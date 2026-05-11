import { test, expect } from '@playwright/test'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UI_BASE = 'http://localhost:3000'
const VM_ID = 'cda24e4e-1e7a-4151-abb8-6baad93715b5'

// Paths relative to web/tests/
const TENBOXD_PATH = process.env.TENBOXD_PATH || path.join(__dirname, '..', '..', 'build', 'tenboxd')
const SERVER_JS_PATH = path.join(__dirname, '..', 'server.js')

function waitFor(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function waitForLog(proc, regex, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for log: ${regex}`)), timeoutMs)

    const check = (data) => {
      buffer += data.toString()
      if (regex.test(buffer)) {
        clearTimeout(timer)
        resolve(buffer)
      }
    }

    proc.stdout.on('data', check)
    proc.stderr.on('data', check)
  })
}

async function api(path, options = {}) {
  const res = await fetch(`http://localhost:3000/api${path}`, options)
  return res.json()
}

test.describe('TenBoxd Stability', () => {
  let tenboxdProc
  let serverProc

  test.beforeAll(async () => {
    // Clean up any stale socket so tenboxd can bind
    const socketPaths = [
      '/run/tenbox/tenbox.sock',
      `${process.env.XDG_RUNTIME_DIR || '/tmp'}/tenbox.sock`,
      `/tmp/tenbox-${process.getuid?.() || 0}.sock`,
    ]
    for (const sp of socketPaths) {
      try { fs.unlinkSync(sp) } catch {}
    }

    console.log('[setup] Starting tenboxd...')
    tenboxdProc = spawn(TENBOXD_PATH, [], {
      cwd: path.join(__dirname, '..', '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let tenboxdLogs = ''
    tenboxdProc.stdout.on('data', (d) => { tenboxdLogs += d })
    tenboxdProc.stderr.on('data', (d) => { tenboxdLogs += d })
    tenboxdProc.on('exit', (code, signal) => {
      console.log(`[tenboxd] EXITED code=${code} signal=${signal}`)
      if (code !== null || signal !== null) {
        console.log('--- tenboxd logs ---')
        console.log(tenboxdLogs.slice(-5000))
      }
    })

    // Wait for tenboxd to create its socket
    let socketReady = false
    for (let i = 0; i < 30; i++) {
      for (const sp of socketPaths) {
        try {
          fs.accessSync(sp, fs.constants.F_OK)
          socketReady = true
          break
        } catch {}
      }
      if (socketReady) break
      await waitFor(1000)
    }
    if (!socketReady) throw new Error('tenboxd socket did not appear')
    console.log('[setup] tenboxd socket ready')

    console.log('[setup] Starting web server...')
    serverProc = spawn('node', [SERVER_JS_PATH], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: '3000' },
    })

    let serverLogs = ''
    serverProc.stdout.on('data', (d) => { serverLogs += d })
    serverProc.stderr.on('data', (d) => { serverLogs += d })
    serverProc.on('exit', (code, signal) => {
      console.log(`[server] EXITED code=${code} signal=${signal}`)
      if (code !== null || signal !== null) {
        console.log('--- server logs ---')
        console.log(serverLogs.slice(-2000))
      }
    })

    await waitForLog(serverProc, /listening on http:\/\/localhost:3000/, 15000)
    console.log('[setup] Web server ready')

    // Ensure VM is running
    const state = await api(`/vms/${VM_ID}`)
    if (state.payload?.runtime?.state !== 'running') {
      console.log('[setup] Starting VM...')
      await api(`/vms/${VM_ID}/start`, { method: 'POST' })
      for (let i = 0; i < 60; i++) {
        await waitFor(2000)
        const s = await api(`/vms/${VM_ID}`)
        if (s.payload?.runtime?.state === 'running') break
      }
    }
    console.log('[setup] VM is running')
  })

  test.afterAll(async () => {
    console.log('[teardown] Cleaning up...')
    if (serverProc && !serverProc.killed) serverProc.kill('SIGTERM')
    if (tenboxdProc && !tenboxdProc.killed) tenboxdProc.kill('SIGTERM')
    await waitFor(2000)
    // Force kill if still alive
    if (serverProc && serverProc.exitCode === null) serverProc.kill('SIGKILL')
    if (tenboxdProc && tenboxdProc.exitCode === null) tenboxdProc.kill('SIGKILL')
  })

  test('remote desktop interaction does not crash tenboxd', async ({ page, context }) => {
    // Track if tenboxd dies during the test
    let tenboxdDied = false
    let tenboxdExitCode = null
    let tenboxdSignal = null

    tenboxdProc.on('exit', (code, signal) => {
      tenboxdDied = true
      tenboxdExitCode = code
      tenboxdSignal = signal
    })

    // Open remote desktop
    const rdPage = await context.newPage()
    console.log('[test] Opening remote desktop...')
    await rdPage.goto(`${UI_BASE}/?remote=${VM_ID}`)

    // Wait for connected status
    await expect(rdPage.locator('.badge-success')).toContainText('Connected', { timeout: 30000 })
    console.log('[test] Remote desktop connected')

    // Collect console logs from the browser
    const logs = []
    rdPage.on('console', (msg) => {
      const text = msg.text()
      if (text.includes('[RemoteDesktop]')) logs.push(text)
    })

    // Take initial screenshot
    await rdPage.screenshot({ path: 'tests/screenshots/stability-01-connected.png' })

    // Get container dimensions
    const containerBox = await rdPage.locator('.rd-container').boundingBox()
    console.log('Container size:', containerBox)

    const videoW = 1024
    const videoH = 768
    const containerAspect = containerBox.width / containerBox.height
    const videoAspect = videoW / videoH
    let renderW, renderH, offsetX, offsetY
    if (containerAspect > videoAspect) {
      renderH = containerBox.height
      renderW = renderH * videoAspect
      offsetX = (containerBox.width - renderW) / 2
      offsetY = 0
    } else {
      renderW = containerBox.width
      renderH = renderW / videoAspect
      offsetX = 0
      offsetY = (containerBox.height - renderH) / 2
    }
    const scaleX = renderW / videoW
    const scaleY = renderH / videoH

    // Helper to click inside the video rendering area
    const clickInVideo = async (vx, vy) => {
      const x = containerBox.x + offsetX + vx * scaleX
      const y = containerBox.y + offsetY + vy * scaleY
      await rdPage.mouse.click(x, y)
    }

    // === Interaction phase ===
    // Click around the desktop periodically for ~60 seconds
    const interactionDurationMs = 60000
    const clickIntervalMs = 3000
    const startTime = Date.now()
    let clickCount = 0

    while (Date.now() - startTime < interactionDurationMs) {
      if (tenboxdDied) {
        console.log(`[test] tenboxd died early at ${Date.now() - startTime}ms`)
        break
      }

      // Click at a few different spots on the desktop
      const spots = [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
        { x: 500, y: 300 },
        { x: 800, y: 500 },
        { x: 300, y: 600 },
      ]
      const spot = spots[clickCount % spots.length]
      await clickInVideo(spot.x, spot.y)
      clickCount++
      console.log(`[test] Click ${clickCount} at video(${spot.x},${spot.y})`)

      // Short wait between clicks
      await rdPage.waitForTimeout(clickIntervalMs)
    }

    // Take final screenshot
    await rdPage.screenshot({ path: 'tests/screenshots/stability-02-final.png' })

    // Check channel open logs
    const controlOpen = logs.some((l) => l.includes('Control channel open'))
    const inputOpen = logs.some((l) => l.includes('Input channel open'))
    console.log('Control open:', controlOpen, 'Input open:', inputOpen)

    // === Stability assertion ===
    if (tenboxdDied) {
      test.info().attach('tenboxd-exit.txt', {
        body: `tenboxd exited with code=${tenboxdExitCode} signal=${tenboxdSignal}`,
        contentType: 'text/plain',
      })
    }

    expect(tenboxdDied, `tenboxd must not die during remote-desktop interaction (exitCode=${tenboxdExitCode}, signal=${tenboxdSignal})`).toBe(false)

    // Also verify the VM is still reported as running via API
    const apiState = await api(`/vms/${VM_ID}`)
    expect(apiState.payload?.runtime?.state).toBe('running')
    expect(apiState.payload?.runtime?.pid).toBeGreaterThan(0)

    await rdPage.close()
  })
})

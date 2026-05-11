import { test, expect } from '@playwright/test'

const UI_BASE = 'http://localhost:3000'
const API_BASE = 'http://localhost:3000/api'
const VM_ID = '50d822e6-4635-4050-9ffa-ac37b12cd063'

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options)
  return res.json()
}

test.describe('Remote into VM', () => {
  test.beforeAll(async () => {
    // Ensure VM is running
    const state = await api(`/vms/${VM_ID}`)
    if (state.payload?.runtime?.state !== 'running') {
      await api(`/vms/${VM_ID}/start`, { method: 'POST' })
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const s = await api(`/vms/${VM_ID}`)
        if (s.payload?.runtime?.state === 'running') break
      }
    }
  })

  test('open remote desktop and interact', async ({ page, context }) => {
    const rdPage = await context.newPage()

    // Collect console logs
    const logs = []
    rdPage.on('console', (msg) => {
      const text = msg.text()
      if (text.includes('[RemoteDesktop]')) {
        logs.push(text)
        console.log('  [console]', text)
      }
    })

    console.log('[test] Opening remote desktop...')
    await rdPage.goto(`${UI_BASE}/?remote=${VM_ID}`)

    // Wait for connected status
    await expect(rdPage.locator('.badge-success')).toContainText('Connected', { timeout: 30000 })
    console.log('[test] Remote desktop connected')

    // Take screenshot
    await rdPage.screenshot({ path: 'tests/screenshots/remote-vm-01-connected.png' })

    // Wait a moment for desktop to settle
    await rdPage.waitForTimeout(2000)

    // Get container dimensions
    const containerBox = await rdPage.locator('.rd-container').boundingBox()
    console.log('Container size:', containerBox)

    // Click in the center of the video rendering area
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

    // Click at a few spots
    const spots = [
      { x: 512, y: 384 },  // center
      { x: 100, y: 100 },  // top-left
      { x: 900, y: 600 },  // bottom-right
    ]

    for (const spot of spots) {
      const clickX = containerBox.x + offsetX + spot.x * scaleX
      const clickY = containerBox.y + offsetY + spot.y * scaleY
      console.log(`Clicking at ${clickX},${clickY}`)
      await rdPage.mouse.click(clickX, clickY)
      await rdPage.waitForTimeout(500)
    }

    // Take another screenshot
    await rdPage.screenshot({ path: 'tests/screenshots/remote-vm-02-after-clicks.png' })

    // Verify we saw mousedown/mouseup in console
    const hasMouseDown = logs.some((l) => l.includes('mousedown'))
    const hasMouseUp = logs.some((l) => l.includes('mouseup'))
    expect(hasMouseDown, 'should see mousedown in console').toBe(true)
    expect(hasMouseUp, 'should see mouseup in console').toBe(true)

    // Verify channels are open
    const controlOpen = logs.some((l) => l.includes('Control channel open'))
    const inputOpen = logs.some((l) => l.includes('Input channel open'))
    console.log('Control open:', controlOpen, 'Input open:', inputOpen)
    expect(controlOpen || inputOpen, 'at least one data channel should open').toBe(true)

    // Check debug overlay text
    const debugText = await rdPage.locator('.rd-debug').textContent()
    console.log('Debug overlay:', debugText)

    await rdPage.close()
  })
})

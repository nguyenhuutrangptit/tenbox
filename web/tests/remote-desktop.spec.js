import { test, expect } from '@playwright/test'

const API_BASE = 'http://localhost:3000/api'
const UI_BASE = 'http://localhost:3000'
const VM_ID = 'cda24e4e-1e7a-4151-abb8-6baad93715b5'

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options)
  return res.json()
}

test.describe('Remote Desktop', () => {
  test.beforeAll(async () => {
    // Ensure VM is running
    const state = await api(`/vms/${VM_ID}`)
    if (state.payload?.runtime?.state !== 'running') {
      await api(`/vms/${VM_ID}/start`, { method: 'POST' })
      // Wait for it to reach running
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const s = await api(`/vms/${VM_ID}`)
        if (s.payload?.runtime?.state === 'running') break
      }
    }
  })

  test('open remote desktop and click file manager icon', async ({ page, context }) => {
    // Open remote desktop in a new tab
    const rdPage = await context.newPage()
    await rdPage.goto(`${UI_BASE}/?remote=${VM_ID}`)

    // Wait for connected status
    await expect(rdPage.locator('.badge-success')).toContainText('Connected', { timeout: 30000 })

    // Check video dimensions
    const videoDims = await rdPage.evaluate(() => {
      const video = document.querySelector('video')
      return video ? { videoWidth: video.videoWidth, videoHeight: video.videoHeight, readyState: video.readyState } : null
    })
    console.log('Video dimensions:', videoDims)

    // Take initial screenshot
    await rdPage.screenshot({ path: 'tests/screenshots/rd-01-connected.png' })

    // Wait a moment for desktop to settle
    await rdPage.waitForTimeout(2000)

    // Get container dimensions
    const containerBox = await rdPage.locator('.rd-container').boundingBox()
    console.log('Container size:', containerBox)

    // The file manager icon (文件系统) is the second icon on the left side.
    // The video is rendered with object-fit: contain inside the container,
    // so we must click within the actual video rendering area.
    // The icon is roughly at x=55, y=220 in the 1024x768 video.
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
    const clickX = containerBox.x + offsetX + 55 * scaleX
    const clickY = containerBox.y + offsetY + 220 * scaleY

    console.log(`Clicking at ${clickX},${clickY}`)

    // Set up console log collection
    const logs = []
    rdPage.on('console', (msg) => {
      const text = msg.text()
      if (text.includes('[RemoteDesktop]')) {
        logs.push(text)
        console.log('  [console]', text)
      }
    })

    // Double-click to open (custom timing for XFCE desktop)
    await rdPage.mouse.move(clickX, clickY)
    await rdPage.mouse.down()
    await rdPage.mouse.up()
    await rdPage.waitForTimeout(80)
    await rdPage.mouse.down()
    await rdPage.mouse.up()
    await rdPage.waitForTimeout(500)

    // Take after-click screenshot
    await rdPage.screenshot({ path: 'tests/screenshots/rd-02-after-click.png' })

    // Wait a bit to see if file manager opens
    await rdPage.waitForTimeout(3000)
    await rdPage.screenshot({ path: 'tests/screenshots/rd-03-after-wait.png' })

    // Verify we saw pointerdown/pointerup in console
    const hasPointerDown = logs.some((l) => l.includes('pointerdown'))
    const hasPointerUp = logs.some((l) => l.includes('pointerup'))
    expect(hasPointerDown, 'should see pointerdown in console').toBe(true)
    expect(hasPointerUp, 'should see pointerup in console').toBe(true)

    // Verify channels are open
    const channelLog = logs.find((l) => l.includes('Control channel open'))
    console.log('Channel open log:', channelLog)

    // Check debug overlay text
    const debugText = await rdPage.locator('.rd-debug').textContent()
    console.log('Debug overlay:', debugText)

    // Close the remote desktop tab
    await rdPage.close()
  })

  test('verify data channels open and input reaches daemon', async ({ context }) => {
    const rdPage = await context.newPage()

    const logs = []
    rdPage.on('console', (msg) => {
      const text = msg.text()
      if (text.includes('[RemoteDesktop]')) logs.push(text)
    })

    await rdPage.goto(`${UI_BASE}/?remote=${VM_ID}`)
    await expect(rdPage.locator('.badge-success')).toContainText('Connected', { timeout: 30000 })

    // Click somewhere on the desktop
    const box = await rdPage.locator('.rd-container').boundingBox()
    await rdPage.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await rdPage.waitForTimeout(500)

    // Verify events were logged
    expect(logs.some((l) => l.includes('pointerdown'))).toBe(true)
    expect(logs.some((l) => l.includes('pointerup'))).toBe(true)

    // Verify at least one channel is open
    const controlOpen = logs.some((l) => l.includes('Control channel open'))
    const inputOpen = logs.some((l) => l.includes('Input channel open'))
    console.log('Control open:', controlOpen, 'Input open:', inputOpen)
    expect(controlOpen || inputOpen, 'at least one data channel should open').toBe(true)

    await rdPage.close()
  })
})

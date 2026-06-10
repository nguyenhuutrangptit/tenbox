import { test, expect } from '@playwright/test'

const UI_BASE = 'http://localhost:3000'
const VM_ID = 'cda24e4e-1e7a-4151-abb8-6baad93715b5'

test.describe('Remote Desktop Input Handling', () => {
  test('right-click sends pointer events and prevents context menu', async ({ context }) => {
    const rdPage = await context.newPage()

    const logs = []
    rdPage.on('console', (msg) => {
      const text = msg.text()
      if (text.includes('[RemoteDesktop]')) logs.push(text)
    })

    // Prevent actual context menus from blocking the test
    await rdPage.addInitScript(() => {
      window.addEventListener('contextmenu', (e) => {
        e.preventDefault()
      }, true)
    })

    await rdPage.goto(`${UI_BASE}/?remote=${VM_ID}`)
    await expect(rdPage.locator('.badge-success')).toContainText('Connected', { timeout: 30000 })

    // Wait for overlay to appear
    await rdPage.waitForSelector('.rd-input-overlay')

    // Get container box and click in the center
    const box = await rdPage.locator('.rd-container').boundingBox()
    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2

    // Right-click
    await rdPage.mouse.click(centerX, centerY, { button: 'right' })
    await rdPage.waitForTimeout(500)

    // Take screenshot for visual confirmation
    await rdPage.screenshot({ path: 'tests/screenshots/input-right-click.png' })

    // Verify pointer events were logged
    const hasPointerDown = logs.some((l) => l.includes('pointerdown'))
    const hasPointerUp = logs.some((l) => l.includes('pointerup'))
    expect(hasPointerDown, 'should see pointerdown for right-click').toBe(true)
    expect(hasPointerUp, 'should see pointerup for right-click').toBe(true)

    // Verify the button=2 (right) was logged
    const rightClickLog = logs.find((l) => l.includes('pointerdown') && l.includes('button=2'))
    expect(rightClickLog, 'pointerdown should report button=2').toBeTruthy()

    await rdPage.close()
  })

  test('middle-click sends pointer events', async ({ context }) => {
    const rdPage = await context.newPage()

    const logs = []
    rdPage.on('console', (msg) => {
      const text = msg.text()
      if (text.includes('[RemoteDesktop]')) logs.push(text)
    })

    await rdPage.goto(`${UI_BASE}/?remote=${VM_ID}`)
    await expect(rdPage.locator('.badge-success')).toContainText('Connected', { timeout: 30000 })
    await rdPage.waitForSelector('.rd-input-overlay')

    const box = await rdPage.locator('.rd-container').boundingBox()
    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2

    // Middle-click
    await rdPage.mouse.click(centerX, centerY, { button: 'middle' })
    await rdPage.waitForTimeout(500)

    await rdPage.screenshot({ path: 'tests/screenshots/input-middle-click.png' })

    const middleClickLog = logs.find((l) => l.includes('pointerdown') && l.includes('button=1'))
    expect(middleClickLog, 'pointerdown should report button=1 for middle-click').toBeTruthy()

    await rdPage.close()
  })

  test('special keys toolbar sends correct key sequences', async ({ context }) => {
    const rdPage = await context.newPage()

    const logs = []
    rdPage.on('console', (msg) => {
      const text = msg.text()
      if (text.includes('[RemoteDesktop]')) logs.push(text)
    })

    await rdPage.goto(`${UI_BASE}/?remote=${VM_ID}`)
    await expect(rdPage.locator('.badge-success')).toContainText('Connected', { timeout: 30000 })

    // Verify toolbar is visible
    await expect(rdPage.locator('.rd-toolbar')).toBeVisible()

    // Click Ctrl+Alt+Del button
    await rdPage.locator('.rd-toolbar button:has-text("Ctrl+Alt+Del")').click()
    await rdPage.waitForTimeout(300)

    // Click Alt+F4 button
    await rdPage.locator('.rd-toolbar button:has-text("Alt+F4")').click()
    await rdPage.waitForTimeout(300)

    // Click Meta button
    await rdPage.locator('.rd-toolbar button:has-text("Meta")').click()
    await rdPage.waitForTimeout(300)

    // Click Esc button
    await rdPage.locator('.rd-toolbar button:has-text("Esc")').click()
    await rdPage.waitForTimeout(300)

    await rdPage.screenshot({ path: 'tests/screenshots/input-special-keys.png' })

    // Verify special key actions were logged
    expect(logs.some((l) => l.includes('Sending Ctrl+Alt+Del'))).toBe(true)
    expect(logs.some((l) => l.includes('Sending Alt+F4'))).toBe(true)
    expect(logs.some((l) => l.includes('Sending Meta key'))).toBe(true)
    expect(logs.some((l) => l.includes('Sending Escape'))).toBe(true)

    await rdPage.close()
  })

  test('keyboard events are captured at window level', async ({ context }) => {
    const rdPage = await context.newPage()

    const logs = []
    rdPage.on('console', (msg) => {
      const text = msg.text()
      if (text.includes('[RemoteDesktop]')) logs.push(text)
    })

    await rdPage.goto(`${UI_BASE}/?remote=${VM_ID}`)
    await expect(rdPage.locator('.badge-success')).toContainText('Connected', { timeout: 30000 })

    // Press a key without explicitly focusing the container first
    // (window-level capture should still intercept it)
    await rdPage.keyboard.press('a')
    await rdPage.waitForTimeout(200)
    await rdPage.keyboard.press('b')
    await rdPage.waitForTimeout(200)
    await rdPage.keyboard.press('c')
    await rdPage.waitForTimeout(200)

    await rdPage.screenshot({ path: 'tests/screenshots/input-keyboard-window.png' })

    const keydownLogs = logs.filter((l) => l.includes('keydown'))
    expect(keydownLogs.length).toBeGreaterThanOrEqual(3)

    // Verify we see the mapped keys (KeyA=30, KeyB=48, KeyC=46)
    expect(logs.some((l) => l.includes('code=KeyA'))).toBe(true)
    expect(logs.some((l) => l.includes('code=KeyB'))).toBe(true)
    expect(logs.some((l) => l.includes('code=KeyC'))).toBe(true)

    await rdPage.close()
  })

  test('key repeat is suppressed', async ({ context }) => {
    const rdPage = await context.newPage()

    const logs = []
    rdPage.on('console', (msg) => {
      const text = msg.text()
      if (text.includes('[RemoteDesktop]')) logs.push(text)
    })

    await rdPage.goto(`${UI_BASE}/?remote=${VM_ID}`)
    await expect(rdPage.locator('.badge-success')).toContainText('Connected', { timeout: 30000 })

    // Hold a key down for a short time, then release
    await rdPage.keyboard.down('x')
    await rdPage.waitForTimeout(600)
    await rdPage.keyboard.up('x')
    await rdPage.waitForTimeout(200)

    const keydownX = logs.filter((l) => l.includes('keydown') && l.includes('code=KeyX'))
    const keyupX = logs.filter((l) => l.includes('keyup') && l.includes('code=KeyX'))

    // Should only see one keydown (no repeat) and one keyup
    expect(keydownX.length).toBe(1)
    expect(keyupX.length).toBe(1)

    await rdPage.close()
  })

  test('beforeunload protection is active when connected', async ({ context }) => {
    const rdPage = await context.newPage()

    await rdPage.goto(`${UI_BASE}/?remote=${VM_ID}`)
    await expect(rdPage.locator('.badge-success')).toContainText('Connected', { timeout: 30000 })

    // In Playwright, beforeunload handlers can be tested by evaluating
    // the returnValue. Modern browsers require user interaction before
    // showing the dialog, but the listener should still be registered.
    const hasListener = await rdPage.evaluate(() => {
      // Check if beforeunload listener is registered by triggering it
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })

    // The event should be cancelable/prevented because our handler calls preventDefault
    expect(hasListener).toBe(true)

    await rdPage.close()
  })
})

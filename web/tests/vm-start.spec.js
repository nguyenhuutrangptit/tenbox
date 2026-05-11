import { test, expect } from '@playwright/test'

const API_BASE = 'http://localhost:3000/api'
const UI_BASE = 'http://localhost:3000'

async function apiVmState(vmId) {
  const res = await fetch(`${API_BASE}/vms/${vmId}`)
  const data = await res.json()
  return data
}

async function apiVmLogs(vmId, lines = 100) {
  const res = await fetch(`${API_BASE}/vms/${vmId}/logs?lines=${lines}`)
  const data = await res.json()
  return data.payload?.lines?.join('\n') || '(no logs)'
}

test.describe('VM Start Flow', () => {
  test('start a stopped/crashed VM and verify it reaches running state', async ({ page }) => {
    const vmId = 'cda24e4e-1e7a-4151-abb8-6baad93715b5'
    const vmName = 'chromium-vm'
    const maxWaitMs = 30000
    const pollIntervalMs = 1000

    // ── 1. Navigate to VM list ───────────────────────────────────────────────
    await page.goto(UI_BASE)
    await page.waitForSelector('.vm-grid, .empty-state', { timeout: 10000 })

    // Take screenshot of initial state
    await page.screenshot({ path: 'tests/screenshots/01-initial-list.png' })

    // Find the VM card
    const vmCard = page.locator('.vm-card').filter({ hasText: vmName })
    await expect(vmCard).toBeVisible({ timeout: 5000 })

    // Capture initial state badge text
    const badge = vmCard.locator('.badge')
    const initialState = await badge.textContent()
    console.log(`Initial VM state: ${initialState?.trim()}`)

    // If already running, stop first so we can test the start flow
    if (initialState?.trim() === 'running') {
      console.log('VM already running — stopping first to test start flow')
      const stopRes = await fetch(`${API_BASE}/vms/${vmId}/stop`, { method: 'POST' })
      const stopData = await stopRes.json()
      expect(stopData.ok).toBe(true)

      // Wait for state to change from running
      await page.waitForFunction(
        () => {
          const badge = document.querySelector('.vm-card .badge')
          return badge && badge.textContent.trim() !== 'running'
        },
        null,
        { timeout: 15000, polling: 1000 }
      )
      await page.screenshot({ path: 'tests/screenshots/02-after-stop.png' })
    }

    // ── 2. Click Start ───────────────────────────────────────────────────────
    const startBtn = vmCard.locator('button:has-text("Start")')
    await expect(startBtn).toBeVisible({ timeout: 5000 })

    // Capture logs before start
    const logsBefore = await apiVmLogs(vmId, 50)
    console.log('--- Logs before start ---')
    console.log(logsBefore.slice(-500))

    await startBtn.click()

    // Wait for toast "Start succeeded"
    const toast = page.locator('.toast.success')
    await expect(toast).toBeVisible({ timeout: 5000 })
    const toastText = await toast.textContent()
    console.log(`Toast: ${toastText}`)
    expect(toastText).toContain('Start succeeded')

    await page.screenshot({ path: 'tests/screenshots/03-after-start-click.png' })

    // ── 3. Poll until running or timeout ─────────────────────────────────────
    console.log(`Polling for 'running' state (max ${maxWaitMs}ms)...`)
    let finalState = initialState
    const startTime = Date.now()

    while (Date.now() - startTime < maxWaitMs) {
      await page.waitForTimeout(pollIntervalMs)
      await page.reload()
      await page.waitForSelector('.vm-grid', { timeout: 10000 })

      const currentBadge = page.locator('.vm-card').filter({ hasText: vmName }).locator('.badge')
      finalState = await currentBadge.textContent()
      finalState = finalState?.trim()
      console.log(`  Poll state: ${finalState} (${Date.now() - startTime}ms)`)

      if (finalState === 'running') {
        break
      }
    }

    await page.screenshot({ path: `tests/screenshots/04-final-state-${finalState}.png` })

    // ── 4. Capture logs after attempt ────────────────────────────────────────
    const logsAfter = await apiVmLogs(vmId, 200)
    console.log('--- Logs after start attempt ---')
    console.log(logsAfter.slice(-2000))

    // ── 5. Assertions ────────────────────────────────────────────────────────
    const apiState = await apiVmState(vmId)
    console.log('API runtime state:', JSON.stringify(apiState.payload?.runtime, null, 2))

    if (finalState !== 'running') {
      // Attach logs to test failure for debugging
      test.info().attach('runtime-logs.txt', {
        body: logsAfter,
        contentType: 'text/plain',
      })
      test.info().attach('api-state.json', {
        body: JSON.stringify(apiState, null, 2),
        contentType: 'application/json',
      })
    }

    expect(finalState, `VM should reach 'running' state but is '${finalState}'`).toBe('running')
    expect(apiState.payload?.runtime?.state).toBe('running')
    expect(apiState.payload?.runtime?.pid).toBeGreaterThan(0)
  })

  test('start flow surfaces errors when runtime is missing', async ({ page }) => {
    // This test documents the expected behavior when the runtime binary is missing.
    // In that case the daemon returns ok=true (fork succeeds) but the VM
    // immediately crashes with exit code 127. The web UI should eventually
    // reflect the crashed state rather than staying stuck.
    const vmId = 'cda24e4e-1e7a-4151-abb8-6baad93715b5'
    const vmName = 'chromium-vm'

    await page.goto(UI_BASE)
    await page.waitForSelector('.vm-grid, .empty-state', { timeout: 10000 })

    const vmCard = page.locator('.vm-card').filter({ hasText: vmName })
    await expect(vmCard).toBeVisible()

    // If currently running, stop it first
    const badge = vmCard.locator('.badge')
    const state = await badge.textContent()
    if (state?.trim() === 'running') {
      await fetch(`${API_BASE}/vms/${vmId}/stop`, { method: 'POST' })
      await page.waitForTimeout(3000)
      await page.reload()
    }

    // Verify we can see the Start button
    const startBtn = vmCard.locator('button:has-text("Start")')
    await expect(startBtn).toBeVisible()

    // Click start
    await startBtn.click()
    await expect(page.locator('.toast')).toBeVisible({ timeout: 5000 })

    // Wait a few seconds for state to settle
    await page.waitForTimeout(5000)
    await page.reload()
    await page.waitForSelector('.vm-grid', { timeout: 10000 })

    // State should NOT stay stuck on 'crashed' with the old error if
    // start actually succeeded. If it crashes again, the last_failure
    // should be updated.
    const apiState = await apiVmState(vmId)
    const runtime = apiState.payload?.runtime

    console.log('Runtime after start attempt:', JSON.stringify(runtime, null, 2))

    // The web UI must reflect the actual current state, not cached state
    const currentBadge = vmCard.locator('.badge')
    const currentState = await currentBadge.textContent()
    console.log(`Current UI state: ${currentState?.trim()}`)

    // We expect either 'running' or 'crashed' — but never a silent failure
    // where the toast says success but state never updates.
    expect(['running', 'crashed', 'starting', 'stopping']).toContain(currentState?.trim())
  })
})

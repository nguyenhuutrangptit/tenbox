import express from 'express'
import { WebSocketServer } from 'ws'
import net from 'net'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())

function getSocketPath() {
  if (process.env.TENBOX_SOCK) return process.env.TENBOX_SOCK
  try {
    const st = fs.statSync('/run/tenbox')
    if (st.isDirectory()) return '/run/tenbox/tenbox.sock'
  } catch {}
  if (process.env.XDG_RUNTIME_DIR) return `${process.env.XDG_RUNTIME_DIR}/tenbox.sock`
  return `/tmp/tenbox-${process.getuid?.() || 0}.sock`
}

function tenboxdRequest(reqBody) {
  return new Promise((resolve, reject) => {
    const socketPath = getSocketPath()
    let buffer = ''
    let resolved = false

    const client = net.createConnection(socketPath, () => {
      client.write(JSON.stringify(reqBody) + '\n')
    })

    client.on('data', (chunk) => {
      buffer += chunk.toString()
      const idx = buffer.indexOf('\n')
      if (idx !== -1 && !resolved) {
        resolved = true
        const line = buffer.slice(0, idx)
        client.end()
        try {
          resolve(JSON.parse(line))
        } catch (e) {
          reject(new Error('Invalid JSON from tenboxd: ' + line))
        }
      }
    })

    client.on('error', (err) => {
      if (!resolved) {
        resolved = true
        reject(err)
      }
    })

    client.on('close', (hadError) => {
      if (!resolved && !hadError) {
        resolved = true
        reject(new Error('Connection closed without response'))
      }
    })

    setTimeout(() => {
      if (!resolved) {
        resolved = true
        client.destroy()
        reject(new Error('Request timed out'))
      }
    }, 30000)
  })
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

// ── API Routes ───────────────────────────────────────────────────────────────

app.get('/api/system/info', asyncHandler(async (req, res) => {
  const data = await tenboxdRequest({ type: 'system.info' })
  res.json(data)
}))

app.get('/api/system/doctor', asyncHandler(async (req, res) => {
  const data = await tenboxdRequest({ type: 'doctor' })
  res.json(data)
}))

app.get('/api/vms', asyncHandler(async (req, res) => {
  const data = await tenboxdRequest({ type: 'vm.list' })
  res.json(data)
}))

app.get('/api/vms/:id', asyncHandler(async (req, res) => {
  const data = await tenboxdRequest({ type: 'vm.list' })
  if (!data.ok) {
    res.json(data)
    return
  }
  const vms = data.payload?.vms || []
  const vm = vms.find(v => v.spec?.id === req.params.id || v.spec?.name === req.params.id)
  if (!vm) {
    res.status(404).json({ ok: false, error: 'VM not found' })
    return
  }
  res.json({ ok: true, payload: vm })
}))

app.post('/api/vms', asyncHandler(async (req, res) => {
  const data = await tenboxdRequest({ type: 'vm.create', payload: req.body })
  res.json(data)
}))

app.post('/api/vms/:id/start', asyncHandler(async (req, res) => {
  const data = await tenboxdRequest({ type: 'vm.start', vm_id: req.params.id })
  res.json(data)
}))

app.post('/api/vms/:id/stop', asyncHandler(async (req, res) => {
  const data = await tenboxdRequest({ type: 'vm.stop', vm_id: req.params.id })
  res.json(data)
}))

app.post('/api/vms/:id/reboot', asyncHandler(async (req, res) => {
  const data = await tenboxdRequest({ type: 'vm.reboot', vm_id: req.params.id })
  res.json(data)
}))

app.post('/api/vms/:id/shutdown', asyncHandler(async (req, res) => {
  const data = await tenboxdRequest({ type: 'vm.shutdown', vm_id: req.params.id })
  res.json(data)
}))

app.delete('/api/vms/:id', asyncHandler(async (req, res) => {
  const data = await tenboxdRequest({ type: 'vm.delete', vm_id: req.params.id })
  res.json(data)
}))

app.post('/api/vms/:id/edit', asyncHandler(async (req, res) => {
  const data = await tenboxdRequest({ type: 'vm.edit', vm_id: req.params.id, payload: req.body })
  res.json(data)
}))

app.get('/api/vms/:id/logs', asyncHandler(async (req, res) => {
  const lines = parseInt(req.query.lines || '200', 10)
  const data = await tenboxdRequest({ type: 'vm.logs', vm_id: req.params.id, lines })
  res.json(data)
}))

// ── Static / SPA ─────────────────────────────────────────────────────────────

const distDir = path.join(__dirname, 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

// ── Error Handling ───────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('API error:', err.message)
  res.status(500).json({ ok: false, error: err.message })
})

const PORT = process.env.PORT || 3000
const server = app.listen(PORT, () => {
  console.log(`TenBox Web API listening on http://localhost:${PORT}`)
  console.log(`TenBox socket: ${getSocketPath()}`)
})

// ── WebSocket Remote Desktop Signaling ───────────────────────────────────────
// Uses JSON-RPC 2.0 framing over WebSocket for structured req/res correlation.

const wss = new WebSocketServer({ server })

function wsSend(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg))
}

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname !== '/ws/remote') {
    ws.close()
    return
  }
  const vmId = url.searchParams.get('vm')
  if (!vmId) {
    wsSend(ws, { jsonrpc: '2.0', error: { code: 'invalid_params', message: 'vm query param required' } })
    ws.close()
    return
  }

  let sessionId = null
  let closed = false

  async function sendToTenboxd(request) {
    return tenboxdRequest(request)
  }

  try {
    const createRes = await sendToTenboxd({
      type: 'remote_session.create',
      vm_id: vmId,
      force: true,
    })
    if (!createRes.ok) {
      wsSend(ws, { jsonrpc: '2.0', error: { code: 'session_failed', message: createRes.error || 'Failed to create session' } })
      ws.close()
      return
    }
    sessionId = createRes.payload?.session_id
    wsSend(ws, { jsonrpc: '2.0', method: 'session_created', params: { session_id: sessionId, payload: createRes.payload } })
  } catch (e) {
    wsSend(ws, { jsonrpc: '2.0', error: { code: 'session_failed', message: e.message } })
    ws.close()
    return
  }

  ws.on('message', async (data) => {
    if (closed) return
    try {
      const msg = JSON.parse(data.toString())
      const id = msg.id
      const method = msg.method || msg.type

      // Heartbeat
      if (method === 'ping') {
        wsSend(ws, { jsonrpc: '2.0', id, result: { pong: true } })
        return
      }

      let result = null

      if (method === 'offer') {
        result = await sendToTenboxd({
          type: 'remote_signal.offer',
          vm_id: vmId,
          session_id: sessionId,
          sdp: msg.params?.sdp || msg.sdp,
        })
      } else if (method === 'candidate') {
        result = await sendToTenboxd({
          type: 'remote_signal.candidate',
          vm_id: vmId,
          session_id: sessionId,
          candidate: msg.params?.candidate || msg.candidate,
          sdpMid: msg.params?.sdpMid || msg.sdpMid,
          sdpMLineIndex: msg.params?.sdpMLineIndex || msg.sdpMLineIndex,
        })
      } else if (method === 'configure') {
        result = await sendToTenboxd({
          type: 'remote_session.configure',
          vm_id: vmId,
          session_id: sessionId,
          payload: msg.params?.payload || msg.payload || {},
        })
      } else if (method === 'resize') {
        result = await sendToTenboxd({
          type: 'remote_session.resize',
          vm_id: vmId,
          session_id: sessionId,
          payload: {
            width: msg.params?.width || msg.width,
            height: msg.params?.height || msg.height,
          },
        })
      } else if (method === 'close') {
        closed = true
        result = await sendToTenboxd({
          type: 'remote_session.close',
          vm_id: vmId,
          session_id: sessionId,
        })
        ws.close()
      } else {
        wsSend(ws, { jsonrpc: '2.0', id, error: { code: 'unknown_method', message: 'unknown method: ' + method } })
        return
      }

      if (id !== undefined) {
        wsSend(ws, { jsonrpc: '2.0', id, result })
      }
    } catch (e) {
      const id = msg?.id
      wsSend(ws, { jsonrpc: '2.0', id, error: { code: 'internal_error', message: e.message } })
    }
  })

  ws.on('close', async () => {
    if (closed || !sessionId) return
    closed = true
    try {
      await sendToTenboxd({
        type: 'remote_session.close',
        vm_id: vmId,
        session_id: sessionId,
      })
    } catch (e) {
      // ignore cleanup errors
    }
  })

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message)
  })
})

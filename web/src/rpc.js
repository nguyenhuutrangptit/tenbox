/**
 * RpcClient — structured JSON-RPC over WebSocket with req/res correlation,
 * auto-reconnect, and heartbeat.
 */

export class RpcError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
    this.name = 'RpcError'
  }
}

export class RpcClient {
  constructor(url) {
    this.url = url
    this.ws = null
    this.connected = false
    this.nextId = 1
    this.pending = new Map() // id -> { resolve, reject, timer }
    this.notifyHandlers = new Map() // type -> handler[]
    this.onClose = null
    this.onOpen = null
    this.onError = null
    this.reconnectTimer = null
    this.reconnectDelay = 1000
    this.maxReconnectDelay = 30000
    this.heartbeatInterval = null
    this.heartbeatMs = 15000
    this.closed = false
  }

  connect() {
    if (this.closed) return Promise.reject(new RpcError('closed', 'client is closed'))
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.url)
        this.ws = ws

        ws.onopen = () => {
          this.connected = true
          this.reconnectDelay = 1000
          this._startHeartbeat()
          if (this.onOpen) this.onOpen()
          resolve()
        }

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data)
            this._handleMessage(msg)
          } catch (e) {
            console.error('[RpcClient] invalid json:', e.message)
          }
        }

        ws.onerror = (err) => {
          if (!this.connected) {
            reject(new RpcError('connect_failed', 'WebSocket connection failed'))
          }
          if (this.onError) this.onError(err)
        }

        ws.onclose = () => {
          this.connected = false
          this._stopHeartbeat()
          this._rejectPending(new RpcError('disconnected', 'connection closed'))
          if (this.onClose) this.onClose()
          if (!this.closed) {
            this._scheduleReconnect()
          }
        }
      } catch (e) {
        reject(new RpcError('connect_failed', e.message))
      }
    })
  }

  _handleMessage(msg) {
    // Response to a pending request
    if (msg.id !== undefined && msg.id !== null) {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(msg.id)
      if (msg.error) {
        pending.reject(new RpcError(msg.error.code || 'error', msg.error.message || 'unknown error'))
      } else {
        pending.resolve(msg.result)
      }
      return
    }

    // Server notification
    const type = msg.type || msg.method
    if (type) {
      const handlers = this.notifyHandlers.get(type)
      if (handlers) {
        handlers.forEach((h) => {
          try { h(msg.params || msg.payload || msg) } catch (e) { console.error(e) }
        })
      }
    }
  }

  request(method, params = {}, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.ws) {
        reject(new RpcError('not_connected', 'not connected'))
        return
      }
      const id = this.nextId++
      const msg = { jsonrpc: '2.0', id, method, params }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new RpcError('timeout', `request ${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify(msg))
    })
  }

  notify(method, params = {}) {
    if (!this.connected || !this.ws) return
    this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }))
  }

  onNotify(type, handler) {
    let list = this.notifyHandlers.get(type)
    if (!list) {
      list = []
      this.notifyHandlers.set(type, list)
    }
    list.push(handler)
    return () => {
      const idx = list.indexOf(handler)
      if (idx !== -1) list.splice(idx, 1)
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat()
    this.heartbeatInterval = setInterval(() => {
      if (this.connected && this.ws) {
        this.ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'ping' }))
      }
    }, this.heartbeatMs)
  }

  _stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      console.log(`[RpcClient] reconnecting in ${this.reconnectDelay}ms...`)
      this.connect().catch(() => {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
      })
    }, this.reconnectDelay)
  }

  _rejectPending(err) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pending.clear()
  }

  close() {
    this.closed = true
    this._stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this._rejectPending(new RpcError('closed', 'client closed'))
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

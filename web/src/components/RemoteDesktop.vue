<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { RpcClient } from '../rpc.js'

const props = defineProps({ vmId: String, fullscreen: Boolean })
const emit = defineEmits(['back'])

const videoRef = ref(null)
const containerRef = ref(null)
const cursorRef = ref(null)
const status = ref('connecting')
const statusMessage = ref('Connecting…')
const error = ref('')
const pc = ref(null)
const sessionId = ref('')
const dataChannels = ref({})
const isPointerLocked = ref(false)
const cursorPos = ref({ x: -100, y: -100, visible: false })

// Debug state
const debug = ref({
  controlOpen: false,
  inputOpen: false,
  lastEvent: '',
  mouseX: 0,
  mouseY: 0,
  queued: 0,
  frozen: false,
  fps: 0,
})

const inputQueue = ref([])
let rpc = null
let resizeTimeout = null
let freezeCheckInterval = null
let rvfcHandle = null
let mouseX = 0
let mouseY = 0
const ripples = ref([])

function log(msg) {
  console.log('[RemoteDesktop]', msg)
}

function setError(msg) {
  error.value = msg
  status.value = 'error'
  statusMessage.value = msg
}

function browserButtonToVmBit(browserButton) {
  switch (browserButton) {
    case 0: return 1
    case 1: return 4
    case 2: return 2
    default: return 0
  }
}

function vmButtonsMask(browserButtons) {
  return browserButtons
}

async function connect() {
  error.value = ''
  status.value = 'connecting'
  statusMessage.value = 'Connecting to signaling server…'

  const wsUrl = `ws://${window.location.host}/ws/remote?vm=${encodeURIComponent(props.vmId)}`
  rpc = new RpcClient(wsUrl)

  rpc.onOpen = () => {
    log('WebSocket connected')
    statusMessage.value = 'Creating remote session…'
  }

  rpc.onNotify('session_created', (params) => {
    sessionId.value = params.session_id
    log('Session created: ' + params.session_id)
    startWebRTC()
  })

  rpc.onError = (err) => {
    log('WebSocket error')
    setError('Signaling connection failed')
  }

  rpc.onClose = () => {
    log('WebSocket closed')
    if (status.value !== 'error') {
      status.value = 'closed'
      statusMessage.value = 'Connection closed'
    }
    cleanup()
  }

  try {
    await rpc.connect()
  } catch (e) {
    setError(e.message || 'Signaling connection failed')
  }
}

async function startWebRTC() {
  statusMessage.value = 'Starting WebRTC…'

  const config = { iceServers: [] }
  const peer = new RTCPeerConnection(config)
  pc.value = peer

  peer.addTransceiver('video', { direction: 'recvonly' })
  peer.addTransceiver('audio', { direction: 'recvonly' })

  const controlChannel = peer.createDataChannel('control', { ordered: true })
  const inputChannel = peer.createDataChannel('input-fast', { ordered: false, maxRetransmits: 0 })

  dataChannels.value = { control: controlChannel, input: inputChannel }

  controlChannel.onopen = () => {
    debug.value.controlOpen = true
    log('Control channel open')
    flushInputQueue()
  }
  controlChannel.onmessage = (e) => handleControlMessage(e.data)
  controlChannel.onclose = () => { debug.value.controlOpen = false; log('Control channel closed') }

  inputChannel.onopen = () => {
    debug.value.inputOpen = true
    log('Input channel open')
    flushInputQueue()
  }
  inputChannel.onclose = () => { debug.value.inputOpen = false; log('Input channel closed') }

  peer.ontrack = (event) => {
    log('Track: ' + event.track.kind)
    if (event.track.kind === 'video' && videoRef.value) {
      const stream = event.streams[0] || new MediaStream([event.track])
      videoRef.value.srcObject = stream
      videoRef.value.play().catch(() => {})
      setInterval(() => {
        if (videoRef.value) {
          log('Video size: ' + videoRef.value.videoWidth + 'x' + videoRef.value.videoHeight)
        }
      }, 2000)
    }
    if (event.track.kind === 'audio') {
      const stream = event.streams[0] || new MediaStream([event.track])
      const audio = new Audio()
      audio.srcObject = stream
      audio.autoplay = true
    }
  }

  peer.onicecandidate = (event) => {
    if (event.candidate && rpc?.connected) {
      rpc.notify('candidate', {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      })
    }
  }

  peer.oniceconnectionstatechange = () => {
    log('ICE state: ' + peer.iceConnectionState)
  }

  peer.onconnectionstatechange = () => {
    log('Peer/Conn state: ' + peer.connectionState)
    if (peer.connectionState === 'connected') {
      status.value = 'connected'
      statusMessage.value = 'Connected'
      startFreezeCheck()
    } else if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
      if (status.value !== 'error') {
        status.value = 'disconnected'
        statusMessage.value = 'Connection lost'
      }
      if (freezeCheckInterval) {
        clearInterval(freezeCheckInterval)
        freezeCheckInterval = null
      }
    }
  }

  const offer = await peer.createOffer()
  await peer.setLocalDescription(offer)

  log('Sending offer')
  try {
    const res = await rpc.request('offer', { sdp: offer.sdp }, 30000)
    const answerPayload = res.payload || res
    const sdp = answerPayload.sdp
    const candidates = answerPayload.candidates || []

    log('Got answer')
    await peer.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }))

    for (const cand of candidates) {
      try {
        await peer.addIceCandidate(new RTCIceCandidate(cand))
      } catch (e) {
        log('ICE candidate failed: ' + e.message)
      }
    }
  } catch (e) {
    setError(e.message || 'WebRTC negotiation failed')
  }
}

function handleControlMessage(data) {
  try {
    const msg = JSON.parse(data)
    if (msg.type === 'cursor' && msg.cursor) {
      const c = msg.cursor
      cursorPos.value = {
        x: c.x ?? -100,
        y: c.y ?? -100,
        visible: c.visible !== false,
        hot_x: c.hot_x ?? 0,
        hot_y: c.hot_y ?? 0,
      }
    }
  } catch (e) {
    // ignore
  }
}

function anyChannelOpen() {
  return debug.value.controlOpen || debug.value.inputOpen
}

function flushInputQueue() {
  if (!anyChannelOpen()) return
  while (inputQueue.value.length > 0) {
    const { type, payload, isControl } = inputQueue.value.shift()
    if (isControl) sendControlNow(type, payload)
    else sendInputNow(type, payload)
  }
  debug.value.queued = inputQueue.value.length
}

function sendInputNow(type, payload) {
  const ch = dataChannels.value.input || dataChannels.value.control
  if (ch && ch.readyState === 'open') {
    const msg = JSON.stringify({ type, ...payload })
    ch.send(msg)
    debug.value.lastEvent = `[input] ${type} ${msg.slice(0, 80)}`
  }
}

function sendControlNow(type, payload) {
  const ch = dataChannels.value.control
  if (ch && ch.readyState === 'open') {
    const msg = JSON.stringify({ type, ...payload })
    ch.send(msg)
    debug.value.lastEvent = `[control] ${type} ${msg.slice(0, 80)}`
  }
}

function sendInput(type, payload) {
  if (!anyChannelOpen()) {
    inputQueue.value.push({ type, payload, isControl: false })
    debug.value.queued = inputQueue.value.length
    return
  }
  sendInputNow(type, payload)
}

function sendControl(type, payload) {
  if (!debug.value.controlOpen) {
    inputQueue.value.push({ type, payload, isControl: true })
    debug.value.queued = inputQueue.value.length
    return
  }
  sendControlNow(type, payload)
}

// ── Visual debug: click ripple ───────────────────────────────────────────────

function addRipple(cx, cy) {
  const id = Date.now() + Math.random()
  ripples.value.push({ id, cx, cy })
  setTimeout(() => {
    ripples.value = ripples.value.filter((r) => r.id !== id)
  }, 600)
}

// ── Mouse events ─────────────────────────────────────────────────────────────

function getMousePos(e) {
  if (!containerRef.value || !videoRef.value) return { x: 0, y: 0 }
  const containerRect = containerRef.value.getBoundingClientRect()
  const videoWidth = videoRef.value.videoWidth || 1024
  const videoHeight = videoRef.value.videoHeight || 768

  if (isPointerLocked.value) {
    mouseX = Math.max(0, Math.min(containerRect.width, mouseX + e.movementX))
    mouseY = Math.max(0, Math.min(containerRect.height, mouseY + e.movementY))
  } else {
    mouseX = e.clientX - containerRect.left
    mouseY = e.clientY - containerRect.top
  }

  // Map container coordinates to video intrinsic dimensions,
  // accounting for object-fit: contain letterboxing.
  const containerAspect = containerRect.width / containerRect.height
  const videoAspect = videoWidth / videoHeight
  let renderWidth, renderHeight, offsetX, offsetY
  if (containerAspect > videoAspect) {
    // Container is wider: black bars on left/right
    renderHeight = containerRect.height
    renderWidth = renderHeight * videoAspect
    offsetX = (containerRect.width - renderWidth) / 2
    offsetY = 0
  } else {
    // Container is taller: black bars on top/bottom
    renderWidth = containerRect.width
    renderHeight = renderWidth / videoAspect
    offsetX = 0
    offsetY = (containerRect.height - renderHeight) / 2
  }

  const scaleX = videoWidth / renderWidth
  const scaleY = videoHeight / renderHeight
  const videoX = (mouseX - offsetX) * scaleX
  const videoY = (mouseY - offsetY) * scaleY

  debug.value.mouseX = Math.round(mouseX)
  debug.value.mouseY = Math.round(mouseY)
  return {
    x: Math.round(Math.max(0, Math.min(videoWidth, videoX))),
    y: Math.round(Math.max(0, Math.min(videoHeight, videoY))),
  }
}

function onMouseMove(e) {
  const pos = getMousePos(e)
  // All pointer events (move + button state) must use the reliable
  // control channel.  input-fast is unordered/unreliable; a dropped
  // or reordered move event can carry a stale buttons mask that
  // desynchronises the guest's inject_prev_buttons_ tracking.
  sendControl('pointer', { x: pos.x, y: pos.y, buttons: vmButtonsMask(e.buttons) })
}

function onMouseDown(e) {
  const pos = getMousePos(e)
  const buttons = vmButtonsMask(e.buttons)
  log('mousedown button=' + e.button + ' buttons=' + buttons + ' pos=' + pos.x + ',' + pos.y)
  sendControl('pointer', { x: pos.x, y: pos.y, buttons })
  // Use container coords for visual ripple placement
  const containerRect = containerRef.value?.getBoundingClientRect()
  const cx = containerRect ? e.clientX - containerRect.left : pos.x
  const cy = containerRect ? e.clientY - containerRect.top : pos.y
  addRipple(cx, cy)
}

function onMouseUp(e) {
  const pos = getMousePos(e)
  const buttons = vmButtonsMask(e.buttons)
  log('mouseup button=' + e.button + ' buttons=' + buttons + ' pos=' + pos.x + ',' + pos.y)
  sendControl('pointer', { x: pos.x, y: pos.y, buttons })
}

function onWheel(e) {
  e.preventDefault()
  sendControl('wheel', { delta: -e.deltaY })
}

// ── Keyboard events ──────────────────────────────────────────────────────────

function onKeyDown(e) {
  e.preventDefault()
  sendControl('key', { key_code: e.keyCode, pressed: true })
}

function onKeyUp(e) {
  e.preventDefault()
  sendControl('key', { key_code: e.keyCode, pressed: false })
}

function requestPointerLock() {
  if (containerRef.value && containerRef.value.requestPointerLock) {
    containerRef.value.requestPointerLock()
  }
}

function focusContainer() {
  containerRef.value?.focus()
}

function onPointerLockChange() {
  const locked = document.pointerLockElement === containerRef.value
  if (locked) {
    const rect = containerRef.value?.getBoundingClientRect()
    if (rect) {
      mouseX = rect.width / 2
      mouseY = rect.height / 2
    }
  }
  isPointerLocked.value = locked
}

// ── Resize ───────────────────────────────────────────────────────────────────

function onResize() {
  if (resizeTimeout) clearTimeout(resizeTimeout)
  resizeTimeout = setTimeout(() => {
    const el = containerRef.value
    if (!el || !rpc?.connected) return
    rpc.notify('resize', { width: el.clientWidth, height: el.clientHeight })
  }, 300)
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

function cleanup() {
  if (freezeCheckInterval) {
    clearInterval(freezeCheckInterval)
    freezeCheckInterval = null
  }
  if (rvfcHandle && videoRef.value && 'cancelVideoFrameCallback' in videoRef.value) {
    videoRef.value.cancelVideoFrameCallback(rvfcHandle)
    rvfcHandle = null
  }
  if (pc.value) {
    pc.value.close()
    pc.value = null
  }
  if (rpc) {
    rpc.close()
    rpc = null
  }
  dataChannels.value = {}
  debug.value.controlOpen = false
  debug.value.inputOpen = false
  inputQueue.value = []
}

function startFreezeCheck() {
  if (freezeCheckInterval) clearInterval(freezeCheckInterval)
  if (rvfcHandle && videoRef.value && 'cancelVideoFrameCallback' in videoRef.value) {
    videoRef.value.cancelVideoFrameCallback(rvfcHandle)
    rvfcHandle = null
  }
  let lastTime = 0
  let lastFrameCount = 0
  let stallCount = 0

  const video = videoRef.value
  if (video && 'requestVideoFrameCallback' in video) {
    const onFrame = () => {
      lastFrameCount++
      rvfcHandle = video.requestVideoFrameCallback(onFrame)
    }
    rvfcHandle = video.requestVideoFrameCallback(onFrame)
  }

  freezeCheckInterval = setInterval(async () => {
    const v = videoRef.value
    if (!v || v.readyState < 2) return

    // Prefer requestVideoFrameCallback frame count if available
    const frameCount = lastFrameCount
    const usingRvfc = 'requestVideoFrameCallback' in v
    const currentTime = v.currentTime

    const isStalled = usingRvfc
      ? frameCount === lastTime
      : currentTime === lastTime

    if (isStalled) {
      stallCount++
      debug.value.frozen = true
      debug.value.fps = 0
      log('VIDEO STALL #' + stallCount +
          ' paused=' + v.paused +
          ' rs=' + v.readyState +
          ' currentTime=' + currentTime.toFixed(2) +
          ' frames=' + frameCount +
          ' rvfc=' + usingRvfc)
      // Auto-resume if browser paused the element
      if (v.paused) {
        log('Attempting to resume paused video')
        v.play().catch((e) => log('Resume failed: ' + e.message))
      }
      // If stalled for > 6s, check WebRTC stats
      if (stallCount >= 3 && pc.value) {
        log('Stalled too long, checking ICE stats...')
        try {
          const stats = await pc.value.getStats()
          let inboundPackets = 0
          let inboundBytes = 0
          let packetsLost = 0
          let jitter = 0
          stats.forEach((s) => {
            if (s.type === 'inbound-rtp' && s.mediaType === 'video') {
              inboundPackets = s.packetsReceived || 0
              inboundBytes = s.bytesReceived || 0
              packetsLost = s.packetsLost || 0
              jitter = s.jitter || 0
            }
          })
          log('Inbound video: packets=' + inboundPackets +
              ' bytes=' + inboundBytes +
              ' lost=' + packetsLost +
              ' jitter=' + jitter.toFixed(3))
        } catch (e) {
          log('Stats error: ' + e.message)
        }
      }
    } else {
      stallCount = 0
      debug.value.frozen = false
      const dt = currentTime - lastTime
      debug.value.fps = dt > 0 ? Math.round(1 / dt) : 0
    }
    lastTime = usingRvfc ? frameCount : currentTime
  }, 2000)
}

function disconnect() {
  cleanup()
  emit('back')
}

function onVisibilityChange() {
  if (!document.hidden && videoRef.value && videoRef.value.paused) {
    log('Tab visible, resuming video')
    videoRef.value.play().catch(() => {})
  }
}

onMounted(() => {
  connect()
  document.addEventListener('pointerlockchange', onPointerLockChange)
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  cleanup()
  document.removeEventListener('pointerlockchange', onPointerLockChange)
  window.removeEventListener('resize', onResize)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <div class="remote-desktop">
    <div class="rd-header">
      <button class="btn-secondary btn-sm" @click="disconnect">← Back</button>
      <div class="rd-status">
        <span class="badge" :class="{
          'badge-success': status === 'connected',
          'badge-warning': status === 'connecting',
          'badge-error': status === 'error' || status === 'disconnected',
        }">{{ statusMessage }}</span>
      </div>
      <button v-if="status === 'connected'" class="btn-primary btn-sm" @click="requestPointerLock">
        {{ isPointerLocked ? 'Pointer locked' : 'Lock pointer' }}
      </button>
    </div>

    <div v-if="error" class="card-white" style="margin-top: 16px; color: #ef4444">
      {{ error }}
    </div>

    <div
      ref="containerRef"
      class="rd-container"
      tabindex="0"
      @keydown="onKeyDown"
      @keyup="onKeyUp"
      @click="focusContainer"
    >
      <video
        v-show="status === 'connected'"
        ref="videoRef"
        class="rd-video"
        autoplay
        playsinline
        muted
        disablePictureInPicture
      />

      <!-- Transparent input capture overlay -->
      <div
        v-if="status === 'connected'"
        class="rd-input-overlay"
        @mousemove="onMouseMove"
        @mousedown="onMouseDown"
        @mouseup="onMouseUp"
        @wheel="onWheel"
      />

      <!-- Custom cursor -->
      <div
        v-if="cursorPos.visible && status === 'connected'"
        ref="cursorRef"
        class="rd-cursor"
        :style="{
          left: (cursorPos.x - cursorPos.hot_x) + 'px',
          top: (cursorPos.y - cursorPos.hot_y) + 'px',
        }"
      />

      <!-- Click ripples (container coords for correct visual placement) -->
      <div
        v-for="r in ripples"
        :key="r.id"
        class="rd-ripple"
        :style="{ left: r.cx + 'px', top: r.cy + 'px' }"
      />

      <!-- Debug overlay -->
      <div v-if="status === 'connected'" class="rd-debug">
        <div>control={{ debug.controlOpen ? 'open' : 'closed' }} input={{ debug.inputOpen ? 'open' : 'closed' }}</div>
        <div>mouse={{ debug.mouseX }},{{ debug.mouseY }} queued={{ debug.queued }}</div>
        <div>fps={{ debug.fps }} {{ debug.frozen ? 'FROZEN' : '' }}</div>
        <div class="rd-debug-last">{{ debug.lastEvent }}</div>
      </div>

      <div v-if="status !== 'connected'" class="rd-placeholder">
        <div class="spinner" />
        <span class="body-sm" style="color: #6b7280; margin-top: 12px">{{ statusMessage }}</span>
      </div>
    </div>

    <div class="rd-hint body-sm" style="color: #6b7280; margin-top: 8px">
      Click the video area to focus. Use "Lock pointer" to capture mouse. Press Esc to release.
    </div>
  </div>
</template>

<style scoped>
.remote-desktop {
  display: flex;
  flex-direction: column;
  height: v-bind('fullscreen ? "100vh" : "calc(100vh - 64px - 48px)"');
  padding: v-bind('fullscreen ? "0" : "16px 0"');
}

.rd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.rd-status {
  flex: 1;
  text-align: center;
}

.rd-container {
  flex: 1;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  outline: none;
  cursor: crosshair;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rd-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}

.rd-input-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
  cursor: crosshair;
}

.rd-cursor {
  position: absolute;
  width: 20px;
  height: 20px;
  pointer-events: none;
  z-index: 10;
  border: 2px solid #fff;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
  mix-blend-mode: difference;
}

.rd-ripple {
  position: absolute;
  width: 40px;
  height: 40px;
  margin-left: -20px;
  margin-top: -20px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.4);
  pointer-events: none;
  z-index: 20;
  animation: ripple-anim 0.6s ease-out forwards;
}

@keyframes ripple-anim {
  0% { transform: scale(0.5); opacity: 1; }
  100% { transform: scale(2); opacity: 0; }
}

.rd-debug {
  position: absolute;
  top: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.7);
  color: #0f0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.5;
  padding: 6px 10px;
  border-radius: 6px;
  pointer-events: none;
  z-index: 30;
  max-width: 80%;
}

.rd-debug-last {
  color: #ff0;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rd-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.rd-hint {
  text-align: center;
}
</style>

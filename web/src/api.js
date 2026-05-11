const API_BASE = '/api'

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json()
}

export default {
  getSystemInfo() {
    return api('/system/info')
  },
  getDoctor() {
    return api('/system/doctor')
  },
  getVms() {
    return api('/vms')
  },
  createVm(payload) {
    return api('/vms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  },
  startVm(id) {
    return api(`/vms/${id}/start`, { method: 'POST' })
  },
  stopVm(id) {
    return api(`/vms/${id}/stop`, { method: 'POST' })
  },
  rebootVm(id) {
    return api(`/vms/${id}/reboot`, { method: 'POST' })
  },
  shutdownVm(id) {
    return api(`/vms/${id}/shutdown`, { method: 'POST' })
  },
  deleteVm(id) {
    return api(`/vms/${id}`, { method: 'DELETE' })
  },
  editVm(id, payload) {
    return api(`/vms/${id}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  },
  getLogs(id, lines = 200) {
    return api(`/vms/${id}/logs?lines=${lines}`)
  },
}

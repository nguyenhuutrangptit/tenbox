<script setup>
import { ref, onMounted, onUnmounted, inject, computed } from 'vue'
import api from '../api.js'

const props = defineProps({ vmId: String })
const navigate = inject('navigate')

const vm = ref(null)
const logs = ref('')
const logLines = ref(200)
const loading = ref(true)
const error = ref('')
const toast = ref(null)

const editing = ref(false)
const editForm = ref({})

let pollInterval = null

function showToast(message, type = 'success') {
  toast.value = { message, type }
  setTimeout(() => { toast.value = null }, 3000)
}

async function fetchVm() {
  try {
    const res = await api.getVms()
    if (res.ok) {
      const list = res.payload?.vms || []
      const found = list.find(v => v.spec?.id === props.vmId)
      if (found) {
        vm.value = found
        error.value = ''
      } else {
        error.value = 'VM not found'
      }
    } else {
      error.value = res.error || 'Failed to fetch VM'
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function fetchLogs() {
  try {
    const res = await api.getLogs(props.vmId, logLines.value)
    if (res.ok && res.payload?.lines) {
      logs.value = res.payload.lines.join('\n')
    } else {
      logs.value = '(no logs available)'
    }
  } catch (e) {
    logs.value = `Error loading logs: ${e.message}`
  }
}

async function doAction(action, label) {
  try {
    let res
    switch (action) {
      case 'start': res = await api.startVm(props.vmId); break
      case 'stop': res = await api.stopVm(props.vmId); break
      case 'reboot': res = await api.rebootVm(props.vmId); break
      case 'shutdown': res = await api.shutdownVm(props.vmId); break
    }
    if (res.ok) {
      showToast(`${label} succeeded`)
      await fetchVm()
    } else {
      showToast(res.error || `${label} failed`, 'error')
    }
  } catch (e) {
    showToast(e.message, 'error')
  }
}

function startEdit() {
  editForm.value = {
    name: vm.value.spec?.name || '',
    memory_mb: vm.value.spec?.memory_mb || 256,
    cpu_count: vm.value.spec?.cpu_count || 1,
    debug_mode: vm.value.spec?.debug_mode ? 'on' : 'off',
    net_enabled: vm.value.spec?.net_enabled ? 'on' : 'off',
  }
  editing.value = true
}

async function saveEdit() {
  try {
    const payload = {}
    if (editForm.value.name !== vm.value.spec?.name) payload.name = editForm.value.name
    if (editForm.value.memory_mb !== vm.value.spec?.memory_mb) payload.memory_mb = Number(editForm.value.memory_mb)
    if (editForm.value.cpu_count !== vm.value.spec?.cpu_count) payload.cpu_count = Number(editForm.value.cpu_count)
    const debug = editForm.value.debug_mode === 'on' || editForm.value.debug_mode === 'true'
    if (debug !== vm.value.spec?.debug_mode) payload.debug_mode = debug
    const net = editForm.value.net_enabled === 'on' || editForm.value.net_enabled === 'true'
    if (net !== vm.value.spec?.net_enabled) payload.net_enabled = net

    if (Object.keys(payload).length === 0) {
      editing.value = false
      return
    }

    const res = await api.editVm(props.vmId, payload)
    if (res.ok) {
      showToast('VM updated')
      editing.value = false
      await fetchVm()
    } else {
      showToast(res.error || 'Update failed', 'error')
    }
  } catch (e) {
    showToast(e.message, 'error')
  }
}

function stateBadgeClass(state) {
  switch (state) {
    case 'running': return 'badge-success'
    case 'starting': return 'badge-warning'
    case 'stopping': return 'badge-warning'
    case 'crashed': return 'badge-error'
    default: return ''
  }
}

function formatDate(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

onMounted(() => {
  fetchVm()
  fetchLogs()
  pollInterval = setInterval(() => { fetchVm(); fetchLogs() }, 3000)
})

onUnmounted(() => {
  clearInterval(pollInterval)
})
</script>

<template>
  <div>
    <div class="page-header">
      <button class="btn-secondary btn-sm" @click="navigate('list')">← Back to VMs</button>
    </div>

    <div v-if="loading" class="loading-wrap">
      <div class="spinner" />
      <span class="body-sm" style="color: #6b7280">Loading VM…</span>
    </div>

    <div v-else-if="error" class="card-white" style="margin-top: 16px">
      <div class="body-md" style="color: #ef4444">{{ error }}</div>
    </div>

    <template v-else-if="vm">
      <div class="detail-grid">
        <!-- Info Card -->
        <div class="card-white">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px">
            <div>
              <div class="title-md">{{ vm.spec?.name || 'Unnamed' }}</div>
              <div class="caption" style="color: #898989; margin-top: 2px">{{ vm.spec?.id }}</div>
            </div>
            <span class="badge" :class="stateBadgeClass(vm.runtime?.state)">
              {{ vm.runtime?.state || 'unknown' }}
            </span>
          </div>

          <div v-if="!editing" class="info-grid">
            <div class="info-row"><span class="info-label">CPUs</span><span class="info-value">{{ vm.spec?.cpu_count }}</span></div>
            <div class="info-row"><span class="info-label">Memory</span><span class="info-value">{{ vm.spec?.memory_mb }} MB</span></div>
            <div class="info-row"><span class="info-label">Network</span><span class="info-value">{{ vm.spec?.net_enabled ? 'On' : 'Off' }}</span></div>
            <div class="info-row"><span class="info-label">Debug</span><span class="info-value">{{ vm.spec?.debug_mode ? 'On' : 'Off' }}</span></div>
            <div class="info-row"><span class="info-label">Kernel</span><span class="info-value">{{ vm.spec?.kernel_path || '—' }}</span></div>
            <div class="info-row"><span class="info-label">Disk</span><span class="info-value">{{ vm.spec?.disk_path || '—' }}</span></div>
            <div class="info-row"><span class="info-label">Created</span><span class="info-value">{{ formatDate(vm.spec?.creation_time) }}</span></div>
            <div class="info-row"><span class="info-label">Last boot</span><span class="info-value">{{ formatDate(vm.spec?.last_boot_time) }}</span></div>
            <div class="info-row" v-if="vm.runtime?.pid"><span class="info-label">PID</span><span class="info-value">{{ vm.runtime.pid }}</span></div>
            <div class="info-row" v-if="vm.runtime?.guest_agent_connected !== undefined">
              <span class="info-label">Guest agent</span>
              <span class="info-value">{{ vm.runtime.guest_agent_connected ? 'Connected' : 'Disconnected' }}</span>
            </div>
          </div>

          <div v-else class="form-stack">
            <div class="form-group">
              <label class="form-label">Name</label>
              <input v-model="editForm.name" class="input" />
            </div>
            <div class="form-row">
              <div class="form-group" style="flex: 1">
                <label class="form-label">Memory (MB)</label>
                <input v-model.number="editForm.memory_mb" class="input" type="number" min="16" />
              </div>
              <div class="form-group" style="flex: 1">
                <label class="form-label">vCPUs</label>
                <input v-model.number="editForm.cpu_count" class="input" type="number" min="1" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group" style="flex: 1">
                <label class="form-label">Debug mode</label>
                <select v-model="editForm.debug_mode" class="input">
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </div>
              <div class="form-group" style="flex: 1">
                <label class="form-label">Network</label>
                <select v-model="editForm.net_enabled" class="input">
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </div>
            </div>
            <div class="form-actions">
              <button type="button" class="btn-secondary" @click="editing = false">Cancel</button>
              <button type="button" class="btn-primary" @click="saveEdit">Save changes</button>
            </div>
          </div>

          <div v-if="!editing" class="vm-actions" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb">
            <button v-if="vm.runtime?.state !== 'running' && vm.runtime?.state !== 'starting'" class="btn-primary btn-sm" @click="doAction('start', 'Start')">Start</button>
            <button v-if="vm.runtime?.state === 'running'" class="btn-secondary btn-sm" @click="doAction('stop', 'Stop')">Stop</button>
            <button v-if="vm.runtime?.state === 'running'" class="btn-secondary btn-sm" @click="doAction('reboot', 'Reboot')">Reboot</button>
            <button v-if="vm.runtime?.state === 'running'" class="btn-secondary btn-sm" @click="doAction('shutdown', 'Shutdown')">Shutdown</button>
            <a v-if="vm.runtime?.state === 'running'" class="btn-primary btn-sm" :href="`/?remote=${encodeURIComponent(props.vmId)}`" target="_blank" style="text-decoration: none">Remote Desktop</a>
            <button class="btn-secondary btn-sm" @click="startEdit">Edit</button>
          </div>
        </div>

        <!-- Logs Card -->
        <div class="card-white">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
            <div class="title-sm">Logs</div>
            <div style="display: flex; gap: 8px">
              <select v-model="logLines" class="input" style="width: 100px; font-size: 13px" @change="fetchLogs">
                <option :value="50">50 lines</option>
                <option :value="200">200 lines</option>
                <option :value="500">500 lines</option>
                <option :value="1000">1000 lines</option>
              </select>
              <button class="btn-secondary btn-sm" @click="fetchLogs">Refresh</button>
            </div>
          </div>
          <textarea class="input log-text" readonly :value="logs" />
        </div>
      </div>
    </template>

    <div v-if="toast" class="toast" :class="toast.type">
      {{ toast.message }}
    </div>
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 16px;
}

.loading-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid #f3f4f6;
}

.info-label {
  font-size: 13px;
  font-weight: 500;
  color: #6b7280;
}

.info-value {
  font-size: 14px;
  color: #111111;
  text-align: right;
  word-break: break-all;
  max-width: 60%;
}

.log-text {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px;
  line-height: 1.5;
  min-height: 320px;
  background: #f8f9fa;
  color: #374151;
}

.form-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-row {
  display: flex;
  gap: 14px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}

.vm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 900px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .form-row {
    flex-direction: column;
  }
}
</style>

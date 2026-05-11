<script setup>
import { ref, onMounted, onUnmounted, inject } from 'vue'
import api from '../api.js'

const navigate = inject('navigate')
const vms = ref([])
const loading = ref(true)
const error = ref('')
const toast = ref(null)

let pollInterval = null

function showToast(message, type = 'success') {
  toast.value = { message, type }
  setTimeout(() => { toast.value = null }, 3000)
}

async function fetchVms() {
  try {
    const res = await api.getVms()
    if (res.ok) {
      vms.value = res.payload?.vms || []
      error.value = ''
    } else {
      error.value = res.error || 'Failed to fetch VMs'
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function doAction(id, action, label) {
  try {
    let res
    switch (action) {
      case 'start': res = await api.startVm(id); break
      case 'stop': res = await api.stopVm(id); break
      case 'reboot': res = await api.rebootVm(id); break
      case 'shutdown': res = await api.shutdownVm(id); break
      case 'delete': {
        if (!confirm('Delete this VM and its data? This cannot be undone.')) return
        res = await api.deleteVm(id)
        break
      }
    }
    if (res.ok) {
      showToast(`${label} succeeded`)
      await fetchVms()
    } else {
      showToast(res.error || `${label} failed`, 'error')
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

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024
    i++
  }
  return `${bytes.toFixed(1)} ${units[i]}`
}

onMounted(() => {
  fetchVms()
  pollInterval = setInterval(fetchVms, 3000)
})

onUnmounted(() => {
  clearInterval(pollInterval)
})
</script>

<template>
  <div>
    <div class="page-header">
      <h1 class="title-lg">Virtual Machines</h1>
      <p class="body-md" style="color: #6b7280; margin-top: 4px">
        Manage your local VMs. Status refreshes every 3 seconds.
      </p>
    </div>

    <div v-if="loading" class="loading-wrap">
      <div class="spinner" />
      <span class="body-sm" style="color: #6b7280">Loading VMs…</span>
    </div>

    <div v-else-if="error" class="card-white" style="margin-top: 24px">
      <div class="body-md" style="color: #ef4444">{{ error }}</div>
      <button class="btn-secondary btn-sm" style="margin-top: 12px" @click="fetchVms">Retry</button>
    </div>

    <div v-else-if="vms.length === 0" class="empty-state">
      <div class="empty-state-title">No VMs yet</div>
      <div class="body-sm">Create your first VM to get started.</div>
      <button class="btn-primary" style="margin-top: 16px" @click="navigate('create')">
        Create VM
      </button>
    </div>

    <div v-else class="vm-grid">
      <div v-for="vm in vms" :key="vm.spec?.id" class="vm-card">
        <div class="vm-header">
          <div>
            <div class="title-sm">{{ vm.spec?.name || 'Unnamed' }}</div>
            <div class="caption" style="color: #898989; margin-top: 2px">{{ vm.spec?.id }}</div>
          </div>
          <span class="badge" :class="stateBadgeClass(vm.runtime?.state)">
            {{ vm.runtime?.state || 'unknown' }}
          </span>
        </div>

        <div class="vm-meta">
          <div class="meta-item">
            <span class="meta-label">CPUs</span>
            <span class="meta-value">{{ vm.spec?.cpu_count || 1 }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Memory</span>
            <span class="meta-value">{{ vm.spec?.memory_mb || 256 }} MB</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Disk</span>
            <span class="meta-value">{{ formatBytes(vm.resources?.disk_usage_bytes) }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Network</span>
            <span class="meta-value">{{ vm.spec?.net_enabled ? 'On' : 'Off' }}</span>
          </div>
        </div>

        <div class="vm-actions">
          <button
            v-if="vm.runtime?.state !== 'running' && vm.runtime?.state !== 'starting'"
            class="btn-primary btn-sm"
            @click="doAction(vm.spec.id, 'start', 'Start')"
          >
            Start
          </button>
          <button
            v-if="vm.runtime?.state === 'running'"
            class="btn-secondary btn-sm"
            @click="doAction(vm.spec.id, 'stop', 'Stop')"
          >
            Stop
          </button>
          <button
            v-if="vm.runtime?.state === 'running'"
            class="btn-secondary btn-sm"
            @click="doAction(vm.spec.id, 'reboot', 'Reboot')"
          >
            Reboot
          </button>
          <button
            v-if="vm.runtime?.state === 'running'"
            class="btn-secondary btn-sm"
            @click="doAction(vm.spec.id, 'shutdown', 'Shutdown')"
          >
            Shutdown
          </button>
          <a
            v-if="vm.runtime?.state === 'running'"
            class="btn-primary btn-sm"
            :href="`/?remote=${encodeURIComponent(vm.spec.id)}`"
            target="_blank"
            style="text-decoration: none"
          >
            Desktop
          </a>
          <button class="btn-secondary btn-sm" @click="navigate('detail', { id: vm.spec.id })">
            Details
          </button>
          <button class="btn-danger btn-sm" @click="doAction(vm.spec.id, 'delete', 'Delete')">
            Delete
          </button>
        </div>
      </div>
    </div>

    <div v-if="toast" class="toast" :class="toast.type">
      {{ toast.message }}
    </div>
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 32px;
}

.loading-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
}

.vm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 24px;
}

.vm-card {
  background: #f5f5f5;
  border-radius: 12px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  transition: box-shadow 0.15s ease;
}

.vm-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}

.vm-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.vm-meta {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px 16px;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.meta-label {
  font-size: 12px;
  font-weight: 500;
  color: #898989;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.meta-value {
  font-size: 14px;
  font-weight: 500;
  color: #111111;
}

.vm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid #e5e7eb;
}

@media (max-width: 768px) {
  .vm-grid {
    grid-template-columns: 1fr;
  }
}
</style>

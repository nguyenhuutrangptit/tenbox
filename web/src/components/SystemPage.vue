<script setup>
import { ref, onMounted, computed } from 'vue'
import api from '../api.js'

const systemInfo = ref(null)
const doctor = ref(null)
const loading = ref({ system: true, doctor: false })
const error = ref({ system: '', doctor: '' })

async function fetchSystem() {
  loading.value.system = true
  error.value.system = ''
  try {
    const res = await api.getSystemInfo()
    if (res.ok) {
      systemInfo.value = res.payload
    } else {
      error.value.system = res.error || 'Failed to load system info'
    }
  } catch (e) {
    error.value.system = e.message
  } finally {
    loading.value.system = false
  }
}

async function runDoctor() {
  loading.value.doctor = true
  error.value.doctor = ''
  try {
    const res = await api.getDoctor()
    if (res.ok) {
      doctor.value = res.payload
    } else {
      error.value.doctor = res.error || 'Doctor check failed'
    }
  } catch (e) {
    error.value.doctor = e.message
  } finally {
    loading.value.doctor = false
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

function doctorCheck(id) {
  return doctor.value?.checks?.find(c => c.id === id)
}

const doctorIssues = computed(() => {
  return doctor.value?.checks?.filter(c => !c.ok) || []
})

onMounted(() => {
  fetchSystem()
})
</script>

<template>
  <div>
    <div class="page-header">
      <h1 class="title-lg">System</h1>
      <p class="body-md" style="color: #6b7280; margin-top: 4px">
        Host information and diagnostics.
      </p>
    </div>

    <div class="system-grid">
      <!-- System Info -->
      <div class="card-white">
        <div class="title-sm" style="margin-bottom: 16px">System Info</div>

        <div v-if="loading.system" class="loading-wrap">
          <div class="spinner" />
          <span class="body-sm" style="color: #6b7280">Loading…</span>
        </div>

        <div v-else-if="error.system" class="body-md" style="color: #ef4444">{{ error.system }}</div>

        <div v-else-if="systemInfo" class="info-grid">
          <div v-if="systemInfo.hostname !== undefined" class="info-row">
            <span class="info-label">Hostname</span>
            <span class="info-value">{{ systemInfo.hostname || '—' }}</span>
          </div>
          <div v-if="systemInfo.daemon_version !== undefined" class="info-row">
            <span class="info-label">Version</span>
            <span class="info-value">{{ systemInfo.daemon_version || '—' }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Data directory</span>
            <span class="info-value">{{ systemInfo.data_dir || '—' }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Socket path</span>
            <span class="info-value">{{ systemInfo.socket_path || '—' }}</span>
          </div>
          <div v-if="systemInfo.daemon_uptime_seconds !== undefined" class="info-row">
            <span class="info-label">Uptime</span>
            <span class="info-value">{{ systemInfo.daemon_uptime_seconds ? systemInfo.daemon_uptime_seconds + ' s' : '—' }}</span>
          </div>
          <div v-if="systemInfo.cloud_connected !== undefined" class="info-row">
            <span class="info-label">Cloud connected</span>
            <span class="info-value">{{ systemInfo.cloud_connected ? 'Yes' : 'No' }}</span>
          </div>
          <template v-if="systemInfo.resources">
            <div class="info-row">
              <span class="info-label">Total memory</span>
              <span class="info-value">{{ formatBytes(systemInfo.resources.memory_total_bytes) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Available memory</span>
              <span class="info-value">{{ formatBytes(systemInfo.resources.memory_available_bytes) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">CPU cores</span>
              <span class="info-value">{{ systemInfo.resources.cpu_count || '—' }}</span>
            </div>
          </template>
        </div>
      </div>

      <!-- Doctor -->
      <div class="card-white">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px">
          <div class="title-sm">KVM Doctor</div>
          <button class="btn-primary btn-sm" :disabled="loading.doctor" @click="runDoctor">
            {{ loading.doctor ? 'Running…' : 'Run Check' }}
          </button>
        </div>

        <div v-if="!doctor && !loading.doctor && !error.doctor" class="body-sm" style="color: #6b7280">
          Click "Run Check" to verify KVM support on this host.
        </div>

        <div v-else-if="error.doctor" class="body-md" style="color: #ef4444">{{ error.doctor }}</div>

        <div v-else-if="doctor" class="info-grid">
          <div class="info-row">
            <span class="info-label">KVM supported</span>
            <span class="info-value">{{ doctor.supported ? 'Yes' : 'No' }}</span>
          </div>
          <div
            v-for="check in doctor.checks"
            :key="check.id"
            class="info-row"
          >
            <span class="info-label">{{ check.id }}</span>
            <span class="info-value" :style="{ color: check.ok ? '#10b981' : '#ef4444' }">
              {{ check.ok ? 'OK' : 'Fail' }}
            </span>
          </div>
          <div v-if="doctorIssues.length" class="info-row" style="flex-direction: column; align-items: flex-start; gap: 6px; margin-top: 4px">
            <span class="info-label">Failed checks</span>
            <ul style="padding-left: 18px; color: #ef4444">
              <li v-for="(issue, i) in doctorIssues" :key="i" class="body-sm">{{ issue.message }}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 32px;
}

.system-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.loading-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px 0;
}

.info-grid {
  display: flex;
  flex-direction: column;
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

@media (max-width: 900px) {
  .system-grid {
    grid-template-columns: 1fr;
  }
}
</style>

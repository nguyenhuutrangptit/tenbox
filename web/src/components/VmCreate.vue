<script setup>
import { ref, inject } from 'vue'
import api from '../api.js'

const navigate = inject('navigate')

const form = ref({
  name: '',
  kernel: '',
  initrd: '',
  disk: '',
  memory_mb: 256,
  cpu_count: 1,
})

const submitting = ref(false)
const toast = ref(null)

function showToast(message, type = 'success') {
  toast.value = { message, type }
  setTimeout(() => { toast.value = null }, 3000)
}

async function submit() {
  if (!form.value.name.trim()) {
    showToast('Name is required', 'error')
    return
  }
  if (!form.value.kernel.trim()) {
    showToast('Kernel path is required', 'error')
    return
  }

  submitting.value = true
  try {
    const payload = {
      name: form.value.name.trim(),
      kernel: form.value.kernel.trim(),
    }
    if (form.value.initrd.trim()) payload.initrd = form.value.initrd.trim()
    if (form.value.disk.trim()) payload.disk = form.value.disk.trim()
    payload.memory_mb = Number(form.value.memory_mb) || 256
    payload.cpu_count = Number(form.value.cpu_count) || 1

    const res = await api.createVm(payload)
    if (res.ok) {
      showToast('VM created successfully')
      navigate('list')
    } else {
      showToast(res.error || 'Create failed', 'error')
    }
  } catch (e) {
    showToast(e.message, 'error')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <h1 class="title-lg">Create Virtual Machine</h1>
      <p class="body-md" style="color: #6b7280; margin-top: 4px">
        Configure a new VM. Name and kernel are required.
      </p>
    </div>

    <div class="card-white" style="max-width: 640px">
      <form @submit.prevent="submit">
        <div class="form-stack">
          <div class="form-group">
            <label class="form-label">Name *</label>
            <input v-model="form.name" class="input" placeholder="e.g. dev-vm" required />
          </div>

          <div class="form-group">
            <label class="form-label">Kernel path *</label>
            <input v-model="form.kernel" class="input" placeholder="/path/to/vmlinuz or Image" required />
            <span class="form-hint">Absolute path to the Linux kernel image.</span>
          </div>

          <div class="form-group">
            <label class="form-label">Initrd path</label>
            <input v-model="form.initrd" class="input" placeholder="/path/to/initramfs (optional)" />
          </div>

          <div class="form-group">
            <label class="form-label">Disk path</label>
            <input v-model="form.disk" class="input" placeholder="/path/to/rootfs.qcow2 (optional)" />
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 1">
              <label class="form-label">Memory (MB)</label>
              <input v-model.number="form.memory_mb" class="input" type="number" min="16" placeholder="256" />
            </div>
            <div class="form-group" style="flex: 1">
              <label class="form-label">vCPUs</label>
              <input v-model.number="form.cpu_count" class="input" type="number" min="1" placeholder="1" />
            </div>
          </div>
        </div>

        <div class="form-actions">
          <button type="button" class="btn-secondary" @click="navigate('list')">Cancel</button>
          <button type="submit" class="btn-primary" :disabled="submitting">
            {{ submitting ? 'Creating…' : 'Create VM' }}
          </button>
        </div>
      </form>
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

.form-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-row {
  display: flex;
  gap: 16px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #e5e7eb;
}

@media (max-width: 640px) {
  .form-row {
    flex-direction: column;
  }
}
</style>

<script setup>
import { ref, provide } from 'vue'
import VmList from './components/VmList.vue'
import VmCreate from './components/VmCreate.vue'
import VmDetail from './components/VmDetail.vue'
import SystemPage from './components/SystemPage.vue'
import RemoteDesktop from './components/RemoteDesktop.vue'

const urlParams = new URLSearchParams(window.location.search)
const remoteParam = urlParams.get('remote')

const page = ref('list')
const detailVmId = ref('')
const remoteVmId = ref('')
const isRemoteTab = ref(!!remoteParam)

if (remoteParam) {
  remoteVmId.value = remoteParam
}

provide('navigate', (target, params = {}) => {
  if (target === 'detail') detailVmId.value = params.id || ''
  if (target === 'remote') remoteVmId.value = params.id || ''
  page.value = target
})
</script>

<template>
  <div class="app">
    <template v-if="isRemoteTab">
      <RemoteDesktop :vm-id="remoteVmId" fullscreen @back="isRemoteTab = false; page = 'list'" />
    </template>
    <template v-else>
      <header class="top-nav">
        <div class="nav-inner">
          <div class="brand" @click="page = 'list'">
            <span class="brand-logo">●</span>
            <span class="brand-text">TenBox</span>
          </div>
          <nav class="nav-links">
            <button
              class="nav-link"
              :class="{ active: page === 'list' || page === 'create' || page === 'detail' }"
              @click="page = 'list'"
            >
              VMs
            </button>
            <button
              class="nav-link"
              :class="{ active: page === 'system' }"
              @click="page = 'system'"
            >
              System
            </button>
          </nav>
          <div class="nav-actions">
            <button v-if="page !== 'create'" class="btn-primary" @click="page = 'create'">
              Create VM
            </button>
          </div>
        </div>
      </header>

      <main class="main">
        <VmList v-if="page === 'list'" />
        <VmCreate v-else-if="page === 'create'" />
        <VmDetail v-else-if="page === 'detail'" :vm-id="detailVmId" />
        <RemoteDesktop v-else-if="page === 'remote'" :vm-id="remoteVmId" @back="page = 'list'" />
        <SystemPage v-else-if="page === 'system'" />
      </main>

      <footer class="footer">
        <div class="footer-inner">
          <div class="footer-brand">TenBox</div>
          <div class="footer-copy">Local VM Manager — runs on localhost</div>
        </div>
      </footer>
    </template>
  </div>
</template>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #111111;
  background: #ffffff;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.top-nav {
  height: 64px;
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
  position: sticky;
  top: 0;
  z-index: 100;
}

.nav-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.brand-logo {
  width: 28px;
  height: 28px;
  background: #111111;
  color: #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
}

.brand-text {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.3px;
}

.nav-links {
  display: flex;
  gap: 4px;
  background: #f8f9fa;
  border-radius: 9999px;
  padding: 6px;
}

.nav-link {
  border: none;
  background: transparent;
  color: #6b7280;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
  padding: 8px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.nav-link.active {
  background: #ffffff;
  color: #111111;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: #111111;
  color: #ffffff;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  padding: 12px 20px;
  height: 40px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.btn-primary:hover {
  background: #242424;
}

.btn-primary:disabled {
  background: #e5e7eb;
  color: #6b7280;
  cursor: not-allowed;
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #e5e7eb;
  background: #ffffff;
  color: #111111;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  padding: 12px 20px;
  height: 40px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-secondary:hover {
  border-color: #111111;
}

.btn-danger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #ef4444;
  background: #ffffff;
  color: #ef4444;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  padding: 12px 20px;
  height: 40px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-danger:hover {
  background: #ef4444;
  color: #ffffff;
}

.btn-sm {
  padding: 8px 14px;
  height: 32px;
  font-size: 13px;
}

.main {
  flex: 1;
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 24px 96px;
}

.footer {
  background: #101010;
  color: #a1a1aa;
  padding: 48px 24px;
}

.footer-inner {
  max-width: 1200px;
  margin: 0 auto;
}

.footer-brand {
  color: #ffffff;
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
}

.footer-copy {
  font-size: 14px;
  color: #a1a1aa;
}

.card {
  background: #f5f5f5;
  border-radius: 12px;
  padding: 32px;
}

.card-white {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 32px;
}

.title-lg {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.3px;
}

.title-md {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
}

.title-sm {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}

.body-md {
  font-size: 16px;
  font-weight: 400;
  line-height: 1.5;
  color: #374151;
}

.body-sm {
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
  color: #374151;
}

.caption {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 500;
  background: #f5f5f5;
  color: #111111;
}

.badge-success {
  background: #d1fae5;
  color: #065f46;
}

.badge-error {
  background: #fee2e2;
  color: #991b1b;
}

.badge-warning {
  background: #fef3c7;
  color: #92400e;
}

.input {
  width: 100%;
  border: 1px solid #e5e7eb;
  background: #ffffff;
  color: #111111;
  font-family: inherit;
  font-size: 16px;
  font-weight: 400;
  line-height: 1.5;
  border-radius: 8px;
  padding: 10px 14px;
  height: 40px;
  outline: none;
  transition: border-color 0.15s ease;
}

.input:focus {
  border-color: #111111;
}

.input::placeholder {
  color: #898989;
}

textarea.input {
  height: auto;
  min-height: 120px;
  resize: vertical;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.form-hint {
  font-size: 13px;
  color: #6b7280;
}

.empty-state {
  text-align: center;
  padding: 96px 24px;
  color: #6b7280;
}

.empty-state-title {
  font-size: 18px;
  font-weight: 600;
  color: #111111;
  margin-bottom: 8px;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #e5e7eb;
  border-top-color: #111111;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  padding: 14px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #ffffff;
  background: #111111;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  animation: slideIn 0.2s ease;
}

.toast.error {
  background: #ef4444;
}

.toast.success {
  background: #10b981;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

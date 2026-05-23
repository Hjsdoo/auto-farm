<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView, useRouter } from 'vue-router'
import AccountModal from '@/components/AccountModal.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import { useAccountStore } from '@/stores/account'
import { useAppStore } from '@/stores/app'
import { reloginTarget, useStatusStore } from '@/stores/status'

const appStore = useAppStore()
const statusStore = useStatusStore()
const accountStore = useAccountStore()
const router = useRouter()

onMounted(() => {
  appStore.fetchTheme()
  // Ensure socket is connected for global events (account:offline)
  statusStore.connectRealtime('all')
})

// Reconnect on route change (e.g. after login)
router.afterEach(() => {
  statusStore.connectRealtime('all')
})

function onReloginSaved() {
  const target = reloginTarget.value
  reloginTarget.value = null
  if (target?.id) {
    statusStore.dismissReloginToast(target.id)
    accountStore.startAccount(target.id)
  }
}
</script>

<template>
  <div class="h-screen w-screen overflow-hidden bg-gray-50 text-gray-700 dark:bg-gray-900 dark:text-gray-200">
    <RouterView />
    <ToastContainer />
    <AccountModal
      :show="!!reloginTarget"
      :edit-data="reloginTarget"
      @close="reloginTarget = null"
      @saved="onReloginSaved"
    />
  </div>
</template>

<style>
/* Global styles */
body {
  margin: 0;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', 'WenQuanYi Micro Hei', sans-serif;
}
</style>

<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { computed, reactive, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'

const props = defineProps<{
  show: boolean
  editData?: any
}>()

const emit = defineEmits(['close', 'saved'])

const activeTab = ref('qq') // qq | wx | manual
const loading = ref(false)
const errorMessage = ref('')

// QQ
const qrData = ref<{ image?: string, code: string, qrcode?: string, url?: string } | null>(null)
const qrStatus = ref('')

// wx
const wxQrImage = ref('')
const wxQrSessionId = ref('')
const wxQrStatus = ref('')

const form = reactive({
  name: '',
  code: '',
  platform: 'qq',
})

// ---- QQ ----
const { pause: stopQQCheck, resume: startQQCheck } = useIntervalFn(async () => {
  if (!qrData.value) return
  try {
    const res = await api.post('/api/qr/check', { code: qrData.value.code })
    if (res.data.ok) {
      const status = res.data.data.status
      if (status === 'OK') {
        stopAllChecks()
        qrStatus.value = '登录成功'
        const { uin, code: authCode, nickname } = res.data.data
        let accName = form.name.trim() || nickname || (uin ? String(uin) : '扫码账号')
        await addAccount({
          id: props.editData?.id,
          uin,
          code: authCode,
          loginType: 'qr',
          name: props.editData ? (props.editData.name || accName) : accName,
          platform: 'qq',
        })
      } else if (status === 'Used') {
        qrStatus.value = '二维码已失效'
        stopQQCheck()
      } else if (status === 'Wait') {
        qrStatus.value = '等待扫码'
      }
    }
  } catch (e) { console.error(e) }
}, 1000, { immediate: false })

async function loadQQQRCode() {
  loading.value = true
  qrStatus.value = '正在获取二维码'
  errorMessage.value = ''
  try {
    const res = await api.post('/api/qr/create')
    if (res.data.ok) {
      qrData.value = res.data.data
      qrStatus.value = '请使用手机QQ扫码'
      startQQCheck()
    } else {
      qrStatus.value = `获取失败: ${res.data.error}`
    }
  } catch (e) {
    qrStatus.value = '获取失败'
    console.error(e)
  } finally { loading.value = false }
}

// ---- wx ----
const { pause: stopWxCheck, resume: startWxCheck } = useIntervalFn(async () => {
  if (!wxQrSessionId.value) return
  try {
    const res = await api.get('/api/qr/wx/status', { params: { sessionId: wxQrSessionId.value } })
    if (res.data.ok) {
      const { status, account } = res.data.data
      if (status === 'done' || status === 'success' || status === 'logged' || status === 'confirmed') {
        stopAllChecks()
        wxQrStatus.value = '登录成功，正在注册设备...'
        await onWxLoginSuccess(account)
      } else if (status === 'scanned' || status === 'scanning') {
        wxQrStatus.value = '已扫码，请在手机上确认授权...'
      } else if (status === 'expired' || status === 'timeout' || status === 'cancelled') {
        wxQrStatus.value = '二维码已过期，请刷新'
        stopWxCheck()
      } else {
        wxQrStatus.value = '请使用微信扫码'
      }
    }
  } catch (e) { console.error(e) }
}, 2000, { immediate: false })

async function loadWxQRCode() {
  loading.value = true
  wxQrStatus.value = '正在获取二维码...'
  errorMessage.value = ''
  try {
    const res = await api.post('/api/qr/wx/start')
    if (res.data.ok) {
      wxQrSessionId.value = res.data.data.sessionId
      wxQrImage.value = res.data.data.qrcodeDataUrl
      wxQrStatus.value = '请使用微信扫码'
      startWxCheck()
    } else {
      wxQrStatus.value = `获取失败: ${res.data.error}`
    }
  } catch (e: any) {
    wxQrStatus.value = e.response?.data?.error || '微信扫码暂不可用'
    console.error(e)
  } finally { loading.value = false }
}

async function onWxLoginSuccess(_account: any) {
  const sessionId = wxQrSessionId.value
  if (!sessionId) {
    wxQrStatus.value = '登录失败：会话已过期'
    return
  }
  try {
    // 1. register device
    const regRes = await api.post('/api/qr/wx/register', { sessionId })
    if (!regRes.data.ok) {
      wxQrStatus.value = `注册失败: ${regRes.data.error || '请重试'}`
      return
    }
    const accounts: any[] = regRes.data.data?.accounts || []
    if (accounts.length === 0) {
      wxQrStatus.value = '注册成功但未获取到账号，请重试'
      return
    }
    const acc = accounts[0]
    const openid = acc.openid
    if (!openid) {
      wxQrStatus.value = '注册成功但未获取到 openid'
      return
    }

    // 2. delay then get code
    wxQrStatus.value = '正在获取 Code...'
    await new Promise(resolve => setTimeout(resolve, 3000))

    const codeRes = await api.post('/api/qr/wx/get-code', { openid })
    if (codeRes.data.ok) {
      const authCode = codeRes.data.data.code
      const nickname = acc.nickname || ''
      const accName = form.name.trim() || nickname || '微信账号'
      await addAccount({
        name: accName,
        code: authCode,
        platform: 'wx',
        loginType: 'qr',
      })
    } else {
      wxQrStatus.value = `获取 Code 失败: ${codeRes.data.error || '请重试'}`
    }
  } catch (e: any) {
    wxQrStatus.value = `操作失败: ${e.response?.data?.error || e.message}`
    console.error(e)
  }
}

function stopAllChecks() {
  stopQQCheck()
  stopWxCheck()
}

// ---- common ----
const isMobile = computed(() => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent))
const manualNameHint = computed(() => form.platform === 'qq'
  ? '留空备注名时，会在保存后自动同步游戏名称。'
  : '微信小程序保留原逻辑，留空时将使用默认备注名。')
const manualNamePlaceholder = computed(() => form.platform === 'qq'
  ? '留空自动同步游戏名称'
  : '留空默认账号名')

function openQRCodeLoginUrl() {
  if (!qrData.value?.url) return
  const url = qrData.value.url
  if (!isMobile.value) { window.open(url, '_blank'); return }
  try {
    const b64 = btoa(decodeURIComponent(encodeURIComponent(url)))
    window.location.href = `mqqapi://forward/url?url_prefix=${encodeURIComponent(b64)}&version=1&src_type=web`
  } catch (e) { window.location.href = url }
}

async function addAccount(data: any) {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await api.post('/api/accounts', data)
    if (res.data.ok) { emit('saved'); close() }
    else { errorMessage.value = `保存失败: ${res.data.error}` }
  } catch (e: any) {
    errorMessage.value = `保存失败: ${e.response?.data?.error || e.message}`
  } finally { loading.value = false }
}

async function submitManual() {
  errorMessage.value = ''
  if (!form.code) { errorMessage.value = '请输入Code 或 进行扫码'; return }
  if (!form.name && props.editData) { errorMessage.value = '请输入名称'; return }
  let code = form.code.trim()
  const match = code.match(/[?&]code=([^&]+)/i)
  if (match && match[1]) { code = decodeURIComponent(match[1]); form.code = code }

  let payload: any = {}
  if (props.editData) {
    const onlyNameChanged = form.name !== props.editData.name
      && form.code === (props.editData.code || '')
      && form.platform === (props.editData.platform || 'qq')
    if (onlyNameChanged) {
      payload = { id: props.editData.id, name: form.name }
    } else {
      payload = { id: props.editData.id, name: form.name, code, platform: form.platform, loginType: 'manual' }
    }
  } else {
    payload = { name: form.name, code, platform: form.platform, loginType: 'manual' }
  }
  await addAccount(payload)
}

function close() { stopAllChecks(); emit('close') }

function switchTab(tab: string) {
  stopAllChecks()
  qrData.value = null; qrStatus.value = ''
  wxQrImage.value = ''; wxQrSessionId.value = ''; wxQrStatus.value = ''
  activeTab.value = tab
  if (tab === 'qq') loadQQQRCode()
  if (tab === 'wx') loadWxQRCode()
}

watch(() => props.show, (newVal) => {
  if (newVal) {
    errorMessage.value = ''
    if (props.editData) {
      form.name = props.editData.name
      form.code = props.editData.code || ''
      form.platform = props.editData.platform || 'qq'
      activeTab.value = props.editData.platform === 'wx' ? 'wx' : 'qq'
      if (activeTab.value === 'qq') loadQQQRCode()
      else loadWxQRCode()
    } else {
      activeTab.value = 'qq'
      form.name = ''; form.code = ''; form.platform = 'qq'
      loadQQQRCode()
    }
  } else {
    stopAllChecks()
    qrData.value = null; qrStatus.value = ''
    wxQrImage.value = ''; wxQrSessionId.value = ''; wxQrStatus.value = ''
  }
})
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div class="max-w-md w-full overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800">
      <div class="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
        <h3 class="text-lg font-semibold">{{ editData ? '编辑账号' : '添加账号' }}</h3>
        <BaseButton variant="ghost" class="!p-1" @click="close">
          <div class="i-carbon-close text-xl" />
        </BaseButton>
      </div>

      <div class="p-4">
        <div v-if="errorMessage" class="mb-4 rounded bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {{ errorMessage }}
        </div>

        <!-- tabs -->
        <div class="mb-4 flex border-b border-gray-200 dark:border-gray-700">
          <button class="flex-1 py-2 text-center text-xs sm:text-sm font-medium"
            :class="activeTab === 'qq' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'"
            @click="switchTab('qq')">QQ扫码</button>
          <button class="flex-1 py-2 text-center text-xs sm:text-sm font-medium"
            :class="activeTab === 'wx' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'"
            @click="switchTab('wx')">微信扫码</button>
          <button class="flex-1 py-2 text-center text-xs sm:text-sm font-medium"
            :class="activeTab === 'manual' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'"
            @click="switchTab('manual')">手动填码</button>
        </div>

        <!-- QQ -->
        <div v-if="activeTab === 'qq'" class="flex flex-col items-center justify-center py-4 space-y-4">
          <p class="text-sm text-gray-500 dark:text-gray-400">扫码默认使用QQ昵称</p>
          <div v-if="qrData && (qrData.image || qrData.qrcode)" class="border rounded bg-white p-2">
            <img :src="qrData.image ? (qrData.image.startsWith('data:') ? qrData.image : `data:image/png;base64,${qrData.image}`) : qrData.qrcode" class="h-48 w-48">
          </div>
          <div v-else class="h-48 w-48 flex items-center justify-center rounded bg-gray-100 text-gray-400 dark:bg-gray-700">
            <div v-if="loading" i-svg-spinners-90-ring-with-bg class="text-3xl" />
            <span v-else>二维码已过期</span>
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-400">{{ qrStatus }}</p>
          <div class="flex gap-2">
            <BaseButton variant="text" size="sm" @click="loadQQQRCode">刷新二维码</BaseButton>
            <BaseButton v-if="qrData?.url" variant="text" size="sm" class="text-blue-600 md:hidden" @click="openQRCodeLoginUrl">跳转QQ登录</BaseButton>
          </div>
        </div>

        <!-- wx -->
        <div v-if="activeTab === 'wx'" class="flex flex-col items-center justify-center py-4 space-y-4">
          <p class="text-sm text-gray-500 dark:text-gray-400">微信扫码仅用于授权登录应用宝电脑版，自动获取小程序 Code</p>
          <div v-if="wxQrImage" class="border rounded bg-white p-2" style="animation:qrPulse 2s ease-in-out infinite">
            <img :src="wxQrImage" class="h-48 w-48 sm:h-56 sm:w-56">
          </div>
          <div v-else class="h-48 w-48 flex items-center justify-center rounded bg-gray-100 text-gray-400 dark:bg-gray-700">
            <div v-if="loading" i-svg-spinners-90-ring-with-bg class="text-3xl" />
            <span v-else>二维码加载中...</span>
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-400">{{ wxQrStatus }}</p>
          <div class="rounded-lg bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 w-full space-y-1">
            <p class="font-medium">扫码提示：</p>
            <p>微信扫码后会提示 <strong>"您的微信正在其他设备上请求第三方应用登录"</strong>，点击确认即可完成授权。</p>
            <p>授权后系统自动获取 QQ 农场小程序 Code 并创建账号。</p>
          </div>
          <BaseButton variant="text" size="sm" @click="loadWxQRCode">刷新二维码</BaseButton>
        </div>

        <!-- manual -->
        <div v-if="activeTab === 'manual'" class="space-y-4">
          <div class="rounded-lg bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
            {{ manualNameHint }}
          </div>
          <div v-if="form.platform === 'wx'" class="rounded-lg bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 space-y-1">
            <p>微信推荐使用「微信扫码」标签，无需手动填码。</p>
          </div>
          <div v-if="form.platform === 'qq'" class="rounded-lg bg-green-50 p-3 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-300">
            <p>QQ 推荐使用左侧「QQ扫码」登录。</p>
          </div>
          <BaseInput v-model="form.name" label="备注名称" :placeholder="manualNamePlaceholder" />
          <BaseTextarea v-model="form.code" label="Code" placeholder="请输入登录 Code" :rows="3" />
          <BaseSelect v-if="!editData" v-model="form.platform" label="平台" :options="[{ label: 'QQ小程序', value: 'qq' }, { label: '微信小程序', value: 'wx' }]" />
          <div class="flex justify-end gap-2 pt-4">
            <BaseButton variant="outline" @click="close">取消</BaseButton>
            <BaseButton variant="primary" :loading="loading" @click="submitManual">{{ editData ? '保存' : '添加' }}</BaseButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes qrPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
  50% { box-shadow: 0 0 0 12px rgba(59, 130, 246, 0); }
}
</style>

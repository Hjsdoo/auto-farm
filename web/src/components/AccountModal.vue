<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { computed, reactive, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import { io as socketIO } from 'socket.io-client'

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
type WxStatus = 'idle' | 'proxy-starting' | 'proxy-running' | 'code-captured' | 'success' | 'error'
const wxStatus = ref<WxStatus>('idle')
const wxStatusText = ref('')
const wxErrorText = ref('')

const form = reactive({
  name: '',
  code: '',
  platform: 'qq',
})

// ---- 本地代理（微信登录用）----
const proxyRunning = ref(false)
const proxyLoading = ref(false)
const proxyStatus = ref<any>({ running: false, port: 8899, caAvailable: false, capturedCount: 0 })
const proxyCaptures = ref<any[]>([])
let proxySocket: any = null

function initProxySocket() {
  if (proxySocket) return
  proxySocket = socketIO('/', {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { token: localStorage.getItem('admin_token') || '' },
  })
  proxySocket.on('proxy:capture', (data: any) => {
    proxyCaptures.value.unshift(data)
    if (proxyCaptures.value.length > 100)
      proxyCaptures.value.pop()
  })
  proxySocket.on('proxy:code-found', (data: any) => {
    // WS code 自动被后端捕获并保存，前端更新状态
    const hasWsCode = data.codes?.some((c: any) => c.pattern === 'code_param')
    if (!hasWsCode) return
    wxStatus.value = 'code-captured'
    wxStatusText.value = '已捕获 Code！正在登录...'
    // 后端已自动保存 code + 重启 worker，等一会儿显示成功
    setTimeout(() => {
      wxStatus.value = 'success'
      wxStatusText.value = '登录成功！'
      // 自动停止代理
      api.post('/api/proxy/stop').catch(() => {})
      proxyRunning.value = false
      setTimeout(() => close(), 1500)
    }, 2000)
  })
}

async function fetchProxyStatus() {
  try {
    const { data } = await api.get('/api/proxy/status')
    if (data.ok) {
      proxyStatus.value = data.data
      proxyRunning.value = data.data.running
    }
  } catch {}
}

async function startProxy() {
  proxyLoading.value = true
  wxStatus.value = 'proxy-starting'
  wxStatusText.value = '启动代理...'
  try {
    const { data } = await api.post('/api/proxy/start')
    if (data.ok) {
      proxyStatus.value = data.data
      proxyRunning.value = true
      wxStatus.value = 'proxy-running'
      wxStatusText.value = '等待小程序 WebSocket 连接...'
      initProxySocket()
    } else {
      wxStatus.value = 'error'
      wxStatusText.value = ''
      wxErrorText.value = `启动失败: ${data.error}`
    }
  } catch (e: any) {
    wxStatus.value = 'error'
    wxStatusText.value = ''
    wxErrorText.value = `启动失败: ${e.response?.data?.error || e.message}`
  }
  finally { proxyLoading.value = false }
}

async function stopProxy() {
  proxyLoading.value = true
  try {
    const { data } = await api.post('/api/proxy/stop')
    if (data.ok) {
      proxyStatus.value = data.data
      proxyRunning.value = false
      wxStatus.value = 'idle'
      wxStatusText.value = ''
    }
  } catch {}
  finally { proxyLoading.value = false }
}

function downloadCaCert() {
  window.open('/api/proxy/ca-cert', '_blank')
}

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

function stopAllChecks() {
  stopQQCheck()
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
  activeTab.value = tab
  if (tab === 'qq') loadQQQRCode()
  if (tab === 'wx') {
    wxStatus.value = 'idle'
    wxStatusText.value = ''
    wxErrorText.value = ''
    fetchProxyStatus().then(() => {
      if (proxyRunning.value) {
        wxStatus.value = 'proxy-running'
        wxStatusText.value = '等待小程序 WebSocket 连接...'
        initProxySocket()
      }
    })
  }
}

watch(() => props.show, (newVal) => {
  if (newVal) {
    errorMessage.value = ''
    if (props.editData) {
      form.name = props.editData.name
      form.code = props.editData.code || ''
      form.platform = props.editData.platform || 'qq'
      if (props.editData.platform === 'wx') {
        activeTab.value = 'wx'
        wxStatus.value = 'idle'
        wxStatusText.value = ''
        wxErrorText.value = ''
        fetchProxyStatus().then(() => {
          if (proxyRunning.value) {
            wxStatus.value = 'proxy-running'
            wxStatusText.value = '等待小程序 WebSocket 连接...'
            initProxySocket()
          }
        })
      } else {
        activeTab.value = 'qq'
        loadQQQRCode()
      }
    } else {
      activeTab.value = 'qq'
      form.name = ''; form.code = ''; form.platform = 'qq'
      loadQQQRCode()
    }
  } else {
    stopAllChecks()
    qrData.value = null; qrStatus.value = ''
    wxStatus.value = 'idle'
    wxStatusText.value = ''
    wxErrorText.value = ''
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
            :class="activeTab === 'wx' ? 'text-green-600 border-b-2 border-green-600' : 'text-gray-500'"
            @click="switchTab('wx')">微信登录</button>
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
            <BaseButton variant="text" size="sm" :disabled="loading" @click="loadQQQRCode">刷新二维码</BaseButton>
            <BaseButton v-if="qrData?.url" variant="text" size="sm" class="text-blue-600 md:hidden" @click="openQRCodeLoginUrl">跳转QQ登录</BaseButton>
          </div>
        </div>

        <!-- 微信登录 (代理拦截) -->
        <div v-if="activeTab === 'wx'" class="space-y-4">
          <div class="rounded-lg bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 space-y-1.5">
            <p class="font-medium">📋 首次设置（每台设备仅需一次）</p>
            <p>1. 点击「启动代理」，下载并安装 CA 证书</p>
            <p>2. Windows 搜索"代理设置" → 使用自动配置脚本 → 填入：</p>
            <code class="block bg-blue-100 px-2 py-1 rounded text-blue-800 dark:bg-blue-800 dark:text-blue-200 select-all text-[11px] break-all" @click.stop>http://localhost:3000/api/proxy/proxy.pac</code>
            <p>3. 打开 PC 微信，进入 QQ 农场小程序 → 自动捕获登录</p>
            <p class="font-medium mt-1">🔄 后续重新登录</p>
            <p>只需点击「启动代理」→ 打开小程序 → 自动完成，无需再设置 PAC</p>
          </div>

          <!-- 代理控制 -->
          <div class="flex items-center gap-2">
            <BaseButton
              variant="primary"
              size="sm"
              :loading="proxyLoading"
              @click="proxyRunning ? stopProxy() : startProxy()"
            >
              {{ proxyRunning ? '停止代理' : '启动代理' }}
            </BaseButton>
            <BaseButton
              v-if="proxyStatus.caAvailable"
              variant="outline"
              size="sm"
              @click="downloadCaCert"
            >
              下载 CA 证书
            </BaseButton>
          </div>

          <!-- 状态显示 -->
          <div class="rounded-lg border p-4 text-center text-sm min-h-[100px] flex flex-col items-center justify-center space-y-2">

            <!-- idle -->
            <template v-if="wxStatus === 'idle'">
              <div class="text-gray-400">
                <div class="i-carbon-settings text-3xl mb-1 mx-auto opacity-50" />
                <p>点击「启动代理」开始</p>
                <p class="text-xs mt-1">Windows 代理设置 → 自动配置脚本 → 填入 PAC 地址</p>
              </div>
            </template>

            <!-- proxy-starting -->
            <template v-if="wxStatus === 'proxy-starting'">
              <div i-svg-spinners-90-ring-with-bg class="text-2xl text-blue-500" />
              <p class="text-blue-600">启动代理...</p>
            </template>

            <!-- proxy-running -->
            <template v-if="wxStatus === 'proxy-running'">
              <div class="flex items-center gap-2">
                <span class="inline-block h-3 w-3 rounded-full bg-green-500 animate-pulse" />
                <span class="text-green-600 font-medium">{{ wxStatusText }}</span>
              </div>
              <p class="text-xs text-gray-400">请打开 PC 微信 → QQ 农场小程序</p>
              <div i-svg-spinners-90-ring-with-bg class="text-xl text-gray-400" />
            </template>

            <!-- code-captured -->
            <template v-if="wxStatus === 'code-captured'">
              <div class="i-carbon-checkmark-filled text-3xl text-green-500" />
              <p class="text-green-600 font-medium">{{ wxStatusText }}</p>
              <p class="text-xs text-gray-400">后端正在自动登录...</p>
            </template>

            <!-- success -->
            <template v-if="wxStatus === 'success'">
              <div class="i-carbon-checkmark-filled text-4xl text-green-500" />
              <p class="text-green-600 font-medium text-base">{{ wxStatusText }}</p>
            </template>

            <!-- error -->
            <template v-if="wxStatus === 'error'">
              <div class="i-carbon-warning-filled text-3xl text-red-500" />
              <p class="text-red-600 font-medium">{{ wxErrorText }}</p>
              <BaseButton variant="outline" size="sm" @click="startProxy">重试</BaseButton>
            </template>

          </div>

          <!-- 代理状态指示器 -->
          <div class="flex items-center justify-between text-xs">
            <span :class="proxyRunning ? 'text-green-600' : 'text-gray-400'">
              <span class="inline-block h-2 w-2 rounded-full mr-1" :class="proxyRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-300'" />
              {{ proxyRunning ? `代理运行中 :${proxyStatus.port}` : '代理已停止' }}
            </span>
            <span v-if="proxyStatus.caAvailable" class="text-gray-400">
              CA 证书 {{ proxyStatus.caCertPath ? '已安装' : '未安装' }}
            </span>
          </div>
        </div>

        <!-- manual -->
        <div v-if="activeTab === 'manual'" class="space-y-4">
          <div class="rounded-lg bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
            {{ manualNameHint }}
          </div>
          <div v-if="form.platform === 'wx'" class="rounded-lg bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 space-y-1">
            <p>微信推荐使用「微信登录」标签，启动代理后自动捕获 Code。</p>
          </div>
          <div v-if="form.platform === 'qq'" class="rounded-lg bg-green-50 p-3 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-300">
            <p>QQ 推荐使用「QQ扫码」登录。</p>
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

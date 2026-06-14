const path = require('node:path')
const fs = require('node:fs')

const CODE_PATTERNS = [
  // QQ farm miniprogram login code
  { name: 'loginCode', regex: /loginCode[=/]([\w-]{10,80})/g, group: 1 },
  // Generic code params in URL
  { name: 'code_param', regex: /[?&]code=([\w.%+-]{10,200})/g, group: 1 },
  // JSON code fields
  { name: 'json_code', regex: /"code"\s*:\s*"([^"]{10,200})"/g, group: 1 },
  // Ticket
  { name: 'ticket', regex: /"ticket"\s*:\s*"([^"]{10,200})"/g, group: 1 },
  // Token
  { name: 'token', regex: /"token"\s*:\s*"([^"]{10,200})"/g, group: 1 },
  // Authorization header
  { name: 'auth_header', regex: /[Aa]uthorization:\s*[Bb]earer\s+([\w.-]{20,200})/g, group: 1 },
  // WeChat openid
  { name: 'openid', regex: /"openid"\s*:\s*"([^"]{10,80})"/g, group: 1 },
  // Mini program exportkey (WeChat session export)
  { name: 'exportkey', regex: /exportkey=([n_]\w[\w%]{50,500})/g, group: 1 },
  // Mini program auth_session_id (in response JSON)
  { name: 'auth_session_id', regex: /"auth_session_id"\s*:\s*"([^"]{50,500})"/g, group: 1 },
]

const TRACKED_HOSTS = [
  'q.qq.com',
  'api.q.qq.com',
  'open.weixin.qq.com',
  'api.weixin.qq.com',
  'qq.com',
  'weixin.qq.com',
  'qzone.qq.com',
  'ssl.ptlogin2.qq.com',
  'xui.ptlogin2.qq.com',
  'localhost',
  '127.0.0.1',
]

function matchHost(hostname) {
  if (!hostname) return false
  const h = String(hostname).toLowerCase()
  return TRACKED_HOSTS.some(t => h === t || h.endsWith(`.${  t}`))
}

function extractCodes(str) {
  if (!str || typeof str !== 'string') return []
  const results = []
  for (const pattern of CODE_PATTERNS) {
    const re = new RegExp(pattern.regex.source, pattern.regex.flags)
    let m = re.exec(str)
    while (m !== null) {
      const val = m[pattern.group]
      if (val && !results.some(r => r.value === val)) {
        results.push({ pattern: pattern.name, value: val })
      }
      m = re.exec(str)
    }
  }
  return results
}

function createLocalProxy(options = {}) {
  const {
    port = 8899,
    caDir = path.join(options.dataDir || path.join(__dirname, '../../data'), 'ca'),
    onCodeFound,
    onRequestCaptured,
    onWsCodeCaptured,   // callback(codes) — 拦截到 WS code 时调用，不放行连接
  } = options

  let proxyInstance = null
  let running = false
  const capturedRequests = []
  const MAX_CAPTURED = 200

  function ensureCaDir() {
    fs.mkdirSync(caDir, { recursive: true })
  }

  function getCaCertPath() {
    return path.join(caDir, 'certs', 'ca.pem')
  }

  function getCaAvailable() {
    const certPath = getCaCertPath()
    return fs.existsSync(certPath)
  }

  function start() {
    return new Promise((resolve, reject) => {
      if (running) return resolve({ port, caAvailable: getCaAvailable() })

      ensureCaDir()

      const Proxy = require('http-mitm-proxy').Proxy
      proxyInstance = new Proxy()

      proxyInstance.onError((ctx, err) => {
        const msg = err ? (err.message || String(err)) : 'unknown'
        if (msg.includes('ECONNRESET') || msg.includes('EPIPE') || msg.includes('socket'))
          return // noisy but harmless
        console.error('[proxy] error:', msg)
      })

      proxyInstance.onWebSocketConnection((ctx, callback) => {
        const wsUrl = (ctx.proxyToServerWebSocketOptions && ctx.proxyToServerWebSocketOptions.url) || ''
        let blockConnection = false
        if (wsUrl) {
          const capture = {
            id: Date.now() + Math.random(),
            ts: Date.now(),
            method: 'WS',
            host: '',
            url: wsUrl.slice(0, 500),
            statusCode: 101,
            codes: extractCodes(wsUrl),
            responseBodyPreview: '',
          }
          try { const u = new URL(wsUrl); capture.host = u.host } catch {}
          capturedRequests.unshift(capture)
          if (capturedRequests.length > MAX_CAPTURED) capturedRequests.pop()

          // 检测是否为 QQ Farm WebSocket (gate-obt.nqf.qq.com)
          const isFarmWs = capture.host === 'gate-obt.nqf.qq.com'
          const hasCode = capture.codes.length > 0

          if (hasCode && typeof onCodeFound === 'function') {
            onCodeFound({ host: capture.host, url: capture.url, codes: capture.codes })
          }
          if (typeof onRequestCaptured === 'function') onRequestCaptured(capture)

          if (isFarmWs && hasCode && typeof onWsCodeCaptured === 'function') {
            // 截取 code，不放行，避免被服务器消耗
            console.error('[proxy] WS intercepted! blocking farm connection, code saved for bot')
            try { onWsCodeCaptured(capture.codes) } catch (e) {
              console.error('[proxy] onWsCodeCaptured error:', e?.message || e)
            }
            blockConnection = true
          } else {
            console.error('[proxy] WS captured:', wsUrl.slice(0, 200))
          }
        }
        // 不放行：让客户端连接挂起/超时
        if (blockConnection) {
          // 不调用 callback，连接不被转发
          return
        }
        return callback()
      })

      proxyInstance.onRequest((ctx, callback) => {
        const req = ctx.clientToProxyRequest
        const host = (req.headers && req.headers.host) || ''
        const url = req.url || ''

        // 伪装 qzone/q.qq.com 的 UA 为 QQ 浏览器，绕过微信扫码拦截
        if (host && !host.includes('weixin') && (host.includes('qzone.qq.com') || host.includes('q.qq.com') || host.includes('ptlogin2.qq.com'))) {
          req.headers['user-agent'] = 'Mozilla/5.0 (Linux; Android 14; M2101K9G Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.200 Mobile Safari/537.36 V1_AND_SQ_9.1.0_1536_YYB_D QQ/9.1.0.1536 NetType/WIFI'
        }

        if (matchHost(host)) {
          const capture = {
            id: Date.now() + Math.random(),
            ts: Date.now(),
            method: req.method,
            host,
            url,
            requestHeaders: { ...req.headers },
            requestBody: '',
            responseHeaders: null,
            responseBody: '',
            statusCode: null,
            codes: [],
          }

          // Collect request body
          ctx.onRequestData((_ctx, chunk, cb) => {
            capture.requestBody += chunk.toString()
            return cb(null, chunk)
          })

          ctx.onRequestEnd((_ctx, cb) => {
            // Check URL for codes
            const urlCodes = extractCodes(url)
            capture.codes.push(...urlCodes)

            // Check request body for codes
            const reqBodyCodes = extractCodes(capture.requestBody)
            for (const c of reqBodyCodes) {
              if (!capture.codes.some(ec => ec.value === c.value))
                capture.codes.push(c)
            }

            return cb()
          })

          // Intercept response
          ctx.onResponse((_ctx, cb) => {
            const res = _ctx.serverToProxyResponse
            capture.statusCode = res.statusCode
            capture.responseHeaders = { ...res.headers }
            return cb()
          })

          ctx.onResponseData((_ctx, chunk, cb) => {
            capture.responseBody += chunk.toString()
            return cb(null, chunk)
          })

          ctx.onResponseEnd((_ctx, cb) => {
            // Check response body for codes
            const respBodyCodes = extractCodes(capture.responseBody)
            for (const c of respBodyCodes) {
              if (!capture.codes.some(ec => ec.value === c.value))
                capture.codes.push(c)
            }

            // Check response headers for codes
            const headerStr = JSON.stringify(capture.responseHeaders || {})
            const headerCodes = extractCodes(headerStr)
            for (const c of headerCodes) {
              if (!capture.codes.some(ec => ec.value === c.value))
                capture.codes.push(c)
            }

            // Store capture
            if (capture.codes.length > 0 || matchHost(host)) {
              // Keep only interesting data
              const stored = {
                id: capture.id,
                ts: capture.ts,
                method: capture.method,
                host: capture.host,
                url: capture.url.length > 500 ? `${capture.url.slice(0, 500)  }...` : capture.url,
                statusCode: capture.statusCode,
                codes: capture.codes,
                responseBodyPreview: capture.responseBody.slice(0, 2000),
              }
              capturedRequests.unshift(stored)
              if (capturedRequests.length > MAX_CAPTURED)
                capturedRequests.pop()

              if (typeof onRequestCaptured === 'function')
                onRequestCaptured(stored)

              if (capture.codes.length > 0 && typeof onCodeFound === 'function') {
                onCodeFound({ host, url, codes: capture.codes })
              }
            }

            return cb()
          })
        }

        return callback()
      })

      proxyInstance.listen({
        port,
        host: '0.0.0.0',
        sslCaDir: caDir,
      }, (err) => {
        if (err) return reject(err)
        const boundPort = proxyInstance.httpPort || port
        running = true
        console.error('[proxy] started on', boundPort, 'sslCaDir:', caDir)
        resolve({ port: boundPort, caAvailable: getCaAvailable() })
      })
    })
  }

  function stop() {
    return new Promise((resolve) => {
      running = false
      if (proxyInstance) {
        try { proxyInstance.close() } catch (e) { console.error('[proxy] close error:', e?.message) }
        proxyInstance = null
      }
      resolve()
    })
  }

  function getStatus() {
    return {
      running,
      port,
      caAvailable: getCaAvailable(),
      caCertPath: getCaAvailable() ? getCaCertPath() : null,
      capturedCount: capturedRequests.length,
    }
  }

  function getCaCertPem() {
    const certPath = getCaCertPath()
    if (!fs.existsSync(certPath)) return null
    return fs.readFileSync(certPath, 'utf-8')
  }

  function getCaptures(limit = 50) {
    return capturedRequests.slice(0, limit)
  }

  function clearCaptures() {
    capturedRequests.length = 0
  }

  return {
    start,
    stop,
    getStatus,
    getCaCertPem,
    getCaptures,
    clearCaptures,
  }
}

module.exports = { createLocalProxy, extractCodes, matchHost, CODE_PATTERNS }

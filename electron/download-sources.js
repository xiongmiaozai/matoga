/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 后端二进制下载源清单与测速。
 *
 * 传统镜像站（清华 TUNA / USTC / 阿里云 / 腾讯云）的 github-release 服务只收录
 * 白名单仓库，不收录本仓库，因此无法直接提供 Release 资产。这里改用 GitHub
 * 加速节点转发：节点形如 `<prefix><原始 GitHub URL>`，逐个测速后按快→慢排序，
 * 下载失败自动回退下一个，最后兜底直连 GitHub 官方地址。
 *
 * 节点可用性会随时间变化，故启动时实测排序而非写死顺序；任一节点不可用不会
 * 影响整体流程（测速超时即当不可用处理）。
 */

// electron 的 net 在模块顶层 require 会让单测（纯 node 环境）无法加载本文件，
// 因此延迟到真正发起请求时再取，并允许通过 setNet() 注入替身。
// netOverridden 记录「调用方显式设置过」：一旦置过就不再回退 require('electron')，
// 否则测试中 setNet(null) 会触发 electron 包下载（纯 node 下会一直挂住）。
let netImpl = null
let netOverridden = false

function resolveNet() {
  if (netImpl) return netImpl
  if (netOverridden) return null
  try {
    return require('electron').net
  } catch {
    return null
  }
}

// 测试注入用：传入一个与 electron net 兼容的实现。
function setNet(impl) {
  netImpl = impl || null
  netOverridden = true
}

// 官方直连地址。测速/下载时它总是作为最后一个兜底项参与。
const OFFICIAL_PREFIX = ''

// 加速节点。prefix 为空串表示直连官方。
const SOURCES = [
  { id: 'ghproxy-site', label: 'ghproxy.site', prefix: 'https://ghproxy.site/' },
  { id: 'gh-proxy-org', label: 'gh-proxy.org', prefix: 'https://gh-proxy.org/' },
  { id: 'monlor', label: 'gh.monlor.com', prefix: 'https://gh.monlor.com/' },
  { id: 'noki', label: 'gh.noki.icu', prefix: 'https://gh.noki.icu/' },
  { id: 'gh-proxy-com', label: 'gh-proxy.com', prefix: 'https://gh-proxy.com/' },
  { id: 'liuzhicong', label: 'ghproxy.liuzhicong.com', prefix: 'https://ghproxy.liuzhicong.com/' },
  { id: 'official', label: 'github.com（官方直连）', prefix: OFFICIAL_PREFIX }
]

// 测速采样大小：取前 256KB 计时，足够区分快慢又不至于白费流量。
const PROBE_BYTES = 256 * 1024
// 单节点测速超时。超时即判为不可用，不阻塞整体进度。
const PROBE_TIMEOUT = 5000

// 把节点前缀与原始 GitHub URL 拼成真实下载地址。
function buildUrl(prefix, rawUrl) {
  return prefix + rawUrl
}

// 返回节点清单的浅拷贝，避免调用方改到内部常量。
function listSources() {
  return SOURCES.map(s => ({ ...s }))
}

/**
 * 用一次 Range 请求量出「拿到 PROBE_BYTES 字节花了多久」。
 *
 * @returns {Promise<{ ok: boolean, ms: number, bytes: number, speed: number }>}
 *   speed 单位为字节/秒；失败时 ok=false 且 speed=0。
 */
function probeOne(rawUrl, source) {
  return new Promise(resolve => {
    const url = buildUrl(source.prefix, rawUrl)
    const started = Date.now()
    let received = 0
    let settled = false

    const finish = ok => {
      if (settled) return
      settled = true
      const ms = Date.now() - started
      resolve({ ok, ms, bytes: received, speed: ok && ms > 0 ? (received * 1000) / ms : 0 })
    }

    let request
    const net = resolveNet()
    if (!net) {
      finish(false)
      return
    }
    try {
      request = net.request({ method: 'GET', url })
    } catch {
      finish(false)
      return
    }

    const timer = setTimeout(() => {
      try {
        request.abort()
      } catch {}
      finish(received > 0)
    }, PROBE_TIMEOUT)

    try {
      request.setHeader('Range', `bytes=0-${PROBE_BYTES - 1}`)
    } catch {}

    request.on('response', response => {
      const status = response.statusCode
      // 接受 200（整文件）与 206（分段）两种成功形态。
      if (status !== 200 && status !== 206) {
        clearTimeout(timer)
        response.resume()
        finish(false)
        return
      }
      response.on('data', chunk => {
        received += chunk.length
        if (received >= PROBE_BYTES) {
          clearTimeout(timer)
          try {
            request.abort()
          } catch {}
          finish(true)
        }
      })
      response.on('end', () => {
        clearTimeout(timer)
        finish(received > 0)
      })
      response.on('error', () => {
        clearTimeout(timer)
        finish(false)
      })
    })
    request.on('error', () => {
      clearTimeout(timer)
      finish(false)
    })
    request.end()
  })
}

/**
 * 并行测速全部节点，返回按速度从快到慢排序的可用节点。
 *
 * 官方直连恒排在可用节点之后作为兜底：它在本机常常不可达，但不应因为
 * 其它节点都慢就被提前，也不应在全部节点都失败时被丢掉。
 *
 * @param {string} rawUrl 原始 GitHub 下载地址
 * @param {(results: Array) => void} [onProbe] 测得单项时回调，用于 UI 展示
 * @returns {Promise<Array<{ id: string, label: string, prefix: string, ms: number, speed: number }>>}
 */
async function probeSources(rawUrl, onProbe) {
  const results = await Promise.all(
    SOURCES.map(async source => {
      const r = await probeOne(rawUrl, source)
      const item = { ...source, ok: r.ok, ms: r.ms, bytes: r.bytes, speed: r.speed }
      if (onProbe) {
        try {
          onProbe(item)
        } catch {}
      }
      return item
    })
  )

  const usable = results.filter(r => r.ok && r.speed > 0).sort((a, b) => b.speed - a.speed)
  const official = results.filter(r => !r.ok && r.prefix === OFFICIAL_PREFIX)
  const failed = results.filter(r => !r.ok && r.prefix !== OFFICIAL_PREFIX)

  // 可用节点（快→慢）→ 未测通的官方直连 → 其余失败节点（万一测速偶发失败仍给一次机会）
  return [...usable, ...official, ...failed]
}

module.exports = {
  SOURCES,
  OFFICIAL_PREFIX,
  PROBE_BYTES,
  PROBE_TIMEOUT,
  buildUrl,
  listSources,
  probeSources,
  setNet
}

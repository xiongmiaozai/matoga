/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 GitHub Release 下载官方预编译 Go 后端二进制（多节点测速 + 多线程分段）。
 *
 * 流程：先把各加速节点按实测速度排序 → 依次尝试 → 某节点失败自动回退下一个 →
 * 全部失败则抛出 MANUAL_INSTALL_REQUIRED，由调用方引导用户手动下载。
 *
 * 仅当 resolveGoBackend() 找不到二进制、且用户在「依赖安装」弹窗里勾选同意
 * 第三方许可后才会调用。下载产物写入 app.getPath('userData')/bin/，不触碰
 * 只读的打包资源目录。
 */

const fs = require('fs')
const path = require('path')
const { SOURCES, buildUrl, probeSources } = require('./download-sources')
const { downloadMultipart, normalizeThreads, DEFAULT_THREADS } = require('./multi-download')

// electron 的 app 延迟获取：模块顶层 require 会让纯 node 单测无法加载本文件。
function electronApp() {
  try {
    return require('electron').app
  } catch {
    return null
  }
}

const RELEASE_OWNER = 'xiongmiaozai'
const RELEASE_REPO = 'matoga'

// 全部节点都失败时抛出，调用方据此引导用户手动下载。
const MANUAL_INSTALL_REQUIRED = 'MANUAL_INSTALL_REQUIRED'

// 平台 → Release 资产名。与 .github/workflows/release-backend.yml 的 matrix 对应。
function assetNameForPlatform() {
  const ext = process.platform === 'win32' ? '.exe' : ''
  switch (process.platform) {
    case 'win32':
      return 'matoga-backend-windows-x64' + ext
    case 'darwin':
      return 'matoga-backend-macos-' + process.arch + ext
    case 'linux':
      return 'matoga-backend-linux-' + process.arch + ext
    default:
      return null
  }
}

// 官方原始地址（不含加速前缀）；加速节点在此基础上加前缀。
function officialUrl() {
  const asset = assetNameForPlatform()
  if (!asset) return null
  return `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/latest/download/${asset}`
}

// 返回官方直连地址（协议展示与兜底下载用）。
function downloadUrl() {
  return officialUrl()
}

function targetDir() {
  const app = electronApp()
  if (!app) throw new Error('无法定位用户数据目录（electron 未就绪）')
  return path.join(app.getPath('userData'), 'bin')
}

function targetPath() {
  const exe = process.platform === 'win32' ? 'matoga-backend.exe' : 'matoga-backend'
  return path.join(targetDir(), exe)
}

// 人类可读字节数，用于进度文案。
function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

// 解析下载线程数。优先级：调用方显式传入 → 环境变量 MATOGA_DOWNLOAD_THREADS
// （便于 CI 与无界面场景覆盖）→ 默认 24。最终一律夹到 1–64。
function resolveThreads(requested) {
  const envThreads = Number.parseInt(process.env.MATOGA_DOWNLOAD_THREADS, 10)
  const picked = requested || (Number.isFinite(envThreads) ? envThreads : null) || DEFAULT_THREADS
  return normalizeThreads(picked)
}

// 滚动窗口测速：只统计最近 windowMs 内的增量。这是「总速度」——
// 所有分片汇入同一个 received，因此天然反映整体吞吐而非单分片速度。
function createSpeedMeter(windowMs = 1500) {
  const samples = []
  return {
    push(received) {
      const now = Date.now()
      samples.push({ t: now, n: received })
      while (samples.length > 2 && now - samples[0].t > windowMs) samples.shift()
    },
    speed() {
      if (samples.length < 2) return 0
      const first = samples[0]
      const last = samples[samples.length - 1]
      const dt = (last.t - first.t) / 1000
      const db = last.n - first.n
      if (dt <= 0 || db <= 0) return 0
      return db / dt
    },
    reset() {
      samples.length = 0
    }
  }
}

/**
 * 下载二进制到 userData/bin/。
 *
 * @param {object} [opts]
 * @param {number} [opts.threads] 线程数，默认 24（可调 1–64）
 * @param {(evt: object) => void} [opts.onProgress] 进度事件：
 *   { phase: 'probe'|'download'|'retry'|'done', source?: string, index?: number,
 *     total?: number, received?: number, percent?: number, speed?: number,
 *     threads?: number, text: string }
 * @returns {Promise<string>} 落盘后的可执行文件绝对路径
 */
async function downloadBackend(opts = {}) {
  const url = officialUrl()
  if (!url) throw new Error('当前平台不支持自动安装后端')

  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {}
  const threads = resolveThreads(opts.threads)
  const dest = targetPath()

  onProgress({ phase: 'probe', text: `正在测速 ${SOURCES.length} 个下载节点…`, threads })

  // 1) 并行测速，得到「快 → 慢」候选顺序（官方直连恒为兜底）。
  const ranked = await probeSources(url, item => {
    if (!item.ok) return
    onProgress({
      phase: 'probe',
      source: item.label,
      text: `测速 ${item.label}：${formatBytes(item.speed)}/s`,
      speed: item.speed,
      threads
    })
  })

  const meter = createSpeedMeter()
  let lastErr = null

  // 2) 逐个节点尝试，任一成功即返回。
  for (let i = 0; i < ranked.length; i++) {
    const src = ranked[i]
    const viaUrl = buildUrl(src.prefix, url)
    const usingOfficial = src.prefix === ''
    onProgress({
      phase: 'download',
      source: src.label,
      index: i,
      total: 0,
      received: 0,
      percent: 0,
      speed: 0,
      threads,
      text: usingOfficial
        ? `正在从 GitHub 官方直连下载（第 ${i + 1}/${ranked.length} 个源）…`
        : `正在从 ${src.label} 下载（第 ${i + 1}/${ranked.length} 个源）…`
    })

    meter.reset()
    try {
      const result = await downloadMultipart(viaUrl, dest, {
        threads,
        onProgress: (received, total) => {
          meter.push(received)
          const speed = meter.speed()
          onProgress({
            phase: 'download',
            source: src.label,
            index: i,
            total: total || 0,
            received,
            percent: total ? Math.min(100, (received / total) * 100) : 0,
            speed,
            threads,
            text:
              `${src.label} · ${formatBytes(received)}` +
              (total ? ' / ' + formatBytes(total) : '') +
              ` · ${formatBytes(speed)}/s`
          })
        }
      })

      // 下载已完成，接下来是「安装」：写入 bin 目录并赋予可执行权限。
      onProgress({
        phase: 'install',
        source: src.label,
        received: result.bytes,
        total: result.bytes,
        percent: 100,
        speed: 0,
        threads,
        text: `正在安装后端到 ${dest}`
      })

      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(dest, 0o755)
        } catch {}
      }

      onProgress({
        phase: 'done',
        source: src.label,
        received: result.bytes,
        total: result.bytes,
        percent: 100,
        speed: 0,
        threads,
        text: `安装完成（${src.label}，${formatBytes(result.bytes)}，${result.threads} 线程）`
      })
      return dest
    } catch (err) {
      lastErr = err
      onProgress({
        phase: 'retry',
        source: src.label,
        index: i,
        threads,
        text: `${src.label} 下载失败（${err.message}），切换到下一个源…`
      })
    }
  }

  // 3) 全军覆没：把控制权交回调用方，由其引导手动下载。
  const err = new Error(`所有下载节点均失败${lastErr ? '：' + lastErr.message : ''}。请手动下载后端二进制。`)
  err.code = MANUAL_INSTALL_REQUIRED
  throw err
}

module.exports = {
  downloadBackend,
  targetPath,
  assetNameForPlatform,
  downloadUrl,
  officialUrl,
  formatBytes,
  resolveThreads,
  MANUAL_INSTALL_REQUIRED
}

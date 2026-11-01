/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 多线程分段下载器（基于 Electron net，天然走系统代理与证书链）。
 *
 * 做法：先用 `Range: bytes=0-0` 问一次总长度，预分配文件，再把文件切成 N 段
 * 并发拉取，各段落盘到自己的偏移位置。默认 24 线程，可由用户调整。
 *
 * 分段失败会重试有限次；整段都拿不下来就整体失败，交由调用方回退下一个下载源。
 * 若目标地址不支持 Range（返回 200 而非 206），自动降级为单流下载，保证仍能完成。
 */

const fs = require('fs')
const path = require('path')

// electron 的 net 延迟获取：模块顶层 require 会让纯 node 单测无法加载本文件，
// 同时允许测试通过 setNet() 注入替身。
// netOverridden 记录「调用方显式设置过」：一旦置过，就不再回退去 require('electron')，
// 否则测试里 setNet(null) 会触发 electron 包下载（纯 node 下会一直挂住）。
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

function setNet(impl) {
  netImpl = impl || null
  netOverridden = true
}

// 默认线程数。用户可在依赖安装弹窗里调整（1–64）。
const DEFAULT_THREADS = 24
const MIN_THREADS = 1
const MAX_THREADS = 64

// 单段重试次数：失败后自动重试两遍（共 3 次尝试），仍失败即认为该源不可用，
// 交由调用方回退下一个下载源；全部源都失败则引导用户手动下载。
const SEGMENT_RETRIES = 2
const SEGMENT_ATTEMPTS = SEGMENT_RETRIES + 1
// 单段请求超时（毫秒）。大段在慢节点上需要放宽。
const SEGMENT_TIMEOUT = 60000

// 把任意输入夹到合法的线程数区间。
function normalizeThreads(n) {
  const v = Number.parseInt(n, 10)
  if (!Number.isFinite(v)) return DEFAULT_THREADS
  return Math.max(MIN_THREADS, Math.min(MAX_THREADS, v))
}

/**
 * 发一个 Range 请求，取回响应头里的总长度与是否支持分段。
 *
 * @returns {Promise<{ total: number, acceptsRanges: boolean }>}
 */
function probeSize(url) {
  return new Promise((resolve, reject) => {
    let request
    const net = resolveNet()
    if (!net) {
      reject(new Error('当前环境不支持网络请求'))
      return
    }
    try {
      request = net.request({ method: 'GET', url })
    } catch (err) {
      reject(err)
      return
    }
    request.setHeader('Range', 'bytes=0-0')

    let settled = false
    const done = (err, value) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve(value)
    }

    request.on('response', response => {
      const status = response.statusCode
      if (status === 200) {
        // 服务端忽略了 Range，只能整文件读。改用 content-length。
        const len = Number(response.headers['content-length'])
        response.resume()
        done(null, { total: Number.isFinite(len) && len > 0 ? len : 0, acceptsRanges: false })
        return
      }
      if (status !== 206) {
        response.resume()
        done(new Error(`HTTP ${status}`))
        return
      }
      const cr = String(response.headers['content-range'] || '')
      const m = /\/(\d+)\s*$/.exec(cr)
      response.resume()
      done(null, { total: m ? Number(m[1]) : 0, acceptsRanges: true })
    })
    request.on('error', err => done(err))
    request.end()
  })
}

/**
 * 拉取一段字节，返回 Buffer。
 *
 * @param {string} url
 * @param {number} start 起始偏移（含）
 * @param {number} end 结束偏移（含）
 * @param {(n: number) => void} onBytes 收到字节时回调，用于累计进度
 * @returns {Promise<Buffer>}
 */
function fetchRange(url, start, end, onBytes) {
  return new Promise((resolve, reject) => {
    let request
    const net = resolveNet()
    if (!net) {
      reject(new Error('当前环境不支持网络请求'))
      return
    }
    try {
      request = net.request({ method: 'GET', url })
    } catch (err) {
      reject(err)
      return
    }
    request.setHeader('Range', `bytes=${start}-${end}`)

    let settled = false
    const fail = err => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    }

    const timer = setTimeout(() => {
      try {
        request.abort()
      } catch {}
      fail(new Error(`分段 ${start}-${end} 超时`))
    }, SEGMENT_TIMEOUT)

    request.on('response', response => {
      const status = response.statusCode
      if (status !== 206 && status !== 200) {
        response.resume()
        fail(new Error(`分段 ${start}-${end} 返回 HTTP ${status}`))
        return
      }
      const chunks = []
      response.on('data', chunk => {
        chunks.push(chunk)
        if (onBytes) onBytes(chunk.length)
      })
      response.on('end', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(Buffer.concat(chunks))
      })
      response.on('error', fail)
    })
    request.on('error', fail)
    request.end()
  })
}

/**
 * 把整个文件单流下载（目标不支持 Range 时的降级路径）。
 */
function fetchWhole(url, onBytes) {
  return new Promise((resolve, reject) => {
    let request
    const net = resolveNet()
    if (!net) {
      reject(new Error('当前环境不支持网络请求'))
      return
    }
    try {
      request = net.request({ method: 'GET', url })
    } catch (err) {
      reject(err)
      return
    }
    let settled = false
    const fail = err => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    }
    const timer = setTimeout(() => {
      try {
        request.abort()
      } catch {}
      fail(new Error('下载超时'))
    }, SEGMENT_TIMEOUT * 5)

    request.on('response', response => {
      if (response.statusCode !== 200) {
        response.resume()
        fail(new Error(`HTTP ${response.statusCode}`))
        return
      }
      const chunks = []
      response.on('data', chunk => {
        chunks.push(chunk)
        if (onBytes) onBytes(chunk.length)
      })
      response.on('end', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(Buffer.concat(chunks))
      })
      response.on('error', fail)
    })
    request.on('error', fail)
    request.end()
  })
}

// 写文件到指定偏移（独占 FileHandle，带位置写入，避免并发错位）。
function writeAt(handle, buffer, position) {
  return handle.write(buffer, 0, buffer.length, position)
}

/**
 * 多线程分段下载到 destPath（先写 .download 临时文件，成功后改名）。
 *
 * @param {string} url 实际下载地址（已含加速节点前缀）
 * @param {string} destPath 目标文件绝对路径
 * @param {object} [opts]
 * @param {number} [opts.threads] 线程数，默认 24
 * @param {(received: number, total: number | null, extra?: object) => void} [opts.onProgress]
 * @returns {Promise<{ path: string, bytes: number, threads: number, ranged: boolean }>}
 */
async function downloadMultipart(url, destPath, opts = {}) {
  const threads = normalizeThreads(opts.threads)
  const onProgress = opts.onProgress

  const dir = path.dirname(destPath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = destPath + '.download'

  const { total, acceptsRanges } = await probeSize(url)

  let received = 0
  const bump = n => {
    received += n
    if (onProgress) onProgress(received, total || null, { threads, ranged: acceptsRanges })
  }

  const cleanup = () => {
    try {
      fs.unlinkSync(tmp)
    } catch {}
  }

  try {
    if (!acceptsRanges || !total || !Number.isFinite(total) || total <= 0) {
      // 降级：单流整文件下载。
      const buf = await fetchWhole(url, bump)
      fs.writeFileSync(tmp, buf)
      fs.renameSync(tmp, destPath)
      return { path: destPath, bytes: buf.length, threads: 1, ranged: false }
    }

    // 预分配目标大小，后续按偏移写入。
    const handle = await fs.promises.open(tmp, 'w')
    try {
      await handle.truncate(total)

      // 切成 threads 段，均分余数。
      const ranges = []
      const base = Math.floor(total / threads)
      let rest = total - base * threads
      let cursor = 0
      for (let i = 0; i < threads; i++) {
        const size = base + (rest > 0 ? 1 : 0)
        if (rest > 0) rest--
        if (size <= 0) break
        ranges.push({ start: cursor, end: cursor + size - 1 })
        cursor += size
      }

      // 简单工作池：每个 worker 反复领下一段，直到取完。
      // 进度按「本次尝试已收字节」计量，失败即整段回滚，避免重试导致进度虚高。
      let next = 0
      const runWorker = async () => {
        for (;;) {
          const idx = next++
          if (idx >= ranges.length) return
          const { start, end } = ranges[idx]
          const want = end - start + 1
          let lastErr = null
          for (let attempt = 1; attempt <= SEGMENT_ATTEMPTS; attempt++) {
            let attemptBytes = 0
            const onAttemptBytes = n => {
              attemptBytes += n
              bump(n)
            }
            try {
              const buf = await fetchRange(url, start, end, onAttemptBytes)
              if (buf.length !== want) {
                throw new Error(`分段 ${start}-${end} 长度不符（${buf.length} ≠ ${want}）`)
              }
              await writeAt(handle, buf, start)
              lastErr = null
              break
            } catch (err) {
              lastErr = err
              // 回滚本次尝试已计入的字节，保证 received 只反映真实落盘进度。
              received -= attemptBytes
              if (onProgress) onProgress(received, total, { threads, ranged: true })
            }
          }
          if (lastErr) throw lastErr
        }
      }

      await Promise.all(Array.from({ length: Math.min(threads, ranges.length) }, runWorker))
    } finally {
      await handle.close()
    }

    const st = fs.statSync(tmp)
    if (st.size !== total) {
      throw new Error(`下载不完整：期望 ${total} 字节，实际 ${st.size} 字节`)
    }
    fs.renameSync(tmp, destPath)
    return { path: destPath, bytes: st.size, threads, ranged: true }
  } catch (err) {
    cleanup()
    throw err
  }
}

module.exports = {
  downloadMultipart,
  normalizeThreads,
  setNet,
  DEFAULT_THREADS,
  MIN_THREADS,
  MAX_THREADS,
  SEGMENT_RETRIES,
  SEGMENT_ATTEMPTS
}

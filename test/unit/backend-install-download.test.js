/**
 * 后端依赖下载单测（electron/download-sources.js、electron/multi-download.js、
 * electron/install-backend.js、electron/third-party-notice.js）：
 * - 多加速节点的地址拼接与排序（官方直连兜底）
 * - 多线程分段下载：分段正确性、Range 不支持时降级单流
 * - 分段失败重试（重试两遍共 3 次尝试）、永久失败时清理临时文件
 * - 进度回滚：重试不得让累计字节虚高
 * - 协议正文必须披露真实下载地址
 *
 * 这些模块把 electron 的 net/app 改成惰性获取，因此可在纯 node 下加载；
 * 下载链路通过 setNet() 注入内存假 net，不触网。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { SOURCES, buildUrl, listSources, setNet: setSourceNet } = require('../../electron/download-sources')
const {
  downloadMultipart,
  normalizeThreads,
  setNet: setDownloadNet,
  DEFAULT_THREADS,
  MIN_THREADS,
  MAX_THREADS,
  SEGMENT_RETRIES,
  SEGMENT_ATTEMPTS
} = require('../../electron/multi-download')
const backend = require('../../electron/install-backend')
const notice = require('../../electron/third-party-notice')

// ---------------------------------------------------------------------------
// 内存假 net：按 Range 切片响应，可注入每段失败次数与「忽略 Range」模式
// ---------------------------------------------------------------------------

/**
 * @param {Buffer} body 服务器持有的完整字节
 * @param {object} [opts]
 * @param {boolean} [opts.ignoreRange] 模拟服务端忽略 Range（回 200 + 全量）
 * @param {Map<string, number>} [opts.failures] key=`start-end` → 剩余失败次数
 * @param {boolean} [opts.networkError] 一律触发 request error
 */
function makeFakeNet(body, opts = {}) {
  const state = { requests: 0, ranges: [], failureHits: 0 }

  const net = {
    request({ url: _url }) {
      const headers = {}
      const listeners = {}
      const req = {
        setHeader(k, v) {
          headers[k] = v
        },
        on(ev, cb) {
          ;(listeners[ev] = listeners[ev] || []).push(cb)
          return req
        },
        abort() {},
        end() {
          state.requests++
          const range = headers['Range'] || headers['range'] || ''
          state.ranges.push(range)

          setImmediate(() => {
            if (opts.networkError) {
              ;(listeners.error || []).forEach(cb => cb(new Error('net down')))
              return
            }

            const m = /bytes=(\d+)-(\d+)/.exec(range)
            const start = m ? Number(m[1]) : 0
            const end = m ? Number(m[2]) : body.length - 1
            const key = `${start}-${end}`

            const left = opts.failures ? opts.failures.get(key) || 0 : 0
            if (left > 0) {
              opts.failures.set(key, left - 1)
              state.failureHits++
              ;(listeners.error || []).forEach(cb => cb(new Error(`分段 ${key} 模拟失败`)))
              return
            }

            const rl = {}
            const resp = {
              statusCode: 0,
              headers: {},
              on(ev, cb) {
                ;(rl[ev] = rl[ev] || []).push(cb)
                return resp
              },
              resume() {},
              _push(chunk) {
                ;(rl.data || []).forEach(cb => cb(chunk))
              },
              _end() {
                ;(rl.end || []).forEach(cb => cb())
              }
            }

            if (opts.ignoreRange || !m) {
              resp.statusCode = 200
              resp.headers = { 'content-length': String(body.length) }
            } else {
              resp.statusCode = 206
              resp.headers = {
                'content-range': `bytes ${start}-${end}/${body.length}`,
                'content-length': String(end - start + 1)
              }
            }

            ;(listeners.response || []).forEach(cb => cb(resp))

            if (resp.statusCode === 200) {
              setImmediate(() => {
                resp._push(body)
                resp._end()
              })
              return
            }

            const slice = body.subarray(start, end + 1)
            setImmediate(() => {
              // 分两片推送，覆盖多 chunk 汇总路径
              const half = Math.ceil(slice.length / 2)
              resp._push(slice.subarray(0, half))
              resp._push(slice.subarray(half))
              resp._end()
            })
          })
        }
      }
      return req
    }
  }

  return { net, state }
}

function tmpFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matoga-dl-'))
  return { dir, file: path.join(dir, name) }
}

function payload(size) {
  const buf = Buffer.alloc(size)
  for (let i = 0; i < size; i++) buf[i] = i % 251
  return buf
}

test.afterEach(() => {
  setDownloadNet(null)
  setSourceNet(null)
})

// ---------------------------------------------------------------------------
// 纯函数：线程数、地址拼接、字节格式化
// ---------------------------------------------------------------------------

test('normalizeThreads 夹取到 1–64 并回落到默认值', () => {
  assert.equal(DEFAULT_THREADS, 24)
  assert.equal(MIN_THREADS, 1)
  assert.equal(MAX_THREADS, 64)
  assert.equal(normalizeThreads(24), 24)
  assert.equal(normalizeThreads(99), MAX_THREADS)
  assert.equal(normalizeThreads(0), MIN_THREADS)
  assert.equal(normalizeThreads(-5), MIN_THREADS)
  assert.equal(normalizeThreads('abc'), DEFAULT_THREADS)
  assert.equal(normalizeThreads(undefined), DEFAULT_THREADS)
  assert.equal(normalizeThreads('8'), 8)
})

test('SEGMENT_RETRIES=2 表示失败后重试两遍（共 3 次尝试）', () => {
  assert.equal(SEGMENT_RETRIES, 2)
  assert.equal(SEGMENT_ATTEMPTS, 3)
})

test('buildUrl 直接拼接节点前缀，官方直连前缀为空', () => {
  const raw = 'https://github.com/xiongmiaozai/matoga/releases/latest/download/x.exe'
  assert.equal(buildUrl('', raw), raw)
  assert.equal(buildUrl('https://gh-proxy.org/', raw), 'https://gh-proxy.org/' + raw)
  const list = listSources()
  assert.equal(list.length, SOURCES.length)
  assert.ok(list.length >= 2, '至少要有加速节点 + 官方兜底')
  assert.equal(list[list.length - 1].prefix, '', '官方直连必须排在最后作兜底')
  // listSources 返回浅拷贝，外部改动不得污染内部表
  list.push({ name: 'x', prefix: 'y' })
  assert.equal(listSources().length, SOURCES.length)
})

test('install-backend 暴露官方地址与手动下载错误码', () => {
  const url = backend.officialUrl()
  assert.match(url, /^https:\/\/github\.com\/xiongmiaozai\/matoga\/releases\/latest\/download\//)
  assert.match(url, /matoga-backend-/)
  // 兼容旧调用：downloadUrl() 仍返回官方原始地址
  assert.equal(backend.downloadUrl(), url)
  assert.equal(backend.MANUAL_INSTALL_REQUIRED, 'MANUAL_INSTALL_REQUIRED')
  const asset = backend.assetNameForPlatform()
  assert.match(asset, /^matoga-backend-(windows-x64\.exe|macos-(arm64|x64)|linux-x64)$/)
})

test('formatBytes 输出人类可读大小', () => {
  assert.equal(backend.formatBytes(9262080), '8.8 MB')
  assert.equal(backend.formatBytes(0), '0 B')
  assert.equal(backend.formatBytes(512), '512 B')
  assert.equal(backend.formatBytes(1024), '1.0 KB')
  assert.equal(backend.formatBytes(-1), '0 B')
  assert.equal(backend.formatBytes(NaN), '0 B')
})

test('resolveThreads 优先级：显式传入 → 环境变量 → 默认 24，并夹到 1–64', () => {
  const saved = process.env.MATOGA_DOWNLOAD_THREADS
  try {
    delete process.env.MATOGA_DOWNLOAD_THREADS
    assert.equal(backend.resolveThreads(undefined), DEFAULT_THREADS)
    assert.equal(backend.resolveThreads(4), 4)
    assert.equal(backend.resolveThreads(999), MAX_THREADS)

    process.env.MATOGA_DOWNLOAD_THREADS = '8'
    assert.equal(backend.resolveThreads(undefined), 8)
    assert.equal(backend.resolveThreads(4), 4, '显式传入应盖过环境变量')

    process.env.MATOGA_DOWNLOAD_THREADS = '999'
    assert.equal(backend.resolveThreads(undefined), MAX_THREADS)

    process.env.MATOGA_DOWNLOAD_THREADS = 'abc'
    assert.equal(backend.resolveThreads(undefined), DEFAULT_THREADS, '非法环境变量回落到默认值')
  } finally {
    if (saved === undefined) delete process.env.MATOGA_DOWNLOAD_THREADS
    else process.env.MATOGA_DOWNLOAD_THREADS = saved
  }
})

test('协议正文必须披露真实下载地址', () => {
  const urls = listSources().map(s => buildUrl(s.prefix, backend.officialUrl()))
  const text = notice.buildNotice(urls)
  assert.ok(text.includes('下载地址'), '协议需含下载地址说明段落')
  for (const u of urls) assert.ok(text.includes(u), `协议缺少下载地址：${u}`)
})

// ---------------------------------------------------------------------------
// 多线程分段下载
// ---------------------------------------------------------------------------

test('分段下载：内容与源字节完全一致，且确实按 Range 分片', async () => {
  const body = payload(5000)
  const { net, state } = makeFakeNet(body)
  setDownloadNet(net)

  const { dir, file } = tmpFile('seg.bin')
  try {
    const r = await downloadMultipart('https://example.test/f.bin', file, { threads: 4 })
    assert.equal(r.ranged, true)
    assert.equal(r.threads, 4)
    assert.equal(r.bytes, body.length)
    assert.deepEqual(fs.readFileSync(file), body)
    // 1 次探测 + 4 次分段
    assert.equal(state.requests, 5)
    assert.equal(state.ranges[0], 'bytes=0-0', '首次请求必须是探测请求')
    assert.equal(fs.existsSync(file + '.download'), false, '成功后临时文件应已改名')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('分段下载：线程数超过总字节数时不会产生空段', async () => {
  const body = payload(3)
  const { net } = makeFakeNet(body)
  setDownloadNet(net)
  const { dir, file } = tmpFile('tiny.bin')
  try {
    const r = await downloadMultipart('https://example.test/t.bin', file, { threads: 24 })
    assert.deepEqual(fs.readFileSync(file), body)
    assert.equal(r.ranged, true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('服务端忽略 Range 时降级为单流下载', async () => {
  const body = payload(4096)
  const { net } = makeFakeNet(body, { ignoreRange: true })
  setDownloadNet(net)
  const { dir, file } = tmpFile('single.bin')
  try {
    const r = await downloadMultipart('https://example.test/f.bin', file, { threads: 8 })
    assert.equal(r.ranged, false)
    assert.equal(r.threads, 1)
    assert.deepEqual(fs.readFileSync(file), body)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('分段失败会在重试额度内恢复', async () => {
  const body = payload(3000)
  // 每个分段前 2 次尝试失败 → 第 3 次成功，正好用满 SEGMENT_RETRIES=2
  const failures = new Map()
  // 探测段不失败；分段区间由 4 线程均分 3000 → 750 每段
  let cursor = 0
  for (let i = 0; i < 4; i++) {
    const size = 750
    failures.set(`${cursor}-${cursor + size - 1}`, 2)
    cursor += size
  }
  const { net, state } = makeFakeNet(body, { failures })
  setDownloadNet(net)

  const { dir, file } = tmpFile('retry.bin')
  try {
    const r = await downloadMultipart('https://example.test/f.bin', file, { threads: 4 })
    assert.deepEqual(fs.readFileSync(file), body)
    assert.equal(state.failureHits, 8, '4 段各失败 2 次')
    assert.equal(r.bytes, body.length)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('分段重试耗尽后整体失败，并清理临时文件', async () => {
  const body = payload(2000)
  const failures = new Map([['0-1999', 99]])
  const { net } = makeFakeNet(body, { failures })
  setDownloadNet(net)

  const { dir, file } = tmpFile('fail.bin')
  try {
    await assert.rejects(() => downloadMultipart('https://example.test/f.bin', file, { threads: 1 }), /模拟失败/)
    assert.equal(fs.existsSync(file), false, '失败后不应留下目标文件')
    assert.equal(fs.existsSync(file + '.download'), false, '失败后应清理临时文件')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('重试时进度回滚，累计字节不超过总长度', async () => {
  const body = payload(2000)
  const failures = new Map([['0-1999', 1]])
  const { net } = makeFakeNet(body, { failures })
  setDownloadNet(net)

  const { dir, file } = tmpFile('prog.bin')
  const seen = []
  try {
    await downloadMultipart('https://example.test/f.bin', file, {
      threads: 1,
      onProgress: received => seen.push(received)
    })
    assert.ok(seen.length > 0)
    for (const n of seen) {
      assert.ok(n <= body.length, `进度虚高：${n} > ${body.length}`)
      assert.ok(n >= 0, `进度为负：${n}`)
    }
    assert.equal(seen[seen.length - 1], body.length, '结束时进度应等于总长')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('无 net 可用时报错而不是静默成功', async () => {
  setDownloadNet(null)
  const { dir, file } = tmpFile('nonet.bin')
  try {
    await assert.rejects(() => downloadMultipart('https://example.test/f.bin', file, { threads: 2 }), /不支持网络请求/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

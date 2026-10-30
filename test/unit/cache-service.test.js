/**
 * 缓存管理服务单测：
 * - cache-stats: dirStats 递归统计文件数与字节 / clearDir 清空目录保留根
 * - 各 service stats() 返回 { files, bytes } 形态（只读，不破坏数据）
 * - lang-service stats() / file-service hashCacheStats() 形态
 * - cache 路由聚合端点：GET /stats / POST /clear / POST /clear-all / POST /hdri-orphans
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')

const { dirStats, clearDir } = require('../../server/services/cache-stats')
const thumbService = require('../../server/services/thumb-service')
const modelThumb = require('../../server/services/model-thumb-service')
const hdriService = require('../../server/services/hdri-service')

const langService = require('../../server/services/lang-service')
const fileService = require('../../server/services/file-service')
const { createApp } = require('../../server/app')

const TMP = path.join(os.tmpdir(), 'matoga-ut-cache-' + process.pid)

function setup() {
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(path.join(TMP, 'sub'), { recursive: true })
  fs.writeFileSync(path.join(TMP, 'a.json'), 'hello')
  fs.writeFileSync(path.join(TMP, 'sub', 'b.png'), Buffer.alloc(64))
}

async function withServer(fn) {
  const server = http.createServer(createApp())
  await new Promise(r => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn(base)
  } finally {
    await new Promise(r => server.close(r))
  }
}

async function getJSON(base, url, opts) {
  const res = await fetch(base + url, opts)
  let j
  try {
    j = await res.json()
  } catch {
    j = null
  }
  return { status: res.status, body: j }
}

test('dirStats: 递归统计文件数与字节', async () => {
  setup()
  const r = await dirStats(TMP)
  assert.equal(r.files, 2)
  assert.equal(r.bytes, 5 + 64)
})

test('dirStats: 不存在目录 → {files:0, bytes:0}', async () => {
  const r = await dirStats(path.join(TMP, 'nope'))
  assert.equal(r.files, 0)
  assert.equal(r.bytes, 0)
})

test('clearDir: 清空内容但保留根目录', async () => {
  setup()
  const r = await clearDir(TMP)
  assert.equal(r.removed, 2)
  assert.ok(fs.existsSync(TMP), '根目录保留')
  assert.deepEqual(fs.readdirSync(TMP), [])
})

test('clearDir: 不存在目录 → removed:0', async () => {
  const r = await clearDir(path.join(TMP, 'nope'))
  assert.equal(r.removed, 0)
})

test('thumbService.stats → {files, bytes}', async () => {
  const r = await thumbService.stats()
  assert.equal(typeof r.files, 'number')
  assert.equal(typeof r.bytes, 'number')
})

test('modelThumb.stats → {files, bytes, byKind}', async () => {
  const r = await modelThumb.stats()
  assert.equal(typeof r.files, 'number')
  assert.equal(typeof r.bytes, 'number')
  assert.ok(r.byKind && r.byKind.imported && r.byKind.mc)
})

test('hdriService.stats → {files, bytes}', async () => {
  const r = await hdriService.stats()
  assert.equal(typeof r.files, 'number')
  assert.equal(typeof r.bytes, 'number')
})


test('langService.stats → {loaded, count}', () => {
  const r = langService.stats()
  assert.equal(typeof r.loaded, 'boolean')
  assert.equal(typeof r.count, 'number')
})

test('fileService.hashCacheStats → {size, max}', () => {
  const r = fileService.hashCacheStats()
  assert.equal(typeof r.size, 'number')
  assert.equal(typeof r.max, 'number')
})

test('cache 路由: GET /stats 聚合全部缓存', async () => {
  await withServer(async base => {
    const { status, body } = await getJSON(base, '/api/cache/stats')
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    const d = body.data
    for (const k of ['thumbs', 'model-thumbs', 'hdri-thumbs', 'hash-mem', 'lang-mem']) {
      assert.ok(d[k], '含 ' + k)
      assert.ok(d[k].kind === 'disk' || d[k].kind === 'mem')
    }
  })
})

test('cache 路由: POST /clear 未知 target → 400', async () => {
  await withServer(async base => {
    const { status, body } = await getJSON(base, '/api/cache/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'nope' })
    })
    assert.equal(status, 400)
    assert.equal(body.ok, false)
    assert.equal(body.code, 'ERR_INVALID_PARAM')
  })
})

test('cache 路由: POST /clear {target:hash-mem} → 清空哈希缓存', async () => {
  await withServer(async base => {
    const { status, body } = await getJSON(base, '/api/cache/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'hash-mem' })
    })
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.data.target, 'hash-mem')
    assert.equal(fileService.hashCacheStats().size, 0)
  })
})

test('cache 路由: POST /clear {target:lang-mem} → 清空译名缓存', async () => {
  await withServer(async base => {
    const { status, body } = await getJSON(base, '/api/cache/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'lang-mem' })
    })
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.data.target, 'lang-mem')
    assert.equal(langService.stats().loaded, false)
  })
})

test('cache 路由: POST /hdri-orphans → {removed, valid}', async () => {
  await withServer(async base => {
    const { status, body } = await getJSON(base, '/api/cache/hdri-orphans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(typeof body.data.removed, 'number')
  })
})

test('cleanup', () => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

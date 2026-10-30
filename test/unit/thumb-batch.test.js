/**
 * 贴图缩略图批量查询端点单测（POST /api/file/thumb-info-batch）：
 * - 多路径一次返回各自缓存信息
 * - 非数组 paths → 400
 * - 超 256 条 → 400
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { createApp } = require('../../server/app')

const TMP = path.join(os.tmpdir(), 'matoga-ut-thumb-batch-' + process.pid)

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

async function postJSON(base, url, body) {
  const res = await fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  let j
  try {
    j = await res.json()
  } catch {
    j = null
  }
  return { status: res.status, body: j }
}

test('thumb-info-batch: 返回每个路径的缓存信息', async () => {
  fs.mkdirSync(TMP, { recursive: true })
  const f1 = path.join(TMP, 'a.png')
  const f2 = path.join(TMP, 'b.png')
  fs.writeFileSync(f1, 'x')
  fs.writeFileSync(f2, 'y')
  await withServer(async base => {
    const { status, body } = await postJSON(base, '/api/file/thumb-info-batch', { paths: [f1, f2] })
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.ok(body.data[f1], '含 f1')
    assert.ok(body.data[f2], '含 f2')
    assert.equal(body.data[f1].exists, false, '无缓存 → exists=false')
    assert.equal(body.data[f1].stale, true)
  })
})

test('thumb-info-batch: 非数组 paths → 400', async () => {
  await withServer(async base => {
    const { status, body } = await postJSON(base, '/api/file/thumb-info-batch', { paths: 'nope' })
    assert.equal(status, 400)
    assert.equal(body.code, 'ERR_INVALID_PARAM')
  })
})

test('thumb-info-batch: 超 256 条 → 400', async () => {
  await withServer(async base => {
    const paths = Array.from({ length: 257 }, (_, i) => '/p' + i)
    const { status, body } = await postJSON(base, '/api/file/thumb-info-batch', { paths })
    assert.equal(status, 400)
    assert.equal(body.code, 'ERR_INVALID_PARAM')
  })
})

test('cleanup', () => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

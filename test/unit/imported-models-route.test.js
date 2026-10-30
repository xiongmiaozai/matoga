/**
 * 导入模型路由集成单测（/api/imported-models）：
 * - GET /location 返回专属目录 data/imported-models
 * - POST 导入 → list / get / delete 全链路
 * - 缺 data → ok:false
 * - /api/asset/model-thumb-info 接受 im: / cm: 键（缩略图前缀放行）
 * 隔离：MATOGA_DATA_ROOT 指向临时目录（须在 require app 前设置）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'matoga-improute-'))
process.env.MATOGA_DATA_ROOT = TMP

const { createApp } = require('../../server/app')

let server, base

test.before(async () => {
  const app = createApp()
  server = http.createServer(app)
  await new Promise(r => server.listen(0, r))
  base = 'http://127.0.0.1:' + server.address().port
})

test.after(async () => {
  await new Promise(r => server.close(r))
  fs.rmSync(TMP, { recursive: true, force: true })
})

async function api(method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

test('GET /api/imported-models/location 返回专属目录', async () => {
  const r = await api('GET', '/api/imported-models/location')
  assert.equal(r.json.ok, true)
  assert.ok(r.json.data.dir.startsWith(TMP))
  assert.ok(r.json.data.dir.endsWith(path.join('data', 'imported-models')))
})

test('POST 导入 → list / get / delete 全链路', async () => {
  const data = JSON.stringify({ meta: { format: 'bbmodel' }, elements: [{ name: 'cube' }] })
  const r = await api('POST', '/api/imported-models', { name: 'demo', data })
  assert.equal(r.json.ok, true)
  const id = r.json.data.id
  assert.ok(id)

  const list = await api('GET', '/api/imported-models')
  assert.ok(list.json.data.models.find(m => m.id === id))

  const one = await api('GET', '/api/imported-models/' + encodeURIComponent(id))
  assert.equal(one.json.data.json.elements[0].name, 'cube')

  await api('DELETE', '/api/imported-models/' + encodeURIComponent(id))
  assert.ok(!fs.existsSync(path.join(TMP, 'data', 'imported-models', id)))
})

test('POST 缺 data → ok:false', async () => {
  const r = await api('POST', '/api/imported-models', { name: 'x' })
  assert.equal(r.json.ok, false)
})

test('asset model-thumb-info 接受 im: / cm: 键', async () => {
  const r1 = await api('GET', '/api/asset/model-thumb-info?key=' + encodeURIComponent('im:abc') + '&mtime=1')
  assert.equal(r1.json.ok, true)
  const r2 = await api('GET', '/api/asset/model-thumb-info?key=' + encodeURIComponent('cm:abc') + '&mtime=1')
  assert.equal(r2.json.ok, true)
})
test('PUT /:id 覆盖更新模型（保留扩展名）', async () => {
  const data = JSON.stringify({ meta: { format: 'bbmodel' }, elements: [{ name: 'cube' }] })
  const r = await api('POST', '/api/imported-models', { name: 'demo-put', data })
  const id = r.json.data.id

  const upd = JSON.stringify({
    meta: { format: 'bbmodel' },
    elements: [{ name: 'cube2', faces: { north: { uv: [1, 2, 3, 4] } } }]
  })
  const pu = await api('PUT', '/api/imported-models/' + encodeURIComponent(id), { data: upd })
  assert.equal(pu.json.ok, true)

  const one = await api('GET', '/api/imported-models/' + encodeURIComponent(id))
  assert.equal(one.json.data.json.elements[0].name, 'cube2')
  assert.deepEqual(one.json.data.json.elements[0].faces.north.uv, [1, 2, 3, 4])

  const file = path.join(TMP, 'data', 'imported-models', id, 'model.bbmodel')
  assert.ok(fs.existsSync(file))
  await api('DELETE', '/api/imported-models/' + encodeURIComponent(id))
})

test('PUT /:id 缺 data → ok:false；不存在 id → ok:false', async () => {
  const r1 = await api('PUT', '/api/imported-models/noid-xxx', { data: '{}' })
  assert.equal(r1.json.ok, false)
  const data = JSON.stringify({ meta: { format: 'bbmodel' }, elements: [] })
  const r2 = await api('POST', '/api/imported-models', { name: 'demo-put2', data })
  const id = r2.json.data.id
  const r3 = await api('PUT', '/api/imported-models/' + encodeURIComponent(id), {})
  assert.equal(r3.json.ok, false)
  await api('DELETE', '/api/imported-models/' + encodeURIComponent(id))
})
const PNG_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

test('POST /:id/textures 批量上传 → GET /:id/textures 列出 → DELETE 删除', async () => {
  const r = await api('POST', '/api/imported-models', { name: 'texroute', data: '{"elements":[]}' })
  const id = r.json.data.id
  const rel = 'assets/minecraft/textures/block/stone.png'

  const up = await api('POST', '/api/imported-models/' + encodeURIComponent(id) + '/textures', {
    textures: { [rel]: PNG_URL, '../evil.png': PNG_URL }
  })
  assert.equal(up.json.ok, true)
  assert.equal(up.json.data.count, 1)

  const list = await api('GET', '/api/imported-models/' + encodeURIComponent(id) + '/textures')
  assert.equal(list.json.ok, true)
  assert.ok(list.json.data.textures.find(t => t.path === rel))

  const del = await api('DELETE', '/api/imported-models/' + encodeURIComponent(id) + '/textures', { path: rel })
  assert.equal(del.json.ok, true)
  const list2 = await api('GET', '/api/imported-models/' + encodeURIComponent(id) + '/textures')
  assert.ok(!list2.json.data.textures.find(t => t.path === rel))

  await api('DELETE', '/api/imported-models/' + encodeURIComponent(id))
})

test('POST 一次性 textures 字段 → texCount 返回', async () => {
  const r = await api('POST', '/api/imported-models', {
    name: 'onetime-route',
    data: JSON.stringify({ textures: { all: 'minecraft:block/stone' } }),
    textures: { 'assets/minecraft/textures/block/stone.png': PNG_URL }
  })
  assert.equal(r.json.ok, true)
  assert.equal(r.json.data.texCount, 1)
  await api('DELETE', '/api/imported-models/' + encodeURIComponent(r.json.data.id))
})

test('GET /:id 返回 texDir', async () => {
  const r = await api('POST', '/api/imported-models', { name: 'texdir-route', data: '{}' })
  const id = r.json.data.id
  const one = await api('GET', '/api/imported-models/' + encodeURIComponent(id))
  assert.equal(one.json.ok, true)
  assert.ok(typeof one.json.data.texDir === 'string')
  await api('DELETE', '/api/imported-models/' + encodeURIComponent(id))
})

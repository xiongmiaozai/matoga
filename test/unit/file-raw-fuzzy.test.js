/**
 * GET /api/file/raw 贴图扩展名变体兜底单测：
 * 精确路径不存在时，对 assets/.../textures/** 下图片引用尝试同 stem 不同扩展名（.png↔.jpg↔.webp）。
 * 对比场景 3D 预览与侧栏检测依赖此兜底容忍社区包贴图扩展名不一致。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { createApp } = require('../../server/app')
const configStore = require('../../server/config/config-store')

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])

const FILE = configStore.FILE
let backup = null
let existed = false
let ROOT = ''

test('setup: 备份配置并构造测试目录', async () => {
  existed = fs.existsSync(FILE)
  if (existed) backup = fs.readFileSync(FILE)
  try { fs.unlinkSync(FILE) } catch {}
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'file-raw-fuzzy-'))
  fs.mkdirSync(path.join(ROOT, 'assets/minecraft/textures/block'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, 'assets/minecraft/textures/block/stone.jpg'), JPG)
  fs.writeFileSync(path.join(ROOT, 'assets/minecraft/textures/block/dirt.webp'), PNG)
  fs.writeFileSync(path.join(ROOT, 'assets/minecraft/textures/block/real.png'), PNG)

})

test('路由: /api/file/raw 精确命中', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/file/raw`
  try {
    const res = await fetch(base + '?path=' + encodeURIComponent(path.join(ROOT, 'assets/minecraft/textures/block/real.png')))
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/png')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('路由: /api/file/raw 引用 .png 但磁盘 .jpg → 变体兜底命中', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/file/raw`
  try {
    const res = await fetch(base + '?path=' + encodeURIComponent(path.join(ROOT, 'assets/minecraft/textures/block/stone.png')))
    assert.equal(res.status, 200, '精确 .png 不存在时回退到 .jpg')
    const buf = Buffer.from(await res.arrayBuffer())
    assert.deepEqual([...buf], [...JPG], '返回 .jpg 内容')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('路由: /api/file/raw 引用 .png 但磁盘 .webp → 变体兜底命中', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/file/raw`
  try {
    const res = await fetch(base + '?path=' + encodeURIComponent(path.join(ROOT, 'assets/minecraft/textures/block/dirt.png')))
    assert.equal(res.status, 200, '精确 .png 不存在时回退到 .webp')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('路由: /api/file/raw 无任何变体 → 404', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/file/raw`
  try {
    const res = await fetch(base + '?path=' + encodeURIComponent(path.join(ROOT, 'assets/minecraft/textures/block/missing.png')))
    assert.equal(res.status, 404)
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('路由: /api/file/raw 非 textures 路径不触发模糊兜底', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/file/raw`
  try {
    const res = await fetch(base + '?path=' + encodeURIComponent(path.join(ROOT, 'assets/minecraft/models/block/stone.json')))
    assert.equal(res.status, 404, '非 textures/ 路径精确失败直接 404，不做变体')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('teardown: 清理临时目录并恢复配置', async () => {
  fs.rmSync(ROOT, { recursive: true, force: true })
  try { fs.unlinkSync(FILE) } catch {}
  if (existed) fs.writeFileSync(FILE, backup)
})
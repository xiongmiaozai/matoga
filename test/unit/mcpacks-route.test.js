/**
 * MC 资源包「包媒体」路由单测（/api/mc-packs）：
 * - /list：mcPacksPath 下目录包 / zip 包解析 pack.mcmeta、统计贴图、firstTexture 封面
 * - /:name/entries：文件管理器式逐层浏览（含面包屑）
 * - /:name/raw：包内贴图字节读取（dir 直读 / zip 提取），路径穿越拒绝
 * - /:name/textures：分类贴图列表
 * - /rename：包重命名（合法名 + 拒绝非法名）
 * 隔离方式：monkey-patch configStore.get（内存注入 mcPacksPath，零磁盘写入，
 * 不依赖 MATOGA_DATA_ROOT 时序——多测试文件共享 require 缓存时 env 方案会失效并污染真实 data/config.json）。
 * zip 为零依赖手工构造（store 方式，CRC 填 0——服务端解析不校验 CRC）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { createApp } = require('../../server/app')
const configStore = require('../../server/config/config-store')
const { trust } = require('../../server/middleware/validate')

/* ── 最小 zip 构造（method 0 stored）── */
function buildZip(files) {
  const locals = [], centrals = []
  let offset = 0
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8')
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8)
    lh.writeUInt32LE(0, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28)
    locals.push(lh, nameBuf, data)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8)
    ch.writeUInt32LE(0, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    ch.writeUInt32LE(0, 38)
    ch.writeUInt32LE(offset, 42)
    centrals.push(ch, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const cdBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cdBuf, eocd])
}

const MCMETA = JSON.stringify({ pack: { pack_format: 15, description: 'test pack' } })
const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9])

let ROOT = ''

/* 内存注入配置（不写盘），并保存原方法供 teardown 恢复 */
const origGet = configStore.get.bind(configStore)
const origPut = configStore.put.bind(configStore)
let injected = {}

function put(rel, data) {
  const f = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, data)
}

test('setup: 构造 mc-packs 测试目录并注入配置', async () => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpacks-'))
  put('MyPack/pack.mcmeta', MCMETA)
  put('MyPack/pack.png', PNG_A)
  put('MyPack/assets/minecraft/textures/block/stone.png', PNG_A)
  put('MyPack/assets/minecraft/textures/item/dirt.png', PNG_B)
  put('MyPack/assets/minecraft/models/item/stone.json', Buffer.from('{}'))
  fs.writeFileSync(path.join(ROOT, 'Zipped.zip'), buildZip([
    { name: 'pack.mcmeta', data: MCMETA },
    { name: 'assets/minecraft/textures/block/oak.png', data: PNG_B },
  ]))
  injected = { ...origGet(), mcPacksPath: ROOT }
  configStore.get = () => injected
  /* put 也拦截：防止路由内任何写配置操作触达真实 data/config.json */
  configStore.put = (patch) => { Object.assign(injected, patch || {}); return Promise.resolve() }
  trust(ROOT)
  assert.equal(configStore.get().mcPacksPath, ROOT)
})

test('路由: /list 以包媒体形式返回目录包与 zip 包', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/mc-packs`
  try {
    const list = await (await fetch(base + '/list')).json()
    assert.equal(list.ok, true)
    assert.equal(list.data.root, ROOT)
    assert.equal(list.data.exists, true)
    const by = Object.fromEntries(list.data.packs.map(p => [p.name, p]))
    assert.equal(by.MyPack.valid, true)
    assert.equal(by.MyPack.format, 15)
    assert.equal(by.MyPack.description, 'test pack')
    assert.equal(by.MyPack.kind, 'dir')
    assert.equal(by.MyPack.textureCount, 2)
    assert.equal(by.MyPack.firstTexture, 'pack.png', '包根有 pack.png 时封面优先图标')
    assert.equal(by['Zipped.zip'].valid, true)
    assert.equal(by['Zipped.zip'].textureCount, 1)
    assert.equal(by['Zipped.zip'].firstTexture, 'assets/minecraft/textures/block/oak.png')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('路由: /:name/entries 文件管理器式浏览（逐层 + 面包屑）', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/mc-packs`
  try {
    const root = await (await fetch(base + '/MyPack/entries')).json()
    assert.equal(root.ok, true)
    assert.deepEqual(root.data.dirs.map(d => d.name), ['assets'])
    assert.deepEqual(root.data.files.map(f => f.name).sort(), ['pack.mcmeta', 'pack.png'])
    assert.deepEqual(root.data.breadcrumbs, [{ name: 'root', dir: null }])

    const assets = await (await fetch(base + '/MyPack/entries?dir=assets')).json()
    assert.deepEqual(assets.data.dirs.map(d => d.name), ['minecraft'])

    const ns = await (await fetch(base + '/MyPack/entries?dir=assets/minecraft')).json()
    assert.deepEqual(ns.data.dirs.map(d => d.name).sort(), ['models', 'textures'])
    assert.deepEqual(ns.data.breadcrumbs.map(b => b.name), ['root', 'assets', 'minecraft'])

    const tex = await (await fetch(base + '/MyPack/entries?dir=assets/minecraft/textures/block')).json()
    assert.deepEqual(tex.data.files.map(f => f.name), ['stone.png'])
    assert.equal(tex.data.parent, 'assets/minecraft/textures')

    const bad = await (await fetch(base + '/MyPack/entries?dir=' + encodeURIComponent('assets/../../etc'))).json()
    assert.equal(bad.ok, false)
    assert.equal(bad.code, 'ERR_INVALID_PARAM')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('路由: /:name/raw 读包内贴图（dir 与 zip），穿越拒绝', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/mc-packs`
  try {
    const png = await fetch(base + '/MyPack/raw?path=' + encodeURIComponent('pack.png'))
    assert.equal(png.status, 200)
    assert.equal(png.headers.get('content-type'), 'image/png')
    assert.deepEqual([...Buffer.from(await png.arrayBuffer())], [...PNG_A])

    const inner = await fetch(base + '/MyPack/raw?path=' + encodeURIComponent('assets/minecraft/textures/item/dirt.png'))
    assert.deepEqual([...Buffer.from(await inner.arrayBuffer())], [...PNG_B])

    const fromZip = await fetch(base + '/Zipped.zip/raw?path=' + encodeURIComponent('assets/minecraft/textures/block/oak.png'))
    assert.equal(fromZip.status, 200)
    assert.deepEqual([...Buffer.from(await fromZip.arrayBuffer())], [...PNG_B])

    const bad = await (await fetch(base + '/MyPack/raw?path=' + encodeURIComponent('assets/../../etc/passwd.png'))).json()
    assert.equal(bad.ok, false)
    assert.equal(bad.code, 'ERR_INVALID_PARAM')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('路由: /:name/textures 分类贴图列表', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/mc-packs`
  try {
    const tex = await (await fetch(base + '/MyPack/textures')).json()
    assert.equal(tex.ok, true)
    assert.equal(tex.data.total, 2)
    assert.deepEqual(tex.data.categories, [
      { name: 'block', dir: 'assets/minecraft/textures/block', count: 1 },
      { name: 'item', dir: 'assets/minecraft/textures/item', count: 1 },
    ])
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('路由: /rename 重命名包', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/mc-packs`
  try {
    const ren = await (await fetch(base + '/rename', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'MyPack', to: 'RenamedPack' }),
    })).json()
    assert.equal(ren.ok, true)
    assert.equal(ren.data.name, 'RenamedPack')
    assert.ok(fs.existsSync(path.join(ROOT, 'RenamedPack')))

    const list = await (await fetch(base + '/list')).json()
    assert.ok(list.data.packs.some(p => p.name === 'RenamedPack'))
    assert.ok(!list.data.packs.some(p => p.name === 'MyPack'))

    const bad = await (await fetch(base + '/rename', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'RenamedPack', to: '../evil' }),
    })).json()
    assert.equal(bad.ok, false)
    assert.equal(bad.code, 'ERR_PATH_DENIED', '越权目标路径被 guardWrite 拦截')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('teardown: 清理临时目录并恢复 configStore 原方法', async () => {
  configStore.get = origGet
  configStore.put = origPut
  fs.rmSync(ROOT, { recursive: true, force: true })
})
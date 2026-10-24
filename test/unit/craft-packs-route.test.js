/**
 * 制作包媒体路由单测（/api/craft-packs）：
 * - /list：craftPacksPath 下目录包（含中文包名「我的制作包」）pack.mcmeta 解析
 * - /:name/entries：文件管理器式逐层浏览（中文包名 + 面包屑）
 * - /:name/raw：包内文件字节读取（pack.png / assets/**），路径穿越拒绝
 * - 路由与 craft-pack 聚合服务隔离：monkey-patch configStore.get（内存注入 craftPacksPath）
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

const MCMETA = JSON.stringify({ pack: { pack_format: 64, description: '我的制作包 · matoga' } })
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

let ROOT = ''
const origGet = configStore.get.bind(configStore)
const origPut = configStore.put.bind(configStore)
let injected = {}

function put(rel, data) {
  const f = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, data)
}

test('setup: 构造 craft-packs 测试目录并注入配置', async () => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'craftpacks-'))
  put('我的制作包/pack.mcmeta', MCMETA)
  put('我的制作包/pack.png', PNG)
  put('我的制作包/assets/minecraft/textures/block/stone.png', PNG)
  put('我的制作包/assets/minecraft/models/item/iron.json', Buffer.from('{"parent":"minecraft:block/cube"}'))
  injected = { ...origGet(), craftPacksPath: ROOT }
  configStore.get = () => injected
  configStore.put = (patch) => { Object.assign(injected, patch || {}); return Promise.resolve() }
  trust(ROOT)
  assert.equal(configStore.get().craftPacksPath, ROOT)
})

test('路由: /list 列出 craft-packs 下的包（含中文包名）', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/craft-packs`
  try {
    const list = await (await fetch(base + '/list')).json()
    assert.equal(list.ok, true)
    assert.equal(list.data.root, ROOT)
    assert.equal(list.data.exists, true)
    const by = Object.fromEntries(list.data.packs.map(p => [p.name, p]))
    assert.ok(by['我的制作包'], '中文包名可列出')
    assert.equal(by['我的制作包'].valid, true)
    assert.equal(by['我的制作包'].format, 64)
    assert.equal(by['我的制作包'].kind, 'dir')
    assert.equal(by['我的制作包'].textureCount, 1, '仅 assets 内 stone.png 计入贴图统计')
    assert.equal(by['我的制作包'].firstTexture, 'pack.png', '包根 pack.png 作为封面')
    assert.equal(by['我的制作包'].fullPath, path.join(ROOT, '我的制作包'))
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('路由: /:name/entries 逐层浏览（中文包名 + 面包屑）', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/craft-packs`
  const name = encodeURIComponent('我的制作包')
  try {
    const root = await (await fetch(base + '/' + name + '/entries')).json()
    assert.equal(root.ok, true)
    assert.deepEqual(root.data.dirs.map(d => d.name), ['assets'])
    assert.deepEqual(root.data.files.map(f => f.name).sort(), ['pack.mcmeta', 'pack.png'])

    const tex = await (await fetch(base + '/' + name + '/entries?dir=' + encodeURIComponent('assets/minecraft/textures/block'))).json()
    assert.equal(tex.ok, true)
    assert.deepEqual(tex.data.files.map(f => f.name), ['stone.png'])
    assert.deepEqual(tex.data.breadcrumbs.map(b => b.name), ['root', 'assets', 'minecraft', 'textures', 'block'])

    const bad = await (await fetch(base + '/' + name + '/entries?dir=' + encodeURIComponent('assets/../../etc'))).json()
    assert.equal(bad.ok, false)
    assert.equal(bad.code, 'ERR_INVALID_PARAM')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('路由: /:name/raw 读包内文件（any=1 放宽扩展名），穿越拒绝', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/craft-packs`
  const name = encodeURIComponent('我的制作包')
  try {
    const png = await fetch(base + '/' + name + '/raw?path=' + encodeURIComponent('pack.png'))
    assert.equal(png.status, 200)
    assert.equal(png.headers.get('content-type'), 'image/png')
    assert.deepEqual([...Buffer.from(await png.arrayBuffer())], [...PNG])

    const model = await fetch(base + '/' + name + '/raw?path=' + encodeURIComponent('assets/minecraft/models/item/iron.json') + '&any=1')
    assert.equal(model.status, 200)
    assert.equal(JSON.parse(await model.text()).parent, 'minecraft:block/cube')

    const bad = await (await fetch(base + '/' + name + '/raw?path=' + encodeURIComponent('assets/../../etc/passwd.png'))).json()
    assert.equal(bad.ok, false)
    assert.equal(bad.code, 'ERR_INVALID_PARAM')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('teardown: 清理测试目录并恢复配置', async () => {
  configStore.get = origGet
  configStore.put = origPut
  try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch {}
})
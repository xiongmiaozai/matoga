/**
 * 总资产库贴图聚合路由单测（GET /api/asset/tex）：
 * - 聚合 mcPacksPath 与 officialPacksPath 下的目录包 / zip 包全部贴图
 * - 每包按 textures/ 第一级类别分组（根级贴图置首，其余按数量降序）
 * - dir 包返回包根绝对路径（root），zip 包 root 为 null
 * - 非包文件跳过；包目录不存在 / 为空时返回空数组而非报错
 * 隔离方式：monkey-patch configStore.get（内存注入路径，零磁盘写入）。
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

let MC_ROOT = ''
let OFFICIAL_ROOT = ''

const origGet = configStore.get.bind(configStore)
const origPut = configStore.put.bind(configStore)
let injected = {}

function put(root, rel, data) {
  const f = path.join(root, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, data)
}

test('setup: 构造 mc / official 测试包目录并注入配置', async () => {
  MC_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'astex-mc-'))
  OFFICIAL_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'astex-off-'))

  /* mc 目录包：block 2 张 + item 1 张 + 根级（textures/ 直下）1 张 */
  put(MC_ROOT, 'MyPack/pack.mcmeta', MCMETA)
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/block/stone.png', PNG_A)
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/block/oak.png', PNG_B)
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/item/dirt.png', PNG_B)
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/missing.png', PNG_A)
  put(MC_ROOT, 'MyPack/assets/minecraft/models/item/m.json', Buffer.from('{}'))

  /* mc zip 包：block 1 张 + 混入 .png.mcmeta / .json（非贴图，应被排除） */
  fs.writeFileSync(path.join(MC_ROOT, 'Zipped.zip'), buildZip([
    { name: 'pack.mcmeta', data: MCMETA },
    { name: 'assets/minecraft/textures/block/zip_tex.png', data: PNG_A },
    { name: 'assets/minecraft/textures/block/zip_tex.png.mcmeta', data: Buffer.from('{"animation":{}}') },
    { name: 'assets/minecraft/textures/block/meta.json', data: Buffer.from('{}') },
  ]))

  /* mc 根下非包文件：跳过 */
  fs.writeFileSync(path.join(MC_ROOT, 'README.txt'), 'not a pack')

  /* official 目录包（Fabric jar 布局：无 pack.mcmeta，直含 assets/） */
  put(OFFICIAL_ROOT, 'OfficialPack/assets/minecraft/textures/block/grass.png', PNG_A)
  put(OFFICIAL_ROOT, 'OfficialPack/version.json', Buffer.from('{}'))

  injected = { ...origGet(), mcPacksPath: MC_ROOT, officialPacksPath: OFFICIAL_ROOT }
  configStore.get = () => injected
  configStore.put = (patch) => { Object.assign(injected, patch || {}); return Promise.resolve() }
  assert.equal(configStore.get().mcPacksPath, MC_ROOT)
})

test('路由: /api/asset/tex 聚合 mc + official 全部贴图并按类别分组', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/asset/tex`
  try {
    const j = await (await fetch(base)).json()
    assert.equal(j.ok, true)
    const packs = j.data.packs
    assert.equal(packs.length, 3, 'MyPack + Zipped.zip + OfficialPack')

    const by = Object.fromEntries(packs.map(p => [p.name, p]))

    /* 目录包：root 为包根绝对路径，贴图按类别分组，根级贴图置首 */
    const mp = by.MyPack
    assert.equal(mp.source, 'mc')
    assert.equal(mp.kind, 'dir')
    assert.equal(mp.root, path.join(MC_ROOT, 'MyPack'))
    assert.equal(mp.total, 4)
    assert.deepEqual(mp.groups.map(g => [g.key, g.count]), [['', 1], ['block', 2], ['item', 1]])
    const blockG = mp.groups.find(g => g.key === 'block')
    assert.deepEqual(blockG.files.map(f => f.name).sort(), ['oak.png', 'stone.png'])
    assert.equal(blockG.files[0].path.startsWith('assets/minecraft/textures/block/'), true)
    assert.ok(blockG.files[0].size > 0)

    /* zip 包：root 为 null，仍按类别分组；.png.mcmeta / .json 非贴图被排除 */
    const zp = by['Zipped.zip']
    assert.equal(zp.source, 'mc')
    assert.equal(zp.kind, 'zip')
    assert.equal(zp.root, null)
    assert.equal(zp.total, 1, '仅图片计入贴图总数')
    assert.deepEqual(zp.groups.map(g => [g.key, g.count]), [['block', 1]])
    assert.equal(zp.groups[0].files[0].name, 'zip_tex.png')
    assert.ok(zp.groups[0].files.every(f => f.name.endsWith('.png')), 'mcmeta/json 不出现在贴图列表')

    /* official 目录包（无 mcmeta 的 jar 布局）：可枚举贴图 */
    const op = by.OfficialPack
    assert.equal(op.source, 'official')
    assert.equal(op.kind, 'dir')
    assert.equal(op.total, 1)
    assert.equal(op.groups[0].files[0].name, 'grass.png')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('路由: /api/asset/tex 目录不存在 / 非包文件不报错', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/asset/tex`
  try {
    injected.mcPacksPath = path.join(os.tmpdir(), 'astex-not-exist-' + Date.now())
    injected.officialPacksPath = ''
    const j = await (await fetch(base)).json()
    assert.equal(j.ok, true)
    assert.deepEqual(j.data.packs, [])
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('teardown: 清理临时目录并恢复 configStore 原方法', async () => {
  configStore.get = origGet
  configStore.put = origPut
  fs.rmSync(MC_ROOT, { recursive: true, force: true })
  fs.rmSync(OFFICIAL_ROOT, { recursive: true, force: true })
})
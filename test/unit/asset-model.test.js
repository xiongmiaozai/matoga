/**
 * 总资产库模型聚合路由单测（GET /api/asset/model）：
 * - 聚合 mcPacksPath 与 officialPacksPath 下的目录包 / zip 包全部模型（assets/<ns>/models/**.json）
 * - 每包按 models/ 第一级类别分组（根级模型置首，其余按数量降序）
 * - blockstates / textures 等其他目录的 .json 不计入模型
 * - 1.21.4+ 物品模型定义（assets/<ns>/items/*.json）计入模型并归入独立 items 分组
 * - dir 包返回包根绝对路径（root），zip 包 root 为 null
 * - /api/mc-official/:name/raw?any=1 可读取模型 JSON 字节
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
const MODEL_BLOCK = JSON.stringify({ parent: 'block/block', textures: { all: 'minecraft:block/stone' }, elements: [{ from: [0, 0, 0], to: [16, 16, 16] }] })
const MODEL_ITEM = JSON.stringify({ parent: 'item/generated', textures: { layer0: 'minecraft:item/stick' } })
/* 1.21.4+ 物品模型定义（assets/<ns>/items/*.json） */
const ITEM_DEF_SIMPLE = JSON.stringify({ model: { type: 'minecraft:model', model: 'minecraft:item/stick' } })
const ITEM_DEF_CONDITION = JSON.stringify({
  model: {
    type: 'minecraft:condition',
    on_false: { type: 'minecraft:model', model: 'minecraft:item/bow' },
    on_true: { type: 'minecraft:model', model: 'minecraft:item/bow_pulling_0' },
    property: 'minecraft:using_item',
  },
})

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
  MC_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'asmod-mc-'))
  OFFICIAL_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'asmod-off-'))

  /* mc 目录包：models/block 2 个 + models/item 1 个 + 根级 1 个 + blockstates 1 个（非模型） */
  put(MC_ROOT, 'MyPack/pack.mcmeta', MCMETA)
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/block/stone.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]))
  put(MC_ROOT, 'MyPack/assets/minecraft/models/block/stone.json', MODEL_BLOCK)
  put(MC_ROOT, 'MyPack/assets/minecraft/models/block/oak.json', MODEL_BLOCK)
  put(MC_ROOT, 'MyPack/assets/minecraft/models/item/stick.json', MODEL_ITEM)
  put(MC_ROOT, 'MyPack/assets/minecraft/models/root.json', MODEL_ITEM)
  put(MC_ROOT, 'MyPack/assets/minecraft/blockstates/stone.json', Buffer.from('{}'))

  /* mc zip 包：模型 1 个 + 混入 blockstates / textures 下的 .json（非模型，应被排除） */
  fs.writeFileSync(path.join(MC_ROOT, 'Zipped.zip'), buildZip([
    { name: 'pack.mcmeta', data: MCMETA },
    { name: 'assets/minecraft/models/block/zip_model.json', data: MODEL_BLOCK },
    { name: 'assets/minecraft/blockstates/zip_model.json', data: Buffer.from('{}') },
    { name: 'assets/minecraft/textures/block/tex.json', data: Buffer.from('{"animation":{}}') },
  ]))

  /* mc 根下非包文件：跳过 */
  fs.writeFileSync(path.join(MC_ROOT, 'README.txt'), 'not a pack')

  /* official 目录包（Fabric jar 布局：无 pack.mcmeta，直含 assets/） */
  put(OFFICIAL_ROOT, 'OfficialPack/assets/minecraft/models/item/iron_helmet.json', MODEL_ITEM)
  put(OFFICIAL_ROOT, 'OfficialPack/version.json', Buffer.from('{}'))

  /* 1.21.4+ 物品模型定义：items/ 下计入模型（dir 包） */
  put(MC_ROOT, 'MyPack/assets/minecraft/items/stick.json', ITEM_DEF_SIMPLE)
  put(MC_ROOT, 'MyPack/assets/minecraft/items/bow.json', ITEM_DEF_CONDITION)

  injected = { ...origGet(), mcPacksPath: MC_ROOT, officialPacksPath: OFFICIAL_ROOT }
  configStore.get = () => injected
  configStore.put = (patch) => { Object.assign(injected, patch || {}); return Promise.resolve() }
  assert.equal(configStore.get().mcPacksPath, MC_ROOT)
})

test('路由: /api/asset/model 聚合 mc + official 全部模型并按类别分组', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/asset/model`
  try {
    const j = await (await fetch(base)).json()
    assert.equal(j.ok, true)
    const packs = j.data.packs
    assert.equal(packs.length, 3, 'MyPack + Zipped.zip + OfficialPack')

    const by = Object.fromEntries(packs.map(p => [p.name, p]))

    /* 目录包：root 为包根绝对路径，模型按类别分组，根级模型置首；items/ 定义归入独立分组 */
    const mp = by.MyPack
    assert.equal(mp.source, 'mc')
    assert.equal(mp.kind, 'dir')
    assert.equal(mp.root, path.join(MC_ROOT, 'MyPack'))
    assert.equal(mp.total, 6, 'models 下 4 个 + items/ 下 2 个（blockstates 不计入）')
    assert.deepEqual(mp.groups.map(g => [g.key, g.count]), [['', 1], ['block', 2], ['items', 2], ['item', 1]])
    const itemsG = mp.groups.find(g => g.key === 'items')
    assert.deepEqual(itemsG.files.map(f => f.name).sort(), ['bow.json', 'stick.json'])
    assert.equal(itemsG.files[0].path.startsWith('assets/minecraft/items/'), true)
    const blockG = mp.groups.find(g => g.key === 'block')
    assert.deepEqual(blockG.files.map(f => f.name).sort(), ['oak.json', 'stone.json'])
    assert.equal(blockG.files[0].path.startsWith('assets/minecraft/models/block/'), true)
    assert.ok(blockG.files[0].size > 0, 'dir 包模型补齐 stat size')
    assert.ok(blockG.files[0].mtime > 0, 'dir 包模型补齐 stat mtime')

    /* zip 包：root 为 null，仍按类别分组；blockstates / textures 下的 json 被排除 */
    const zp = by['Zipped.zip']
    assert.equal(zp.source, 'mc')
    assert.equal(zp.kind, 'zip')
    assert.equal(zp.root, null)
    assert.equal(zp.total, 1, '仅 models/ 下的 json 计入模型总数')
    assert.deepEqual(zp.groups.map(g => [g.key, g.count]), [['block', 1]])
    assert.equal(zp.groups[0].files[0].name, 'zip_model.json')

    /* official 目录包（无 mcmeta 的 jar 布局）：可枚举模型 */
    const op = by.OfficialPack
    assert.equal(op.source, 'official')
    assert.equal(op.kind, 'dir')
    assert.equal(op.total, 1)
    assert.equal(op.groups[0].files[0].name, 'iron_helmet.json')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('路由: /api/asset/model 目录不存在 / 非包文件不报错', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/asset/model`
  try {
    injected.mcPacksPath = path.join(os.tmpdir(), 'asmod-not-exist-' + Date.now())
    injected.officialPacksPath = ''
    const j = await (await fetch(base)).json()
    assert.equal(j.ok, true)
    assert.deepEqual(j.data.packs, [])
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('路由: raw any=1 可读取包内模型 JSON（内容一致）', async () => {
  injected.mcPacksPath = MC_ROOT
  injected.officialPacksPath = OFFICIAL_ROOT
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    /* dir 包模型 */
    const r1 = await fetch(base + '/api/mc-packs/MyPack/raw?path=' + encodeURIComponent('assets/minecraft/models/block/stone.json') + '&any=1')
    assert.equal(r1.status, 200)
    assert.deepEqual(await r1.json(), JSON.parse(MODEL_BLOCK))

    /* zip 包模型 */
    const r2 = await fetch(base + '/api/mc-packs/Zipped.zip/raw?path=' + encodeURIComponent('assets/minecraft/models/block/zip_model.json') + '&any=1')
    assert.equal(r2.status, 200)
    assert.deepEqual(await r2.json(), JSON.parse(MODEL_BLOCK))

    /* official jar 布局包模型 */
    const r3 = await fetch(base + '/api/mc-official/OfficialPack/raw?path=' + encodeURIComponent('assets/minecraft/models/item/iron_helmet.json') + '&any=1')
    assert.equal(r3.status, 200)
    assert.deepEqual(await r3.json(), JSON.parse(MODEL_ITEM))

    /* 无 any=1 时非图片扩展名被拒绝（业务错误返回 400 + ok:false） */
    const r4 = await fetch(base + '/api/mc-packs/MyPack/raw?path=' + encodeURIComponent('assets/minecraft/models/block/stone.json'))
    assert.equal(r4.status, 400)
    const j4 = await r4.json()
    assert.equal(j4.ok, false)
    assert.equal(j4.code, 'ERR_INVALID_PARAM')
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
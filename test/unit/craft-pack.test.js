/**
 * 制作包服务单测（server/services/craft-pack-service.js）：
 * - 自选清单持久化：setSelection/getSelection 往返、去重、无效项剔除
 * - addItem / removeItem / clearSelection
 * - aggregateStorage：自选 + 收藏 + 最近 按 key 去重
 * - exportPack：包内贴图/模型保留 assets 结构落盘、磁盘贴图入 matoga 命名空间、
 *   HDRI 入 hdri/、虚拟资产跳过、pack.mcmeta 与 matoga-craft.json 生成、重名包自动 -2
 * - listCraftPacks：识别含 matoga-craft.json 的导出包
 * 隔离方式：备份真实 selection 后删除；favorites/recent 与 configStore.get 全部 monkey-patch 内存版，
 * 避免与 asset-store.test.js 等并行测试文件操作同一磁盘文件互相干扰。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const craft = require('../../server/services/craft-pack-service')
const assetStore = require('../../server/config/asset-store')
const configStore = require('../../server/config/config-store')

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const PNG2 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9])
const MODEL_JSON = Buffer.from('{"parent":"minecraft:block/cube"}')

let MC_ROOT = ''
let TEX_DIR = ''
let diskTex = '', diskHdri = ''

/* 备份真实 selection（favorites/recent 用内存 monkey-patch） */
let selBackup = null, selExisted = false

function put(root, rel, data) {
  const f = path.join(root, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, data)
}

test('setup: 备份真实数据并构造测试环境', async () => {
  selExisted = fs.existsSync(craft.SELECTION_FILE)
  if (selExisted) selBackup = fs.readFileSync(craft.SELECTION_FILE)
  try { fs.unlinkSync(craft.SELECTION_FILE) } catch {}

  MC_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-mc-'))
  TEX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-tex-'))

  put(MC_ROOT, 'MyPack/pack.mcmeta', JSON.stringify({ pack: { pack_format: 15, description: 'src' } }))
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/block/stone.png', PNG)
  put(MC_ROOT, 'MyPack/assets/minecraft/models/item/m.json', MODEL_JSON)

  diskTex = path.join(TEX_DIR, 'my_diffuse.png')
  fs.writeFileSync(diskTex, PNG2)
  diskHdri = path.join(TEX_DIR, 'studio.hdr')
  fs.writeFileSync(diskHdri, Buffer.from('#?RADIANCE\n'))

  const origGet = configStore.get.bind(configStore)
  const injected = { ...origGet(), mcPacksPath: MC_ROOT, officialPacksPath: MC_ROOT, craftPacksPath: MC_ROOT }
  configStore.get = () => injected

  let memFav = [], memRec = []
  assetStore.getFavorites = () => memFav.slice()
  assetStore.getRecent = () => memRec.slice()
  assetStore.setFavorites = async (items) => { memFav = (items || []).slice() }
  assetStore.setRecent = async (items) => { memRec = (items || []).slice() }

  await craft.clearSelection()
  assert.deepEqual(craft.getSelection(), [])
})

test('setSelection: 往返 / 去重 / 剔除无效项', async () => {
  const items = [
    { key: 'tex:' + diskTex, name: 'my_diffuse', type: 'tex', path: diskTex, mtime: 1 },
    { key: 'tex:' + diskTex, name: 'dup', type: 'tex', path: diskTex },
    { key: 'bad' },
    null,
    { key: 'tex:/x.png', type: 'hdri', name: 'mismatch' },
    { key: 'hdri:' + diskHdri, name: 'studio', type: 'hdri', path: diskHdri },
  ]
  await craft.setSelection(items)
  const sel = craft.getSelection()
  assert.equal(sel.length, 2)
  assert.equal(sel[0].key, 'tex:' + diskTex)
  assert.equal(sel[0].name, 'my_diffuse')
  assert.equal(sel[1].type, 'hdri')
})

test('addItem / removeItem / clearSelection', async () => {
  const r1 = await craft.addItem({ key: 'preset:metal', name: '金属', type: 'preset', path: null })
  assert.equal(r1.added, true)
  assert.equal(r1.count, 3)
  const r2 = await craft.addItem({ key: 'preset:metal', name: '金属', type: 'preset' })
  assert.equal(r2.added, false)
  const r3 = await craft.removeItem('preset:metal')
  assert.equal(r3.removed, true)
  assert.equal(r3.count, 2)
  const r4 = await craft.removeItem('tex:/not-exist.png')
  assert.equal(r4.removed, false)
  const r5 = await craft.clearSelection()
  assert.equal(r5.count, 0)
})

test('aggregateStorage: 自选 + 收藏 + 最近 按 key 去重（前者优先）', async () => {
  await assetStore.setFavorites([
    { key: 'tex:' + diskTex, name: 'fav-dup', type: 'tex', path: diskTex },
    { key: 'tex:' + path.join(TEX_DIR, 'other.png'), name: 'fav-only', type: 'tex', path: path.join(TEX_DIR, 'other.png') },
  ])
  await assetStore.setRecent([
    { key: 'tex:' + diskTex, name: 'recent-dup', type: 'tex', path: diskTex },
    { key: 'hdri:' + diskHdri, name: 'recent-hdri', type: 'hdri', path: diskHdri },
  ])
  await craft.setSelection([
    { key: 'tex:' + diskTex, name: 'sel-tex', type: 'tex', path: diskTex },
  ])
  const agg = craft.aggregateStorage()
  assert.equal(agg.items.length, 3, 'tex 去重 + fav-only + hdri')
  assert.equal(agg.items[0].name, 'sel-tex', '自选优先')
  assert.deepEqual(agg.totals, { selection: 1, favorites: 2, recent: 2, aggregate: 3 })
})

test('exportPack: 包内贴图/模型保留结构 + 磁盘资产落盘 + 虚拟资产跳过', async () => {
  await assetStore.setFavorites([])
  await assetStore.setRecent([])
  await craft.setSelection([
    { key: 'tex:pack:mc:MyPack/assets/minecraft/textures/block/stone.png', name: 'stone.png', type: 'tex', path: 'pack:mc:MyPack/assets/minecraft/textures/block/stone.png' },
    { key: 'model:packmodel:mc:MyPack/assets/minecraft/models/item/m.json', name: 'm.json', type: 'model', path: 'packmodel:mc:MyPack/assets/minecraft/models/item/m.json' },
    { key: 'tex:' + diskTex, name: 'my_diffuse.png', type: 'tex', path: diskTex },
    { key: 'hdri:' + diskHdri, name: 'studio.hdr', type: 'hdri', path: diskHdri },
    { key: 'preset:metal', name: '金属', type: 'preset', path: null },
  ])
  const r = await craft.exportPack({ name: 'TestCraft' })
  assert.equal(r.name, 'TestCraft')
  assert.equal(r.written, 4, '贴图/模型/磁盘贴图/HDRI 各 1')
  assert.equal(r.skipped, 1, 'preset 虚拟资产跳过')
  assert.equal(r.skippedList[0].key, 'preset:metal')

  const packDir = path.join(MC_ROOT, 'TestCraft')
  assert.ok(fs.existsSync(path.join(packDir, 'pack.mcmeta')))
  assert.ok(fs.existsSync(path.join(packDir, 'matoga-craft.json')))
  assert.ok(fs.existsSync(path.join(packDir, 'assets/minecraft/textures/block/stone.png')), '包内贴图保留原结构')
  assert.ok(fs.existsSync(path.join(packDir, 'assets/minecraft/models/item/m.json')), '包内模型保留原结构')
  assert.ok(fs.existsSync(path.join(packDir, 'assets/matoga/textures/my_diffuse.png')), '磁盘贴图入 matoga 命名空间')
  assert.ok(fs.existsSync(path.join(packDir, 'hdri/studio.hdr')), 'HDRI 存入 hdri/')

  const mcmeta = JSON.parse(fs.readFileSync(path.join(packDir, 'pack.mcmeta'), 'utf8'))
  assert.equal(mcmeta.pack.pack_format, 64)
  assert.ok(mcmeta.pack.description.includes('TestCraft'))

  const marker = JSON.parse(fs.readFileSync(path.join(packDir, 'matoga-craft.json'), 'utf8'))
  assert.equal(marker.format, 'matoga-craft-pack')
  assert.equal(marker.written.length, 4)
  assert.equal(marker.skipped.length, 1)
  assert.deepEqual(marker.totals, { selection: 5, favorites: 0, recent: 0, aggregate: 5 })
})

test('exportPack: 重名包自动追加序号', async () => {
  const r = await craft.exportPack({ name: 'TestCraft', items: [{ key: 'preset:metal', type: 'preset', name: '金属' }] })
  assert.equal(r.name, 'TestCraft-2')
  assert.ok(fs.existsSync(path.join(MC_ROOT, 'TestCraft-2')))
})

test('exportPack: 无效包名 / 空清单报错', async () => {
  await assert.rejects(() => craft.exportPack({ name: '../evil' }), (e) => e.code === 'ERR_INVALID_PARAM')
  const keep = craft.getSelection()
  await craft.clearSelection()
  await assetStore.setFavorites([])
  await assetStore.setRecent([])
  await assert.rejects(() => craft.exportPack({ name: 'EmptyPack' }), (e) => e.code === 'ERR_INVALID_PARAM')
  await craft.setSelection(keep)
})

test('listCraftPacks: 识别含 matoga-craft.json 的导出包', async () => {
  const { packs } = await craft.listCraftPacks()
  assert.equal(packs.length, 2)
  const names = packs.map(p => p.name).sort()
  assert.deepEqual(names, ['TestCraft', 'TestCraft-2'])
  const first = packs.find(p => p.name === 'TestCraft')
  assert.equal(first.written, 4)
  assert.equal(first.skipped, 1)
  assert.ok(first.exportedAt > 0)
  assert.equal(path.basename(first.dir), 'TestCraft')
})


test('copyToCraftPack: 单个资产直接复制到当前制作包目录', async () => {
  await craft.clearSelection()
  const r = await craft.copyToCraftPack({
    key: 'tex:pack:mc:MyPack/assets/minecraft/textures/block/stone.png',
    name: 'stone.png', type: 'tex',
    path: 'pack:mc:MyPack/assets/minecraft/textures/block/stone.png',
  })
  assert.equal(r.name, '我的制作包')
  assert.equal(r.written, 1)
  const packDir = path.join(MC_ROOT, '我的制作包')
  assert.ok(fs.existsSync(path.join(packDir, 'pack.mcmeta')), '首次存入生成 pack.mcmeta')
  assert.ok(fs.existsSync(path.join(packDir, 'assets/minecraft/textures/block/stone.png')), '贴图已复制到制作包')
  assert.ok(craft.getSelection().some(it => it.name === 'stone.png'), '自选清单同步索引')
})

test('copyToCraftPack: 同名文件追加序号不覆盖', async () => {
  const r = await craft.copyToCraftPack({
    key: 'tex:pack:mc:MyPack/assets/minecraft/textures/block/stone.png',
    name: 'stone.png', type: 'tex',
    path: 'pack:mc:MyPack/assets/minecraft/textures/block/stone.png',
  })
  assert.ok(r.dest.includes('stone-2.png'), '重名追加 -2')
  assert.ok(fs.existsSync(path.join(MC_ROOT, '我的制作包', r.dest)))
})

test('copyToCraftPack: 自选清单记录 craftPath 指向制作包内副本', async () => {
  const sel = craft.getSelection()
  const it = sel.find(s => s.name === 'stone.png')
  assert.ok(it, '存在 stone 条目')
  assert.ok(typeof it.craftPath === 'string', 'craftPath 已记录')
  assert.ok(it.craftPath.includes('我的制作包'), 'craftPath 指向制作包目录')
  assert.ok(fs.existsSync(it.craftPath), 'craftPath 文件实际存在')
})

test('locateItem: craftPath 优先 / 失效回退源路径与虚拟路径解析', async () => {
  const cfg = configStore.get()

  /* 有效 craftPath（制作包内副本）优先 */
  const st = craft.getSelection().find(s => s.name === 'stone.png')
  assert.ok(st && st.craftPath, '前置：stone 条目带 craftPath')
  assert.equal(craft.locateItem(st, cfg), st.craftPath)

  /* craftPath 失效（文件已被改名/删除）→ 回退源路径 */
  assert.equal(craft.locateItem({ path: diskTex, craftPath: '/not/exist/x.png' }, cfg), diskTex)

  /* 磁盘绝对路径原样返回 */
  assert.equal(craft.locateItem({ path: diskTex }, cfg), diskTex)

  /* 包内虚拟路径 → mcPacksPath/<包>/<包内相对路径> */
  assert.equal(craft.locateItem({ path: 'pack:mc:MyPack/assets/minecraft/textures/block/stone.png' }, cfg),
    path.join(MC_ROOT, 'MyPack', 'assets/minecraft/textures/block/stone.png'))
  assert.equal(craft.locateItem({ path: 'packmodel:mc:MyPack/assets/minecraft/models/item/m.json' }, cfg),
    path.join(MC_ROOT, 'MyPack', 'assets/minecraft/models/item/m.json'))

  /* craft 来源虚拟路径 → craftPacksPath/<包>/<包内相对路径> */
  assert.equal(craft.locateItem({ path: 'pack:craft:我的制作包/assets/minecraft/textures/block/stone.png' }, cfg),
    path.join(MC_ROOT, '我的制作包', 'assets/minecraft/textures/block/stone.png'))

  /* 虚拟资产 / 无路径 / 坏条目 → null */
  assert.equal(craft.locateItem({ path: 'preset:metal' }, cfg), null)
  assert.equal(craft.locateItem({ path: null }, cfg), null)
  assert.equal(craft.locateItem(null, cfg), null)
})

test('copyToCraftPack: 虚拟资产无法复制报错', async () => {
  await assert.rejects(() => craft.copyToCraftPack({
    key: 'preset:metal', name: '金属', type: 'preset', path: null,
  }), (e) => e.code === 'ERR_INVALID_PARAM')
})

test('copyToCraftPack: 整包合并复制 assets 到制作包', async () => {
  await craft.clearSelection()
  const craftDir = path.join(MC_ROOT, '我的制作包')
  try { fs.rmSync(craftDir, { recursive: true, force: true }) } catch {}
  const r = await craft.copyToCraftPack({
    key: 'mc:' + path.join(MC_ROOT, 'MyPack'),
    name: 'MyPack', type: 'mc', path: path.join(MC_ROOT, 'MyPack'),
  })
  assert.equal(r.wholePack, true)
  assert.equal(r.written, 2, 'stone.png + m.json')
  assert.ok(fs.existsSync(path.join(craftDir, 'assets/minecraft/textures/block/stone.png')), '贴图已复制')
  assert.ok(fs.existsSync(path.join(craftDir, 'assets/minecraft/models/item/m.json')), '模型已复制')
  assert.ok(craft.getSelection().some(it => it.name === 'MyPack'), '自选清单同步索引')
})

test('getCurrentCraftPack: 返回当前制作项目（持续累积，非导出）', async () => {
  await craft.clearSelection()
  const craftDir = path.join(MC_ROOT, '我的制作包')
  try { fs.rmSync(craftDir, { recursive: true, force: true }) } catch {}
  let r = await craft.getCurrentCraftPack()
  assert.equal(r.pack, null, '空时返回 null')
  await craft.copyToCraftPack({
    key: 'tex:pack:mc:MyPack/assets/minecraft/textures/block/stone.png',
    name: 'stone.png', type: 'tex',
    path: 'pack:mc:MyPack/assets/minecraft/textures/block/stone.png',
  })
  r = await craft.getCurrentCraftPack()
  assert.ok(r.pack, '存入后返回当前制作项目')
  assert.equal(r.pack.name, '我的制作包')
  assert.equal(r.pack.dir, craftDir)
  assert.ok(r.pack.fileCount >= 1, '统计 assets 文件数')
})

test('exportPack: 与当前制作项目同名时自动加时间戳，不覆盖项目目录', async () => {
  await craft.clearSelection()
  await craft.copyToCraftPack({
    key: 'tex:pack:mc:MyPack/assets/minecraft/textures/block/stone.png',
    name: 'stone.png', type: 'tex',
    path: 'pack:mc:MyPack/assets/minecraft/textures/block/stone.png',
  })
  const craftDir = path.join(MC_ROOT, '我的制作包')
  assert.ok(fs.existsSync(craftDir), '当前制作项目目录已就绪')

  const r = await craft.exportPack({ name: '我的制作包', items: [
    { key: 'tex:' + diskTex, name: 'my_diffuse.png', type: 'tex', path: diskTex },
  ] })
  assert.match(r.name, /^我的制作包-\d{8}-\d{6}$/, '自动追加 YYYYMMDD-HHMMSS 时间戳')
  assert.ok(fs.existsSync(path.join(MC_ROOT, r.name, 'matoga-craft.json')), '导出快照独立成目录')
  assert.ok(!fs.existsSync(path.join(craftDir, 'matoga-craft.json')), '当前制作项目未被导出污染')
  assert.ok(fs.existsSync(path.join(craftDir, 'pack.mcmeta')), '当前制作项目原样保留')

  /* 同名导出产生的快照可被 listCraftPacks 识别，且不与当前项目目录混淆 */
  const { packs } = await craft.listCraftPacks()
  const snap = packs.find(p => p.name === r.name)
  assert.ok(snap, '时间戳快照出现在已导出列表')
  assert.equal(path.basename(snap.dir), r.name)
  assert.ok(!packs.some(p => p.name === '我的制作包'), '当前制作项目（无标记）不混入导出列表')
})

test('teardown: 恢复真实数据', async () => {
  await craft.clearSelection()
  try { fs.rmSync(MC_ROOT, { recursive: true, force: true }) } catch {}
  try { fs.rmSync(TEX_DIR, { recursive: true, force: true }) } catch {}
  try { fs.rmSync(path.dirname(craft.SELECTION_FILE), { recursive: true, force: true }) } catch {}
  if (selExisted) {
    fs.mkdirSync(path.dirname(craft.SELECTION_FILE), { recursive: true })
    fs.writeFileSync(craft.SELECTION_FILE, selBackup)
  }
})
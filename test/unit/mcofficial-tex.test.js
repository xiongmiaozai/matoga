/**
 * MC 官方材质包「包内贴图」单测：
 * - listOfficialPacks：每包统计 textureCount / firstTexture（dir 直排、dir 嵌套根、zip 嵌套前缀归一化）
 * - listPackTextures：列出 assets/<ns>/textures/** 贴图（dir / zip），上限截断标记
 * - listPackEntries：任意目录直接子项（文件管理器式浏览，dir / zip 归一化、截断标记）
 * - readPackFile：dir 直读 / zip 条目提取；路径穿越（..、非 assets/、非图片）拒绝
 * - 路由集成：GET /api/mc-official/:name/textures、/:name/entries、/:name/raw（含穿越 4xx）
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
const mcmeta = require('../../server/services/mcmeta-service')

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

const MCMETA = JSON.stringify({ pack: { pack_format: 15, description: 'test' } })
const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9])

const FILE = configStore.FILE
let backup = null
let existed = false
let ROOT = ''

function put(rel, data) {
  const f = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, data)
}

test('setup: 备份真实配置并构造官方包测试目录', async () => {
  existed = fs.existsSync(FILE)
  if (existed) backup = fs.readFileSync(FILE)
  try { fs.unlinkSync(FILE) } catch {}
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mcofficial-'))
  put('PackA/pack.mcmeta', MCMETA)
  put('PackA/assets/minecraft/textures/block/stone.png', PNG_A)
  put('PackA/assets/minecraft/textures/block/doors/oak.png', PNG_B)
  put('PackA/assets/minecraft/textures/item/dirt.png', PNG_B)
  put('PackA/assets/minecraft/sounds/step.ogg', Buffer.from('not-image'))
  put('PackB/inner/pack.mcmeta', MCMETA)
  put('PackB/inner/assets/minecraft/textures/block/deep.png', PNG_A)
  put('PackD/pack.mcmeta', MCMETA)
  // PackE：Fabric jar 解压布局（无 pack.mcmeta，顶层 assets + pack.png）
  put('PackE/assets/minecraft/textures/block/steel.png', PNG_A)
  put('PackE/META-INF/MANIFEST.MF', 'Manifest-Version: 1.0')
  put('PackE/pack.png', PNG_B)
  // PackF：唯一子目录含 assets 但无 mcmeta
  put('PackG/only/assets/minecraft/textures/item/gem.png', PNG_B)
  fs.writeFileSync(path.join(ROOT, 'PackC.zip'), buildZip([
    { name: 'pack.mcmeta', data: MCMETA },
    { name: 'PackC/assets/minecraft/textures/block/oak.png', data: PNG_B },
    { name: 'PackC/assets/minecraft/lang/en_us.json', data: '{}' },
  ]))
  // PackH.zip：无 mcmeta 但有嵌套 pack.png（zip 版 Fabric 布局）
  fs.writeFileSync(path.join(ROOT, 'PackH.zip'), buildZip([
    { name: 'PackH/assets/minecraft/textures/block/iron.png', data: PNG_A },
    { name: 'PackH/pack.png', data: PNG_B },
  ]))
  // Big.zip：单目录 4200 文件（超出浏览上限 4000 → 截断标记）
  const bigFiles = [{ name: 'pack.mcmeta', data: MCMETA }]
  for (let i = 0; i < 4200; i++) bigFiles.push({ name: `assets/minecraft/textures/block/f${i}.png`, data: PNG_A })
  fs.writeFileSync(path.join(ROOT, 'Big.zip'), buildZip(bigFiles))
  await configStore.put({ officialPacksPath: ROOT })
  assert.equal(configStore.get().officialPacksPath, ROOT)
})

test('listOfficialPacks: 每包统计贴图数与首张贴图', async () => {
  const { packs } = await mcmeta.listOfficialPacks(ROOT)

  const by = Object.fromEntries(packs.map(p => [p.name, p]))
  assert.equal(by.PackA.textureCount, 3, 'dir 直排：3 张贴图（含嵌套 doors/），排除非贴图文件')
  assert.equal(by.PackA.firstTexture, 'assets/minecraft/textures/block/doors/oak.png')
  assert.equal(by.PackB.textureCount, 1, 'dir 嵌套唯一子目录作为包根')
  assert.equal(by.PackB.firstTexture, 'assets/minecraft/textures/block/deep.png')
  assert.equal(by['PackC.zip'].textureCount, 1, 'zip 嵌套前缀（PackC/assets/...）归一化统计')
  assert.equal(by['PackC.zip'].firstTexture, 'assets/minecraft/textures/block/oak.png')
  assert.equal(by.PackD.textureCount, 0, '无贴图包为 0')
  assert.equal(by.PackD.firstTexture, null)
  assert.equal(by.PackE.textureCount, 1, '无 mcmeta 的 Fabric 布局仍统计贴图')
  assert.equal(by.PackE.firstTexture, 'pack.png', '包根有 pack.png 时缩略图优先图标')
  assert.equal(by.PackE.valid, false)
  assert.equal(by.PackE.error, 'pack.mcmeta not found')
  assert.deepEqual(by.PackE.namespaces, ['minecraft'])
  assert.equal(by.PackG.textureCount, 1, '唯一子目录含 assets（无 mcmeta）以子目录为包根')
  assert.equal(by.PackG.firstTexture, 'assets/minecraft/textures/item/gem.png')
  assert.equal(by['PackH.zip'].textureCount, 1, 'zip 无 mcmeta 仍统计贴图')
  assert.equal(by['PackH.zip'].firstTexture, 'pack.png')
  assert.equal(by['PackH.zip'].error, 'pack.mcmeta not found in archive')
})

test('listPackTextures: 根视图 = 类别分组 + 全部平铺分页', async () => {
  const a = await mcmeta.listPackTextures(ROOT, 'PackA')
  assert.equal(a.kind, 'dir')
  assert.equal(a.total, 3, 'block/stone + block/doors/oak + item/dirt')
  assert.equal(a.dir, null)
  assert.deepEqual(a.namespaces, ['minecraft'])
  assert.deepEqual(a.categories, [
    { name: 'block', dir: 'assets/minecraft/textures/block', count: 2 },
    { name: 'item', dir: 'assets/minecraft/textures/item', count: 1 },
  ], '类别 = textures/ 第一级目录，含数量与入口 dir')
  assert.deepEqual(a.breadcrumbs, [{ name: 'root', dir: null }])
  assert.equal(a.filesTotal, 3)
  assert.deepEqual(a.files.map(f => f.path), [
    'assets/minecraft/textures/block/doors/oak.png',
    'assets/minecraft/textures/block/stone.png',
    'assets/minecraft/textures/item/dirt.png',
  ], '根视图全部平铺（按路径排序）')

  const page = await mcmeta.listPackTextures(ROOT, 'PackA', { offset: 1, limit: 1 })
  assert.deepEqual(page.files.map(f => f.path), ['assets/minecraft/textures/block/stone.png'], '分页 offset/limit')
  assert.equal(page.offset, 1)
  assert.equal(page.limit, 1)
})

test('listPackTextures: dir 模式 = 子目录导航 + 面包屑 + 直接文件分页', async () => {
  const block = await mcmeta.listPackTextures(ROOT, 'PackA', { dir: 'assets/minecraft/textures/block' })
  assert.equal(block.dir, 'assets/minecraft/textures/block')
  assert.equal(block.parent, null, 'textures/ 上一级 → 根（类别）视图')
  assert.deepEqual(block.breadcrumbs, [
    { name: 'root', dir: null },
    { name: 'block', dir: 'assets/minecraft/textures/block' },
  ])
  assert.deepEqual(block.dirs, [
    { name: 'doors', dir: 'assets/minecraft/textures/block/doors', count: 1 },
  ], '子目录含递归计数与入口 dir')
  assert.deepEqual(block.files.map(f => f.name), ['stone.png'], '仅直接文件，不含子目录内文件')
  assert.equal(block.filesTotal, 1)

  const doors = await mcmeta.listPackTextures(ROOT, 'PackA', { dir: 'assets/minecraft/textures/block/doors' })
  assert.equal(doors.parent, 'assets/minecraft/textures/block')
  assert.deepEqual(doors.breadcrumbs.map(b => b.name), ['root', 'block', 'doors'])
  assert.deepEqual(doors.files.map(f => f.name), ['oak.png'])
  assert.deepEqual(doors.dirs, [])

  const zipDir = await mcmeta.listPackTextures(ROOT, 'PackC.zip', { dir: 'assets/minecraft/textures/block' })
  assert.deepEqual(zipDir.files.map(f => f.path), ['assets/minecraft/textures/block/oak.png'], 'zip 嵌套归一化后同样可浏览')
  assert.deepEqual(zipDir.categories, [{ name: 'block', dir: 'assets/minecraft/textures/block', count: 1 }])

  const empty = await mcmeta.listPackTextures(ROOT, 'PackD')
  assert.equal(empty.total, 0)
  assert.deepEqual(empty.files, [])
  assert.deepEqual(empty.categories, [])

  await assert.rejects(() => mcmeta.listPackTextures(ROOT, 'PackA', { dir: 'assets/../../etc' }),
    e => e.code === 'ERR_INVALID_PARAM', '浏览目录穿越拒绝')
  await assert.rejects(() => mcmeta.listPackTextures(ROOT, 'PackA', { dir: 'data/minecraft' }),
    e => e.code === 'ERR_INVALID_PARAM', '非 assets/<ns>/textures 层级拒绝')
  const nsOnly = await mcmeta.listPackTextures(ROOT, 'PackA', { dir: 'assets/minecraft' })
  assert.equal(nsOnly.dir, null, 'assets/<ns> 本身映射为根视图')
})

test('readPackFile: dir / zip 均读出字节，穿越路径拒绝', async () => {
  const a = await mcmeta.readPackFile(ROOT, 'PackA', 'assets/minecraft/textures/block/stone.png')
  assert.equal(a.mime, 'image/png')
  assert.deepEqual([...a.buf], [...PNG_A])

  const b = await mcmeta.readPackFile(ROOT, 'PackB', 'assets/minecraft/textures/block/deep.png')
  assert.deepEqual([...b.buf], [...PNG_A], 'dir 嵌套根读取')

  const c = await mcmeta.readPackFile(ROOT, 'PackC.zip', 'assets/minecraft/textures/block/oak.png')
  assert.deepEqual([...c.buf], [...PNG_B], 'zip 嵌套前缀归一化后按 assets/ 路径提取')

  const eIcon = await mcmeta.readPackFile(ROOT, 'PackE', 'pack.png')
  assert.equal(eIcon.mime, 'image/png')
  assert.deepEqual([...eIcon.buf], [...PNG_B], 'Fabric 布局包根 pack.png 可读')
  const eTex = await mcmeta.readPackFile(ROOT, 'PackE', 'assets/minecraft/textures/block/steel.png')
  assert.deepEqual([...eTex.buf], [...PNG_A], 'Fabric 布局贴图可读')
  const gTex = await mcmeta.readPackFile(ROOT, 'PackG', 'assets/minecraft/textures/item/gem.png')
  assert.deepEqual([...gTex.buf], [...PNG_B], '唯一子目录 assets 包根读取')
  const hIcon = await mcmeta.readPackFile(ROOT, 'PackH.zip', 'pack.png')
  assert.deepEqual([...hIcon.buf], [...PNG_B], 'zip 嵌套 pack.png 可读')
  await assert.rejects(() => mcmeta.readPackFile(ROOT, 'PackA', 'pack.png'),
    e => e.code === 'ERR_FS_NOT_FOUND', '包根无 pack.png 时 404')
  await assert.rejects(() => mcmeta.readPackFile(ROOT, 'PackA', 'pack.mcmeta'),
    e => e.code === 'ERR_INVALID_PARAM', '非图片扩展拒绝')

  await assert.rejects(() => mcmeta.readPackFile(ROOT, 'PackA', '../outside.png'),
    e => e.code === 'ERR_INVALID_PARAM', '非 assets/ 前缀拒绝')
  await assert.rejects(() => mcmeta.readPackFile(ROOT, 'PackA', 'assets/../../etc/passwd.png'),
    e => e.code === 'ERR_INVALID_PARAM', '含 .. 拒绝')
  await assert.rejects(() => mcmeta.readPackFile(ROOT, 'PackA', 'assets/minecraft/sounds/step.ogg'),
    e => e.code === 'ERR_INVALID_PARAM', '非图片扩展拒绝')
  await assert.rejects(() => mcmeta.readPackFile(ROOT, 'PackA', 'assets/minecraft/textures/block/none.png'),
    e => e.code === 'ERR_FS_NOT_FOUND', '不存在的贴图 404')
  await assert.rejects(() => mcmeta.readPackFile(ROOT, '../evil', 'assets/a.png'),
    e => e.code === 'ERR_INVALID_PARAM', '非法包名拒绝')
})

test('路由: /list 返回贴图统计，/:name/textures 与 /:name/raw 可用', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}/api/mc-official`
  try {
    const list = await (await fetch(base + '/list')).json()
    const packA = list.data.packs.find(p => p.name === 'PackA')
    assert.equal(packA.textureCount, 3)

    const tex = await (await fetch(base + '/PackA/textures')).json()
    assert.equal(tex.data.total, 3)
    assert.deepEqual(tex.data.categories, [
      { name: 'block', dir: 'assets/minecraft/textures/block', count: 2 },
      { name: 'item', dir: 'assets/minecraft/textures/item', count: 1 },
    ])
    assert.equal(tex.data.filesTotal, 3)
    assert.equal(tex.data.files[0].path, 'assets/minecraft/textures/block/doors/oak.png')

    const blockDir = await (await fetch(base + '/PackA/textures?dir=' + encodeURIComponent('assets/minecraft/textures/block'))).json()
    assert.deepEqual(blockDir.data.dirs.map(d => d.name), ['doors'])
    assert.deepEqual(blockDir.data.files.map(f => f.name), ['stone.png'])
    assert.equal(blockDir.data.parent, null)

    const paged = await (await fetch(base + '/PackA/textures?offset=1&limit=1')).json()
    assert.equal(paged.data.offset, 1)
    assert.equal(paged.data.files.length, 1)

    const badDir = await (await fetch(base + '/PackA/textures?dir=' + encodeURIComponent('assets/../../etc'))).json()
    assert.equal(badDir.ok, false)
    assert.equal(badDir.code, 'ERR_INVALID_PARAM')

    const raw = await fetch(base + '/PackC.zip/raw?path=' + encodeURIComponent('assets/minecraft/textures/block/oak.png'))
    assert.equal(raw.status, 200)
    assert.equal(raw.headers.get('content-type'), 'image/png')
    assert.deepEqual([...Buffer.from(await raw.arrayBuffer())], [...PNG_B])

    const bad = await fetch(base + '/PackA/raw?path=' + encodeURIComponent('assets/../../etc/passwd.png'))
    const badJson = await bad.json()
    assert.equal(badJson.ok, false, '路径穿越应失败')
    assert.equal(badJson.code, 'ERR_INVALID_PARAM')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('listPackEntries: 文件管理器式浏览（dir 包根/逐层进入/面包屑）', async () => {
  const a = await mcmeta.listPackEntries(ROOT, 'PackA')
  assert.equal(a.kind, 'dir')
  assert.equal(a.dir, null)
  assert.equal(a.parent, null)
  assert.deepEqual(a.breadcrumbs, [{ name: 'root', dir: null }])
  assert.deepEqual(a.dirs.map(d => d.name), ['assets'], 'PackA 根只有 assets 目录')
  assert.deepEqual(a.files.map(f => f.name), ['pack.mcmeta'], '根级文件')
  assert.equal(a.files[0].size, MCMETA.length, '文件大小')
  assert.ok(a.files[0].mtime > 0, '目录包文件带 mtime')
  assert.equal(a.total, 2)
  assert.equal(a.truncated, false)

  const assets = await mcmeta.listPackEntries(ROOT, 'PackA', { dir: 'assets' })
  assert.deepEqual(assets.dirs.map(d => d.name), ['minecraft'])
  assert.deepEqual(assets.files, [])
  assert.equal(assets.parent, null)
  assert.deepEqual(assets.breadcrumbs, [
    { name: 'root', dir: null },
    { name: 'assets', dir: 'assets' },
  ])

  const mc = await mcmeta.listPackEntries(ROOT, 'PackA', { dir: 'assets/minecraft' })
  assert.deepEqual(mc.dirs.map(d => d.name), ['sounds', 'textures'], '目录名排序')
  assert.equal(mc.parent, 'assets')

  const block = await mcmeta.listPackEntries(ROOT, 'PackA', { dir: 'assets/minecraft/textures/block' })
  assert.deepEqual(block.dirs.map(d => d.name), ['doors'])
  assert.deepEqual(block.files.map(f => f.name), ['stone.png'], '仅直接文件，不含子目录内文件')
  assert.equal(block.files[0].size, PNG_A.length)
  assert.equal(block.parent, 'assets/minecraft/textures')
  assert.deepEqual(block.breadcrumbs.map(b => b.name), ['root', 'assets', 'minecraft', 'textures', 'block'])
})

test('listPackEntries: dir 嵌套唯一子目录作为包根', async () => {
  const b = await mcmeta.listPackEntries(ROOT, 'PackB')
  assert.deepEqual(b.dirs.map(d => d.name), ['assets'], '以 inner/ 为包根')
  assert.deepEqual(b.files.map(f => f.name), ['pack.mcmeta'], 'inner/pack.mcmeta 视作包根文件')
  const deep = await mcmeta.listPackEntries(ROOT, 'PackB', { dir: 'assets/minecraft/textures/block' })
  assert.deepEqual(deep.files.map(f => f.name), ['deep.png'])
})

test('listPackEntries: zip 嵌套前缀归一化（混合布局 PackC/ → 包根）', async () => {
  const c = await mcmeta.listPackEntries(ROOT, 'PackC.zip')
  assert.equal(c.kind, 'zip')
  assert.deepEqual(c.dirs.map(d => d.name), ['assets'])
  assert.deepEqual(c.files.map(f => f.name), ['pack.mcmeta'])
  const mc = await mcmeta.listPackEntries(ROOT, 'PackC.zip', { dir: 'assets/minecraft' })
  assert.deepEqual(mc.dirs.map(d => d.name), ['lang', 'textures'])
  const lang = await mcmeta.listPackEntries(ROOT, 'PackC.zip', { dir: 'assets/minecraft/lang' })
  assert.deepEqual(lang.dirs, [])
  assert.deepEqual(lang.files.map(f => f.name), ['en_us.json'])
  assert.equal(lang.files[0].size, 2)
  assert.equal(lang.files[0].mtime, 0, 'zip 条目无 mtime')
})

test('listPackEntries: Fabric 布局（无 mcmeta，包根 = 自身）', async () => {
  const e = await mcmeta.listPackEntries(ROOT, 'PackE')
  assert.deepEqual(e.dirs.map(d => d.name), ['assets', 'META-INF'])
  assert.deepEqual(e.files.map(f => f.name), ['pack.png'])
})

test('listPackEntries: 超上限截断标记', async () => {
  const big = await mcmeta.listPackEntries(ROOT, 'Big.zip', { dir: 'assets/minecraft/textures/block' })
  assert.equal(big.truncated, true)
  assert.deepEqual(big.dirs, [])
  assert.equal(big.files.length, 4000, '文件截断至上限')
  assert.equal(big.total, 4200, 'total 反映真实总数')
  const root = await mcmeta.listPackEntries(ROOT, 'Big.zip')
  assert.equal(root.total, 2, '根视图不受深层文件影响')
  assert.equal(root.truncated, false)
})

test('listPackEntries: 穿越与非法路径拒绝，不存在目录/包 404', async () => {
  await assert.rejects(() => mcmeta.listPackEntries(ROOT, 'PackA', { dir: '../..' }),
    e => e.code === 'ERR_INVALID_PARAM', '含 .. 拒绝')
  await assert.rejects(() => mcmeta.listPackEntries(ROOT, 'PackA', { dir: '/etc' }),
    e => e.code === 'ERR_INVALID_PARAM', '绝对路径拒绝')
  await assert.rejects(() => mcmeta.listPackEntries(ROOT, 'PackA', { dir: 'a\\b' }),
    e => e.code === 'ERR_INVALID_PARAM', '反斜杠拒绝')
  await assert.rejects(() => mcmeta.listPackEntries(ROOT, 'PackA', { dir: 'no-such' }),
    e => e.code === 'ERR_FS_NOT_FOUND', '不存在子目录 404')
  await assert.rejects(() => mcmeta.listPackEntries(ROOT, '../evil'),
    e => e.code === 'ERR_INVALID_PARAM', '非法包名拒绝')
  await assert.rejects(() => mcmeta.listPackEntries(ROOT, 'no-such-pack'),
    e => e.code === 'ERR_FS_NOT_FOUND', '不存在包 404')
})

test('路由: GET /:name/entries 文件浏览可用且穿越返回 4xx', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}/api/mc-official`
  try {
    const root = await (await fetch(base + '/PackA/entries')).json()
    assert.equal(root.ok, true)
    assert.equal(root.data.kind, 'dir')
    assert.deepEqual(root.data.dirs.map(d => d.name), ['assets'])
    assert.deepEqual(root.data.files.map(f => f.name), ['pack.mcmeta'])

    const block = await (await fetch(base + '/PackA/entries?dir=' + encodeURIComponent('assets/minecraft/textures/block'))).json()
    assert.deepEqual(block.data.dirs.map(d => d.name), ['doors'])
    assert.deepEqual(block.data.files.map(f => f.name), ['stone.png'])

    const zipRoot = await (await fetch(base + '/PackC.zip/entries')).json()
    assert.equal(zipRoot.data.kind, 'zip')
    assert.deepEqual(zipRoot.data.files.map(f => f.name), ['pack.mcmeta'])

    const badDir = await (await fetch(base + '/PackA/entries?dir=' + encodeURIComponent('../..'))).json()
    assert.equal(badDir.ok, false)
    assert.equal(badDir.code, 'ERR_INVALID_PARAM')

    const notFound = await (await fetch(base + '/no-such-pack/entries')).json()
    assert.equal(notFound.ok, false)
    assert.equal(notFound.code, 'ERR_FS_NOT_FOUND')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('listAllTexPaths: 扁平收集所有官方包贴图路径去重', async () => {
  const paths = await mcmeta.listAllTexPaths(ROOT)
  const set = new Set(paths)
  assert.ok(set.has('assets/minecraft/textures/block/stone.png'), 'PackA 贴图收录')
  assert.ok(set.has('assets/minecraft/textures/block/doors/oak.png'), 'PackA 嵌套子目录贴图收录')
  assert.ok(set.has('assets/minecraft/textures/item/dirt.png'), 'PackA item 贴图收录')
  assert.ok(set.has('assets/minecraft/textures/block/deep.png'), 'PackB 嵌套根贴图收录')
  assert.ok(set.has('assets/minecraft/textures/block/oak.png'), 'PackC.zip 嵌套前缀归一化贴图收录')
  assert.ok(set.has('assets/minecraft/textures/block/steel.png'), 'PackE Fabric 布局贴图收录')
  assert.ok(set.has('assets/minecraft/textures/item/gem.png'), 'PackG 唯一子目录贴图收录')
  assert.ok(set.has('assets/minecraft/textures/block/iron.png'), 'PackH.zip 贴图收录')
  const unique = new Set(paths)
  assert.equal(paths.length, unique.size, '路径去重无重复')
  assert.ok(paths.length >= 8, '至少收录 8 张已知贴图（不含 Big.zip 的 4200 张，受 MAX_TEX_WALK=20000 限制仍应全部收录）')
})

test('listAllTexPaths: 不存在的根目录返回空数组', async () => {
  const paths = await mcmeta.listAllTexPaths(path.join(ROOT, 'no-such-dir'))
  assert.deepEqual(paths, [])
})

test('路由: GET /tex-index 返回全量贴图路径数组', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}/api/mc-official`
  try {
    const res = await (await fetch(base + '/tex-index')).json()
    assert.equal(res.ok, true)
    assert.ok(Array.isArray(res.data.paths), '返回 paths 数组')
    const set = new Set(res.data.paths)
    assert.ok(set.has('assets/minecraft/textures/block/stone.png'), '含 PackA 贴图')
    assert.ok(set.has('assets/minecraft/textures/block/oak.png'), '含 PackC.zip 贴图')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('teardown: 清理临时目录并恢复真实配置', async () => {
  fs.rmSync(ROOT, { recursive: true, force: true })
  try { fs.unlinkSync(FILE) } catch {}
  if (existed) fs.writeFileSync(FILE, backup)
})
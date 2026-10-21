const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const svc = require('../../server/services/mcmeta-service')
const { AppError } = require('../../shared/errors')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'matoga-mcmeta-'))

/* ── 测试用 zip 构造器（store / deflate）──────── */

function makeZip(files, method) {
  const m = method === 8 ? 8 : 0
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8')
    const raw = Buffer.from(f.data, 'utf8')
    const data = m === 8 ? zlib.deflateRawSync(raw) : raw
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(m, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuf, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(m, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuf)

    offset += 30 + nameBuf.length + data.length
  }
  const cd = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, cd, eocd])
}

const MCMETA_121 = JSON.stringify({ pack: { pack_format: 34, description: '§aOfficial 1.21' } })
const VERSION_JSON_263 = JSON.stringify({
  id: '26.3', name: '26.3', world_version: 5023, protocol_version: 777,
  pack_version: { resource_major: 97, resource_minor: 1, data_major: 121, data_minor: 0 },
  stable: true,
})

/* ── 版本映射 ─────────────────────────────────── */

test('formatToVersions: pack_format 映射到 MC 版本', () => {
  assert.equal(svc.formatToVersions(34), '1.21 – 1.21.1')
  assert.equal(svc.formatToVersions(1), '1.6.1 – 1.8.9')
  assert.equal(svc.formatToVersions(64), '1.21.7 – 1.21.8')
  assert.equal(svc.formatToVersions(99), '')
  assert.equal(svc.formatToVersions(null), '')
})

test('PACK_FORMAT_VERSIONS: 覆盖常用版本', () => {
  const formats = svc.PACK_FORMAT_VERSIONS.map(e => e.format)
  for (const f of [1, 4, 6, 9, 15, 22, 32, 34, 46, 64]) assert.ok(formats.includes(f), 'missing ' + f)
})

/* ── pack.mcmeta 解析 ────────────────────────── */

test('parseMcmetaText: 标准 pack.mcmeta', () => {
  const m = svc.parseMcmetaText(MCMETA_121)
  assert.equal(m.format, 34)
  assert.equal(m.description, 'Official 1.21')
})

test('parseMcmetaText: description 为组件对象', () => {
  const m = svc.parseMcmetaText(JSON.stringify({ pack: { pack_format: 15, description: { text: '§bVillage&Pillage', color: 'green' } } }))
  assert.equal(m.description, 'Village&Pillage')
})

test('parseMcmetaText: supported_formats 对象与数组', () => {
  const o = svc.parseMcmetaText(JSON.stringify({ pack: { pack_format: 42, supported_formats: { min_format_inclusive: 42, max_format_inclusive: 46 } } }))
  assert.equal(o.minFormat, 42)
  assert.equal(o.maxFormat, 46)
  const a = svc.parseMcmetaText(JSON.stringify({ pack: { pack_format: 42, supported_formats: [42, 46] } }))
  assert.equal(a.minFormat, 42)
  assert.equal(a.maxFormat, 46)
})

test('parseMcmetaText: 非法输入抛错', () => {
  assert.throws(() => svc.parseMcmetaText('{ bad'), AppError)
  assert.throws(() => svc.parseMcmetaText('{}'), AppError)
  assert.throws(() => svc.parseMcmetaText('null'), AppError)
})

/* ── analyzePack: 文件夹包 ───────────────────── */

test('analyzePack: 目录包解析根级 pack.mcmeta 与命名空间', async () => {
  const dir = path.join(TMP, 'pack-dir-121')
  fs.mkdirSync(path.join(dir, 'assets', 'minecraft', 'textures', 'block'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'assets', 'realms'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'pack.mcmeta'), MCMETA_121)
  const st = await fs.promises.stat(dir)
  const e = await svc.analyzePack(dir, st)
  assert.equal(e.valid, true)
  assert.equal(e.kind, 'dir')
  assert.equal(e.format, 34)
  assert.equal(e.formatRange, '1.21 – 1.21.1')
  assert.equal(e.description, 'Official 1.21')
  assert.deepEqual(e.namespaces.sort(), ['minecraft', 'realms'])
})

test('analyzePack: 目录包支持唯一子目录内的 pack.mcmeta', async () => {
  const dir = path.join(TMP, 'pack-nested')
  fs.mkdirSync(path.join(dir, 'Vanilla 1.21'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'Vanilla 1.21', 'pack.mcmeta'), MCMETA_121)
  const st = await fs.promises.stat(dir)
  const e = await svc.analyzePack(dir, st)
  assert.equal(e.valid, true)
  assert.equal(e.format, 34)
})

test('analyzePack: 目录缺少 pack.mcmeta 时标记无效', async () => {
  const dir = path.join(TMP, 'pack-empty-dir')
  fs.mkdirSync(dir)
  const st = await fs.promises.stat(dir)
  const e = await svc.analyzePack(dir, st)
  assert.equal(e.valid, false)
  assert.ok(e.error.includes('not found'))
})

/* ── analyzePack: version.json 回退（jar 解包布局）── */

test('analyzePack: 目录包缺 mcmeta 时回退 version.json（Fabric jar 布局）', async () => {
  const dir = path.join(TMP, 'pack-fabric-263')
  fs.mkdirSync(path.join(dir, 'assets', 'minecraft', 'textures', 'block'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'version.json'), VERSION_JSON_263)
  fs.writeFileSync(path.join(dir, 'pack.png'), 'png')
  fs.writeFileSync(path.join(dir, 'assets', 'minecraft', 'textures', 'block', 'stone.png'), 'png')
  const st = await fs.promises.stat(dir)
  const e = await svc.analyzePack(dir, st)
  assert.equal(e.valid, true)
  assert.equal(e.kind, 'dir')
  assert.equal(e.format, 97)
  assert.equal(e.formatLabel, '97.1')
  assert.equal(e.formatRange, '26.3')
  assert.deepEqual(e.namespaces, ['minecraft'])
  assert.equal(e.textureCount, 1)
  assert.equal(e.firstTexture, 'pack.png')
  assert.equal(e.error, '')
})

test('analyzePack: zip（jar 形态）缺 mcmeta 时回退 version.json', async () => {
  const zipPath = path.join(TMP, 'client-263.zip')
  fs.writeFileSync(zipPath, makeZip([
    { name: 'version.json', data: VERSION_JSON_263 },
    { name: 'assets/minecraft/textures/block/dirt.png', data: 'png' },
  ], 8))
  const st = await fs.promises.stat(zipPath)
  const e = await svc.analyzePack(zipPath, st)
  assert.equal(e.valid, true)
  assert.equal(e.kind, 'zip')
  assert.equal(e.format, 97)
  assert.equal(e.formatLabel, '97.1')
  assert.equal(e.formatRange, '26.3')
  assert.equal(e.textureCount, 1)
})

test('analyzePack: version.json 非法 JSON 时不回退', async () => {
  const dir = path.join(TMP, 'pack-bad-vjson')
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'version.json'), '{ bad')
  const st = await fs.promises.stat(dir)
  const e = await svc.analyzePack(dir, st)
  assert.equal(e.valid, false)
  assert.ok(e.error.includes('not found'))
})

/* ── analyzePack: zip 包 ─────────────────────── */

test('analyzePack: zip 包（store）解析 pack.mcmeta', async () => {
  const zipPath = path.join(TMP, 'official-121.zip')
  fs.writeFileSync(zipPath, makeZip([
    { name: 'pack.mcmeta', data: MCMETA_121 },
    { name: 'assets/minecraft/textures/block/stone.png', data: 'png' },
    { name: 'assets/realms/lang/en_us.json', data: '{}' },
  ], 0))
  const st = await fs.promises.stat(zipPath)
  const e = await svc.analyzePack(zipPath, st)
  assert.equal(e.valid, true)
  assert.equal(e.kind, 'zip')
  assert.equal(e.format, 34)
  assert.equal(e.formatRange, '1.21 – 1.21.1')
  assert.deepEqual(e.namespaces.sort(), ['minecraft', 'realms'])
})

test('analyzePack: zip 包（deflate）解析 pack.mcmeta', async () => {
  const zipPath = path.join(TMP, 'official-121-deflate.zip')
  fs.writeFileSync(zipPath, makeZip([
    { name: 'pack.mcmeta', data: JSON.stringify({ pack: { pack_format: 15, description: '1.20' } }) },
  ], 8))
  const st = await fs.promises.stat(zipPath)
  const e = await svc.analyzePack(zipPath, st)
  assert.equal(e.valid, true)
  assert.equal(e.format, 15)
  assert.equal(e.formatRange, '1.20 – 1.20.1')
})

test('analyzePack: zip 内嵌套 pack.mcmeta 时取最浅层', async () => {
  const zipPath = path.join(TMP, 'official-nested.zip')
  fs.writeFileSync(zipPath, makeZip([
    { name: 'Vanilla/pack.mcmeta', data: MCMETA_121 },
  ], 0))
  const st = await fs.promises.stat(zipPath)
  const e = await svc.analyzePack(zipPath, st)
  assert.equal(e.valid, true)
  assert.equal(e.format, 34)
})

test('analyzePack: zip 缺少 pack.mcmeta 时标记无效', async () => {
  const zipPath = path.join(TMP, 'official-bad.zip')
  fs.writeFileSync(zipPath, makeZip([{ name: 'assets/x.txt', data: 'x' }], 0))
  const st = await fs.promises.stat(zipPath)
  const e = await svc.analyzePack(zipPath, st)
  assert.equal(e.valid, false)
  assert.ok(e.error.includes('not found'))
})

test('analyzePack: 非 zip 扩展名的文件被拒绝', async () => {
  const p = path.join(TMP, 'notes.txt')
  fs.writeFileSync(p, 'hello')
  const st = await fs.promises.stat(p)
  const e = await svc.analyzePack(p, st)
  assert.equal(e.valid, false)
  assert.equal(e.kind, 'file')
})

test('analyzePack: 损坏的 zip 标记无效而非抛出', async () => {
  const p = path.join(TMP, 'broken.zip')
  fs.writeFileSync(p, Buffer.from('this is not a zip file at all'))
  const st = await fs.promises.stat(p)
  const e = await svc.analyzePack(p, st)
  assert.equal(e.valid, false)
  assert.ok(e.error)
})

/* ── listOfficialPacks ──────────────────────── */

test('listOfficialPacks: 目录不存在时返回空且不抛错', async () => {
  const r = await svc.listOfficialPacks(path.join(TMP, 'nope-does-not-exist'))
  assert.equal(r.exists, false)
  assert.deepEqual(r.packs, [])
})

test('listOfficialPacks: 混合条目、跳过隐藏文件与非包文件', async () => {
  const root = path.join(TMP, 'lib-root')
  fs.mkdirSync(path.join(root, '1.21 官方包', 'assets', 'minecraft'), { recursive: true })
  fs.writeFileSync(path.join(root, '1.21 官方包', 'pack.mcmeta'), MCMETA_121)
  fs.writeFileSync(path.join(root, 'vanilla-120.zip'), makeZip([
    { name: 'pack.mcmeta', data: JSON.stringify({ pack: { pack_format: 15, description: '1.20' } }) },
  ], 0))
  fs.writeFileSync(path.join(root, 'readme.txt'), 'skip me')
  fs.mkdirSync(path.join(root, '.hidden'))
  const r = await svc.listOfficialPacks(root)
  assert.equal(r.exists, true)
  assert.equal(r.packs.length, 2)
  const names = r.packs.map(p => p.name)
  assert.ok(names.includes('1.21 官方包'))
  assert.ok(names.includes('vanilla-120.zip'))
  for (const p of r.packs) assert.equal(p.valid, true)
})

/* ── renamePack ─────────────────────────────── */

test('renamePack: 成功重命名并返回新旧路径', async () => {
  const root = path.join(TMP, 'ren-root')
  fs.mkdirSync(path.join(root, 'old-name'), { recursive: true })
  const r = await svc.renamePack(root, 'old-name', 'new-name')
  assert.equal(r.name, 'new-name')
  assert.ok(fs.existsSync(path.join(root, 'new-name')))
  assert.ok(!fs.existsSync(path.join(root, 'old-name')))
})

test('renamePack: 源不存在时抛 ERR_FS_NOT_FOUND', async () => {
  const root = path.join(TMP, 'ren-root')
  await assert.rejects(() => svc.renamePack(root, 'ghost', 'x'), (e) => e instanceof AppError && e.code === 'ERR_FS_NOT_FOUND')
})

test('renamePack: 目标已存在时抛 ERR_ALREADY_EXISTS', async () => {
  const root = path.join(TMP, 'ren-root')
  fs.mkdirSync(path.join(root, 'new-name'), { recursive: true })
  await assert.rejects(() => svc.renamePack(root, 'new-name', 'new-name'), (e) => e instanceof AppError && e.code === 'ERR_ALREADY_EXISTS')
})

test('renamePack: 非法名字被拒绝（防路径穿越）', async () => {
  const root = path.join(TMP, 'ren-root')
  for (const bad of ['', '  ', '..', '.', 'a/b', 'a\\b', ' a', null, undefined, 123]) {
    await assert.rejects(() => svc.renamePack(root, String(bad ?? ''), 'ok'), AppError)
    await assert.rejects(() => svc.renamePack(root, 'new-name', bad), AppError)
  }
})

/* ── suggestName ────────────────────────────── */

test('suggestName: 由版本范围生成规范名', () => {
  assert.equal(svc.suggestName({ name: 'foo', formatRange: '1.21 – 1.21.1' }), '1.21-1.21.1')
  assert.equal(svc.suggestName({ name: 'foo', formatRange: '1.19.3' }), '1.19.3')
  assert.equal(svc.suggestName({ name: 'foo', format: 34 }), 'pack_format-34')
  assert.equal(svc.suggestName({ name: 'foo' }), 'foo')
  assert.equal(svc.suggestName(null), '')
})

test('validPackName: 边界校验', () => {
  assert.equal(svc.validPackName('1.21-官方包'), true)
  assert.equal(svc.validPackName('a b.zip'), true)
  assert.equal(svc.validPackName(''), false)
  assert.equal(svc.validPackName('..'), false)
  assert.equal(svc.validPackName('a/b'), false)
  assert.equal(svc.validPackName('a\\b'), false)
  assert.equal(svc.validPackName(' a'), false)
  assert.equal(svc.validPackName(null), false)
})

test('teardown: 清理临时目录', () => {
  fs.rmSync(TMP, { recursive: true, force: true })
})
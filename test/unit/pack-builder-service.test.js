/**
 * 资源包自动创建服务单测（server/services/pack-builder-service.js）：
 * - buildMcmeta：pack_format 模式 / min_format+max_format 模式 / 默认值
 * - crc32：已知向量校验
 * - buildZip：零依赖 zip 能被 mcmeta-service.parseZipCentralDirectory 解析回原条目
 * - defaultPackPng / encodePng：生成有效 PNG（签名 + IHDR + IDAT 可解）
 * - buildPack 输出目录：pack.mcmeta + pack.png + 贴图/模型自动归类
 * - buildPack 输出 zip：生成的 zip 可被 mcmeta 解析且含 pack.mcmeta
 * - buildPack 从资产库 items 聚合（复用 craft.resolveEntry）
 * - buildPack 安全校验：非法命名空间 / 路径穿越拒绝
 * - listFormats：返回映射表
 * 隔离：monkey-patch configStore.get 指向临时目录，不写真实 data/config.json
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')

const builder = require('../../server/services/pack-builder-service')
const mcmeta = require('../../server/services/mcmeta-service')
const configStore = require('../../server/config/config-store')
const { AppError } = require('../../server/lib/errors')

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_BODY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const MODEL_JSON = Buffer.from('{"parent":"minecraft:block/cube"}')

let DEST = ''
let SRC = ''
const origGet = configStore.get.bind(configStore)
let injected = {}

function put(root, rel, data) {
  const f = path.join(root, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, data)
}

test('setup: 构造临时目录并注入配置', () => {
  DEST = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-build-dest-'))
  SRC = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-build-src-'))
  put(SRC, 'stone.png', PNG_BODY)
  put(SRC, 'cube.json', MODEL_JSON)
  injected = { ...origGet(), craftPacksPath: DEST, mcPacksPath: SRC }
  configStore.get = () => injected
})

test('buildMcmeta: pack_format 模式', () => {
  const m = builder.buildMcmeta({ name: 'T', packFormat: 34 })
  assert.equal(m.pack.pack_format, 34)
  assert.equal(m.pack.description, 'T · matoga')
  assert.equal(m.pack.min_format, undefined)
})

test('buildMcmeta: min_format/max_format 模式优先', () => {
  const m = builder.buildMcmeta({ name: 'T', packFormat: 34, minFormat: 88, maxFormat: 90 })
  assert.equal(m.pack.min_format, 88)
  assert.equal(m.pack.max_format, 90)
  assert.equal(m.pack.pack_format, undefined)
})

test('buildMcmeta: 默认 pack_format', () => {
  const m = builder.buildMcmeta({ name: 'T' })
  assert.equal(m.pack.pack_format, builder.DEFAULT_PACK_FORMAT)
})

test('buildMcmeta: 自定义描述', () => {
  const m = builder.buildMcmeta({ name: 'T', description: '我的包' })
  assert.equal(m.pack.description, '我的包')
})

test('crc32: 已知向量', () => {
  assert.equal(builder.crc32(Buffer.from('')), 0)
  assert.equal(builder.crc32(Buffer.from('123456789')), 0xcbf43926)
})

test('buildZip: 生成的 zip 可被 mcmeta 解析回原条目', () => {
  const entries = [
    { name: 'pack.mcmeta', data: Buffer.from('{"pack":{"pack_format":15}}') },
    { name: 'assets/matoga/textures/x.png', data: PNG_BODY },
  ]
  const zip = builder.buildZip(entries)
  assert.ok(zip.length > 0)
  const parsed = mcmeta.parseZipCentralDirectory(zip)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].name, 'pack.mcmeta')
  assert.equal(parsed[1].name, 'assets/matoga/textures/x.png')
  const e0 = parsed[0]
  const lh = e0.localOffset
  const nameLen = zip.readUInt16LE(lh + 26)
  const extraLen = zip.readUInt16LE(lh + 28)
  const dataStart = lh + 30 + nameLen + extraLen
  const raw = zip.subarray(dataStart, dataStart + e0.csize)
  const body = e0.method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw)
  assert.equal(body.toString(), '{"pack":{"pack_format":15}}')
})

test('encodePng: 生成有效 PNG（签名 + IHDR + IDAT 可解）', () => {
  const rgba = Buffer.alloc(4 * 4 * 4)
  rgba[0] = 255; rgba[3] = 255
  const png = builder.encodePng(4, 4, rgba)
  assert.ok(png.subarray(0, 8).equals(PNG_SIG))
  assert.equal(png.toString('ascii', 12, 16), 'IHDR')
  assert.equal(png.readUInt32BE(16), 4)
  assert.equal(png.readUInt32BE(20), 4)
})

test('defaultPackPng: 128×128 有效 PNG 且非空', () => {
  const png = builder.defaultPackPng()
  assert.ok(png.subarray(0, 8).equals(PNG_SIG))
  assert.equal(png.toString('ascii', 12, 16), 'IHDR')
  assert.equal(png.readUInt32BE(16), 128)
  assert.equal(png.readUInt32BE(20), 128)
  assert.ok(png.length > 200, 'pack.png should have visible content')
})

test('buildPack: 输出目录，贴图/模型自动归类', async () => {
  const r = await builder.buildPack({
    name: 'TestPack',
    description: '测试包',
    packFormat: 15,
    files: [
      { src: path.join(SRC, 'stone.png') },
      { src: path.join(SRC, 'cube.json') },
    ],
    output: 'dir',
  })
  assert.equal(r.output, 'dir')
  assert.equal(r.written, 2)
  assert.equal(r.skipped, 0)
  assert.equal(r.packFormat, 15)
  assert.ok(fs.existsSync(path.join(r.dir, 'pack.mcmeta')))
  assert.ok(fs.existsSync(path.join(r.dir, 'pack.png')))
  assert.ok(fs.existsSync(path.join(r.dir, 'assets/minecraft/textures/stone.png')))
  assert.ok(fs.existsSync(path.join(r.dir, 'assets/minecraft/models/cube.json')))
  const meta = JSON.parse(fs.readFileSync(path.join(r.dir, 'pack.mcmeta'), 'utf8'))
  assert.equal(meta.pack.pack_format, 15)
  assert.equal(meta.pack.description, '测试包')
})

test('buildPack: 输出 zip，可被 mcmeta 解析且含 pack.mcmeta + pack.png', async () => {
  const r = await builder.buildPack({
    name: 'TestZip',
    packFormat: 22,
    files: [{ src: path.join(SRC, 'stone.png') }],
    output: 'zip',
  })
  assert.equal(r.output, 'zip')
  assert.ok(r.file.endsWith('.zip'))
  const zip = fs.readFileSync(r.file)
  const entries = mcmeta.parseZipCentralDirectory(zip)
  const names = entries.map(e => e.name)
  assert.ok(names.includes('pack.mcmeta'))
  assert.ok(names.includes('pack.png'))
  assert.ok(names.includes('assets/minecraft/textures/stone.png'))
})

test('buildPack: 自定义 dest 保留指定包内路径', async () => {
  const r = await builder.buildPack({
    name: 'TestDest',
    files: [{ src: path.join(SRC, 'stone.png'), dest: 'assets/minecraft/textures/block/dirt.png' }],
    output: 'dir',
  })
  assert.ok(fs.existsSync(path.join(r.dir, 'assets/minecraft/textures/block/dirt.png')))
})

test('buildPack: 自定义命名空间', async () => {
  const r = await builder.buildPack({
    name: 'TestNs',
    namespace: 'my_mod',
    files: [{ src: path.join(SRC, 'stone.png') }],
    output: 'dir',
  })
  assert.ok(fs.existsSync(path.join(r.dir, 'assets/my_mod/textures/stone.png')))
})

test('buildPack: 传入 packPng 路径则使用之', async () => {
  const custom = path.join(SRC, 'custom.png')
  fs.writeFileSync(custom, PNG_BODY)
  const r = await builder.buildPack({
    name: 'TestCustomPng',
    files: [{ src: path.join(SRC, 'stone.png') }],
    packPng: custom,
    output: 'dir',
  })
  const png = fs.readFileSync(path.join(r.dir, 'pack.png'))
  assert.ok(png.equals(PNG_BODY))
})

test('buildPack: 从资产库 items 聚合（包内虚拟路径）', async () => {
  put(SRC, 'SrcPack/pack.mcmeta', JSON.stringify({ pack: { pack_format: 15, description: 's' } }))
  put(SRC, 'SrcPack/assets/minecraft/textures/block/iron.png', PNG_BODY)
  const r = await builder.buildPack({
    name: 'TestItems',
    items: [{
      key: 'pack:mc:SrcPack/assets/minecraft/textures/block/iron.png',
      name: 'iron',
      type: 'tex',
      path: 'pack:mc:SrcPack/assets/minecraft/textures/block/iron.png',
    }],
    output: 'dir',
  })
  assert.equal(r.written, 1)
  assert.ok(fs.existsSync(path.join(r.dir, 'assets/minecraft/textures/block/iron.png')))
})

test('buildPack: 非法命名空间拒绝', async () => {
  await assert.rejects(
    builder.buildPack({ name: 'BadNs', namespace: 'MyMod' }),
    AppError
  )
})

test('buildPack: 路径穿越 dest 被拒绝并回退到安全自动归类', async () => {
  const r = await builder.buildPack({
    name: 'BadDest',
    files: [{ src: path.join(SRC, 'stone.png'), dest: '../evil.png' }],
    output: 'dir',
  })
  assert.equal(r.written, 1)
  assert.ok(fs.existsSync(path.join(r.dir, 'assets/minecraft/textures/stone.png')))
  assert.ok(!fs.existsSync(path.join(r.dir, '..', 'evil.png')))
})

test('buildPack: 不支持的扩展名跳过', async () => {
  const unk = path.join(SRC, 'data.txt')
  fs.writeFileSync(unk, Buffer.from('hello'))
  const r = await builder.buildPack({
    name: 'TestSkip',
    files: [{ src: unk }],
    output: 'dir',
  })
  assert.equal(r.written, 0)
  assert.equal(r.skipped, 1)
})

test('buildPack: 重名自动追加序号', async () => {
  const r1 = await builder.buildPack({ name: 'Dup', files: [{ src: path.join(SRC, 'stone.png') }], output: 'dir' })
  const r2 = await builder.buildPack({ name: 'Dup', files: [{ src: path.join(SRC, 'stone.png') }], output: 'dir' })
  assert.notEqual(r1.dir, r2.dir)
  assert.ok(r2.name.startsWith('Dup'))
})

test('listFormats: 返回 pack_format 映射表', () => {
  const fmts = builder.listFormats()
  assert.ok(Array.isArray(fmts))
  assert.ok(fmts.some(f => f.format === 34 && f.versions.includes('1.21')))
  assert.ok(fmts.some(f => f.format === 64))
  assert.ok(fmts.some(f => f.format === 69 && f.versions.includes('1.21.9')))
  assert.ok(fmts.some(f => f.format === 75 && f.versions.includes('1.21.11')))
  assert.ok(fmts.some(f => f.format === 88 && f.versions.includes('26.2')))
  assert.ok(fmts.some(f => f.format === 97 && f.versions.includes('26.3')))
})

test('buildPack: min≠max 范围写法生成 min_format/max_format', async () => {
  const data = PNG_BODY.toString('base64')
  const r = await builder.buildPack({
    name: 'TestRange',
    minFormat: 18,
    maxFormat: 34,
    files: [{ data, name: 'x.png' }],
    output: 'dir',
  })
  assert.equal(r.minFormat, 18)
  assert.equal(r.maxFormat, 34)
  assert.equal(r.packFormat, null)
  const meta = JSON.parse(fs.readFileSync(path.join(r.dir, 'pack.mcmeta'), 'utf8'))
  assert.equal(meta.pack.min_format, 18)
  assert.equal(meta.pack.max_format, 34)
  assert.equal(meta.pack.pack_format, undefined)
})

test('buildPack: files 支持 base64 内联 data', async () => {
  const data = PNG_BODY.toString('base64')
  const r = await builder.buildPack({
    name: 'TestInline',
    packFormat: 15,
    files: [{ data, name: 'grass.png' }],
    output: 'dir',
  })
  assert.equal(r.written, 1)
  assert.ok(fs.existsSync(path.join(r.dir, 'assets/minecraft/textures/grass.png')))
  assert.deepEqual(fs.readFileSync(path.join(r.dir, 'assets/minecraft/textures/grass.png')), PNG_BODY)
})

test('buildPack: packPngData base64 作为 pack.png', async () => {
  const data = PNG_BODY.toString('base64')
  const r = await builder.buildPack({
    name: 'TestPngData',
    packPngData: data,
    files: [{ data: PNG_BODY.toString('base64'), name: 'x.png' }],
    output: 'dir',
  })
  assert.deepEqual(fs.readFileSync(path.join(r.dir, 'pack.png')), PNG_BODY)
})

test('archivePack: 目录包导出为 zip 且可解析', async () => {
  const r = await builder.buildPack({
    name: 'ArchiveTest',
    packFormat: 15,
    files: [{ data: PNG_BODY.toString('base64'), name: 'stone.png' }],
    output: 'dir',
  })
  const { buf, zipName } = await builder.archivePack(SRC, r.name)
  assert.equal(zipName, r.name + '.zip')
  assert.ok(buf.length > 0)
  const entries = mcmeta.parseZipCentralDirectory(buf)
  const names = entries.map(e => e.name)
  assert.ok(names.includes('pack.mcmeta'))
  assert.ok(names.includes('pack.png'))
  assert.ok(names.some(n => n.includes('stone.png')))
})

test('archivePack: zip 包直接返回原文件', async () => {
  const r = await builder.buildPack({
    name: 'ArchiveZip',
    packFormat: 15,
    files: [{ data: PNG_BODY.toString('base64'), name: 'x.png' }],
    output: 'zip',
  })
  const orig = fs.readFileSync(r.file)
  const { buf, zipName } = await builder.archivePack(SRC, r.name)
  assert.deepEqual(buf, orig)
  assert.equal(zipName, r.name)
})

test('archivePack: 不存在的包拒绝', async () => {
  await assert.rejects(() => builder.archivePack(SRC, 'NoPack'), e => e.code === 'ERR_FS_NOT_FOUND')
})

test('buildZip: noCompress 选项生成 store 模式（method=0）', () => {
  const entries = [{ name: 'a.txt', data: Buffer.from('hello world') }]
  const zip = builder.buildZip(entries, { noCompress: true })
  const parsed = mcmeta.parseZipCentralDirectory(zip)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].method, 0)
})

test('archivePack: skipPackPng 跳过 pack.png', async () => {
  const r = await builder.buildPack({
    name: 'SkipPngTest',
    packFormat: 15,
    files: [{ data: PNG_BODY.toString('base64'), name: 'stone.png' }],
    output: 'dir',
  })
  const { buf } = await builder.archivePack(SRC, r.name, { skipPackPng: true })
  const entries = mcmeta.parseZipCentralDirectory(buf)
  const names = entries.map(e => e.name)
  assert.ok(!names.includes('pack.png'))
  assert.ok(names.includes('pack.mcmeta'))
  assert.ok(names.some(n => n.includes('stone.png')))
})

test('archivePack: noCompress 生成 store 模式', async () => {
  const r = await builder.buildPack({
    name: 'NoCompressTest',
    packFormat: 15,
    files: [{ data: PNG_BODY.toString('base64'), name: 'x.png' }],
    output: 'dir',
  })
  const { buf } = await builder.archivePack(SRC, r.name, { noCompress: true })
  const entries = mcmeta.parseZipCentralDirectory(buf)
  assert.ok(entries.every(e => e.method === 0))
})

test('archivePacks: 批量导出多个包为一个 zip', async () => {
  const r1 = await builder.buildPack({ name: 'BatchA', packFormat: 15, files: [{ data: PNG_BODY.toString('base64'), name: 'a.png' }], output: 'dir' })
  const r2 = await builder.buildPack({ name: 'BatchB', packFormat: 15, files: [{ data: PNG_BODY.toString('base64'), name: 'b.png' }], output: 'dir' })
  const { buf, zipName, count } = await builder.archivePacks(SRC, [r1.name, r2.name])
  assert.equal(zipName, 'mc-packs-export.zip')
  assert.equal(count, 2)
  const entries = mcmeta.parseZipCentralDirectory(buf)
  const names = entries.map(e => e.name)
  assert.ok(names.includes(r1.name + '.zip'))
  assert.ok(names.includes(r2.name + '.zip'))
})

test('archivePacks: 空数组拒绝', async () => {
  await assert.rejects(() => builder.archivePacks(SRC, []), AppError)
})

test('teardown: 恢复 configStore 并清理临时目录', () => {
  configStore.get = origGet
  fs.rmSync(DEST, { recursive: true, force: true })
  fs.rmSync(SRC, { recursive: true, force: true })
})
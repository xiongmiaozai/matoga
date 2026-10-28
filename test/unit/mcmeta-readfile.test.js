/**
 * 资源包元数据服务单测：readPackFile 与命名
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mcmeta-service.test.js 按用例主题拆出；夹具与 TMP 目录每文件自建
 * （node:test 按文件独立进程运行）。断言未改动。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const svc = require('../../server/services/mcmeta-service')
const { AppError } = require('../../server/lib/errors')

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

fs.mkdirSync(path.join(TMP, 'fuzzy-root'), { recursive: true })

test('readPackFile: zip 图片扩展名变体（引用 .png 实为 .jpg）', async () => {
  const root = path.join(TMP, 'fuzzy-root')
  fs.writeFileSync(path.join(root, 'Jpg.zip'), makeZip([
    { name: 'pack.mcmeta', data: MCMETA_121 },
    { name: 'assets/minecraft/textures/block/flower.jpg', data: 'jpg-bytes' },
  ]))
  const r = await svc.readPackFile(root, 'Jpg.zip', 'assets/minecraft/textures/block/flower.png')
  assert.equal(r.buf.toString(), 'jpg-bytes')
  assert.equal(r.mime, 'image/jpeg', 'mime 反映真实图片类型')
})

test('readPackFile: zip 精确条目优先于模糊变体（png 与 jpg 并存取 png）', async () => {
  const root = path.join(TMP, 'fuzzy-root')
  fs.writeFileSync(path.join(root, 'Both.zip'), makeZip([
    { name: 'pack.mcmeta', data: MCMETA_121 },
    { name: 'assets/minecraft/textures/block/stone.png', data: 'png-wins' },
    { name: 'assets/minecraft/textures/block/stone.jpg', data: 'jpg-loses' },
  ]))
  const r = await svc.readPackFile(root, 'Both.zip', 'assets/minecraft/textures/block/stone.png')
  assert.equal(r.buf.toString(), 'png-wins')
})

test('readPackFile: zip mcmeta 扩展名变体（请求 .png.mcmeta 命中 .jpg.mcmeta）', async () => {
  const root = path.join(TMP, 'fuzzy-root')
  fs.writeFileSync(path.join(root, 'Meta.zip'), makeZip([
    { name: 'pack.mcmeta', data: MCMETA_121 },
    { name: 'assets/minecraft/textures/block/flower.jpg.mcmeta', data: '{"animation":{}}' },
  ]))
  const r = await svc.readPackFile(root, 'Meta.zip', 'assets/minecraft/textures/block/flower.png.mcmeta', { anyExt: true })
  assert.equal(r.buf.toString(), '{"animation":{}}')
})

test('readPackFile: zip mcmeta 请求不误命中普通贴图（无变体 mcmeta 时 404）', async () => {
  const root = path.join(TMP, 'fuzzy-root')
  fs.writeFileSync(path.join(root, 'NoMeta.zip'), makeZip([
    { name: 'pack.mcmeta', data: MCMETA_121 },
    { name: 'assets/minecraft/textures/block/flower.jpg', data: 'jpg-bytes' },
    { name: 'assets/minecraft/textures/block/bare.png.mcmeta', data: '{"animation":{}}' },
  ]))
  /* mcmeta 请求不误命中普通贴图 flower.jpg */
  await assert.rejects(
    () => svc.readPackFile(root, 'NoMeta.zip', 'assets/minecraft/textures/block/flower.png.mcmeta', { anyExt: true }),
    e => e.code === 'ERR_FS_NOT_FOUND',
  )
  /* 反向：贴图请求不误命中 .mcmeta 条目（bare 仅有 mcmeta 元数据、无图片本体） */
  await assert.rejects(
    () => svc.readPackFile(root, 'NoMeta.zip', 'assets/minecraft/textures/block/bare.png'),
    e => e.code === 'ERR_FS_NOT_FOUND',
  )
})

test('readPackFile: zip 大小写不敏感嵌套前缀（多层根 + 大小写差异）', async () => {
  const root = path.join(TMP, 'fuzzy-root')
  fs.writeFileSync(path.join(root, 'Nest.zip'), makeZip([
    { name: 'pack.mcmeta', data: MCMETA_121 },
    { name: 'a/pack/assets/minecraft/textures/block/Grass.png', data: 'nest-bytes' },
  ]))
  const r = await svc.readPackFile(root, 'Nest.zip', 'assets/minecraft/textures/block/grass.png')
  assert.equal(r.buf.toString(), 'nest-bytes')
})

test('readPackFile: 目录包大小写 / 图片扩展名变体兜底', async () => {
  const root = path.join(TMP, 'fuzzy-root')
  const pkg = path.join(root, 'DirPack')
  fs.mkdirSync(path.join(pkg, 'assets', 'minecraft', 'textures', 'block'), { recursive: true })
  fs.writeFileSync(path.join(pkg, 'pack.mcmeta'), MCMETA_121)
  fs.writeFileSync(path.join(pkg, 'assets/minecraft/textures/block/Grass.png'), 'grass-bytes')
  fs.writeFileSync(path.join(pkg, 'assets/minecraft/textures/block/dirt.jpg'), 'dirt-bytes')

  const a = await svc.readPackFile(root, 'DirPack', 'assets/minecraft/textures/block/grass.png')
  assert.equal(a.buf.toString(), 'grass-bytes', '大小写不敏感命中')
  assert.equal(a.mime, 'image/png')

  const b = await svc.readPackFile(root, 'DirPack', 'assets/minecraft/textures/block/dirt.png')
  assert.equal(b.buf.toString(), 'dirt-bytes', '扩展名变体命中')
  assert.equal(b.mime, 'image/jpeg', 'mime 按实际文件扩展名')

  /* 目录包 mcmeta 变体：请求 .png.mcmeta 命中 .jpg.mcmeta */
  fs.writeFileSync(path.join(pkg, 'assets/minecraft/textures/block/dirt.jpg.mcmeta'), '{"animation":{}}')
  const c = await svc.readPackFile(root, 'DirPack', 'assets/minecraft/textures/block/dirt.png.mcmeta', { anyExt: true })
  assert.equal(c.buf.toString(), '{"animation":{}}')

  /* 无同名 stem 文件仍 404（不误匹配同目录其他贴图） */
  await assert.rejects(
    () => svc.readPackFile(root, 'DirPack', 'assets/minecraft/textures/block/none.png'),
    e => e.code === 'ERR_FS_NOT_FOUND',
  )
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

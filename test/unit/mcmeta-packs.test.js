/**
 * 资源包元数据服务单测：目录级操作
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

/* ── readPackFile 模糊兜底（模型引用与包内实际条目名大小写 / 扩展名不一致）── */

test('readPackFile: zip 条目名大小写不敏感兜底', async () => {
  const root = path.join(TMP, 'fuzzy-root')
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, 'Case.zip'), makeZip([
    { name: 'pack.mcmeta', data: MCMETA_121 },
    { name: 'assets/minecraft/textures/block/Stone.PNG', data: 'case-bytes' },
  ]))
  const r = await svc.readPackFile(root, 'Case.zip', 'assets/minecraft/textures/block/stone.png')
  assert.equal(r.buf.toString(), 'case-bytes')
  assert.equal(r.mime, 'image/png', 'mime 按实际命中条目扩展名')
})

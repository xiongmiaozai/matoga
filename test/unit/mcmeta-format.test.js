/**
 * 资源包元数据服务单测：格式映射与 mcmeta 解析
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

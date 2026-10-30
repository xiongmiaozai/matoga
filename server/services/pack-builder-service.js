/**
 * matoga - 资源包自动创建服务
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 按 Minecraft 资源包规范自动创建材质包，输出为目录或 .zip 压缩包：
 *  - pack.mcmeta：支持 pack_format（1.21.8 及以前）与 min_format/max_format（1.21.9+）两种写法
 *  - pack.png：调用方可传入；缺失时纯代码绘制 128×128 草方块等轴测图标（零图片依赖）
 *  - 资产文件：磁盘文件按扩展名自动归类到 assets/<ns>/textures|models/，或由调用方指定包内相对路径
 *  - 资产库聚合：接受 craft item 数组，复用 craft-pack-service.resolveEntry 解析包内虚拟路径
 *  - zip 打包为零依赖手写实现（deflate + 中央目录），与 mcmeta-service 的零依赖 zip 解析对称
 */

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { logger } = require('../middleware/logger')
const { AppError } = require('../lib/errors')
const { guardRead } = require('../middleware/validate')
const configStore = require('../config/config-store')
const mcmeta = require('./mcmeta-service')
const craft = require('./craft-pack-service')
const { crc32 } = require('./crc32')
const { BUILD_TEX_EXTS } = require('./img-exts')

const DEFAULT_NAMESPACE = 'minecraft'
const DEFAULT_PACK_FORMAT = 64 /* 1.21.7 – 1.21.8 */
const DEFAULT_NAME = '我的材质包'
const MAX_FILES = 2000
const MAX_FILE_BYTES = 256 * 1024 * 1024

const IMG_EXTS = BUILD_TEX_EXTS
const MODEL_EXTS = new Set(['json', 'bbmodel'])


/* ── 零依赖 zip 打包（deflate + 中央目录）────────── */

function buildZip(entries, opts = {}) {
  const noCompress = !!opts.noCompress
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const data = e.data
    const compressed = noCompress ? data : zlib.deflateRawSync(data)
    const method = !noCompress && compressed.length < data.length ? 8 : 0
    const payload = method === 8 ? compressed : data
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    const localBlock = Buffer.concat([local, nameBuf, payload])
    localParts.push(localBlock)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(Buffer.concat([central, nameBuf]))

    offset += localBlock.length
  }

  const centralBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralBuf, eocd])
}

/* ── 纯代码 PNG 编码（8-bit RGBA）────────────────── */

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const rowLen = width * 4
  const raw = Buffer.alloc((rowLen + 1) * height)
  for (let y = 0; y < height; y++) {
    const o = y * (rowLen + 1)
    raw[o] = 0
    rgba.copy(raw, o + 1, y * rowLen, (y + 1) * rowLen)
  }
  const idat = zlib.deflateSync(raw)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/* 点在凸多边形内（叉积同号） */
function inPoly(px, py, poly) {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const c = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])
    if (c !== 0) {
      const s = c > 0 ? 1 : -1
      if (sign === 0) sign = s
      else if (s !== sign) return false
    }
  }
  return true
}

/* 默认 pack.png：128×128 草方块等轴测图标 */
function defaultPackPng() {
  const W = 128, H = 128
  const rgba = Buffer.alloc(W * H * 4)

  const top = [[64, 12], [112, 44], [64, 76], [16, 44]]
  const left = [[16, 44], [64, 76], [64, 116], [16, 84]]
  const right = [[64, 76], [112, 44], [112, 84], [64, 116]]

  function noise(x, y, amp) {
    return ((x * 7 + y * 13 + (x ^ y) * 3) % (amp * 2 + 1)) - amp
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      let r, g, b
      if (inPoly(x, y, top)) {
        r = 110 + noise(x, y, 18)
        g = 170 + noise(x, y, 22)
        b = 70 + noise(x, y, 16)
      } else if (inPoly(x, y, left)) {
        r = 134 + noise(x, y, 16)
        g = 96 + noise(x, y, 14)
        b = 67 + noise(x, y, 12)
      } else if (inPoly(x, y, right)) {
        r = 100 + noise(x, y, 14)
        g = 72 + noise(x, y, 12)
        b = 50 + noise(x, y, 10)
      } else {
        continue
      }
      rgba[o] = Math.max(0, Math.min(255, r))
      rgba[o + 1] = Math.max(0, Math.min(255, g))
      rgba[o + 2] = Math.max(0, Math.min(255, b))
      rgba[o + 3] = 255
    }
  }
  return encodePng(W, H, rgba)
}

/* ── pack.mcmeta 生成 ─────────────────────────── */

function buildMcmeta(opts) {
  const pack = {}
  const desc = (opts.description && String(opts.description).trim()) || (opts.name + ' · matoga')
  pack.description = desc

  const hasRange = Number.isFinite(+opts.minFormat) && Number.isFinite(+opts.maxFormat)
  if (hasRange) {
    pack.min_format = Math.floor(+opts.minFormat)
    pack.max_format = Math.floor(+opts.maxFormat)
  } else {
    pack.pack_format = Number.isFinite(+opts.packFormat) && +opts.packFormat > 0
      ? Math.floor(+opts.packFormat) : DEFAULT_PACK_FORMAT
  }
  return { pack }
}

/* ── 包内相对路径安全校验与归类 ─────────────────── */

function extOf(name) {
  return (String(name).split('.').pop() || '').toLowerCase()
}

function safeRel(rel) {
  if (typeof rel !== 'string' || !rel) return null
  if (rel.includes('..') || rel.includes('\\') || rel.includes('\0') || rel.startsWith('/')) return null
  return rel
}

function classifyByName(name, namespace) {
  const base = path.basename(name)
  const ext = extOf(base)
  if (IMG_EXTS.has(ext)) return 'assets/' + namespace + '/textures/' + base
  if (MODEL_EXTS.has(ext)) return 'assets/' + namespace + '/models/' + base
  return null
}

function classifyDiskFile(srcPath, namespace) {
  return classifyByName(path.basename(srcPath), namespace)
}

/* ── 资产解析 ─────────────────────────────────── */

async function readDiskFile(p) {
  const abs = guardRead(p)
  const st = await fs.promises.stat(abs).catch(() => null)
  if (!st || !st.isFile() || st.size > MAX_FILE_BYTES) return null
  return fs.promises.readFile(abs)
}

async function resolveFiles(files, namespace) {
  const out = []
  const skipped = []
  if (!Array.isArray(files)) return { out, skipped }
  for (const f of files) {
    try {
      const isObj = typeof f === 'object' && f !== null
      const destHint = isObj && f.dest ? f.dest : null

      /* 内联数据（base64）：前端 file input 直传，无需磁盘路径 */
      if (isObj && f.data != null) {
        let buf
        try { buf = Buffer.from(f.data, 'base64') } catch { skipped.push({ name: f.name, reason: 'bad base64 data' }); continue }
        if (!buf.length || buf.length > MAX_FILE_BYTES) { skipped.push({ name: f.name, reason: 'empty or too large' }); continue }
        let dest = safeRel(destHint)
        if (!dest) dest = classifyByName(f.name || 'file.bin', namespace)
        if (!dest) { skipped.push({ name: f.name, reason: 'unsupported file type' }); continue }
        out.push({ dest, bytes: buf, src: f.name })
        continue
      }

      const src = typeof f === 'string' ? f : (isObj && f.src)
      if (!src || typeof src !== 'string') {
        skipped.push({ src, reason: 'invalid source path' })
        continue
      }
      const buf = await readDiskFile(src)
      if (!buf) {
        skipped.push({ src, reason: 'file missing or too large' })
        continue
      }
      let dest = safeRel(destHint)
      if (!dest) dest = classifyDiskFile(src, namespace)
      if (!dest) {
        skipped.push({ src, reason: 'unsupported file type' })
        continue
      }
      out.push({ dest, bytes: buf, src })
    } catch (e) {
      skipped.push({ src: typeof f === 'string' ? f : f && f.src, reason: e.message })
    }
  }
  return { out, skipped }
}

async function resolveItems(items, cfg) {
  const out = []
  const skipped = []
  if (!Array.isArray(items)) return { out, skipped }
  for (const it of items) {
    try {
      const r = await craft.resolveEntry(it, cfg)
      if (r.skip) {
        skipped.push({ key: it.key, name: it.name, reason: r.skip })
        continue
      }
      out.push({ dest: r.dest, bytes: r.bytes, key: it.key })
    } catch (e) {
      skipped.push({ key: it && it.key, reason: e.message })
    }
  }
  return { out, skipped }
}

/* ── 输出目录名去重 ─────────────────────────────── */

async function exists(p) {
  return fs.promises.access(p).then(() => true, () => false)
}

async function uniqueName(root, name, ext) {
  const suffix = ext || ''
  let candidate = name + suffix
  for (let i = 2; i < 100; i++) {
    if (!(await exists(path.join(root, candidate)))) return candidate
    candidate = name + '-' + i + suffix
  }
  throw new AppError('ERR_FS', 'cannot allocate pack name')
}

/* ── 主函数：buildPack ─────────────────────────── */

async function buildPack(opts = {}) {
  const cfg = configStore.get()
  const root = opts.destRoot && typeof opts.destRoot === 'string' ? opts.destRoot : cfg.mcPacksPath
  if (!root || typeof root !== 'string') throw new AppError('ERR_INVALID_PARAM', 'destRoot not configured')

  let name = (opts.name && String(opts.name).trim()) || DEFAULT_NAME
  if (!mcmeta.validPackName(name)) throw new AppError('ERR_INVALID_PARAM', 'invalid pack name')

  const namespace = (opts.namespace && String(opts.namespace).trim()) || DEFAULT_NAMESPACE
  if (!/^[a-z0-9_-]+$/.test(namespace)) throw new AppError('ERR_INVALID_PARAM', 'invalid namespace (lowercase a-z 0-9 _ -)')

  const output = opts.output === 'zip' ? 'zip' : 'dir'

  const { out: fileEntries, skipped: skipFiles } = await resolveFiles(opts.files, namespace)
  const { out: itemEntries, skipped: skipItems } = await resolveItems(opts.items, cfg)

  const all = [...fileEntries, ...itemEntries]
  if (all.length > MAX_FILES) throw new AppError('ERR_INVALID_PARAM', 'too many files: ' + all.length + ' > ' + MAX_FILES)

  const skipped = [...skipFiles, ...skipItems]
  const usedDest = new Set()
  const entries = []
  for (const e of all) {
    let dest = e.dest
    if (usedDest.has(dest)) {
      const dot = dest.lastIndexOf('.')
      const ext = dot > 0 ? dest.slice(dot) : ''
      const stem = dot > 0 ? dest.slice(0, dot) : dest
      let i = 2
      while (usedDest.has(stem + '-' + i + ext)) i++
      dest = stem + '-' + i + ext
    }
    usedDest.add(dest)
    entries.push({ dest, bytes: e.bytes })
  }

  const mcmetaJson = buildMcmeta({ ...opts, name })
  const mcmetaBytes = Buffer.from(JSON.stringify(mcmetaJson, null, 2), 'utf8')

  let packPngBytes = null
  if (opts.packPngData != null) {
    try { packPngBytes = Buffer.from(opts.packPngData, 'base64') } catch { packPngBytes = null }
  }
  if (!packPngBytes && opts.packPng) {
    if (Buffer.isBuffer(opts.packPng)) {
      packPngBytes = opts.packPng
    } else if (typeof opts.packPng === 'string') {
      packPngBytes = await readDiskFile(opts.packPng).catch(() => null)
    }
  }
  if (!packPngBytes) packPngBytes = defaultPackPng()

  const archive = [
    { name: 'pack.mcmeta', data: mcmetaBytes },
    { name: 'pack.png', data: packPngBytes },
    ...entries.map(e => ({ name: e.dest, data: e.bytes })),
  ]

  const writtenCount = entries.length

  if (output === 'zip') {
    const fileName = await uniqueName(root, name, '.zip')
    const fullPath = path.join(root, fileName)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, buildZip(archive))
    logger.info('pack-builder', `built zip "${fileName}": ${writtenCount} files`)
    return {
      name: fileName,
      file: fullPath,
      output: 'zip',
      packFormat: mcmetaJson.pack.pack_format || null,
      minFormat: mcmetaJson.pack.min_format || null,
      maxFormat: mcmetaJson.pack.max_format || null,
      written: writtenCount,
      skipped: skipped.length,
      skippedList: skipped,
    }
  }

  const dirName = await uniqueName(root, name)
  const packDir = path.join(root, dirName)
  fs.mkdirSync(packDir, { recursive: true })
  fs.writeFileSync(path.join(packDir, 'pack.mcmeta'), mcmetaBytes)
  fs.writeFileSync(path.join(packDir, 'pack.png'), packPngBytes)
  for (const e of entries) {
    const full = path.join(packDir, e.dest)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, e.bytes)
  }
  logger.info('pack-builder', `built dir "${dirName}": ${writtenCount} files`)
  return {
    name: dirName,
    dir: packDir,
    output: 'dir',
    packFormat: mcmetaJson.pack.pack_format || null,
    minFormat: mcmetaJson.pack.min_format || null,
    maxFormat: mcmetaJson.pack.max_format || null,
    written: writtenCount,
    skipped: skipped.length,
    skippedList: skipped,
  }
}

/* ── 导出已有资源包为 zip Buffer ────────────────── */

async function archivePack(root, name, opts = {}) {
  if (!mcmeta.validPackName(name)) throw new AppError('ERR_INVALID_PARAM', 'invalid pack name')
  const full = path.join(root, name)
  const st = await fs.promises.stat(full).catch(() => null)
  if (!st) throw new AppError('ERR_FS_NOT_FOUND', 'pack not found: ' + name)

  const ext = (name.split('.').pop() || '').toLowerCase()
  const baseName = name.replace(/\.[^.]+$/, '')
  const zipOpts = { noCompress: !!opts.noCompress }

  if (st.isFile() && mcmeta.ZIP_EXTS.has(ext)) {
    if (!opts.skipPackPng && !opts.noCompress) {
      return { buf: await fs.promises.readFile(full), zipName: name }
    }
    const buf = await fs.promises.readFile(full)
    const entries = mcmeta.parseZipCentralDirectory(buf)
    const out = []
    for (const e of entries) {
      if (opts.skipPackPng && e.name === 'pack.png') continue
      out.push({ name: e.name, data: mcmeta.readZipEntry(buf, e) })
    }
    return { buf: buildZip(out, zipOpts), zipName: baseName + '.zip' }
  }
  if (!st.isDirectory()) throw new AppError('ERR_INVALID_PARAM', 'not a pack (dir or zip)')

  const resolved = await mcmeta.resolveDirPack(full)
  if (!resolved) throw new AppError('ERR_INVALID_PARAM', 'invalid pack structure')
  const packRoot = resolved.root

  const entries = []
  async function walk(abs, rel) {
    const ents = await fs.promises.readdir(abs, { withFileTypes: true })
    for (const e of ents) {
      if (e.name.startsWith('.')) continue
      const r = rel ? rel + '/' + e.name : e.name
      if (e.isDirectory()) await walk(path.join(abs, e.name), r)
      else {
        if (opts.skipPackPng && r === 'pack.png') continue
        entries.push({ name: r, data: await fs.promises.readFile(path.join(abs, e.name)) })
      }
    }
  }
  await walk(packRoot, '')

  logger.info('pack-builder', `archived "${name}" → ${entries.length} entries`)
  return { buf: buildZip(entries, zipOpts), zipName: baseName + '.zip' }
}

async function archivePacks(root, names, opts = {}) {
  if (!Array.isArray(names) || !names.length) throw new AppError('ERR_INVALID_PARAM', 'no packs selected')
  const entries = []
  for (const name of names) {
    const { buf, zipName } = await archivePack(root, name, opts)
    entries.push({ name: zipName, data: buf })
  }
  logger.info('pack-builder', `batch archived ${entries.length} packs`)
  return { buf: buildZip(entries), zipName: 'mc-packs-export.zip', count: entries.length }
}

/* ── pack_format 列表（复用 mcmeta 映射表）──────── */

function listFormats() {
  return mcmeta.PACK_FORMAT_VERSIONS.map(e => ({ format: e.format, versions: e.versions }))
}

module.exports = {
  buildPack,
  buildMcmeta,
  buildZip,
  defaultPackPng,
  encodePng,
  listFormats,
  archivePack,
  archivePacks,
  crc32,
  DEFAULT_NAMESPACE,
  DEFAULT_PACK_FORMAT,
  DEFAULT_NAME,
}
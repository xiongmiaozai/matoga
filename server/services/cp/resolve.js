/**
 * matoga - 制作包服务：资产解析
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 craft-pack-service.js 按职责搬出，逻辑未改。
 */
const { extOf, safePackRel, uniqueDest } = require('./fs-utils')

const path = require('path')
const { MAX_FILE_BYTES, IMG_EXTS, MODEL_EXTS, HDRI_EXTS } = require('./consts')

const fs = require('fs')
const { guardRead } = require('../../middleware/validate')
const mcmeta = require('../mcmeta-service')

/* ── 资产解析：item → 目标相对路径 + 字节 ────────── */

function parsePackRef(p, prefix) {
  if (typeof p !== 'string' || !p.startsWith(prefix)) return null
  const rest = p.slice(prefix.length)
  const ci = rest.indexOf(':')
  if (ci <= 0) return null
  const source = rest.slice(0, ci)
  const remain = rest.slice(ci + 1)
  const si = remain.indexOf('/')
  if (si <= 0) return null
  return { source, packName: remain.slice(0, si), rel: remain.slice(si + 1) }
}


function rootForSource(source, cfg) {
  if (source === 'mc') return cfg.mcPacksPath
  if (source === 'official') return cfg.officialPacksPath
  if (source === 'craft') return cfg.craftPacksPath
  return null
}


async function readDiskFile(p, allowedExts) {
  const abs = guardRead(p)
  if (!allowedExts.has(extOf(abs))) return null
  const st = await fs.promises.stat(abs).catch(() => null)
  if (!st || !st.isFile() || st.size > MAX_FILE_BYTES) return null
  return fs.promises.readFile(abs)
}


async function resolveEntry(item, cfg) {
  const p = item.path
  try {
    /* 贴图：包内虚拟路径（pack:mc:<包>/<rel> / pack:official:<包>/<rel>）→ 保留原包内结构 */
    const pt = parsePackRef(p, 'pack:')
    if (item.type === 'tex' && pt) {
      const root = rootForSource(pt.source, cfg)
      const rel = safePackRel(pt.rel)
      if (!root || !rel) return { skip: 'invalid pack path' }
      const { buf } = await mcmeta.readPackFile(root, pt.packName, pt.rel)
      return { dest: rel, bytes: buf }
    }
    /* 模型：包内虚拟路径（packmodel:…）→ 保留原包内结构 */
    const pm = parsePackRef(p, 'packmodel:')
    if (item.type === 'model' && pm) {
      const root = rootForSource(pm.source, cfg)
      const rel = safePackRel(pm.rel)
      if (!root || !rel) return { skip: 'invalid pack path' }
      const { buf } = await mcmeta.readPackFile(root, pm.packName, pm.rel, { anyExt: true })
      return { dest: rel, bytes: buf }
    }

    /* 贴图：磁盘绝对路径 → assets/matoga/textures/<文件名> */
    if (item.type === 'tex' && typeof p === 'string' && path.isAbsolute(p)) {
      const buf = await readDiskFile(p, IMG_EXTS)
      if (!buf) return { skip: 'texture file missing or unsupported' }
      return { dest: 'assets/matoga/textures/' + path.basename(p), bytes: buf }
    }
    /* 模型：磁盘 .json → assets/matoga/models/<文件名> */
    if (item.type === 'model' && typeof p === 'string' && path.isAbsolute(p)) {
      const buf = await readDiskFile(p, MODEL_EXTS)
      if (!buf) return { skip: 'model file missing or unsupported' }
      const rel = safePackRel(normalizeAssetsRel(p))
      return { dest: rel || ('assets/matoga/models/' + path.basename(p)), bytes: buf }
    }
    /* HDRI：磁盘路径 → hdri/<文件名>（MC 忽略该目录，仅作储存） */
    if (item.type === 'hdri' && typeof p === 'string' && path.isAbsolute(p)) {
      const buf = await readDiskFile(p, HDRI_EXTS)
      if (!buf) return { skip: 'hdri file missing or unsupported' }
      return { dest: 'hdri/' + path.basename(p), bytes: buf }
    }
  } catch (e) {
    return { skip: e.message || 'resolve failed' }
  }
  /* 整包媒体（mc/official）与虚拟资产（preset/project）无法以文件形式导出 */
  return { skip: 'virtual or pack-media asset' }
}

/* 磁盘模型路径若含 assets/<ns>/models/ 结构则保留，否则归入 matoga 命名空间 */


/* 磁盘模型路径若含 assets/<ns>/models/ 结构则保留，否则归入 matoga 命名空间 */
function normalizeAssetsRel(abs) {
  const m = /[\\/]?(assets[\\/][^\\/]+[\\/]models[\\/].+)$/.exec(String(abs))
  return m ? m[1].replace(/\\/g, '/') : null
}

/* ── 定位路径解析：条目 → 可在文件管理器中打开的磁盘绝对路径 ──
 * locatePath 仅用于 API 响应，不写入 selection.json：
 *  1. craftPath 指向制作包内副本且文件仍在 → craftPath（uniqueDest 改名 / 手动整理后会失效）
 *  2. 失效则回退源路径：磁盘绝对路径原样返回；包内虚拟路径（pack:/packmodel:）拼出真实文件路径
 *  3. 虚拟资产（preset/project 等）无法定位 → null
 */


/* ── 定位路径解析：条目 → 可在文件管理器中打开的磁盘绝对路径 ──
 * locatePath 仅用于 API 响应，不写入 selection.json：
 *  1. craftPath 指向制作包内副本且文件仍在 → craftPath（uniqueDest 改名 / 手动整理后会失效）
 *  2. 失效则回退源路径：磁盘绝对路径原样返回；包内虚拟路径（pack:/packmodel:）拼出真实文件路径
 *  3. 虚拟资产（preset/project 等）无法定位 → null
 */
function locateItem(item, cfg) {
  if (!item || typeof item !== 'object') return null
  if (typeof item.craftPath === 'string' && item.craftPath && fs.existsSync(item.craftPath)) return item.craftPath
  const p = item.path
  if (typeof p !== 'string' || !p) return null
  if (path.isAbsolute(p)) return p
  for (const prefix of ['pack:', 'packmodel:']) {
    if (!p.startsWith(prefix)) continue
    const ref = parsePackRef(p, prefix)
    if (!ref) continue
    const root = rootForSource(ref.source, cfg)
    if (!root) continue
    return path.join(root, ref.packName, ref.rel)
  }
  return null
}

/* ── 存入制作包：单个资产或整包直接复制到当前制作包项目目录（持续累积） ── */

module.exports = { parsePackRef, rootForSource, readDiskFile, resolveEntry, normalizeAssetsRel, locateItem }

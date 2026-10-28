/**
 * matoga - 制作包服务：制作包导出与复制
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 craft-pack-service.js 按职责搬出，逻辑未改。
 */
const path = require('path')
const { MARKER_FILE, MARKER_FORMAT, MARKER_VERSION, MAX_EXPORT_ITEMS, DEFAULT_NAME, DEFAULT_PACK_FORMAT } = require('./consts')

const fs = require('fs')
const { logger } = require('../../middleware/logger')
const { AppError } = require('../../lib/errors')
const configStore = require('../../config/config-store')
const mcmeta = require('../mcmeta-service')
const { stamp, uniqueDest, uniquePackName } = require('./fs-utils')
const { resolveEntry } = require('./resolve')
const { sanitizeItem, sanitizeList, addItem, aggregateStorage } = require('./selection')

/* ── 存入制作包：单个资产或整包直接复制到当前制作包项目目录（持续累积） ── */

function ensureCraftPackDir(cfg) {
  const root = cfg.craftPacksPath
  if (!root || typeof root !== 'string') throw new AppError('ERR_INVALID_PARAM', 'craftPacksPath not configured')
  const packDir = path.join(root, DEFAULT_NAME)
  fs.mkdirSync(packDir, { recursive: true })
  const mcmetaPath = path.join(packDir, 'pack.mcmeta')
  if (!fs.existsSync(mcmetaPath)) {
    fs.writeFileSync(mcmetaPath, JSON.stringify({
      pack: { pack_format: DEFAULT_PACK_FORMAT, description: DEFAULT_NAME + ' · matoga' },
    }, null, 2))
  }
  return packDir
}


/* 整包（mc/official）：合并复制包内 assets/ 到制作包 assets/（同名加序号不覆盖） */
async function copyWholePack(s, cfg, packDir) {
  const srcDir = s.path
  if (!srcDir || !path.isAbsolute(srcDir)) throw new AppError('ERR_INVALID_PARAM', 'invalid pack path')
  const st = await fs.promises.stat(srcDir).catch(() => null)
  if (!st || !st.isDirectory()) throw new AppError('ERR_INVALID_PARAM', 'pack is not a directory (zip not supported): ' + srcDir)

  const srcAssets = path.join(srcDir, 'assets')
  const hasAssets = await fs.promises.access(srcAssets).then(() => true, () => false)
  if (!hasAssets) throw new AppError('ERR_INVALID_PARAM', 'pack has no assets/ directory: ' + srcDir)

  const files = []
  async function walk(dir, relBase) {
    const ents = await fs.promises.readdir(dir, { withFileTypes: true })
    for (const e of ents) {
      if (e.name.startsWith('.')) continue
      const rel = relBase ? relBase + '/' + e.name : e.name
      if (e.isDirectory()) await walk(path.join(dir, e.name), rel)
      else if (e.isFile()) files.push(rel)
    }
  }
  await walk(srcAssets, '')
  if (!files.length) throw new AppError('ERR_INVALID_PARAM', 'pack assets/ is empty: ' + srcDir)

  let copied = 0
  for (const rel of files) {
    const dest = uniqueDest(packDir, 'assets/' + rel)
    const full = path.join(packDir, dest)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.copyFileSync(path.join(srcAssets, rel), full)
    copied++
  }

  await addItem(s)
  logger.info('craft', `copied whole pack "${s.name}" → ${DEFAULT_NAME}/ (${copied} files)`)
  return { name: DEFAULT_NAME, dir: packDir, written: copied, wholePack: true }
}


async function copyToCraftPack(item) {
  const cfg = configStore.get()
  const s = sanitizeItem(item)
  if (!s) throw new AppError('ERR_INVALID_PARAM', 'invalid craft item')

  const packDir = ensureCraftPackDir(cfg)

  /* 整包（mc/official）：合并复制包内 assets/ 到制作包 */
  if (s.type === 'mc' || s.type === 'official') {
    return copyWholePack(s, cfg, packDir)
  }

  /* 单文件资产：解析源 → 原样复制 */
  const r = await resolveEntry(s, cfg)
  if (r.skip) throw new AppError('ERR_INVALID_PARAM', 'cannot copy asset: ' + r.skip)

  const dest = uniqueDest(packDir, r.dest)
  const full = path.join(packDir, dest)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, r.bytes)

  s.craftPath = full
  await addItem(s)
  logger.info('craft', `copied "${s.name}" → ${DEFAULT_NAME}/${dest}`)
  return { name: DEFAULT_NAME, dir: packDir, dest, written: 1 }
}

/* ── 导出：聚合全部储存 → craftPacksPath 下的真实 MC 资源包 ── */


async function exportPack(opts = {}) {
  const cfg = configStore.get()
  const root = cfg.craftPacksPath
  if (!root || typeof root !== 'string') throw new AppError('ERR_INVALID_PARAM', 'craftPacksPath not configured')

  let name = (opts.name && String(opts.name).trim()) || DEFAULT_NAME
  if (!mcmeta.validPackName(name)) throw new AppError('ERR_INVALID_PARAM', 'invalid pack name')
  if (name === DEFAULT_NAME) name = DEFAULT_NAME + '-' + stamp()

  const packFormat = Number.isFinite(+opts.packFormat) && +opts.packFormat > 0
    ? Math.floor(+opts.packFormat) : DEFAULT_PACK_FORMAT
  const description = (opts.description && String(opts.description).trim()) || (name + ' · matoga')

  const aggregate = opts.items
    ? { items: sanitizeList(opts.items, MAX_EXPORT_ITEMS), totals: { custom: true } }
    : aggregateStorage()
  const items = aggregate.items
  if (!items.length) throw new AppError('ERR_INVALID_PARAM', 'no stored assets to export')

  const dirName = await uniquePackName(root, name)
  const packDir = path.join(root, dirName)
  fs.mkdirSync(packDir, { recursive: true })

  const written = []
  const skipped = []
  const usedDest = new Set()

  for (const it of items) {
    const r = await resolveEntry(it, cfg)
    if (r.skip) {
      skipped.push({ key: it.key, name: it.name, type: it.type, reason: r.skip })
      continue
    }
    let dest = r.dest
    if (usedDest.has(dest)) {
      const dot = dest.lastIndexOf('.')
      const ext = dot > 0 ? dest.slice(dot) : ''
      const stem = dot > 0 ? dest.slice(0, dot) : dest
      let i = 2
      while (usedDest.has(stem + '-' + i + ext)) i++
      dest = stem + '-' + i + ext
    }
    usedDest.add(dest)
    const full = path.join(packDir, dest)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, r.bytes)
    written.push({ key: it.key, name: it.name, type: it.type, dest })
  }

  fs.writeFileSync(path.join(packDir, 'pack.mcmeta'), JSON.stringify({
    pack: { pack_format: packFormat, description },
  }, null, 2))

  const marker = {
    format: MARKER_FORMAT,
    version: MARKER_VERSION,
    exportedAt: Date.now(),
    name: dirName,
    packFormat,
    totals: aggregate.totals,
    written,
    skipped,
  }
  fs.writeFileSync(path.join(packDir, MARKER_FILE), JSON.stringify(marker, null, 2))

  logger.info('craft', `exported pack "${dirName}": ${written.length} written, ${skipped.length} skipped`)
  return {
    name: dirName,
    dir: packDir,
    packFormat,
    written: written.length,
    skipped: skipped.length,
    skippedList: skipped,
    totals: aggregate.totals,
  }
}

/* ── 已导出制作包识别（craftPacksPath 下含 matoga-craft.json 的包；兼容 mcPacksPath） ── */


/* ── 已导出制作包识别（craftPacksPath 下含 matoga-craft.json 的包；兼容 mcPacksPath） ── */

async function scanCraftRoot(root) {
  if (!root || typeof root !== 'string') return []
  let names
  try { names = await fs.promises.readdir(root, { withFileTypes: true }) } catch { return [] }
  const packs = []
  for (const d of names) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue
    const markerPath = path.join(root, d.name, MARKER_FILE)
    let raw
    try { raw = JSON.parse(await fs.promises.readFile(markerPath, 'utf8')) } catch { continue }
    if (!raw || raw.format !== MARKER_FORMAT) continue
    packs.push({
      name: raw.name || d.name,
      dir: path.join(root, d.name),
      exportedAt: raw.exportedAt || 0,
      packFormat: raw.packFormat || null,
      written: Array.isArray(raw.written) ? raw.written.length : 0,
      skipped: Array.isArray(raw.skipped) ? raw.skipped.length : 0,
      totals: raw.totals || null,
    })
  }
  return packs
}


async function listCraftPacks() {
  const cfg = configStore.get()
  /* 主目录 craftPacksPath；兼容 mcPacksPath 下早期导出的制作包（按 dir 去重） */
  const seen = new Set()
  const packs = []
  for (const root of [cfg.craftPacksPath, cfg.mcPacksPath]) {
    for (const p of await scanCraftRoot(root)) {
      if (seen.has(p.dir)) continue
      seen.add(p.dir)
      packs.push(p)
    }
  }
  packs.sort((a, b) => b.exportedAt - a.exportedAt)
  return { packs }
}

/* ── 当前制作包项目（craft-packs/我的制作包/，持续累积，非导出） ── */

async function getCurrentCraftPack() {
  const cfg = configStore.get()
  const root = cfg.craftPacksPath
  if (!root || typeof root !== 'string') return { pack: null }
  const packDir = path.join(root, DEFAULT_NAME)
  const exists = await fs.promises.access(packDir).then(() => true, () => false)
  if (!exists) return { pack: null }

  let fileCount = 0
  async function walk(dir) {
    const ents = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (!ents) return
    for (const e of ents) {
      if (e.name.startsWith('.')) continue
      if (e.isDirectory()) await walk(path.join(dir, e.name))
      else if (e.isFile()) fileCount++
    }
  }
  const assetsDir = path.join(packDir, 'assets')
  if (await fs.promises.access(assetsDir).then(() => true, () => false)) await walk(assetsDir)

  let packFormat = null
  try {
    const meta = JSON.parse(await fs.promises.readFile(path.join(packDir, 'pack.mcmeta'), 'utf8'))
    packFormat = meta && meta.pack && meta.pack.pack_format != null ? meta.pack.pack_format : null
  } catch {}

  return { pack: { name: DEFAULT_NAME, dir: packDir, packFormat, fileCount } }
}

module.exports = { ensureCraftPackDir, copyWholePack, copyToCraftPack, exportPack, scanCraftRoot, listCraftPacks, getCurrentCraftPack }

/**
 * matoga - 制作包服务（总资产库 · 我的开发包）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 「制作包」= 用户所有储存（自选清单 + 收藏夹 + 最近使用）的聚合，即用户开发中的资源包：
 *  - 自选清单持久化到 data/craft-pack/selection.json（原子写入 + 串行队列，与 asset-store 一致）
 *  - exportPack() 将全部储存聚合导出为 craftPacksPath 下的真实 MC 资源包（与 mc-packs 平级的独立目录）：
 *      pack.mcmeta（pack_format + description）
 *      assets/<ns>/textures/**（贴图：包内虚拟路径保留原结构，磁盘文件入 assets/matoga/textures/）
 *      assets/<ns>/models/**（模型：包内 .json 保留原结构）
 *      hdri/**（HDRI 环境贴图：MC 会忽略该目录，仅作储存）
 *    整包媒体（mc/official）与虚拟资产（preset/project）无法落盘，跳过并说明原因。
 *  - 导出包写入 matoga-craft.json 标记（导出时间 + 条目清单），listCraftPacks() 据此识别；
 *    优先扫描 craftPacksPath，兼容扫描 mcPacksPath 下早期导出的制作包（按目录去重）。
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { logger } = require('../middleware/logger')
const { DATA_ROOT } = require('../paths')
const { AppError } = require('../../shared/errors')
const { guardRead } = require('../middleware/validate')
const configStore = require('../config/config-store')
const assetStore = require('../config/asset-store')
const mcmeta = require('./mcmeta-service')


const DIR = path.join(DATA_ROOT, 'data', 'craft-pack')
const SELECTION_FILE = path.join(DIR, 'selection.json')
const MARKER_FILE = 'matoga-craft.json'
const MARKER_FORMAT = 'matoga-craft-pack'
const MARKER_VERSION = 1
const MAX_ITEMS = 500
const MAX_EXPORT_ITEMS = 2000
const MAX_FILE_BYTES = 256 * 1024 * 1024

const IMG_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tga', 'tif', 'tiff'])
const MODEL_EXTS = new Set(['json', 'bbmodel'])
const HDRI_EXTS = new Set(['hdr', 'exr'])
const DEFAULT_NAME = '我的制作包'
const DEFAULT_PACK_FORMAT = 64 /* 1.21.7 – 1.21.8 */

let writeQueue = Promise.resolve()

/* ── 自选清单持久化 ─────────────────────────────── */

function readRaw(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    if (e.code !== 'ENOENT') logger.warn('craft', 'bad ' + path.basename(file) + ': ' + e.message)
    return {}
  }
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + crypto.randomUUID() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

function sanitizeItem(item) {
  if (!item || typeof item !== 'object') return null
  if (typeof item.key !== 'string' || !item.key) return null
  const detected = assetStore.detectType(item.key)
  if (!detected) return null
  if (item.type && !assetStore.VALID_TYPES.has(item.type)) return null
  const type = item.type || detected
  if (type !== detected) return null
  return {
    key: item.key,
    name: typeof item.name === 'string' ? item.name : '',
    thumb: typeof item.thumb === 'string' ? item.thumb : null,
    type,
    path: typeof item.path === 'string' ? item.path : null,
    craftPath: typeof item.craftPath === 'string' ? item.craftPath : undefined,
    mtime: typeof item.mtime === 'number' ? item.mtime : 0,
    role: typeof item.role === 'string' ? item.role : undefined,
    color: typeof item.color === 'string' ? item.color : undefined,
    badge: typeof item.badge === 'string' ? item.badge : undefined,
  }
}

function sanitizeList(arr, max) {
  if (!Array.isArray(arr)) return []
  const seen = new Set()
  const out = []
  for (const it of arr) {
    const s = sanitizeItem(it)
    if (!s || seen.has(s.key)) continue
    seen.add(s.key)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

function getSelection() {
  return sanitizeList(readRaw(SELECTION_FILE).items, MAX_ITEMS)
}

function setSelection(items) {
  const clean = sanitizeList(items, MAX_ITEMS)
  writeQueue = writeQueue.then(() => {
    try { atomicWrite(SELECTION_FILE, { items: clean }) }
    catch (e) { logger.error('craft', 'setSelection failed: ' + e.message) }
  })
  return writeQueue.then(() => clean)
}

function addItem(item) {
  const cur = getSelection()
  const s = sanitizeItem(item)
  if (!s) throw new AppError('ERR_INVALID_PARAM', 'invalid craft item')
  const exists = cur.some(it => it.key === s.key)
  if (exists) return { added: false, count: cur.length }
  if (cur.length >= MAX_ITEMS) throw new AppError('ERR_INVALID_PARAM', 'craft pack full: ' + MAX_ITEMS)
  cur.push(s)
  return setSelection(cur).then(list => ({ added: true, count: list.length }))
}

function removeItem(key) {
  const cur = getSelection()
  const next = cur.filter(it => it.key !== key)
  if (next.length === cur.length) return Promise.resolve({ removed: false, count: cur.length })
  return setSelection(next).then(list => ({ removed: true, count: list.length }))
}

function clearSelection() {
  return setSelection([]).then(list => ({ cleared: true, count: list.length }))
}

/* ── 储存聚合：自选 + 收藏 + 最近（key 去重，前者优先） ── */

function aggregateStorage() {
  const sel = getSelection()
  const fav = assetStore.getFavorites()
  const rec = assetStore.getRecent()
  const seen = new Set()
  const out = []
  for (const it of [...sel, ...fav, ...rec]) {
    if (seen.has(it.key)) continue
    seen.add(it.key)
    out.push(it)
  }
  return {
    items: out.slice(0, MAX_EXPORT_ITEMS),
    totals: { selection: sel.length, favorites: fav.length, recent: rec.length, aggregate: out.length },
  }
}

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

function extOf(name) {
  return (String(name).split('.').pop() || '').toLowerCase()
}

/* 包内 rel 必须形如 assets/<ns>/textures|models/… 且无穿越 */
function safePackRel(rel) {
  if (typeof rel !== 'string') return null
  if (!/^assets\/[^/]+\/(textures|models)\/[^/].*$/.test(rel)) return null
  if (rel.includes('..') || rel.includes('\\') || rel.includes('\0')) return null
  return rel
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

function uniqueDest(packDir, dest) {
  if (!fs.existsSync(path.join(packDir, dest))) return dest
  const dot = dest.lastIndexOf('.')
  const ext = dot > 0 ? dest.slice(dot) : ''
  const stem = dot > 0 ? dest.slice(0, dot) : dest
  let i = 2
  while (fs.existsSync(path.join(packDir, stem + '-' + i + ext))) i++
  return stem + '-' + i + ext
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

async function exists(p) {
  return fs.promises.access(p).then(() => true, () => false)
}

async function uniquePackName(root, name) {
  let candidate = name
  for (let i = 2; i < 100; i++) {
    if (!(await exists(path.join(root, candidate)))) return candidate
    candidate = name + '-' + i
  }
  throw new AppError('ERR_FS', 'cannot allocate pack dir name')
}

/* 导出快照名与当前制作项目目录（DEFAULT_NAME）同名会互相覆盖混淆，自动追加时间戳区分 */
function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
}

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

module.exports = {
  DIR, SELECTION_FILE, MARKER_FILE, MAX_ITEMS, DEFAULT_NAME, DEFAULT_PACK_FORMAT,
  getSelection, setSelection, addItem, removeItem, clearSelection,
  aggregateStorage, copyToCraftPack, exportPack, listCraftPacks, getCurrentCraftPack, resolveEntry, locateItem,
}
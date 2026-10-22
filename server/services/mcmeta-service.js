/**
 * matoga - MC 官方材质包分析服务
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 扫描「官方材质包」目录（config.officialPacksPath），对每个包（文件夹或 .zip/.mcpack）
 * 解析 pack.mcmeta，提取 pack_format 与描述，并通过内置映射表还原对应的 MC 版本范围，
 * 为后续开发（版本对比 / 贴图迁移）与重命名提供数据支撑。
 * 缺 pack.mcmeta 时回退 version.json（原版 / Fabric 客户端 jar 解包布局）还原版本号。
 * zip 解析为零依赖的最小实现（central directory 遍历 + raw inflate），仅提取 pack.mcmeta。
 */

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { AppError } = require('../../shared/errors')

const ZIP_EXTS = new Set(['zip', 'mcpack', 'resourcepack'])
const MCMETA_NAME = 'pack.mcmeta'
const VERSION_JSON_NAME = 'version.json'
const ASSETS_PREFIX = 'assets/'

/* 包内贴图：assets/<ns>/textures/** 下的图片文件 */
const IMG_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i
const TEX_DIR_RE = /^assets\/[^/]+\/textures\//
const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', avif: 'image/avif',
}
const MAX_TEX_WALK = 20000
const MAX_TEX_RETURN = 200

// pack_format -> Minecraft 版本范围（资源包格式，Java 版）
const PACK_FORMAT_VERSIONS = [
  { format: 1,  versions: '1.6.1 – 1.8.9' },
  { format: 2,  versions: '1.9 – 1.10.2' },
  { format: 3,  versions: '1.11 – 1.12.2' },
  { format: 4,  versions: '1.13 – 1.14.4' },
  { format: 5,  versions: '1.15 – 1.16.1' },
  { format: 6,  versions: '1.16.2 – 1.16.5' },
  { format: 7,  versions: '1.17 – 1.17.1' },
  { format: 8,  versions: '1.18 – 1.18.2' },
  { format: 9,  versions: '1.19 – 1.19.2' },
  { format: 12, versions: '1.19.3' },
  { format: 13, versions: '1.19.4' },
  { format: 15, versions: '1.20 – 1.20.1' },
  { format: 18, versions: '1.20.2' },
  { format: 22, versions: '1.20.3 – 1.20.4' },
  { format: 32, versions: '1.20.5 – 1.20.6' },
  { format: 34, versions: '1.21 – 1.21.1' },
  { format: 42, versions: '1.21.2 – 1.21.3' },
  { format: 46, versions: '1.21.4' },
  { format: 55, versions: '1.21.5' },
  { format: 63, versions: '1.21.6' },
  { format: 64, versions: '1.21.7 – 1.21.8' },
]

const FORMAT_INDEX = new Map(PACK_FORMAT_VERSIONS.map(e => [e.format, e.versions]))

function formatToVersions(format) {
  if (!Number.isFinite(format)) return ''
  return FORMAT_INDEX.get(format) || ''
}

/* ── 最小 zip 解析（仅读取 central directory 与指定条目）──── */

function parseZipCentralDirectory(buf) {
  let eocd = -1
  const minPos = Math.max(0, buf.length - 22 - 65536)
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new AppError('ERR_MC_NOT_ZIP', 'zip EOCD not found')
  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || cdOffset === 0xffffffff) {
    throw new AppError('ERR_MC_NOT_ZIP', 'zip64 archives are not supported')
  }
  const entries = []
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const usize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (!name.endsWith('/')) entries.push({ name, method, csize, usize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function readZipEntry(buf, entry) {
  const p = entry.localOffset
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) {
    throw new AppError('ERR_MC_NOT_ZIP', 'bad zip local header')
  }
  const nameLen = buf.readUInt16LE(p + 26)
  const extraLen = buf.readUInt16LE(p + 28)
  const dataStart = p + 30 + nameLen + extraLen
  const raw = buf.subarray(dataStart, dataStart + entry.csize)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) return zlib.inflateRawSync(raw)
  throw new AppError('ERR_MC_NOT_ZIP', 'unsupported zip compression method: ' + entry.method)
}

function pickMcmetaEntry(entries) {
  const exact = entries.find(e => e.name === MCMETA_NAME)
  if (exact) return exact
  const nested = entries
    .filter(e => e.name.endsWith('/' + MCMETA_NAME))
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length)
  return nested[0] || null
}

/* 按归一化路径查 zip 条目：精确 → assets 嵌套归一 → 任意层嵌套根前缀（pack.png 等） */
function findZipEntry(entries, rel) {
  const exact = entries.find(e => e.name === rel)
  if (exact) return exact
  const norm = entries.find(e => normalizeZipTexName(e.name) === rel)
  if (norm) return norm
  const nested = entries
    .filter(e => e.name.endsWith('/' + rel))
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length)
  return nested[0] || null
}

function collectNamespaces(entries) {
  const ns = new Set()
  for (const e of entries) {
    if (!e.name.startsWith(ASSETS_PREFIX)) continue
    const rest = e.name.slice(ASSETS_PREFIX.length)
    if (!rest || rest.startsWith('/')) continue
    const first = rest.split('/')[0]
    if (first) ns.add(first)
  }
  return [...ns]
}

/* zip 条目名 → 归一化贴图路径：容忍包内容套一层根文件夹（<root>/assets/...） */
function normalizeZipTexName(name) {
  if (TEX_DIR_RE.test(name)) return name
  const m = /^[^/]+\/(assets\/[^/]+\/textures\/.+)$/.exec(name)
  return m ? m[1] : null
}

function mimeOf(name) {
  const ext = (name.split('.').pop() || '').toLowerCase()
  return MIME_BY_EXT[ext] || 'application/octet-stream'
}

/* ── pack.mcmeta 解析 ─────────────────────────── */

function plainDescription(desc) {
  if (typeof desc === 'string') return desc.replace(/§./g, '').trim()
  if (desc && typeof desc === 'object') {
    const s = typeof desc.text === 'string' ? desc.text
      : typeof desc.translate === 'string' ? desc.translate : ''
    return s.replace(/§./g, '').trim()
  }
  return ''
}

function parseMcmetaText(text) {
  let raw
  try { raw = JSON.parse(text) } catch {
    throw new AppError('ERR_MC_BAD_MCMETA', 'pack.mcmeta is not valid JSON')
  }
  const pack = raw && raw.pack
  if (!pack || typeof pack !== 'object') {
    throw new AppError('ERR_MC_BAD_MCMETA', 'pack.mcmeta missing "pack" field')
  }
  const out = {
    format: Number.isFinite(pack.pack_format) ? pack.pack_format : null,
    minFormat: null,
    maxFormat: null,
    description: plainDescription(pack.description),
  }
  const sup = pack.supported_formats
  if (sup && typeof sup === 'object' && !Array.isArray(sup)) {
    if (Number.isFinite(sup.min_format_inclusive)) out.minFormat = sup.min_format_inclusive
    if (Number.isFinite(sup.max_format_inclusive)) out.maxFormat = sup.max_format_inclusive
  } else if (Array.isArray(sup) && sup.length >= 2) {
    if (Number.isFinite(sup[0])) out.minFormat = sup[0]
    if (Number.isFinite(sup[1])) out.maxFormat = sup[1]
  }
  return out
}

/* ── version.json 解析（jar 解包布局的版本回退）──── */

/* 原版 / Fabric 客户端 jar 根部带 version.json：取 id（版本号）与 pack_version.resource（资源包格式 major.minor） */
function parseVersionJson(text) {
  let raw
  try { raw = JSON.parse(text) } catch { return null }
  if (!raw || typeof raw !== 'object') return null
  const pv = raw.pack_version && typeof raw.pack_version === 'object' ? raw.pack_version : {}
  const major = Number.isFinite(pv.resource_major) ? pv.resource_major : null
  const minor = Number.isFinite(pv.resource_minor) ? pv.resource_minor : 0
  const id = typeof raw.id === 'string' && raw.id ? raw.id : (typeof raw.name === 'string' ? raw.name : '')
  return {
    format: major,
    formatLabel: major != null ? (minor ? major + '.' + minor : String(major)) : null,
    versionRange: id,
  }
}

async function tryReadVersionJson(root) {
  try {
    return parseVersionJson(await fs.promises.readFile(path.join(root, VERSION_JSON_NAME), 'utf8'))
  } catch { return null }
}

/* ── 单个包分析 ──────────────────────────────── */


/* 定位目录包的包根：pack.mcmeta 所在目录；无 mcmeta 时回退到含 assets/ 的目录（如 Fabric jar 解压布局）。
   返回 { root, text|null, namespaces, versionInfo|null }；text=null 表示缺 mcmeta（可回退 version.json 分析版本，贴图仍可枚举）。 */
async function resolveDirPack(dir) {
  const tryRead = async (base) => {
    let text = null
    try { text = await fs.promises.readFile(path.join(base, MCMETA_NAME), 'utf8') } catch {}
    return text
  }
  const direct = await tryRead(dir)
  if (direct !== null) return { root: dir, text: direct, namespaces: await readDirNamespaces(dir) }
  const names = (await fs.promises.readdir(dir, { withFileTypes: true }))
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
  if (names.length === 1) {
    const sub = path.join(dir, names[0].name)
    const subText = await tryRead(sub)
    if (subText !== null) return { root: sub, text: subText, namespaces: await readDirNamespaces(sub) }
    // 唯一子目录含 assets（无 mcmeta）：以子目录为包根
    try {
      await fs.promises.access(path.join(sub, 'assets'))
      return { root: sub, text: null, namespaces: await readDirNamespaces(sub), versionInfo: await tryReadVersionJson(sub) }
    } catch {}
  }
  try {
    await fs.promises.access(path.join(dir, 'assets'))
    return { root: dir, text: null, namespaces: await readDirNamespaces(dir), versionInfo: await tryReadVersionJson(dir) }
  } catch {}
  return null
}

/* 递归收集包内贴图（相对包根的 assets/... 路径，带上限防大包卡死） */
async function walkDirTextures(packRoot) {
  const found = []
  async function walk(abs, rel) {
    if (found.length >= MAX_TEX_WALK) return
    let ents
    try { ents = await fs.promises.readdir(abs, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue
      const r = rel ? rel + '/' + e.name : e.name
      if (e.isDirectory()) await walk(path.join(abs, e.name), r)
      else if (TEX_DIR_RE.test(r) && IMG_EXT_RE.test(e.name)) {
        found.push({ path: r, size: 0 })
        if (found.length >= MAX_TEX_WALK) return
      }
    }
  }
  await walk(packRoot, '')
  return found
}

/* zip 包内贴图条目：路径限定 assets/<ns>/textures/ 且扩展名为图片（排除 .png.mcmeta / .json 等非贴图） */
function zipTextureEntries(entries) {
  const out = []
  for (const e of entries) {
    const p = normalizeZipTexName(e.name)
    if (p && IMG_EXT_RE.test(e.name)) out.push({ path: p, size: e.usize })
  }
  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}

async function readDirNamespaces(dir) {
  try {
    const entries = await fs.promises.readdir(path.join(dir, 'assets'), { withFileTypes: true })
    return entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name)
  } catch { return [] }
}

async function analyzePack(fullPath, stat) {
  const entry = {
    name: path.basename(fullPath),
    fullPath,
    isDirectory: stat.isDirectory(),
    size: stat.isDirectory() ? 0 : stat.size,
    mtime: stat.mtimeMs,
    kind: stat.isDirectory() ? 'dir' : 'file',
    valid: false,
    format: null, minFormat: null, maxFormat: null, formatLabel: null,
    formatRange: '', description: '', namespaces: [],
    textureCount: 0, firstTexture: null,
    error: '',
  }
  let text = null
  try {
    if (stat.isDirectory()) {
      const r = await resolveDirPack(fullPath)
      if (!r) {
        entry.error = 'pack.mcmeta not found'
        return entry
      }
      entry.namespaces = r.namespaces
      text = r.text
      entry.versionInfo = r.versionInfo || null
      const hasIcon = await fs.promises.access(path.join(r.root, 'pack.png')).then(() => true, () => false)
      const texs = await walkDirTextures(r.root)
      entry.textureCount = texs.length
      entry.firstTexture = hasIcon ? 'pack.png' : (texs.length ? texs[0].path : null)
      if (!text) entry.error = 'pack.mcmeta not found'
    } else {
      const ext = (entry.name.split('.').pop() || '').toLowerCase()
      if (!ZIP_EXTS.has(ext)) {
        entry.error = 'not a resource pack (folder or .zip)'
        return entry
      }
      entry.kind = 'zip'
      const buf = await fs.promises.readFile(fullPath)
      const entries = parseZipCentralDirectory(buf)
      const mc = pickMcmetaEntry(entries)
      entry.namespaces = collectNamespaces(entries)
      const texs = zipTextureEntries(entries)
      entry.textureCount = texs.length
      const icon = findZipEntry(entries, 'pack.png')
      entry.firstTexture = icon ? 'pack.png' : (texs.length ? texs[0].path : null)
      if (!mc) {
        entry.error = 'pack.mcmeta not found in archive'
        const vj = findZipEntry(entries, VERSION_JSON_NAME)
        entry.versionInfo = vj ? parseVersionJson(readZipEntry(buf, vj).toString('utf8')) : null
      }
      text = mc ? readZipEntry(buf, mc).toString('utf8') : null
    }
    if (text === null) {
      // 缺 pack.mcmeta：回退 version.json（原版 / Fabric 客户端 jar 布局）还原版本
      const vi = entry.versionInfo
      if (vi && (vi.format != null || vi.versionRange)) {
        entry.format = vi.format
        entry.formatLabel = vi.formatLabel
        entry.formatRange = vi.versionRange
        entry.valid = true
        entry.error = ''
      }
      delete entry.versionInfo
      return entry
    }
    const meta = parseMcmetaText(text)
    entry.format = meta.format
    entry.minFormat = meta.minFormat
    entry.maxFormat = meta.maxFormat
    entry.description = meta.description
    entry.formatRange = buildFormatRange(meta)
    entry.valid = true
  } catch (e) {
    entry.error = (e && e.message) || 'analyze failed'
  }
  return entry
}

function buildFormatRange(meta) {
  if (meta.minFormat != null || meta.maxFormat != null) {
    const min = meta.minFormat != null ? formatToVersions(meta.minFormat) : ''
    const max = meta.maxFormat != null ? formatToVersions(meta.maxFormat) : ''
    if (min && max) return min === max ? min : min + ' – ' + max
    return min || max || `pack_format ${meta.minFormat ?? meta.maxFormat}`
  }
  if (meta.format != null) return formatToVersions(meta.format)
  return ''
}

/* ── 目录级操作 ──────────────────────────────── */

async function listOfficialPacks(root) {
  let names
  try {
    names = await fs.promises.readdir(root, { withFileTypes: true })
  } catch (e) {
    if (e && e.code === 'ENOENT') return { root, exists: false, packs: [] }
    throw new AppError('ERR_FS_NOT_FOUND', e.message)
  }
  const packs = []
  for (const d of names) {
    if (d.name.startsWith('.')) continue
    const full = path.join(root, d.name)
    const st = await fs.promises.stat(full).catch(() => null)
    if (!st) continue
    if (!st.isDirectory() && !ZIP_EXTS.has((d.name.split('.').pop() || '').toLowerCase())) continue
    packs.push(await analyzePack(full, st))
  }
  packs.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return { root, exists: true, packs }
}

function validPackName(name) {
  if (typeof name !== 'string') return false
  const n = name
  if (!n || n.length > 255 || n !== n.trim()) return false
  if (n === '.' || n === '..') return false
  if (/[\\/]/.test(n) || n.includes('\0')) return false
  return path.basename(n) === n
}

async function renamePack(root, fromName, toName) {
  if (!validPackName(fromName)) throw new AppError('ERR_INVALID_PARAM', 'invalid source name')
  if (!validPackName(toName)) throw new AppError('ERR_INVALID_PARAM', 'invalid target name')
  const from = path.join(root, fromName)
  const to = path.join(root, toName)
  try {
    await fs.promises.access(from)
  } catch {
    throw new AppError('ERR_FS_NOT_FOUND', 'source pack not found: ' + fromName)
  }
  const targetExists = await fs.promises.access(to).then(() => true, () => false)
  if (targetExists) throw new AppError('ERR_ALREADY_EXISTS', 'target already exists: ' + toName)
  await fs.promises.rename(from, to)
  return { from, to, name: toName }
}

function suggestName(entry) {
  const range = (entry && entry.formatRange) || ''
  if (range) return range.replace(/\s*–\s*/g, '-').replace(/\s*-\s*/g, '-').trim()
  if (entry && entry.format != null) return 'pack_format-' + entry.format
  return (entry && entry.name) || ''
}

/* ── 包内贴图：分类浏览与读取 ─────────────────── */

const TEX_PAGE_DEFAULT = 120
const TEX_PAGE_MAX = 400

/* 浏览目录：assets/<ns>/textures[/<子目录>…] 形态，禁止穿越 */
function assertBrowseDir(dir) {
  if (typeof dir !== 'string' || !dir) return null
  if (dir.startsWith('/') || dir.endsWith('/') || dir.includes('\\') || dir.includes('..') || dir.includes('\0')) {
    throw new AppError('ERR_INVALID_PARAM', 'invalid browse dir')
  }
  const m = /^assets\/([^/]+)(\/textures(\/[^/]+)*)?$/.exec(dir)
  if (!m) throw new AppError('ERR_INVALID_PARAM', 'browse dir must be under assets/<ns>/textures')
  if (m[2]) return dir
  return null // assets/<ns> 本身不是浏览层
}

function parseTexPath(p) {
  const m = /^assets\/([^/]+)\/textures\/(.+)$/.exec(p)
  return m ? { ns: m[1], rest: m[2] } : null
}

function parentBrowseDir(dir) {
  const seg = dir.split('/')
  const up = seg.slice(0, -1).join('/')
  // assets/<ns>/textures 的上级 → 回根（类别）视图
  return /^assets\/[^/]+\/textures$/.test(up) ? null : up
}

async function listPackTextures(root, name, opts = {}) {
  const st = await statPack(root, name)
  const full = path.join(root, name)
  let kind = 'dir'
  let texs = []
  if (st.isDirectory()) {
    const r = await resolveDirPack(full)
    texs = await walkDirTextures(r ? r.root : full)
  } else {
    kind = 'zip'
    const buf = await fs.promises.readFile(full)
    texs = zipTextureEntries(parseZipCentralDirectory(buf))
  }
  const total = texs.length

  const dir = assertBrowseDir(opts.dir)
  const offset = Math.max(0, parseInt(opts.offset, 10) || 0)
  const limit = Math.min(TEX_PAGE_MAX, Math.max(1, parseInt(opts.limit, 10) || TEX_PAGE_DEFAULT))

  /* 命名空间与类别（textures/ 第一级目录，跨 ns 去重合并） */
  const namespaces = [...new Set(texs.map(t => { const p = parseTexPath(t.path); return p && p.ns }).filter(Boolean))]
  const catMap = new Map()
  for (const t of texs) {
    const p = parseTexPath(t.path)
    if (!p) continue
    const seg = p.rest.split('/')
    if (seg.length >= 2) {
      const key = p.ns + '/' + seg[0]
      const c = catMap.get(key) || { name: seg[0], dir: `assets/${p.ns}/textures/${seg[0]}`, count: 0 }
      c.count++
      catMap.set(key, c)
    }
  }
  const categories = [...catMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  let parent = null
  let dirs = []
  let files = []
  let filesTotal = 0
  let breadcrumbs = [{ name: 'root', dir: null }]
  if (dir) {
    parent = parentBrowseDir(dir)
    const sub = new Map()
    const fl = []
    for (const t of texs) {
      if (!t.path.startsWith(dir + '/')) continue
      const rest = t.path.slice(dir.length + 1)
      const seg = rest.split('/')
      if (seg.length >= 2) {
        const d = sub.get(seg[0]) || { name: seg[0], dir: dir + '/' + seg[0], count: 0 }
        d.count++
        sub.set(seg[0], d)
      } else {
        fl.push({ path: t.path, name: seg[0], size: t.size || 0 })
      }
    }
    dirs = [...sub.values()].sort((a, b) => a.name.localeCompare(b.name))
    fl.sort((a, b) => a.name.localeCompare(b.name))
    filesTotal = fl.length
    files = fl.slice(offset, offset + limit)
    // 面包屑：block › doors（root + textures/ 下每级目录；assets/<ns>/textures 层并入根）
    const dirSegs = dir.split('/')
    dirSegs.forEach((s, i) => {
      if (i < 3) return // assets / <ns> / textures
      breadcrumbs.push({ name: s, dir: dirSegs.slice(0, i + 1).join('/') })
    })
  } else {
    // 根视图：全部贴图平铺分页
    const fl = texs
      .map(t => ({ path: t.path, name: t.path.split('/').pop(), size: t.size || 0 }))
      .sort((a, b) => a.path.localeCompare(b.path))
    filesTotal = total
    files = fl.slice(offset, offset + limit)
  }

  return { name, kind, dir, parent, namespaces, categories, dirs, breadcrumbs, files, filesTotal, total, offset, limit }
}

/* ── 总资产库贴图聚合：包内全部贴图按类别（textures/ 第一级目录）分组，无分页 ── */

/* 目录包补齐 size / mtime（分批 stat，避免大包一次性打满线程池） */
async function statTexMeta(packRoot, texs) {
  const out = new Array(texs.length).fill(null)
  for (let i = 0; i < texs.length; i += 32) {
    await Promise.all(texs.slice(i, i + 32).map((t, k) =>
      fs.promises.stat(path.join(packRoot, t.path))
        .then(s => { out[i + k] = { size: s.size, mtime: s.mtimeMs } })
        .catch(() => {})))
  }
  return out
}

async function listPackTexGroups(root, name) {
  const st = await statPack(root, name)
  const full = path.join(root, name)
  let kind = 'dir'
  let packRoot = null
  let texs = []
  if (st.isDirectory()) {
    const r = await resolveDirPack(full)
    packRoot = r ? r.root : full
    texs = await walkDirTextures(packRoot)
    const metas = await statTexMeta(packRoot, texs)
    texs.forEach((t, i) => { const m = metas[i]; if (m) { t.size = m.size; t.mtime = m.mtime } })
  } else {
    kind = 'zip'
    texs = zipTextureEntries(parseZipCentralDirectory(await fs.promises.readFile(full)))
  }
  const groups = new Map()
  for (const t of texs) {
    const p = parseTexPath(t.path)
    if (!p) continue
    const seg = p.rest.split('/')
    const key = seg.length >= 2 ? seg[0] : ''
    let g = groups.get(key)
    if (!g) { g = { key, count: 0, files: [] }; groups.set(key, g) }
    g.count++
    g.files.push({ path: t.path, name: seg[seg.length - 1], size: t.size || 0, mtime: t.mtime || 0 })
  }
  /* 根级贴图（textures/ 直下）置首，其余按数量降序（与 categories 一致） */
  const sorted = [...groups.values()].sort((a, b) =>
    (a.key === '' ? -1 : b.key === '' ? 1 : b.count - a.count) || a.key.localeCompare(b.key))
  return { name, kind, root: packRoot, total: texs.length, groups: sorted }
}

async function statPack(root, name) {
  if (!validPackName(name)) throw new AppError('ERR_INVALID_PARAM', 'invalid pack name')
  const full = path.join(root, name)
  const st = await fs.promises.stat(full).catch(() => null)
  if (!st) throw new AppError('ERR_FS_NOT_FOUND', 'pack not found: ' + name)
  return st
}

function assertValidRelPath(rel, opts = {}) {
  if (rel === 'pack.png') return rel
  if (typeof rel !== 'string' || !rel.startsWith('assets/')) {
    throw new AppError('ERR_INVALID_PARAM', 'texture path must start with assets/')
  }
  if (rel.includes('..') || rel.includes('\\') || rel.includes('\0') || rel.startsWith('/')) {
    throw new AppError('ERR_INVALID_PARAM', 'invalid texture path')
  }
  if (!opts.anyExt && !IMG_EXT_RE.test(rel)) {
    throw new AppError('ERR_INVALID_PARAM', 'not an image texture')
  }
  return rel
}

/* ── 包内文件浏览（文件管理器式：任意目录的直接子项） ── */

const BROWSE_MAX_ENTRIES = 4000

/* 浏览路径：null/''（包根）或安全相对路径（禁止绝对路径 / 穿越 / 反斜杠） */
function assertBrowsePath(dir) {
  if (dir == null || dir === '') return null
  if (typeof dir !== 'string' || dir.startsWith('/') || dir.endsWith('/') ||
      dir.includes('\\') || dir.includes('..') || dir.includes('\0')) {
    throw new AppError('ERR_INVALID_PARAM', 'invalid browse path')
  }
  return dir
}

/* zip 条目名 → 包根相对路径：assets/META-INF 直排保留；套层根（<root>/assets/…、<root>/pack.mcmeta 等包根文件）剥离前缀 */
function normalizeZipBrowseName(name) {
  if (name.startsWith('assets/') || name.startsWith('META-INF/')) return name
  const m = /^[^/]+\/(assets\/.+|META-INF\/.+|pack\.mcmeta|pack\.png|version\.json|credits\.txt|LICENSE|README[^/]*)$/i.exec(name)
  return m ? m[1] : name
}

function browseBreadcrumbs(dir) {
  const crumbs = [{ name: 'root', dir: null }]
  if (!dir) return crumbs
  const segs = dir.split('/')
  segs.forEach((s, i) => crumbs.push({ name: s, dir: segs.slice(0, i + 1).join('/') }))
  return crumbs
}

async function listPackEntries(root, name, opts = {}) {
  const st = await statPack(root, name)
  const full = path.join(root, name)
  const dir = assertBrowsePath(opts.dir)
  const parent = dir ? (dir.split('/').slice(0, -1).join('/') || null) : null
  let dirs = []
  let files = []

  if (st.isDirectory()) {
    const r = await resolveDirPack(full)
    const base = path.resolve(r ? r.root : full)
    const abs = dir ? path.resolve(base, dir) : base
    if (abs !== base && !abs.startsWith(base + path.sep)) {
      throw new AppError('ERR_INVALID_PARAM', 'invalid browse path')
    }
    const ents = await fs.promises.readdir(abs, { withFileTypes: true }).catch(() => null)
    if (!ents) throw new AppError('ERR_FS_NOT_FOUND', 'directory not found: ' + (dir || '.'))
    for (const e of ents) {
      if (e.name.startsWith('.')) continue
      if (e.isDirectory()) dirs.push({ name: e.name })
      else if (e.isFile()) {
        const s = await fs.promises.stat(path.join(abs, e.name)).catch(() => null)
        files.push({ name: e.name, size: s ? s.size : 0, mtime: s ? s.mtimeMs : 0 })
      }
    }
  } else {
    const entries = parseZipCentralDirectory(await fs.promises.readFile(full))
    const dirPrefix = dir ? dir + '/' : ''
    const dirSet = new Map()
    for (const e of entries) {
      const n = normalizeZipBrowseName(e.name)
      if (!n) continue
      let rest = n
      if (dir) {
        if (!n.startsWith(dirPrefix)) continue
        rest = n.slice(dirPrefix.length)
      }
      const seg = rest.split('/')
      if (seg.length >= 2) {
        if (!dirSet.has(seg[0])) dirSet.set(seg[0], { name: seg[0] })
      } else if (seg[0]) {
        files.push({ name: seg[0], size: e.usize, mtime: 0 })
      }
    }
    dirs = [...dirSet.values()]
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.name.localeCompare(b.name))

  const total = dirs.length + files.length
  let truncated = false
  if (total > BROWSE_MAX_ENTRIES) {
    truncated = true
    if (dirs.length > BROWSE_MAX_ENTRIES) dirs = dirs.slice(0, BROWSE_MAX_ENTRIES)
    files = files.slice(0, Math.max(0, BROWSE_MAX_ENTRIES - dirs.length))
  }

  return {
    name, kind: st.isDirectory() ? 'dir' : 'zip', dir, parent,
    breadcrumbs: browseBreadcrumbs(dir), dirs, files,
    total, truncated,
  }
}

async function readPackFile(root, name, relPath, opts = {}) {
  const rel = assertValidRelPath(relPath, opts)
  const st = await statPack(root, name)
  const full = path.join(root, name)
  if (st.isDirectory()) {
    const r = await resolveDirPack(full)
    const base = r ? r.root : full
    const file = path.resolve(base, rel)
    if (!file.startsWith(path.resolve(base) + path.sep)) {
      throw new AppError('ERR_INVALID_PARAM', 'invalid texture path')
    }
    try {
      const buf = await fs.promises.readFile(file)
      return { buf, mime: mimeOf(rel) }
    } catch {
      throw new AppError('ERR_FS_NOT_FOUND', 'texture not found: ' + rel)
    }
  }
  const buf = await fs.promises.readFile(full)
  const entries = parseZipCentralDirectory(buf)
  const entry = findZipEntry(entries, rel)
  if (!entry) throw new AppError('ERR_FS_NOT_FOUND', 'texture not found: ' + rel)
  return { buf: readZipEntry(buf, entry), mime: mimeOf(rel) }
}

module.exports = {
  PACK_FORMAT_VERSIONS,
  formatToVersions,
  parseMcmetaText,
  analyzePack,
  listOfficialPacks,
  renamePack,
  suggestName,
  validPackName,
  listPackTextures,
  listPackTexGroups,
  listPackEntries,
  readPackFile,
  ZIP_EXTS,
}
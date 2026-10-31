/**
 * matoga - 导入模型服务（用户主动导入的 .bbmodel / MC .json）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 本服务承载用户在资产库主动「上传模型」导入的模型，拥有独立专属目录 DATA_ROOT/data/imported-models。
 * 每个模型占一个专属子目录：DATA_ROOT/data/imported-models/<id>/model.<ext>
 * （ext 为 bbmodel 或 json，由文件名/内容判定）。旧的扁平 <id>.json 会在列表时惰性迁移。
 *
 * 贴图支持：MC .json 模型引用的贴图可随模型一同导入，存放在 <id>/assets/<ns>/textures/<path>.png，
 * 视口查看时以 <id> 子目录为 fileRoot，贴图引用按命名空间解析后从该目录加载。
 */

const fs = require('fs')
const path = require('path')
const { DATA_ROOT } = require('../paths')
const { AppError } = require('../lib/errors')
const configStore = require('../config/config-store')

const DEFAULT_IMPORTED_DIR = path.join(DATA_ROOT, 'data', 'imported-models')
function importedDir() {
  return configStore.get().importedModelsPath || DEFAULT_IMPORTED_DIR
}

/* 子目录内模型文件固定基名 model.<ext> */
const MODEL_BASENAME = 'model'
const KNOWN_EXTS = ['bbmodel', 'json']

/* 贴图合法扩展名（导入贴图白名单，防任意文件写入） */
const TEXTURE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'avif']
/* 贴图根子目录：贴图必须落在 <id>/assets/ 下，relPath 须以 assets/ 开头 */
const TEXTURE_ROOT_PREFIX = 'assets'

async function ensureDir(d) {
  await fs.promises.mkdir(d, { recursive: true })
}

function validId(id) {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 128 &&
    !id.includes('/') &&
    !id.includes('\\') &&
    !id.includes(':') &&
    id !== '.' &&
    id !== '..'
  )
}

function assertValidId(id) {
  if (!validId(id)) {
    const err = new Error('invalid model id')
    err.code = 'ERR_INVALID_PARAM'
    throw err
  }
}

function normalizeExt(ext, name, data) {
  if (ext && KNOWN_EXTS.includes(ext)) return ext
  const lname = String(name || '').toLowerCase()
  if (lname.endsWith('.bbmodel')) return 'bbmodel'
  if (lname.endsWith('.json')) return 'json'
  let parsed = data
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data)
    } catch {}
  }
  if (parsed && typeof parsed === 'object') {
    const m = parsed.meta
    if (m && (m.format === 'bbmodel' || m.model_format)) return 'bbmodel'
  }
  return 'json'
}

/* 子目录内首个 model.<ext> 文件的绝对路径（不存在返回 null） */
function modelFileIn(dir) {
  let files
  try {
    files = fs.readdirSync(dir)
  } catch {
    return null
  }
  for (const ext of KNOWN_EXTS) {
    const f = MODEL_BASENAME + '.' + ext
    if (files.includes(f)) return path.join(dir, f)
  }
  return null
}

/* 旧扁平格式 <id>.bbmodel / <id>.json → <id>/model.<ext>（幂等惰性迁移） */
async function migrateLegacy() {
  let entries
  try {
    entries = await fs.promises.readdir(importedDir(), { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (!e.isFile()) continue
    const m = /^(.+)\.(bbmodel|json)$/.exec(e.name)
    if (!m) continue
    const id = m[1]
    const dir = path.join(importedDir(), id)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises
      .rename(path.join(importedDir(), e.name), path.join(dir, MODEL_BASENAME + '.' + m[2]))
      .catch(() => {})
  }
}

async function listModels() {
  await ensureDir(importedDir())
  await migrateLegacy()
  const entries = await fs.promises.readdir(importedDir(), { withFileTypes: true })
  const dirs = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const p = modelFileIn(path.join(importedDir(), e.name))
    if (p) dirs.push({ name: e.name, p })
  }
  // 各目录独立，并行 stat + readFile
  const out = await Promise.all(
    dirs.map(async ({ name, p }) => {
      const st = await fs.promises.stat(p)
      let meta = {}
      try {
        const j = JSON.parse(await fs.promises.readFile(p, 'utf8'))
        meta = { name: j.name, format: j.meta && j.meta.format, model_format: j.meta && j.meta.model_format }
      } catch {}
      return {
        id: name,
        file: path.basename(p),
        ext: path.extname(p).slice(1),
        size: st.size,
        mtime: st.mtimeMs,
        ...meta
      }
    })
  )
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

/* 模型专属子目录绝对路径（贴图根 fileRoot） */
function modelDir(id) {
  return path.join(importedDir(), id)
}

/* 校验贴图相对路径：须形如 assets/<ns>/textures/.../<name>.<ext>，禁止穿越与越界 */
function assertValidTextureRel(rel) {
  if (typeof rel !== 'string' || !rel) {
    const err = new Error('invalid texture path')
    err.code = 'ERR_INVALID_PARAM'
    throw err
  }
  const norm = path.normalize(rel).replace(/\\/g, '/')
  if (norm.startsWith('..') || norm.includes('../') || path.isAbsolute(norm)) {
    const err = new Error('invalid texture path')
    err.code = 'ERR_INVALID_PARAM'
    throw err
  }
  if (!norm.startsWith(TEXTURE_ROOT_PREFIX + '/')) {
    const err = new Error('texture path must start with ' + TEXTURE_ROOT_PREFIX + '/')
    err.code = 'ERR_INVALID_PARAM'
    throw err
  }
  const ext = path.extname(norm).slice(1).toLowerCase()
  if (!ext || !TEXTURE_EXTS.includes(ext)) {
    const err = new Error('unsupported texture extension: ' + ext)
    err.code = 'ERR_INVALID_PARAM'
    throw err
  }
  return norm
}

/* dataURL → Buffer；非 dataURL 抛错 */
function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    const err = new Error('texture data must be a data: URL')
    err.code = 'ERR_INVALID_PARAM'
    throw err
  }
  const comma = dataUrl.indexOf(',')
  if (comma < 0) {
    const err = new Error('malformed data URL')
    err.code = 'ERR_INVALID_PARAM'
    throw err
  }
  return Buffer.from(dataUrl.slice(comma + 1), 'base64')
}

/* 写入单张贴图到 <id>/<relPath>；返回 { path, size } */
async function saveTexture(id, relPath, dataUrl) {
  assertValidId(id)
  const rel = assertValidTextureRel(relPath)
  const buf = decodeDataUrl(dataUrl)
  const dest = path.join(modelDir(id), rel)
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  await fs.promises.writeFile(dest, buf)
  return { path: rel, size: buf.length }
}

/* 批量写入贴图 { relPath: dataUrl }；返回 { saved, skipped } */
async function saveTextures(id, map) {
  assertValidId(id)
  if (!map || typeof map !== 'object') {
    const err = new Error('textures map required')
    err.code = 'ERR_INVALID_PARAM'
    throw err
  }
  const saved = []
  for (const rel of Object.keys(map)) {
    try {
      saved.push(await saveTexture(id, rel, map[rel]))
    } catch {
      /* 跳过非法项，保留合法项写入 */
    }
  }
  return { saved, count: saved.length }
}

/* 递归列出 <id>/assets/ 下所有贴图（相对路径 + 大小 + mtime） */
async function listTextures(id) {
  assertValidId(id)
  const root = path.join(modelDir(id), TEXTURE_ROOT_PREFIX)
  const out = []
  async function walk(dir, base) {
    let entries
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      const rel = base ? base + '/' + e.name : e.name
      if (e.isDirectory()) {
        await walk(full, rel)
      } else if (e.isFile()) {
        const ext = path.extname(e.name).slice(1).toLowerCase()
        if (TEXTURE_EXTS.includes(ext)) {
          const st = await fs.promises.stat(full)
          out.push({ path: TEXTURE_ROOT_PREFIX + '/' + rel, size: st.size, mtime: st.mtimeMs })
        }
      }
    }
  }
  await walk(root, '')
  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}

/* 删除单张贴图 */
async function deleteTexture(id, relPath) {
  assertValidId(id)
  const rel = assertValidTextureRel(relPath)
  const full = path.join(modelDir(id), rel)
  await fs.promises.rm(full, { force: true })
  return { path: rel }
}

async function saveModel({ id, name, data, ext, textures }) {
  await ensureDir(importedDir())
  const safeName = String(name || 'model').replace(/[^\w.-]+/g, '_')
  const fid = id || safeName + '-' + Date.now().toString(36)
  if (id) assertValidId(id)
  if (data == null) throw new AppError('ERR_INVALID_PARAM', 'data required')
  const e = normalizeExt(ext, name, data)
  const dir = path.join(importedDir(), fid)
  await fs.promises.mkdir(dir, { recursive: true })
  const p = path.join(dir, MODEL_BASENAME + '.' + e)
  const content = typeof data === 'string' ? data : JSON.stringify(data)
  await fs.promises.writeFile(p, content, 'utf8')
  let texResult = null
  if (textures && typeof textures === 'object') {
    try {
      texResult = await saveTextures(fid, textures)
    } catch {
      texResult = { count: 0 }
    }
  }
  return { id: fid, path: p, ext: e, size: content.length, texCount: texResult ? texResult.count : 0 }
}

async function loadModel(id) {
  assertValidId(id)
  const p = modelFileIn(path.join(importedDir(), id))
  if (!p) {
    const err = new Error('model not found: ' + id)
    err.code = 'ENOENT'
    throw err
  }
  const raw = await fs.promises.readFile(p, 'utf8')
  let json = null
  try {
    json = JSON.parse(raw)
  } catch {}
  return { id, raw, json, texDir: path.dirname(p) }
}

/* 覆盖更新模型内容（保留原文件扩展名） */
async function updateModel(id, data) {
  assertValidId(id)
  const p = modelFileIn(path.join(importedDir(), id))
  if (!p) {
    const err = new Error('model not found: ' + id)
    err.code = 'ENOENT'
    throw err
  }
  const content = typeof data === 'string' ? data : JSON.stringify(data)
  await fs.promises.writeFile(p, content, 'utf8')
  return { id, path: p, size: content.length }
}

async function deleteModel(id) {
  assertValidId(id)
  await fs.promises.rm(path.join(importedDir(), id), { recursive: true, force: true })
  return { id }
}

module.exports = {
  importedDir,
  TEXTURE_EXTS,
  listModels,
  saveModel,
  loadModel,
  updateModel,
  deleteModel,
  saveTexture,
  saveTextures,
  listTextures,
  deleteTexture,
  modelDir
}

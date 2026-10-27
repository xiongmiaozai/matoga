/**
 * matoga - 导入模型服务（用户主动导入的 .bbmodel / MC .json）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 本服务承载用户在资产库主动「上传模型」导入的模型，拥有独立专属目录 DATA_ROOT/data/imported-models。
 * 每个模型占一个专属子目录：DATA_ROOT/data/imported-models/<id>/model.<ext>
 * （ext 为 bbmodel 或 json，由文件名/内容判定）。旧的扁平 <id>.json 会在列表时惰性迁移。
 */

const fs = require('fs')
const path = require('path')
const { DATA_ROOT } = require('../paths')
const { AppError } = require('../lib/errors')

const IMPORTED_MODELS_DIR = path.join(DATA_ROOT, 'data', 'imported-models')

/* 子目录内模型文件固定基名 model.<ext> */
const MODEL_BASENAME = 'model'
const KNOWN_EXTS = ['bbmodel', 'json']

async function ensureDir(d) { await fs.promises.mkdir(d, { recursive: true }) }

function validId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 128
    && !id.includes('/') && !id.includes('\\') && !id.includes(':')
    && id !== '.' && id !== '..'
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
  if (typeof data === 'string') { try { parsed = JSON.parse(data) } catch {} }
  if (parsed && typeof parsed === 'object') {
    const m = parsed.meta
    if (m && (m.format === 'bbmodel' || m.model_format)) return 'bbmodel'
  }
  return 'json'
}

/* 子目录内首个 model.<ext> 文件的绝对路径（不存在返回 null） */
function modelFileIn(dir) {
  let files
  try { files = fs.readdirSync(dir) } catch { return null }
  for (const ext of KNOWN_EXTS) {
    const f = MODEL_BASENAME + '.' + ext
    if (files.includes(f)) return path.join(dir, f)
  }
  return null
}

/* 旧扁平格式 <id>.bbmodel / <id>.json → <id>/model.<ext>（幂等惰性迁移） */
async function migrateLegacy() {
  let entries
  try { entries = await fs.promises.readdir(IMPORTED_MODELS_DIR, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (!e.isFile()) continue
    const m = /^(.+)\.(bbmodel|json)$/.exec(e.name)
    if (!m) continue
    const id = m[1]
    const dir = path.join(IMPORTED_MODELS_DIR, id)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.rename(path.join(IMPORTED_MODELS_DIR, e.name), path.join(dir, MODEL_BASENAME + '.' + m[2])).catch(() => {})
  }
}

async function listModels() {
  await ensureDir(IMPORTED_MODELS_DIR)
  await migrateLegacy()
  const entries = await fs.promises.readdir(IMPORTED_MODELS_DIR, { withFileTypes: true })
  const out = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const p = modelFileIn(path.join(IMPORTED_MODELS_DIR, e.name))
    if (!p) continue
    const st = await fs.promises.stat(p)
    let meta = {}
    try {
      const j = JSON.parse(await fs.promises.readFile(p, 'utf8'))
      meta = { name: j.name, format: j.meta && j.meta.format, model_format: j.meta && j.meta.model_format }
    } catch {}
    out.push({ id: e.name, file: path.basename(p), ext: path.extname(p).slice(1), size: st.size, mtime: st.mtimeMs, ...meta })
  }
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

async function saveModel({ id, name, data, ext }) {
  await ensureDir(IMPORTED_MODELS_DIR)
  const safeName = String(name || 'model').replace(/[^\w.-]+/g, '_')
  const fid = id || (safeName + '-' + Date.now().toString(36))
  if (id) assertValidId(id)
  if (data == null) throw new AppError('ERR_INVALID_PARAM', 'data required')
  const e = normalizeExt(ext, name, data)
  const dir = path.join(IMPORTED_MODELS_DIR, fid)
  await fs.promises.mkdir(dir, { recursive: true })
  const p = path.join(dir, MODEL_BASENAME + '.' + e)
  const content = typeof data === 'string' ? data : JSON.stringify(data)
  await fs.promises.writeFile(p, content, 'utf8')
  return { id: fid, path: p, ext: e, size: content.length }
}

async function loadModel(id) {
  assertValidId(id)
  const p = modelFileIn(path.join(IMPORTED_MODELS_DIR, id))
  if (!p) {
    const err = new Error('model not found: ' + id)
    err.code = 'ENOENT'
    throw err
  }
  const raw = await fs.promises.readFile(p, 'utf8')
  let json = null
  try { json = JSON.parse(raw) } catch {}
  return { id, raw, json }
}

/* 覆盖更新模型内容（保留原文件扩展名） */
async function updateModel(id, data) {
  assertValidId(id)
  const p = modelFileIn(path.join(IMPORTED_MODELS_DIR, id))
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
  await fs.promises.rm(path.join(IMPORTED_MODELS_DIR, id), { recursive: true, force: true })
  return { id }
}

module.exports = {
  IMPORTED_MODELS_DIR,
  listModels, saveModel, loadModel, updateModel, deleteModel,
}
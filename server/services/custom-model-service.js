/**
 * matoga - 自定义模型服务（从模板创建 MC 模型）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 模板库内联展开 elements（自包含，预览无需 parent 链解析），
 * 产物落盘于 DATA_ROOT/data/custom-models/<id>.json（可写，跨开发/打包模式）。
 */

const fs = require('fs')
const path = require('path')
const { DATA_ROOT } = require('../paths')
const { TEMPLATES } = require('./cms/templates')

const CUSTOM_MODELS_DIR = path.join(DATA_ROOT, 'data', 'custom-models')

async function ensureDir(d) { await fs.promises.mkdir(d, { recursive: true }) }

/* ── 模板库：每个模板 generate(name, ns) 返回自包含 MC 模型 JSON ── */
/* 坐标 / UV 均为 0-16 像素空间；textures 引用 ns:block/<name> 约定 */
function listTemplates() {
  return TEMPLATES.map(t => ({ id: t.id, name: t.name, category: t.category, description: t.description }))
}

function getTemplate(id) {
  return TEMPLATES.find(t => t.id === id) || null
}

/* 从模板生成模型 JSON */
function generateModel({ template, name, namespace }) {
  const tpl = getTemplate(template)
  if (!tpl) {
    const e = new Error('未知模板: ' + template)
    e.code = 'ERR_INVALID_PARAM'
    throw e
  }
  const ns = String(namespace || 'minecraft').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'minecraft'
  const safeName = String(name || 'model').replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'model'
  const model = tpl.generate(safeName, ns)
  if (!model || typeof model !== 'object') throw new Error('模板生成失败')
  return { model, namespace: ns, name: safeName, template: tpl.id }
}

/* ── CRUD ── */
/* 每个模型占一个专属子目录：data/custom-models/<id>/model.json */
const MODEL_BASENAME = 'model'

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

function modelFileIn(dir) {
  const p = path.join(dir, MODEL_BASENAME + '.json')
  try { return fs.existsSync(p) ? p : null } catch { return null }
}

/* 旧扁平格式 <id>.json → <id>/model.json（幂等惰性迁移） */
async function migrateLegacy() {
  let entries
  try { entries = await fs.promises.readdir(CUSTOM_MODELS_DIR, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue
    const id = e.name.replace(/\.json$/, '')
    const dir = path.join(CUSTOM_MODELS_DIR, id)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.rename(path.join(CUSTOM_MODELS_DIR, e.name), path.join(dir, MODEL_BASENAME + '.json')).catch(() => {})
  }
}

async function listModels() {
  await ensureDir(CUSTOM_MODELS_DIR)
  await migrateLegacy()
  const entries = await fs.promises.readdir(CUSTOM_MODELS_DIR, { withFileTypes: true })
  const out = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const p = modelFileIn(path.join(CUSTOM_MODELS_DIR, e.name))
    if (!p) continue
    const st = await fs.promises.stat(p)
    let meta = {}
    try {
      const j = JSON.parse(await fs.promises.readFile(p, 'utf8'))
      meta = {
        name: j.name, namespace: j.namespace, template: j.template,
        parent: j.model && j.model.parent, hasElements: !!(j.model && Array.isArray(j.model.elements) && j.model.elements.length),
      }
    } catch {}
    out.push({ id: e.name, file: MODEL_BASENAME + '.json', size: st.size, mtime: st.mtimeMs, ...meta })
  }
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

async function createModel({ template, name, namespace }) {
  await ensureDir(CUSTOM_MODELS_DIR)
  const { model, namespace: ns, name: safeName, template: tplId } = generateModel({ template, name, namespace })
  const fid = safeName + '-' + Date.now().toString(36)
  const dir = path.join(CUSTOM_MODELS_DIR, fid)
  await fs.promises.mkdir(dir, { recursive: true })
  const p = path.join(dir, MODEL_BASENAME + '.json')
  const record = {
    id: fid, name: safeName, namespace: ns, template: tplId,
    createdAt: new Date().toISOString(), model,
  }
  const content = JSON.stringify(record, null, 2)
  await fs.promises.writeFile(p, content, 'utf8')
  return { id: fid, path: p, size: content.length, name: safeName, namespace: ns, template: tplId }
}

async function loadModel(id) {
  assertValidId(id)
  const p = modelFileIn(path.join(CUSTOM_MODELS_DIR, id))
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

async function updateModel(id, { model, name }) {
  assertValidId(id)
  const p = modelFileIn(path.join(CUSTOM_MODELS_DIR, id))
  if (!p) throw new Error('model not found: ' + id)
  const raw = await fs.promises.readFile(p, 'utf8')
  let record
  try { record = JSON.parse(raw) } catch (e) {
    const err = new Error('model file corrupted: ' + id)
    err.code = 'ERR_PARSE'
    throw err
  }
  if (model !== undefined) record.model = typeof model === 'string' ? JSON.parse(model) : model
  if (name !== undefined) record.name = String(name)
  record.updatedAt = new Date().toISOString()
  const content = JSON.stringify(record, null, 2)
  await fs.promises.writeFile(p, content, 'utf8')
  return { id, size: content.length }
}

async function deleteModel(id) {
  assertValidId(id)
  await fs.promises.rm(path.join(CUSTOM_MODELS_DIR, id), { recursive: true, force: true })
  return { id }
}

module.exports = {
  CUSTOM_MODELS_DIR,
  listTemplates, getTemplate, generateModel,
  listModels, createModel, loadModel, updateModel, deleteModel,
}
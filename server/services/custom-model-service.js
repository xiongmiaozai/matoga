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

const CUSTOM_MODELS_DIR = path.join(DATA_ROOT, 'data', 'custom-models')

async function ensureDir(d) { await fs.promises.mkdir(d, { recursive: true }) }

/* ── 模板库：每个模板 generate(name, ns) 返回自包含 MC 模型 JSON ── */
/* 坐标 / UV 均为 0-16 像素空间；textures 引用 ns:block/<name> 约定 */
const TEMPLATES = [
  {
    id: 'cube_all', name: 'cube_all', category: 'block',
    description: '六面同贴图方块',
    generate: (n, ns) => ({
      textures: { all: `${ns}:block/${n}` },
      elements: [cubeAllEl('#all')],
    }),
  },
  {
    id: 'cube', name: 'cube', category: 'block',
    description: '标准方块（各面独立贴图）',
    generate: (n, ns) => ({
      textures: {
        particle: `${ns}:block/${n}`,
        north: `${ns}:block/${n}_front`, south: `${ns}:block/${n}_back`,
        east: `${ns}:block/${n}_side`, west: `${ns}:block/${n}_side`,
        up: `${ns}:block/${n}_top`, down: `${ns}:block/${n}_bottom`,
      },
      elements: [cubeEl()],
    }),
  },
  {
    id: 'cube_column', name: 'cube_column', category: 'block',
    description: '柱体（顶底 + 侧面）',
    generate: (n, ns) => ({
      textures: { end: `${ns}:block/${n}_top`, side: `${ns}:block/${n}_side` },
      elements: [columnEl('#end', '#side')],
    }),
  },
  {
    id: 'cube_column_horizontal', name: 'cube_column_horizontal', category: 'block',
    description: '水平柱体（两端 + 侧面）',
    generate: (n, ns) => ({
      textures: { end: `${ns}:block/${n}_top`, side: `${ns}:block/${n}_side` },
      elements: [columnHEl('#end', '#side')],
    }),
  },
  {
    id: 'carpet', name: 'carpet', category: 'block',
    description: '地毯（薄层）',
    generate: (n, ns) => ({
      textures: { wool: `${ns}:block/${n}` },
      elements: [slabEl('#wool', 0, 1)],
    }),
  },
  {
    id: 'pressure_plate', name: 'pressure_plate', category: 'block',
    description: '压力板',
    generate: (n, ns) => ({
      textures: { plate: `${ns}:block/${n}` },
      elements: [plateEl('#plate')],
    }),
  },
  {
    id: 'button', name: 'button', category: 'block',
    description: '按钮（贴墙）',
    generate: (n, ns) => ({
      textures: { texture: `${ns}:block/${n}` },
      elements: [buttonEl('#texture')],
    }),
  },
  {
    id: 'fence_post', name: 'fence_post', category: 'block',
    description: '栅栏柱',
    generate: (n, ns) => ({
      textures: { texture: `${ns}:block/${n}_side` },
      elements: [postEl('#texture')],
    }),
  },
  {
    id: 'slab', name: 'slab', category: 'block',
    description: '台阶（下半）',
    generate: (n, ns) => ({
      textures: { top: `${ns}:block/${n}_top`, side: `${ns}:block/${n}_side` },
      elements: [slabElHalf('#top', '#side')],
    }),
  },
  {
    id: 'stairs', name: 'stairs', category: 'block',
    description: '楼梯',
    generate: (n, ns) => ({
      textures: { top: `${ns}:block/${n}_top`, side: `${ns}:block/${n}_side` },
      elements: stairsEls('#top', '#side'),
    }),
  },
  {
    id: 'cross', name: 'cross', category: 'block',
    description: '植物交叉（两片旋转面）',
    generate: (n, ns) => ({
      textures: { cross: `${ns}:block/${n}` },
      elements: crossEls('#cross'),
    }),
  },
  {
    id: 'rail_flat', name: 'rail_flat', category: 'block',
    description: '平坦铁轨',
    generate: (n, ns) => ({
      textures: { rail: `${ns}:block/${n}` },
      elements: [railEl('#rail')],
    }),
  },
  {
    id: 'torch', name: 'torch', category: 'block',
    description: '火把（直立小柱）',
    generate: (n, ns) => ({
      textures: { torch: `${ns}:block/${n}` },
      elements: [torchEl('#torch')],
    }),
  },
  {
    id: 'item_generated', name: 'item/generated', category: 'item',
    description: '物品平面图标（generated）',
    generate: (n, ns) => ({
      parent: 'minecraft:item/generated',
      textures: { layer0: `${ns}:item/${n}` },
    }),
  },
  {
    id: 'item_handheld', name: 'item/handheld', category: 'item',
    description: '手持物品图标',
    generate: (n, ns) => ({
      parent: 'minecraft:item/handheld',
      textures: { layer0: `${ns}:item/${n}` },
    }),
  },
]

/* ── 几何辅助：生成 MC elements（0-16 空间） ── */
function face(uv, tex) { return { uv, texture: tex } }
const FULL = [0, 0, 16, 16]

function cubeAllEl(tex) {
  return {
    from: [0, 0, 0], to: [16, 16, 16],
    faces: {
      north: face(FULL, tex), south: face(FULL, tex),
      east: face(FULL, tex), west: face(FULL, tex),
      up: face(FULL, tex), down: face(FULL, tex),
    },
  }
}
function cubeEl() {
  return {
    from: [0, 0, 0], to: [16, 16, 16],
    faces: {
      north: face(FULL, '#north'), south: face(FULL, '#south'),
      east: face(FULL, '#east'), west: face(FULL, '#west'),
      up: face(FULL, '#up'), down: face(FULL, '#down'),
    },
  }
}
function columnEl(end, side) {
  return {
    from: [0, 0, 0], to: [16, 16, 16],
    faces: {
      north: face(FULL, side), south: face(FULL, side),
      east: face(FULL, side), west: face(FULL, side),
      up: face(FULL, end), down: face(FULL, end),
    },
  }
}
function columnHEl(end, side) {
  return {
    from: [0, 0, 0], to: [16, 16, 16],
    faces: {
      north: face(FULL, end), south: face(FULL, end),
      east: face(FULL, side), west: face(FULL, side),
      up: face(FULL, side), down: face(FULL, side),
    },
  }
}
function slabEl(tex, y0, y1) {
  return {
    from: [0, y0, 0], to: [16, y1, 16],
    faces: {
      north: face(FULL, tex), south: face(FULL, tex),
      east: face(FULL, tex), west: face(FULL, tex),
      up: face(FULL, tex), down: face(FULL, tex),
    },
  }
}
function plateEl(tex) {
  return {
    from: [1, 0, 1], to: [15, 1, 15],
    faces: {
      north: face([1, 15, 15, 1], tex), south: face([1, 15, 15, 1], tex),
      east: face([1, 15, 15, 1], tex), west: face([1, 15, 15, 1], tex),
      up: face([1, 1, 15, 15], tex), down: face([1, 1, 15, 15], tex),
    },
  }
}
function buttonEl(tex) {
  return {
    from: [5, 0, 4], to: [11, 2, 12],
    faces: {
      north: face([5, 14, 11, 12], tex), south: face([5, 14, 11, 12], tex),
      east: face([4, 14, 12, 12], tex), west: face([4, 14, 12, 12], tex),
      up: face([5, 4, 11, 12], tex), down: face([5, 4, 11, 12], tex),
    },
  }
}
function postEl(tex) {
  return {
    from: [6, 0, 6], to: [10, 16, 10],
    faces: {
      north: face([6, 0, 10, 16], tex), south: face([6, 0, 10, 16], tex),
      east: face([6, 0, 10, 16], tex), west: face([6, 0, 10, 16], tex),
      up: face([6, 6, 10, 10], tex), down: face([6, 6, 10, 10], tex),
    },
  }
}
function slabElHalf(top, side) {
  return {
    from: [0, 0, 0], to: [16, 8, 16],
    faces: {
      north: face([0, 8, 16, 16], side), south: face([0, 8, 16, 16], side),
      east: face([0, 8, 16, 16], side), west: face([0, 8, 16, 16], side),
      up: face(FULL, top), down: face(FULL, top),
    },
  }
}
function stairsEls(top, side) {
  return [
    {
      from: [0, 0, 0], to: [16, 8, 16],
      faces: {
        north: face([0, 8, 16, 16], side), south: face([0, 8, 16, 16], side),
        east: face([0, 8, 16, 16], side), west: face([0, 8, 16, 16], side),
        up: face(FULL, top), down: face(FULL, top),
      },
    },
    {
      from: [0, 8, 0], to: [16, 16, 8],
      faces: {
        north: face([0, 0, 16, 8], side), south: face([0, 0, 16, 8], side),
        east: face([0, 0, 8, 8], side), west: face([0, 0, 8, 8], side),
        up: face([0, 0, 16, 8], top), down: face([0, 0, 16, 8], top),
      },
    },
  ]
}
function crossEls(tex) {
  const f = { north: face(FULL, tex), south: face(FULL, tex) }
  return [
    { from: [0, 0, 8], to: [16, 16, 8], rotation: { origin: [8, 8, 8], axis: 'y', angle: 45 }, faces: f },
    { from: [0, 0, 8], to: [16, 16, 8], rotation: { origin: [8, 8, 8], axis: 'y', angle: -45 }, faces: f },
  ]
}
function railEl(tex) {
  return {
    from: [0, 0, 0], to: [16, 1, 16],
    faces: { up: face(FULL, tex), down: face(FULL, tex) },
  }
}
function torchEl(tex) {
  return {
    from: [6, 0, 6], to: [10, 16, 10],
    faces: {
      north: face([6, 0, 10, 16], tex), south: face([6, 0, 10, 16], tex),
      east: face([6, 0, 10, 16], tex), west: face([6, 0, 10, 16], tex),
      up: face([6, 6, 10, 10], tex), down: face([6, 6, 10, 10], tex),
    },
  }
}

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
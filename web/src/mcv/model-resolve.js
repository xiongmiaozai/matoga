/**
 * matoga - 材质 3D 视口：model-resolve
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */

import * as THREE from 'three'
import { apiUrl, fetchJson, fetchOkData, rawUrl, texCacheKey } from './utils.js'
import { TEX_REF_EXT_RE, expandTextureAliases, isSpecialTexPath, resolveTextureRef, spriteTexKey, texPathForRef, texUrlToRef, writeMcTexRef } from './tex-refs.js'

export const MAX_PARENT_DEPTH = 8
export const MAX_ITEM_DEF_DEPTH = 12
export const MAX_ITEM_DEF_REFS = 16

/* parent 引用 → 包内模型路径："minecraft:block/cube" / "block/cube" → assets/minecraft/models/block/cube.json */
export function parentModelPath(parent) {
  if (typeof parent !== 'string' || !parent) return null
  let ns = 'minecraft', rest = parent
  const ci = parent.indexOf(':')
  if (ci >= 0) { ns = parent.slice(0, ci); rest = parent.slice(ci + 1) }
  if (!rest) return null
  return `assets/${ns}/models/${rest}.json`
}

/* 贴图引用 → 包内贴图路径："minecraft:block/stone" → assets/minecraft/textures/block/stone.png；
    引用已带图片扩展名（社区包写法）不再追加，防 stone.png.png */
export const BUILTIN_PARENT_MODELS = {
  'assets/minecraft/models/block/cube.json': {
    elements: [{
      from: [0, 0, 0], to: [16, 16, 16],
      faces: {
        down: { texture: '#down' }, up: { texture: '#up' },
        north: { texture: '#north' }, south: { texture: '#south' },
        west: { texture: '#west' }, east: { texture: '#east' },
      },
    }],
  },
  'assets/minecraft/models/block/cube_all.json': {
    parent: 'minecraft:block/cube',
    textures: { all: '#all' },
  },
  'assets/minecraft/models/block/cube_bottom_top.json': {
    parent: 'minecraft:block/cube',
    textures: { down: '#end', up: '#end', side: '#side' },
  },
  'assets/minecraft/models/block/block.json': {},
  'assets/minecraft/models/item/generated.json': {},
  'assets/minecraft/models/item/handheld.json': { parent: 'minecraft:item/generated' },
  'assets/minecraft/models/item/template_shulker_box.json': {},
}

/* fetch 模型 JSON 并沿 parent 链合并：elements 取最近定义层，textures 子覆盖父。
    包内不存在时回退内置 vanilla 基类（普通资源包不含基类文件）。
    合并在原始 textures 表上进行（子键覆盖父键，all/side 别名不参与中间合并），
    最外层解析完成后统一展开一次——若逐层先展开再合并，子层的 side 展开键
    （north/south/east/west）会错误覆盖父层的显式方向键（command_block 的
    north=#front / south=#back 被覆盖成 #side → front/back 贴图丢失）。 */
export async function resolveMcModelRaw(api, packName, rel, depth = 0, fileRoot) {
  const url = rawUrl(api, packName, rel, fileRoot, true)
  let model
  try {
    model = await fetchJson(url)
  } catch (e) {
    const builtin = BUILTIN_PARENT_MODELS[rel]
    if (!builtin) throw e
    model = builtin
  }
  if (!model || typeof model !== 'object') throw new Error('invalid model json')
  let elements = Array.isArray(model.elements) ? model.elements : null
  const textures = (model.textures && typeof model.textures === 'object') ? model.textures : {}
  if (model.parent && depth < MAX_PARENT_DEPTH) {
    const parentRel = parentModelPath(model.parent)
    if (parentRel) {
      try {
        const p = await resolveMcModelRaw(api, packName, parentRel, depth + 1, fileRoot)
        if (!elements && p.elements.length) elements = p.elements
        const merged = { ...p.textures }
        for (const k in textures) merged[k] = textures[k]
        return { elements: elements || [], textures: merged }
      } catch {}
    }
  }
  return { elements: elements || [], textures }
}

export async function resolveMcModel(api, packName, rel, depth = 0, fileRoot) {
  const { elements, textures } = await resolveMcModelRaw(api, packName, rel, depth, fileRoot)
  return { elements, textures: expandTextureAliases(textures) }
}

/* ── 1.21.4+ 物品模型定义（assets/<ns>/items/*.json）────────
   结构：{ model: <节点> }，节点按 type 递归解析出要渲染的普通模型引用：
     model          → 引用 models/ 路径（可带 transformation / tints）
     condition      → 取 on_false（属性默认未满足态，如弓未拉弦）
     select / range_dispatch → 取 fallback
     composite      → 收集 models 数组全部引用（多模型合并渲染）
     special        → base 引用（盾/旗等内置实体渲染之外的基础形状）
   未知类型忽略；tints（染色）不影响几何，跳过 */
export function resolveItemDefRefs(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > MAX_ITEM_DEF_DEPTH) return out
  const type = typeof node.type === 'string' ? node.type.replace(/^[^:]*:/, '') : ''
  switch (type) {
    case 'model':
      if (typeof node.model === 'string' && node.model) {
        out.push({ model: node.model, transformation: node.transformation || null, tints: Array.isArray(node.tints) ? node.tints : null })
      }
      break
    case 'condition':
      resolveItemDefRefs(node.on_false, out, depth + 1)
      break
    case 'select':
    case 'range_dispatch':
      resolveItemDefRefs(node.fallback, out, depth + 1)
      break
    case 'composite':
      for (const m of Array.isArray(node.models) ? node.models : []) {
        resolveItemDefRefs(m, out, depth + 1)
      }
      break
    case 'special':
      if (typeof node.base === 'string' && node.base) {
        out.push({ model: node.base, transformation: node.transformation || null })
      }
      break
    default: break
  }
  return out
}

/* item 定义路径判定（assets/<ns>/items/*.json，与 models/ 路径区分） */
export function isItemDefPath(rel) {
  return typeof rel === 'string' && /^assets\/[^/]+\/items\/[^/]+\.json$/.test(rel)
}

/* 模板模型文件名判定（template_*）：vanilla 约定模板自身不定义 textures，由子模型注入 */
export function isTemplateModelName(rel) {
  if (typeof rel !== 'string') return false
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  return name.startsWith('template_')
}

/* 模板模型（template_*）直接预览时 textures 全空 → 所有面回退灰色占位。借用同级目录下
   引用该模板为 parent 的子模型的 textures，让模板也能显示真实贴图。仅包模式生效
   （fileRoot 模式无列目录接口）；最多探测 60 个候选 .json，命中首个含贴图的子模型即止 */
export async function borrowTemplateTextures(api, packName, rel, fileRoot) {
  if (fileRoot || typeof api !== 'string' || typeof packName !== 'string' || !packName) return null
  const li = rel.lastIndexOf('/')
  if (li < 0) return null
  const dir = rel.slice(0, li)
  const selfName = rel.slice(li + 1)
  const m = rel.match(/^assets\/([^/]+)\/models\/(.+)\.json$/)
  if (!m) return null
  const withNs = m[1] + ':' + m[2]
  const noNs = m[2]
  let entries
  try {
    entries = await fetchOkData(`${api}/${encodeURIComponent(packName)}/entries?dir=${encodeURIComponent(dir)}`)
  } catch { return null }
  const files = (entries && Array.isArray(entries.files)) ? entries.files : []
  const candidates = files.map(f => f && f.name).filter(n =>
    typeof n === 'string' && n.endsWith('.json') && n !== selfName && !n.startsWith('template_'))
  for (const name of candidates.slice(0, 60)) {
    const childRel = dir + '/' + name
    let child
    try { child = await fetchJson(rawUrl(api, packName, childRel, fileRoot, true)) } catch { continue }
    if (!child || typeof child !== 'object' || typeof child.parent !== 'string') continue
    const cp = child.parent
    const cpNoNs = cp.includes(':') ? cp.slice(cp.indexOf(':') + 1) : cp
    if (cp !== withNs && cp !== noNs && cpNoNs !== withNs && cpNoNs !== noNs) continue
    const ct = (child.textures && typeof child.textures === 'object') ? child.textures : null
    if (ct && Object.keys(ct).length) return ct
  }
  return null
}

/* 统一模型资产解析入口：rel 为 models/ 路径或 items/ 定义路径。
    返回 { parts: [{ elements, textures, transform }] }（多 parts 仅出现在 composite）；
    模型文件不存在 / 非法 → parts 空（shown:false 语义） */
export async function resolveMcModelAsset(api, packName, rel, fileRoot) {
  if (!isItemDefPath(rel)) {
    try {
      let { elements, textures } = await resolveMcModel(api, packName, rel, 0, fileRoot)
      /* 模板模型贴图借用：有几何体 + textures 全空 + 文件名 template_* → 借子模型 textures */
      if (elements.length && !Object.keys(textures).length && isTemplateModelName(rel)) {
        const borrowed = await borrowTemplateTextures(api, packName, rel, fileRoot)
        if (borrowed) textures = expandTextureAliases(borrowed)
      }
      return { parts: [{ elements, textures, transform: null, tints: null }] }
    } catch {
      return { parts: [] }
    }
  }
  const url = rawUrl(api, packName, rel, fileRoot, true)
  let def = null
  try { def = await fetchJson(url) } catch {}
  const refs = resolveItemDefRefs(def && def.model).slice(0, MAX_ITEM_DEF_REFS)
  const parts = []
  for (const r of refs) {
    const mp = parentModelPath(r.model)
    if (!mp) continue
    try {
      const { elements, textures } = await resolveMcModel(api, packName, mp, 0, fileRoot)
      parts.push({ elements, textures, transform: r.transformation || null, tints: r.tints || null })
    } catch {}
  }
  return { parts }
}

/* item 定义 transformation（块单位）应用到子模型 Group：
   顶点变换 T + L*(S*(R*v))——外层 position/quaternion 承载 T/L，scale 承载 S，
   right_rotation 非单位四元数时经内层 Group 承载 R（保持与 vanilla 组合顺序一致）。
   负 scale（镜像）翻转三角绕序，材质置 DoubleSide 防背面剔除消失 */
export function applyItemTransformation(group, tr) {
  if (!group || !tr || typeof tr !== 'object') return group
  const t = Array.isArray(tr.translation) ? tr.translation : null
  if (t && t.length >= 3 && t.every(n => Number.isFinite(+n))) {
    group.position.set(+t[0], +t[1], +t[2])
  }
  const toQuat = (q) => {
    if (!Array.isArray(q) || q.length < 4 || !q.every(n => Number.isFinite(+n))) return null
    return new THREE.Quaternion(+q[0], +q[1], +q[2], +q[3]).normalize()
  }
  const lq = toQuat(tr.left_rotation)
  if (lq) group.quaternion.copy(lq)
  const s = Array.isArray(tr.scale) ? tr.scale : null
  const rq = toQuat(tr.right_rotation)
  if (s && s.length >= 3 && s.every(n => Number.isFinite(+n))) {
    group.scale.set(+s[0], +s[1], +s[2])
    if (rq) {
      const inner = new THREE.Group()
      inner.quaternion.copy(rq)
      for (const c of [...group.children]) inner.add(c)
      group.add(inner)
    }
    if (+s[0] < 0 || +s[1] < 0 || +s[2] < 0) {
      group.traverse(o => {
        const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])
        for (const m of mats) { if (m && !(m.userData && m.userData.shared)) m.side = THREE.DoubleSide }
      })
    }
  }
  return group
}



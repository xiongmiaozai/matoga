/**
 * matoga - 材质 3D 视口：view
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */

import * as THREE from 'three'
import { showCustomModel, showCustomModelPair, hasVisibleViewport, applyPbrMapsToModelMaterial } from '../material3d.js'
import { apiUrl, fetchJson, fetchOkData, rawUrl, texCacheKey } from './utils.js'
import { TEX_REF_EXT_RE, expandTextureAliases, isSpecialTexPath, resolveTextureRef, spriteTexKey, texPathForRef, texUrlToRef, writeMcTexRef } from './tex-refs.js'
import { FACE_KEYS, MAT_INDEX, MAX_ELEMENTS, PLACEHOLDER_MAT, applyFaceUvs, buildModelGroup, defaultFaceUv, expandElementFaces, normFaceRotation, parseUv, parseVec3 } from './geometry.js'
import { applyItemTransformation, parentModelPath, resolveMcModelAsset, resolveMcModelRaw } from './model-resolve.js'
import { bbMatFor, buildItemSpriteGroup, mcMatFor } from './textures.js'
import { buildBbLayout, buildMcLayout, buildSpriteLayout, getLastModelLayout, setLastLayout, notifyModelShown } from './layout.js'
import { bindActiveModel } from './face-edit.js'

/* 获取导入模型 JSON（data/imported-models，可能是 .bbmodel 或 MC .json；供缩略图/视口复用） */
export async function fetchImportedModelJson(id) {
  const data = await fetchOkData('/api/imported-models/' + encodeURIComponent(id))
  const json = data && data.json
  return (json && typeof json === 'object') ? json : null
}

/* MC 包内 .json 模型（models/ 路径或 items/ 物品定义）→ 3D 视口；返回 { shown, noElements } */
export async function viewMcModelInViewport({ api, packName, rel, fileRoot }) {
  const { parts } = await resolveMcModelAsset(api, packName, rel, fileRoot)
  let noElements = false
  let layout = null
  const subs = []
  let anyTransform = false
  for (const part of parts) {
    let sub = null
    let partLayout = null
    if (part.elements.length) {
      sub = buildModelGroup(part.elements, mcMatFor(part.textures, api, packName, fileRoot), 16)
      partLayout = buildMcLayout(part.elements, part.textures, api, packName, fileRoot)
    } else {
      /* sprite 合成 element（mesh 挂引用 → 贴图替换联动；UV 编辑不适用） */
      const spriteEl = { faces: { sprite: { texture: spriteTexKey(part.textures) || undefined } } }
      sub = buildItemSpriteGroup(part.textures, api, packName, fileRoot)
      if (sub && sub.children[0]) sub.children[0].userData.mcElement = spriteEl
      noElements = true
      partLayout = buildSpriteLayout(part.textures, api, packName, spriteEl, fileRoot)
    }
    if (!sub || !sub.children.length) continue
    if (part.transform) { applyItemTransformation(sub, part.transform); anyTransform = true }
    if (!layout && partLayout) layout = partLayout
    subs.push(sub)
  }
  if (!subs.length) return { shown: false, noElements }
  /* 单部件无变换：直接展示（保持既有层级契约，children[0] 即 Mesh）；
     多部件/带变换：外层合并 Group——transformation 在内层子 Group 上，
     不被视口归一化（showCustomModel 重设 position/scale）覆盖 */
  let group
  if (subs.length === 1 && !anyTransform) group = subs[0]
  else { group = new THREE.Group(); for (const s of subs) group.add(s) }
  const shown = showCustomModel(group)
  if (shown) {
    setLastLayout(layout)
    notifyModelShown(getLastModelLayout())
    bindActiveModel(group, { type: 'mc', parts, filename: rel.split('/').pop() || 'model.json', ctx: { api, packName } })
  }
  return { shown, noElements }
}


export async function buildMcGroupFromRel(fileRoot, rel, texRoot, overrideUrl) {
  const texSource = texRoot || fileRoot
  const fbRoot = (texRoot && !overrideUrl) ? fileRoot : undefined
  const { parts } = await resolveMcModelAsset(undefined, undefined, rel, fileRoot)
  let layout = null
  const subs = []
  let anyTransform = false
  for (const part of parts) {
    let sub = null
    let partLayout = null
    if (part.elements.length) {
      sub = buildModelGroup(part.elements, mcMatFor(part.textures, undefined, undefined, texSource, fbRoot, overrideUrl), 16)
      partLayout = buildMcLayout(part.elements, part.textures, undefined, undefined, texSource)
    } else {
      const spriteEl = { faces: { sprite: { texture: spriteTexKey(part.textures) || undefined } } }
      sub = buildItemSpriteGroup(part.textures, undefined, undefined, texSource)
      if (sub && sub.children[0]) sub.children[0].userData.mcElement = spriteEl
      partLayout = buildSpriteLayout(part.textures, undefined, undefined, spriteEl, texSource)
    }
    if (!sub || !sub.children.length) continue
    if (part.transform) { applyItemTransformation(sub, part.transform); anyTransform = true }
    if (!layout && partLayout) layout = partLayout
    subs.push(sub)
  }
  if (!subs.length) return null
  let group
  if (subs.length === 1 && !anyTransform) group = subs[0]
  else { group = new THREE.Group(); for (const s of subs) group.add(s) }
  return { group, layout, parts, filename: rel.split('/').pop() || 'model.json' }
}

export async function viewMcModelPairInViewport({ left, right, isStale }) {
  const [lr, rr] = await Promise.all([
    left ? buildMcGroupFromRel(left.fileRoot, left.rel).catch(() => null) : Promise.resolve(null),
    right ? buildMcGroupFromRel(right.fileRoot, right.rel).catch(() => null) : Promise.resolve(null),
  ])
  if (isStale && isStale()) return { shown: false }
  if (!lr && !rr) return { shown: false }
  const shown = showCustomModelPair(lr && lr.group, rr && rr.group)
  if (shown) {
    setLastLayout((lr && lr.layout) || (rr && rr.layout))
    notifyModelShown(getLastModelLayout())
    if (lr) bindActiveModel(lr.group, { type: 'mc', parts: lr.parts, filename: lr.filename })
    else if (rr) bindActiveModel(rr.group, { type: 'mc', parts: rr.parts, filename: rr.filename })
  }
  return { shown }
}

/* 贴图效果对比：左=左模型+左贴图，右=右模型+右贴图（模型或贴图缺失回退左侧）。
   右侧展示替换后模型与贴图的组合效果；左侧模型缺失时两侧几何均取右侧模型 */
export async function viewMcModelTexCompareInViewport({ left, right, rightRoot, leftTexUrl, rightTexUrl, isStale }) {
  const rGeo = right || left
  const [lr, rr] = await Promise.all([
    left ? buildMcGroupFromRel(left.fileRoot, left.rel, null, leftTexUrl).catch(() => null) : Promise.resolve(null),
    rGeo ? buildMcGroupFromRel(rGeo.fileRoot, rGeo.rel, rGeo === right ? rightRoot : rGeo.fileRoot, rightTexUrl).catch(() => null) : Promise.resolve(null),
  ])
  if (isStale && isStale()) return { shown: false }
  if (!lr && !rr) return { shown: false }
  const shown = showCustomModelPair(lr && lr.group, rr && rr.group)
  if (shown) {
    setLastLayout((lr && lr.layout) || (rr && rr.layout))
    notifyModelShown(getLastModelLayout())
    if (lr) bindActiveModel(lr.group, { type: 'mc', parts: lr.parts, filename: lr.filename })
  }
  return { shown }
}

/* 获取模型引用的材质贴图列表（不展示，供预览面板列出"对应的材质有哪些"）：
   合并所有 parts（composite 多部件）的 layout.textures 并按贴图名去重。
   与 viewMcModelInViewport 同解析路径，但不构建几何/不进视口，轻量 */

/* 导入模型（data/imported-models/<id>/model.*，.bbmodel 或 MC .json）→ 3D 视口；返回 { shown } */
export async function viewImportedModelInViewport({ id }) {
  const json = await fetchImportedModelJson(id)
  if (!json || typeof json !== 'object') return { shown: false }
  const isBb = !!(json.meta && (json.meta.format === 'bbmodel' || json.meta.model_format))
  if (isBb) {
    if (!Array.isArray(json.elements) || !json.elements.length) return { shown: false }
    const uvScale = Number.isFinite(+json.resolution) && +json.resolution > 0 ? +json.resolution : 16
    const group = buildModelGroup(json.elements, bbMatFor(json.textures, 'bbm:' + id), uvScale)
    if (!group.children.length) return { shown: false }
    const shown = showCustomModel(group)
    if (shown) {
      setLastLayout(buildBbLayout(json))
      notifyModelShown(getLastModelLayout())
      bindActiveModel(group, { type: 'bb', json, filename: (id || 'model') + '.bbmodel' })
    }
    return { shown }
  }
  /* MC .json：自包含 elements（导入文件无包上下文，贴图引用按命名空间解析，缺失回退占位） */
  if (!Array.isArray(json.elements) || !json.elements.length) return { shown: false }
  const textures = (json.textures && typeof json.textures === 'object') ? json.textures : {}
  const group = buildModelGroup(json.elements, mcMatFor(textures, undefined, undefined), 16)
  if (!group.children.length) return { shown: false }
  const shown = showCustomModel(group)
  if (shown) {
    const parts = [{ elements: json.elements, textures }]
    setLastLayout(buildMcLayout(json.elements, textures, undefined, undefined))
    notifyModelShown(getLastModelLayout())
    bindActiveModel(group, { type: 'mc', parts, filename: (id || 'model') + '.json' })
  }
  return { shown }
}

/* 自定义模型（data/custom-models/<id>/model.json）→ 3D 视口；返回 { shown }
    模型 JSON 自包含 elements（模板已内联展开）；若有 parent 且无 elements，
    沿官方包 parent 链合并；贴图从官方包加载（api/packName 可缺省 → 占位灰） */
export async function viewCustomModelInViewport({ id, api, packName }) {
  const model = await fetchOkData('/api/custom-models/' + encodeURIComponent(id) + '/raw')
  if (!model || typeof model !== 'object') return { shown: false }
  let elements = Array.isArray(model.elements) ? model.elements : null
  let textures = (model.textures && typeof model.textures === 'object') ? model.textures : {}
  if (model.parent) {
    const parentRel = parentModelPath(model.parent)
    if (parentRel) {
      try {
        const p = await resolveMcModelRaw(api, packName, parentRel, 0, undefined)
        if (!elements && p.elements.length) elements = p.elements
        const merged = { ...p.textures }
        for (const k in textures) merged[k] = textures[k]
        textures = merged
      } catch {}
    }
  }
  textures = expandTextureAliases(textures)
  let group = null
  let layout = null
  if (elements && elements.length) {
    group = buildModelGroup(elements, mcMatFor(textures, api, packName), 16)
    layout = buildMcLayout(elements, textures, api, packName)
  } else {
    const spriteEl = { faces: { sprite: { texture: spriteTexKey(textures) || undefined } } }
    group = buildItemSpriteGroup(textures, api, packName)
    if (group && group.children[0]) group.children[0].userData.mcElement = spriteEl
    layout = buildSpriteLayout(textures, api, packName, spriteEl)
  }
  if (!group || !group.children.length) return { shown: false }
  const shown = showCustomModel(group)
  if (shown) {
    setLastLayout(layout)
    notifyModelShown(layout)
    bindActiveModel(group, { type: 'mc', parts: [{ elements: elements || [], textures, transform: null }], filename: (id || 'custom') + '.json', ctx: { api, packName } })
  }
  return { shown }
}

export function isViewportVisible() { return hasVisibleViewport() }

// 兼容既有导入路径：以下导出已迁至子模块






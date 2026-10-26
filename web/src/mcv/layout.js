/**
 * matoga - 材质 3D 视口：layout
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */

import * as THREE from 'three'
import { apiUrl, fetchJson, fetchOkData, rawUrl, texCacheKey } from './utils.js'
import { TEX_REF_EXT_RE, expandTextureAliases, isSpecialTexPath, resolveTextureRef, spriteTexKey, texPathForRef, texUrlToRef, writeMcTexRef } from './tex-refs.js'
import { FACE_KEYS, MAT_INDEX, MAX_ELEMENTS, PLACEHOLDER_MAT, applyFaceUvs, buildModelGroup, defaultFaceUv, expandElementFaces, normFaceRotation, parseUv, parseVec3 } from './geometry.js'
import { packMcmetaUrl, texDisplayName } from './textures.js'
import { resolveMcModelAsset } from './model-resolve.js'

/* 最近一次成功展示的模型 UV 布局（uv-view 浮窗数据源） */
let lastLayout = null
export function setLastLayout(v) { lastLayout = v }


export function buildMcLayout(elements, textures, api, packName, fileRoot) {
  const texList = []
  const texPaths = []
  const texIndex = new Map()
  const texIndexOf = (texPath) => {
    if (!texIndex.has(texPath)) {
      texIndex.set(texPath, texList.length)
      texList.push({
        name: texDisplayName(texPath),
        url: rawUrl(api, packName, texPath, fileRoot, false),
        mcmetaUrl: packMcmetaUrl(api, packName, texPath, fileRoot),
      })
      texPaths.push(texPath)
    }
    return texIndex.get(texPath)
  }
  const outElements = []
  const list = (Array.isArray(elements) ? elements : []).slice(0, MAX_ELEMENTS)
  for (const el of list) {
    if (!el || typeof el !== 'object') continue
    const faces = expandElementFaces(el)
    const from = parseVec3(el.from, [0, 0, 0])
    const to = parseVec3(el.to, [16, 16, 16])
    const out = {}
    for (const key of FACE_KEYS) {
      const face = faces[key]
      if (!face || typeof face !== 'object' || typeof face.texture !== 'string') continue
      const texPath = resolveTextureRef(textures, face.texture)
      if (!texPath) continue
      const uv = parseUv(face.uv) || defaultFaceUv(key, from, to) || [0, 0, 16, 16]
      out[key] = { tex: texIndexOf(texPath), uv, rotation: normFaceRotation(face.rotation), mirror: uv[2] < uv[0] }
    }
    if (Object.keys(out).length) outElements.push({ faces: out, el })
  }
  return { type: 'mc', uvScale: 16, textures: texList, texPaths, elements: outElements }
}

/* item/generated sprite 回退布局：layer0 整幅贴图单面（spriteEl 为合成 element 引用，供贴图替换联动） */
export function buildSpriteLayout(textures, api, packName, spriteEl, fileRoot) {
  textures = (textures && typeof textures === 'object') ? textures : {}
  const texPath = resolveTextureRef(textures, spriteTexKey(textures))
  if (!texPath) return null
  return {
    type: 'mc', uvScale: 16, sprite: true,
    textures: [{
      name: texDisplayName(texPath),
      url: rawUrl(api, packName, texPath, fileRoot, false),
      mcmetaUrl: packMcmetaUrl(api, packName, texPath, fileRoot),
    }],
    texPaths: [texPath],
    elements: [{ faces: { sprite: { tex: 0, uv: [0, 0, 16, 16], rotation: 0, mirror: false } }, el: spriteEl || null }],
  }
}

/* bbmodel → 布局（无效贴图项过滤但保持索引对齐：faces.texture 引用原始数组下标）。
    texOrigin：原始 json.textures 下标 → 布局贴图索引（-1 无效项），供 UV 编辑器
    把替换后的内嵌贴图（dataURL）写回原始 bbmodel JSON 保存 */
export function buildBbLayout(json) {
  json = (json && typeof json === 'object') ? json : {}
  const uvScale = Number.isFinite(+json.resolution) && +json.resolution > 0 ? +json.resolution : 16
  const raw = Array.isArray(json.textures) ? json.textures : []
  const texList = []
  const texOrigin = raw.map(tex => {
    if (tex && typeof tex.source === 'string' && tex.source.startsWith('data:')) {
      texList.push({ name: tex.name || ('texture ' + texList.length), url: tex.source })
      return texList.length - 1
    }
    return -1
  })
  const outElements = []
  const list = (Array.isArray(json.elements) ? json.elements : []).slice(0, MAX_ELEMENTS)
  for (const el of list) {
    if (!el || typeof el !== 'object') continue
    const faces = expandElementFaces(el)
    const from = parseVec3(el.from, [0, 0, 0])
    const to = parseVec3(el.to, [16, 16, 16])
    const out = {}
    for (const key of FACE_KEYS) {
      const face = faces[key]
      if (!face || typeof face !== 'object' || face.texture == null) continue
      const ti = texOrigin[+face.texture]
      if (ti == null || ti < 0) continue
      const uv = parseUv(face.uv) || defaultFaceUv(key, from, to, uvScale) || [0, 0, uvScale, uvScale]
      out[key] = { tex: ti, uv, rotation: normFaceRotation(face.rotation), mirror: uv[2] < uv[0] }
    }
    if (Object.keys(out).length) outElements.push({ faces: out, el })
  }
  return { type: 'bb', uvScale, textures: texList, texOrigin, elements: outElements }
}

/* ── 模型编辑联动（uv-view 编辑 → 3D 实时更新 + 导出）──────────
   layout.elements[i].el 持有原始 element 引用（与 parts / bbmodel json 中的对象同一引用），
   编辑写回原始 element 后按引用从 activeElementMeshes 定位 mesh 重映射几何 UV；
   material3d 的渲染循环逐帧执行 → 变更下一帧即生效（实时预览）。 */


/* 最近一次成功展示的模型布局（无模型 / 已被清除时为 null） */
export function getLastModelLayout() { return lastLayout }

/* 模型成功展示后广播（uv-view 浮窗监听以自动刷新；无 DOM 环境安全跳过） */
export function notifyModelShown(layout) {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mcmodel:shown', { detail: { layout } }))
    }
  } catch {}
}

/* ── 对外入口 ─────────────────────────────────────── */



export async function resolveModelTexList({ api, packName, rel, fileRoot }) {
  const { parts } = await resolveMcModelAsset(api, packName, rel, fileRoot)
  const seen = new Map()
  for (const part of parts) {
    let lay = null
    if (part.elements.length) {
      lay = buildMcLayout(part.elements, part.textures, api, packName, fileRoot)
    } else {
      const spriteEl = { faces: { sprite: { texture: spriteTexKey(part.textures) || undefined } } }
      lay = buildSpriteLayout(part.textures, api, packName, spriteEl, fileRoot)
    }
    if (!lay || !Array.isArray(lay.textures)) continue
    for (const tx of lay.textures) {
      if (tx && typeof tx.name === 'string' && !seen.has(tx.name)) seen.set(tx.name, tx.url)
    }
  }
  return [...seen].map(([name, url]) => ({ name, url }))
}





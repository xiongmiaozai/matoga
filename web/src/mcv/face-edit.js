/**
 * matoga - 材质 3D 视口：face-edit
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */

import * as THREE from 'three'
import { apiUrl, fetchJson, fetchOkData, rawUrl, texCacheKey } from './utils.js'
import { TEX_REF_EXT_RE, expandTextureAliases, isSpecialTexPath, resolveTextureRef, spriteTexKey, texPathForRef, texUrlToRef, writeMcTexRef } from './tex-refs.js'
import { FACE_KEYS, MAT_INDEX, MAX_ELEMENTS, PLACEHOLDER_MAT, applyFaceUvs, buildModelGroup, defaultFaceUv, expandElementFaces, normFaceRotation, parseUv, parseVec3 } from './geometry.js'
import { animatedTexs, attachPackTexture, loadAnimMetaCached } from './anim.js'
import { applyTexParams } from './anim.js'
import { getLastModelLayout } from './layout.js'
import { makeModelMaterial } from './textures.js'
import { applyPbrMapsToModelMaterial } from '../material3d.js'

export const activeElementMeshes = new Map()   /* 原始 element → mesh（当前展示模型） */
export let activeExportModel = null            /* 导出信息：{ type:'mc', parts, filename } | { type:'bb', json, filename } */

/* 展示成功后绑定：收集 mesh.userData.mcElement → mesh 映射 + 导出信息（bindActiveModel 也可供测试注入）；
    exportModel.ctx = { api, packName } 模型包上下文（mc 包模式传入，替换贴图时用于
    判断能否把新贴图转成标准 MC 引用；im/bb 等无包上下文不传 → 一律扩展引用形式） */
export function bindActiveModel(group, exportModel) {
  activeElementMeshes.clear()
  activeExportModel = exportModel || null
  if (!group || typeof group.traverse !== 'function') return
  group.traverse(o => {
    if (o && o.isMesh && o.userData && o.userData.mcElement) activeElementMeshes.set(o.userData.mcElement, o)
  })
}

/* 编辑落成显式 face（来自 "all" 展开或默认 UV 的面：显式定义优先，与 Blockbench 语义一致） */
export function ensureExplicitFace(el, faceKey) {
  if (!el || typeof el !== 'object') return null
  if (!el.faces || typeof el.faces !== 'object') el.faces = {}
  let f = el.faces[faceKey]
  if (f && typeof f === 'object') return f
  const expanded = expandElementFaces(el)
  const src = expanded[faceKey]
  const tex = (src && typeof src === 'object' && typeof src.texture === 'string') ? src.texture : undefined
  f = tex != null ? { texture: tex } : {}
  el.faces[faceKey] = f
  return f
}

export function remapMeshFaceUv(mesh, el) {
  applyFaceUvs(
    mesh.geometry, el.faces,
    mesh.userData.uvScale || 16,
    parseVec3(el.from, [0, 0, 0]), parseVec3(el.to, [16, 16, 16]),
  )
}

/* UV 编辑写回：原始 element face.uv 更新 + mesh 几何 UV 重映射（视口下一帧生效）；返回是否联动成功 */
export function updateModelFaceUv(element, faceKey, uv) {
  const mesh = activeElementMeshes.get(element)
  if (!mesh || !mesh.geometry) return false
  if (!Array.isArray(uv) || uv.length !== 4 || !uv.every(n => Number.isFinite(+n))) return false
  const face = ensureExplicitFace(element, faceKey)
  if (!face) return false
  face.uv = [+uv[0], +uv[1], +uv[2], +uv[3]]
  remapMeshFaceUv(mesh, element)
  return true
}

/* 面贴图旋转（0/90/180/270）写回 + 重映射 */
export function updateModelFaceRotation(element, faceKey, rotation) {
  const mesh = activeElementMeshes.get(element)
  if (!mesh || !mesh.geometry) return false
  const face = ensureExplicitFace(element, faceKey)
  if (!face) return false
  face.rotation = Number.isFinite(+rotation) ? (((Math.round(+rotation / 90) * 90) % 360) + 360) % 360 : 0
  remapMeshFaceUv(mesh, element)
  return true
}

/* 材质贴图替换（编辑器自定义贴图）：阻断旧贴图异步加载竞态 + 摘除动画注册 */
export function swapFaceTexture(mat, tex) {
  if (!mat || (mat.userData && mat.userData.shared)) return false
  mat.userData.replaced = true
  if (mat.map && animatedTexs.has(mat.map)) animatedTexs.delete(mat.map)
  mat.map = tex
  mat.needsUpdate = true
  return true
}

/* 材质贴图清除（编辑器移除材质）：map 置 null → 纯色面 */
export function clearFaceTexture(mat) {
  if (!mat || (mat.userData && mat.userData.shared)) return false
  mat.userData.replaced = true
  if (mat.map && animatedTexs.has(mat.map)) animatedTexs.delete(mat.map)
  mat.map = null
  mat.needsUpdate = true
  return true
}

/* 贴图替换：dataURL 或可加载 URL（贴图库 raw URL）→ 更新 layout 中引用 texIndex 的所有面材质（含 sprite 单材质面）。
     替换成功后把新贴图引用写回模型 textures 表（智能引用：同包 → 标准 MC 引用，
     其他 → 扩展引用），导出/保存即持久化，重新打开模型自动加载。
     extra（材质球配套）：{ normal, specular } URL 字符串 → 同步应用到面材质做 3D 视口 PBR 预览
     （空串清除对应 map；extra 省略则不动 PBR，保持模型加载时自动配的 PBR） */
export async function updateModelTexture(texIndex, texUrl, layout, extra) {
  const lay = layout || getLastModelLayout()
  if (!lay || !Array.isArray(lay.elements)) return false
  if (typeof texUrl !== 'string' || !(texUrl.startsWith('data:') || /^https?:\/\//i.test(texUrl) || texUrl.startsWith('/'))) return false
  let tex = null
  try {
    tex = await new THREE.TextureLoader().loadAsync(texUrl)
  } catch { return false }
  if (!tex) return false
  applyTexParams(tex)
  let touched = 0
  for (const layEl of lay.elements) {
    const mesh = (layEl && layEl.el) ? activeElementMeshes.get(layEl.el) : null
    if (!mesh) continue
    for (const key in layEl.faces) {
      const lf = layEl.faces[key]
      if (!lf || lf.tex !== texIndex) continue
      const mi = MAT_INDEX[key]
      if (mi != null && Array.isArray(mesh.material)) {
        let mat = mesh.material[mi]
        if (!mat || (mat.userData && mat.userData.shared)) {
          mat = makeModelMaterial(null)
          mesh.material[mi] = mat
        }
        if (swapFaceTexture(mat, tex)) { touched++; if (extra) applyPbrMapsToModelMaterial(mat, extra.normal, extra.specular, true) }
      } else if (mi == null && mesh.material && !Array.isArray(mesh.material)) {
        if (swapFaceTexture(mesh.material, tex)) { touched++; if (extra) applyPbrMapsToModelMaterial(mesh.material, extra.normal, extra.specular, true) }
      }
    }
  }
  writeBackTexRef(texIndex, texUrl, lay)
  return touched > 0
}

/* 移除材质：清空 layout 中引用 texIndex 的所有面材质贴图（面变纯色；含 sprite 单材质面）。
    引用同步写回空值（重新打开模型 → 面灰色） */
export function clearModelTexture(texIndex, layout) {
  const lay = layout || getLastModelLayout()
  if (!lay || !Array.isArray(lay.elements)) return false
  let touched = 0
  for (const layEl of lay.elements) {
    const mesh = (layEl && layEl.el) ? activeElementMeshes.get(layEl.el) : null
    if (!mesh) continue
    for (const key in layEl.faces) {
      const lf = layEl.faces[key]
      if (!lf || lf.tex !== texIndex) continue
      const mi = MAT_INDEX[key]
      if (mi != null && Array.isArray(mesh.material)) {
        let mat = mesh.material[mi]
        if (!mat || (mat.userData && mat.userData.shared)) {
          mat = makeModelMaterial(null)
          mesh.material[mi] = mat
        }
        if (clearFaceTexture(mat)) touched++
      } else if (mi == null && mesh.material && !Array.isArray(mesh.material)) {
        if (clearFaceTexture(mesh.material)) touched++
      }
    }
  }
  writeBackTexRef(texIndex, '', lay)
  return touched > 0
}

/* 贴图引用写回（uv 编辑替换/移除 → 模型数据持久化）：
    mc：texPaths 定位旧路径 → 解析命中键改写为智能引用（texPaths 同步更新支持连续替换）；
    bb：texOrigin 定位原始下标写 source（dataURL 直接写；站内 URL 异步 fetch 转 dataURL，
    转换失败保留 URL 兜底） */
export function writeBackTexRef(texIndex, texUrl, lay) {
  const m = activeExportModel
  if (!m || !lay) return
  if (m.type === 'bb' && m.json && Array.isArray(lay.texOrigin) && Array.isArray(m.json.textures)) {
    const src = String(texUrl || '')
    for (let rawIdx = 0; rawIdx < lay.texOrigin.length; rawIdx++) {
      if (lay.texOrigin[rawIdx] !== texIndex || !m.json.textures[rawIdx]) continue
      if (src.startsWith('data:')) {
        m.json.textures[rawIdx].source = src
      } else if (src.startsWith('/')) {
        fetch(apiUrl(src))
          .then(r => (r.ok ? r.blob() : null))
          .then(blob => (blob ? new Promise((resolve) => {
            const rd = new FileReader()
            rd.onload = () => resolve(String(rd.result))
            rd.onerror = () => resolve(null)
            rd.readAsDataURL(blob)
          }) : null))
          .then(dataUrl => { if (dataUrl) m.json.textures[rawIdx].source = dataUrl })
          .catch(() => {})
      }
    }
    return
  }
  if (m.type === 'mc' && Array.isArray(lay.texPaths) && Array.isArray(m.parts)) {
    const oldPath = lay.texPaths[texIndex]
    if (typeof oldPath !== 'string') return
    const ref = texUrlToRef(texUrl, m.ctx)
    if (ref == null) return
    for (const p of m.parts) {
      if (p && p.textures) writeMcTexRef(p.textures, oldPath, ref)
    }
    lay.texPaths[texIndex] = texPathForRef(ref)
  }
}

/* UV 视图 hover/选中 → 3D 视口对应面 emissive 高亮 */
export let highlightedFace = null   /* { element, faceKey, mat } */

export function highlightModelFace(element, faceKey, on) {
  if (highlightedFace) {
    try { if (highlightedFace.mat.emissive) highlightedFace.mat.emissive.setHex(0x000000) } catch {}
    highlightedFace = null
  }
  if (!on) return true
  const mesh = activeElementMeshes.get(element)
  if (!mesh) return false
  const mi = MAT_INDEX[faceKey]
  const mat = (mi != null && Array.isArray(mesh.material))
    ? mesh.material[mi]
    : ((mi == null && mesh.material && !Array.isArray(mesh.material)) ? mesh.material : null)
  if (!mat || (mat.userData && mat.userData.shared)) return false
  try {
    if (!mat.emissive) return false
    mat.emissive.setHex(0x2e4a8f)
    highlightedFace = { element, faceKey, mat }
    return true
  } catch { return false }
}

/* 导出当前模型 JSON（编辑直接写回原始 element 引用 → 序列化即包含 UV 修改；
   mc 为烘焙后的独立模型（parent 链已合并），bb 为完整 bbmodel） */
export function exportActiveModelJson() {
  const m = activeExportModel
  if (!m) return null
  if (m.type === 'bb' && m.json && typeof m.json === 'object') {
    return { filename: m.filename || 'model.bbmodel', json: m.json }
  }
  const parts = Array.isArray(m.parts) ? m.parts : []
  const textures = {}
  const elements = []
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue
    for (const k in (p.textures || {})) if (textures[k] == null) textures[k] = p.textures[k]
    for (const el of (p.elements || [])) elements.push(el)
  }
  if (!elements.length) return null
  return { filename: m.filename || 'model.json', json: { textures, elements } }
}




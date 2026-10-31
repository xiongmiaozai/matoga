/**
 * matoga - MC 模型：模型高亮与导出
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：面高亮（emissive 切换）、当前模型 JSON 导出、编辑态绑定
 */

/* 模块状态：只读用 getter；可写用 get/set 成对（§2.2） */
let _get_activeElementMeshes = () => undefined
let _get_MAT_INDEX = () => undefined
let _get_activeExportModel = () => undefined
let _set_activeExportModel = () => {}
let _get_highlightedFace = () => undefined
let _set_highlightedFace = () => {}

export function setHooks(h) {
  if (h.get_activeElementMeshes) _get_activeElementMeshes = h.get_activeElementMeshes
  if (h.get_MAT_INDEX) _get_MAT_INDEX = h.get_MAT_INDEX
  if (h.get_activeExportModel) _get_activeExportModel = h.get_activeExportModel
  if (h.set_activeExportModel) _set_activeExportModel = h.set_activeExportModel
  if (h.get_highlightedFace) _get_highlightedFace = h.get_highlightedFace
  if (h.set_highlightedFace) _set_highlightedFace = h.set_highlightedFace
}

export function bindActiveModel(group, exportModel, append = false) {
  if (!append) {
    _get_activeElementMeshes().clear()
    _set_activeExportModel(exportModel || null)
  }
  if (!group || typeof group.traverse !== 'function') return
  group.traverse(o => {
    if (o && o.isMesh && o.userData && o.userData.mcElement) _get_activeElementMeshes().set(o.userData.mcElement, o)
  })
}

export function highlightModelFace(element, faceKey, on) {
  if (_get_highlightedFace()) {
    try {
      if (_get_highlightedFace().mat.emissive) _get_highlightedFace().mat.emissive.setHex(0x000000)
    } catch {}
    _set_highlightedFace(null)
  }
  if (!on) return true
  const mesh = _get_activeElementMeshes().get(element)
  if (!mesh) return false
  const mi = _get_MAT_INDEX()[faceKey]
  const mat =
    mi != null && Array.isArray(mesh.material)
      ? mesh.material[mi]
      : mi == null && mesh.material && !Array.isArray(mesh.material)
        ? mesh.material
        : null
  if (!mat || (mat.userData && mat.userData.shared)) return false
  try {
    if (!mat.emissive) return false
    mat.emissive.setHex(0x2e4a8f)
    _set_highlightedFace({ element, faceKey, mat })
    return true
  } catch {
    return false
  }
}

export function exportActiveModelJson() {
  const m = _get_activeExportModel()
  if (!m) return null
  if (m.type === 'bb' && m.json && typeof m.json === 'object') {
    return { filename: m.filename || 'model.bbmodel', json: m.json }
  }
  const parts = Array.isArray(m.parts) ? m.parts : []
  const textures = {}
  const elements = []
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue
    for (const k in p.textures || {}) if (textures[k] == null) textures[k] = p.textures[k]
    for (const el of p.elements || []) elements.push(el)
  }
  if (!elements.length) return null
  return { filename: m.filename || 'model.json', json: { textures, elements } }
}

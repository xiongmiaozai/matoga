/**
 * matoga - 材质 3D 视口：dispose-utils
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */

import { unloadTextureAnim } from '../mcv/anim.js'

export function disposeTexture(tex) { if (tex && tex.dispose) { unloadTextureAnim(tex); tex.dispose() } }
export function disposeAllMaterialTextures(m) { disposeTexture(m.map); disposeTexture(m.normalMap); disposeTexture(m.roughnessMap); disposeTexture(m.metalnessMap); disposeTexture(m.emissiveMap); if (m.userData.shaderRefs) { disposeTexture(m.userData.shaderRefs.heightMap.value); m.userData.shaderRefs.heightMap.value = null; m.userData.shaderRefs.hasHeightMap.value = 0.0 } disposeTexture(m.userData.pendingHeightMap); m.userData.pendingHeightMap = null; m.map = null; m.normalMap = null; m.roughnessMap = null; m.metalnessMap = null; m.emissiveMap = null; m.emissive.set(0x000000); m.emissiveIntensity = 1.0; m.color.set(0x888888) }


export function disposeGroupDeep(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose()
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])
    /* userData.shared 标记的跨模型共享材质（隐藏面/占位）不 dispose */
    for (const m of mats) { if (!(m && m.userData && m.userData.shared)) m.dispose() }
  })
}

/* ════════════════════════════════════════════════════════════
   节点编辑器联动 API
   ════════════════════════════════════════════════════════════ */

export function clamp01(v) { return Math.max(0, Math.min(1, v)) }

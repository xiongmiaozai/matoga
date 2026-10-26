/**
 * matoga - 材质 3D 视口：custom-model
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */
import { S, FLY_KEYS, FLY_SPEED, FLY_BOOST } from './state.js'
import { clamp01, disposeAllMaterialTextures, disposeGroupDeep, disposeTexture } from './dispose-utils.js'
import { applySourceSide } from './textures.js'

export function showCustomModel(group) {
  if (!S.initialized || !group) return false
  clearCustomModel()
  try {
    const box = new THREE.Box3().setFromObject(group)
    if (box.isEmpty()) return false
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    const scale = 2.0 / maxDim
    group.position.set(-center.x, -center.y, -center.z)
    group.scale.setScalar(scale)
    const wrapper = new THREE.Group()
    wrapper.add(group)
    /* 底面贴地（地面 y=-1.3）：wrapper 原点在缩放后模型中心 */
    const halfY = (size.y * scale) / 2
    wrapper.position.y = -1.28 + halfY
    S.meshLeft.visible = false; S.meshRight.visible = false
    S.labelLeft.visible = false; S.labelRight.visible = false
    S.customModelGroup = wrapper
    S.scene.add(wrapper)

    return true
  } catch { return false }
}

export function showCustomModelPair(leftGroup, rightGroup) {
  if (!S.initialized) return false
  if (!leftGroup && !rightGroup) return false
  clearCustomModel()
  try {
    const wrapper = new THREE.Group()
    let added = 0
    const place = (grp, x) => {
      if (!grp) return
      const box = new THREE.Box3().setFromObject(grp)
      if (box.isEmpty()) return
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z) || 1
      const scale = 1.5 / maxDim
      grp.position.set(-center.x, -center.y, -center.z)
      grp.scale.setScalar(scale)
      const sub = new THREE.Group()
      sub.add(grp)
      const halfY = (size.y * scale) / 2
      sub.position.set(x, -1.28 + halfY, 0)
      wrapper.add(sub)
      added++
    }
    place(leftGroup, -1.1)
    place(rightGroup, 1.1)
    if (added === 0) return false
    S.meshLeft.visible = false; S.meshRight.visible = false
    S.labelLeft.visible = true; S.labelRight.visible = true
    S.labelLeft.position.set(-1.1, -0.95, 0); S.labelRight.position.set(1.1, -0.95, 0)
    S.customModelGroup = wrapper
    S.scene.add(wrapper)

    return true
  } catch { return false }
}

export function clearCustomModel() {
  if (!S.customModelGroup) return
  S.scene.remove(S.customModelGroup)
  disposeGroupDeep(S.customModelGroup)
  S.customModelGroup = null
  if (S.initialized) applySourceSide()
}

export function isCustomModelActive() { return !!S.customModelGroup }


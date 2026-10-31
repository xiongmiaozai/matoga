/**
 * matoga - MC 模型：模型杂项工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：元素变换、分组构建、贴图动画查询
 */

import * as THREE from 'three'
import { parseVec3, expandElementFaces } from '../mcv/layout-build.js'
import { applyFaceUvs } from '../mcv/tex-ref-tools.js'

/* 常量由主文件注入（§5.1：常量不搬，避免主文件引用消失） */
let _get_MAX_ELEMENTS = () => undefined
let _get_FACE_KEYS = () => undefined
let _get_HIDDEN_MAT = () => undefined
let _get_animatedTexs = () => undefined

export function setHooks(h) {
  if (h.get_MAX_ELEMENTS) _get_MAX_ELEMENTS = h.get_MAX_ELEMENTS
  if (h.get_FACE_KEYS) _get_FACE_KEYS = h.get_FACE_KEYS
  if (h.get_HIDDEN_MAT) _get_HIDDEN_MAT = h.get_HIDDEN_MAT
  if (h.get_animatedTexs) _get_animatedTexs = h.get_animatedTexs
}

export function applyElementTransform(mesh, el, center) {
  const c = [(center[0] - 8) / 16, (center[1] - 8) / 16, (center[2] - 8) / 16]
  const rot = el.rotation
  if (!rot) {
    mesh.position.set(c[0], c[1], c[2])
    return
  }
  const origin = parseVec3(Array.isArray(rot) ? el.origin : rot.origin, [8, 8, 8]).map(v => (v - 8) / 16)
  if (Array.isArray(rot)) {
    mesh.rotation.set(
      ((+rot[0] || 0) * Math.PI) / 180,
      ((+rot[1] || 0) * Math.PI) / 180,
      ((+rot[2] || 0) * Math.PI) / 180
    )
  } else if (rot.axis === 'x' || rot.axis === 'y' || rot.axis === 'z') {
    mesh.rotation[rot.axis] = ((+rot.angle || 0) * Math.PI) / 180
  } else {
    mesh.position.set(c[0], c[1], c[2])
    return
  }
  /* position = origin + R(center - origin) */
  const off = new THREE.Vector3(c[0] - origin[0], c[1] - origin[1], c[2] - origin[2])
  off.applyEuler(mesh.rotation)
  mesh.position.set(origin[0] + off.x, origin[1] + off.y, origin[2] + off.z)
}

export function buildModelGroup(elements, matFor, uvScale = 16) {
  const group = new THREE.Group()
  const scale = uvScale || 16
  const list = (Array.isArray(elements) ? elements : []).slice(0, _get_MAX_ELEMENTS())
  for (const el of list) {
    if (!el || typeof el !== 'object') continue
    const from = parseVec3(el.from, [0, 0, 0])
    const to = parseVec3(el.to, [16, 16, 16])
    const sx = Math.abs(to[0] - from[0]) || 0.01,
      sy = Math.abs(to[1] - from[1]) || 0.01,
      sz = Math.abs(to[2] - from[2]) || 0.01
    const geo = new THREE.BoxGeometry(sx / 16, sy / 16, sz / 16)
    const faces = expandElementFaces(el)
    applyFaceUvs(geo, faces, scale, from, to)
    const mats = _get_FACE_KEYS().map(key => {
      const m = matFor(key, faces[key], el)
      return m || _get_HIDDEN_MAT()
    })
    const mesh = new THREE.Mesh(geo, mats)
    mesh.castShadow = true
    mesh.receiveShadow = true
    /* 原始 element 引用（编辑联动：uv-view 编辑 UV 后按引用定位 mesh 重映射几何 UV） */
    mesh.userData.mcElement = el
    mesh.userData.uvScale = scale
    applyElementTransform(mesh, el, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2])
    group.add(mesh)
  }
  return group
}

export function applyTexAnimFrame(tex, anim, frameIndex) {
  if (!tex || !anim || !tex.repeat || !tex.offset) return tex
  const i = Math.min(Math.max(Math.round(+frameIndex || 0), 0), anim.frameCount - 1)
  const rx = anim.frameW / anim.texW
  const ry = anim.frameH / anim.texH
  const ex = 0.5 / anim.texW
  const ey = 0.5 / anim.texH
  tex.repeat.set(rx - 2 * ex, ry - 2 * ey)
  tex.offset.set(ex, 1 - (i + 1) * ry + ey)
  return tex
}

export function getModelTexAnims(group) {
  const out = []
  if (!group || typeof group.traverse !== 'function') return out
  group.traverse(o => {
    if (!o || !o.isMesh) return
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    for (const m of mats) {
      if (!m || !m.map || !_get_animatedTexs().has(m.map)) continue
      if (out.some(e => e.tex === m.map)) continue
      out.push({ tex: m.map, anim: _get_animatedTexs().get(m.map) })
    }
  })
  return out
}

export function notifyModelShown(layout) {
  try {
    if (
      typeof window !== 'undefined' &&
      typeof window.dispatchEvent === 'function' &&
      typeof CustomEvent !== 'undefined'
    ) {
      window.dispatchEvent(new CustomEvent('mcmodel:shown', { detail: { layout } }))
    }
  } catch {}
}

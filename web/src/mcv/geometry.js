/**
 * matoga - 材质 3D 视口：geometry
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */

import * as THREE from 'three'

/* 跨模型共享材质：userData.shared 标记（material3d dispose 时跳过，避免重复 dispose 后渲染失效） */
export const MAX_ELEMENTS = 4096

const HIDDEN_MAT = new THREE.MeshBasicMaterial({ visible: false })
HIDDEN_MAT.userData.shared = true
export const PLACEHOLDER_MAT = new THREE.MeshStandardMaterial({ color: 0x9a9aa8, roughness: 0.9 })
PLACEHOLDER_MAT.userData.shared = true

/* BoxGeometry 材质索引顺序（+x,-x,+y,-y,+z,-z）↔ MC 面名 */
export const FACE_KEYS = ['east', 'west', 'up', 'down', 'south', 'north']
export const MAT_INDEX = { east: 0, west: 1, up: 2, down: 3, south: 4, north: 5 }


export function parseVec3(v, fallback) {
  if (Array.isArray(v) && v.length >= 3 && v.every(n => Number.isFinite(+n))) return [+v[0], +v[1], +v[2]]
  if (typeof v === 'string') {
    const a = v.split(',').map(s => +s.trim())
    if (a.length >= 3 && a.every(n => Number.isFinite(n))) return a.slice(0, 3)
  }
  return fallback
}

export function parseUv(uv) {
  const a = Array.isArray(uv) ? uv : (typeof uv === 'string' ? uv.split(',').map(s => +s.trim()) : null)
  if (a && a.length === 4 && a.every(n => Number.isFinite(n))) return a
  return null
}

/* face.rotation（0/90/180/270，顺时针）：几何四角 [TL,TR,BL,BR] 的采样角随之轮转
   （贴图顺时针转 90° 后，原 BL 像素显示在几何 TL 位置：TL←BL, TR←TL, BL←BR, BR←TR） */
export const FACE_ROT_ORDER = {
  90:  [2, 0, 3, 1],
  180: [3, 2, 1, 0],
  270: [1, 3, 0, 2],
}

/* vanilla 默认 UV（face 无 uv 字段时按元素 from/to 尺寸计算，v 自顶向下）：
   水平面 u 取 x 范围、v 取 z 范围（down 垂直翻转）；侧面 v 取 y 范围（16-to.y → 16-from.y）；
   north/east 面贴图相对世界坐标水平翻转（观察方向所致）。
   例：蛋糕主体 [1,0,1]→[15,8,15]：up→[1,1,15,15]（cake_top 中央 14×14），
   side→u 1-15 / v 8-16（cake_side 下半），而非整张 16×16 拉伸。
   uvScale≠16（bbmodel resolution）时按比例换算 */
export function defaultFaceUv(key, from, to, uvScale = 16) {
  if (!Array.isArray(from) || !Array.isArray(to)) return null
  const fx = +from[0], fy = +from[1], fz = +from[2]
  const tx = +to[0], ty = +to[1], tz = +to[2]
  if (![fx, fy, fz, tx, ty, tz].every(Number.isFinite)) return null
  let uv
  switch (key) {
    case 'up':    uv = [fx, fz, tx, tz]; break
    case 'down':  uv = [fx, 16 - tz, tx, 16 - fz]; break
    case 'north': uv = [16 - tx, 16 - ty, 16 - fx, 16 - fy]; break
    case 'south': uv = [fx, 16 - ty, tx, 16 - fy]; break
    case 'east':  uv = [16 - tz, 16 - ty, 16 - fz, 16 - fy]; break
    case 'west':  uv = [fz, 16 - ty, tz, 16 - fy]; break
    default: return null
  }
  if (uvScale && uvScale !== 16) {
    const s = uvScale / 16
    uv = uv.map(v => v * s)
  }
  return uv
}

/* BoxGeometry 每面 4 顶点 UV（左上/右上/左下/右下）按 MC 像素坐标重映射（uvScale=16 或 bbmodel resolution）
   无 uv 的 face 用 vanilla 默认 UV（按元素尺寸），防止整张贴图拉伸 */
export function applyFaceUvs(geo, faces, uvScale, from, to) {
  if (!faces || typeof faces !== 'object') return
  const uvAttr = geo.attributes.uv
  if (!uvAttr) return
  for (const key of FACE_KEYS) {
    const f = faces[key]
    if (!f || typeof f !== 'object') continue
    const uv = parseUv(f.uv) || defaultFaceUv(key, from, to, uvScale)
    if (!uv) continue
    /* u1/u2 与 v1/v2 支持翻转（uv[2] < uv[0] 时为水平镜像采样） */
    const u1 = uv[0] / uvScale, u2 = uv[2] / uvScale
    const v1 = 1 - uv[1] / uvScale, v2 = 1 - uv[3] / uvScale
    const corners = [[u1, v1], [u2, v1], [u1, v2], [u2, v2]]
    const rot = Number.isFinite(+f.rotation) ? ((Math.round(+f.rotation / 90) * 90) % 360 + 360) % 360 : 0
    const order = FACE_ROT_ORDER[rot] || [0, 1, 2, 3]
    const i = MAT_INDEX[key] * 4
    for (let k = 0; k < 4; k++) {
      const c = corners[order[k]]
      uvAttr.setXY(i + k, c[0], c[1])
    }
  }
  uvAttr.needsUpdate = true
}

/* element 变换：MC 单轴旋转 / bbmodel 欧拉旋转均绕 origin，几何中心置于元素中心 */
export function applyElementTransform(mesh, el, center) {
  const c = [(center[0] - 8) / 16, (center[1] - 8) / 16, (center[2] - 8) / 16]
  const rot = el.rotation
  if (!rot) { mesh.position.set(c[0], c[1], c[2]); return }
  const origin = parseVec3(Array.isArray(rot) ? el.origin : rot.origin, [8, 8, 8]).map(v => (v - 8) / 16)
  if (Array.isArray(rot)) {
    mesh.rotation.set(
      (+rot[0] || 0) * Math.PI / 180,
      (+rot[1] || 0) * Math.PI / 180,
      (+rot[2] || 0) * Math.PI / 180,
    )
  } else if (rot.axis === 'x' || rot.axis === 'y' || rot.axis === 'z') {
    mesh.rotation[rot.axis] = (+rot.angle || 0) * Math.PI / 180
  } else {
    mesh.position.set(c[0], c[1], c[2]); return
  }
  /* position = origin + R(center - origin) */
  const off = new THREE.Vector3(c[0] - origin[0], c[1] - origin[1], c[2] - origin[2])
  off.applyEuler(mesh.rotation)
  mesh.position.set(origin[0] + off.x, origin[1] + off.y, origin[2] + off.z)
}

/* faces "all" 简写展开（bbmodel / 社区模型）：复制到未定义的方向面（不改原对象） */
export function expandElementFaces(el) {
  let faces = (el && el.faces && typeof el.faces === 'object') ? el.faces : {}
  if (faces.all && typeof faces.all === 'object') {
    faces = { ...faces }
    for (const k of FACE_KEYS) if (!faces[k]) faces[k] = faces.all
  }
  return faces
}

/* 通用构建：elements（MC 或 bbmodel Cube）→ THREE.Group
    matFor(faceKey, faceDef, el) 返回该面材质（null/undefined → 隐藏面） */
export function buildModelGroup(elements, matFor, uvScale = 16) {
  const group = new THREE.Group()
  const scale = uvScale || 16
  const list = (Array.isArray(elements) ? elements : []).slice(0, MAX_ELEMENTS)
  for (const el of list) {
    if (!el || typeof el !== 'object') continue
    const from = parseVec3(el.from, [0, 0, 0])
    const to = parseVec3(el.to, [16, 16, 16])
    const sx = Math.abs(to[0] - from[0]) || 0.01, sy = Math.abs(to[1] - from[1]) || 0.01, sz = Math.abs(to[2] - from[2]) || 0.01
    const geo = new THREE.BoxGeometry(sx / 16, sy / 16, sz / 16)
    const faces = expandElementFaces(el)
    applyFaceUvs(geo, faces, scale, from, to)
    const mats = FACE_KEYS.map(key => {
      const m = matFor(key, faces[key], el)
      return m || HIDDEN_MAT
    })
    const mesh = new THREE.Mesh(geo, mats)
    mesh.castShadow = true; mesh.receiveShadow = true
    /* 原始 element 引用（编辑联动：uv-view 编辑 UV 后按引用定位 mesh 重映射几何 UV） */
    mesh.userData.mcElement = el
    mesh.userData.uvScale = scale
    applyElementTransform(mesh, el, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2])
    group.add(mesh)
  }
  return group
}


export function normFaceRotation(rot) {
  return Number.isFinite(+rot) ? ((Math.round(+rot / 90) * 90) % 360 + 360) % 360 : 0
}




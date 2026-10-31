/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 3D 材质预览：几何体工具
 *
 * 从 material3d.js 原样搬出，逻辑未改。仅依赖 three。
 */

import * as THREE from 'three'

export function computeTangents(geometry) {
  const index = geometry.index
  const positionAttribute = geometry.attributes.position
  const normalAttribute = geometry.attributes.normal
  const uvAttribute = geometry.attributes.uv
  if (!positionAttribute || !normalAttribute || !uvAttribute) return geometry
  const vertexCount = positionAttribute.count
  const tan1 = new Float32Array(vertexCount * 3)
  const tan2 = new Float32Array(vertexCount * 3)
  const vA = new THREE.Vector3(),
    vB = new THREE.Vector3(),
    vC = new THREE.Vector3()
  const uvA = new THREE.Vector2(),
    uvB = new THREE.Vector2(),
    uvC = new THREE.Vector2()
  const sdir = new THREE.Vector3(),
    tdir = new THREE.Vector3()
  const handleTriangle = (a, b, c) => {
    vA.fromBufferAttribute(positionAttribute, a)
    vB.fromBufferAttribute(positionAttribute, b)
    vC.fromBufferAttribute(positionAttribute, c)
    uvA.fromBufferAttribute(uvAttribute, a)
    uvB.fromBufferAttribute(uvAttribute, b)
    uvC.fromBufferAttribute(uvAttribute, c)
    const x1 = vB.x - vA.x,
      x2 = vC.x - vA.x,
      y1 = vB.y - vA.y,
      y2 = vC.y - vA.y,
      z1 = vB.z - vA.z,
      z2 = vC.z - vA.z
    const s1 = uvB.x - uvA.x,
      s2 = uvC.x - uvA.x,
      t1 = uvB.y - uvA.y,
      t2 = uvC.y - uvA.y
    const det = s1 * t2 - s2 * t1,
      r = det === 0 ? 0 : 1 / det
    sdir.set((t2 * x1 - t1 * x2) * r, (t2 * y1 - t1 * y2) * r, (t2 * z1 - t1 * z2) * r)
    tdir.set((s1 * x2 - s2 * x1) * r, (s1 * y2 - s2 * y1) * r, (s1 * z2 - s2 * z1) * r)
    for (const i of [a, b, c]) {
      tan1[i * 3] += sdir.x
      tan1[i * 3 + 1] += sdir.y
      tan1[i * 3 + 2] += sdir.z
      tan2[i * 3] += tdir.x
      tan2[i * 3 + 1] += tdir.y
      tan2[i * 3 + 2] += tdir.z
    }
  }
  if (index) {
    for (let i = 0; i < index.count; i += 3) handleTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2))
  } else {
    for (let i = 0; i < vertexCount; i += 3) handleTriangle(i, i + 1, i + 2)
  }
  const tangentArray = new Float32Array(vertexCount * 4)
  const t = new THREE.Vector3(),
    n = new THREE.Vector3(),
    tmp = new THREE.Vector3(),
    tmp2 = new THREE.Vector3()
  for (let i = 0; i < vertexCount; i++) {
    n.fromBufferAttribute(normalAttribute, i)
    t.set(tan1[i * 3], tan1[i * 3 + 1], tan1[i * 3 + 2])
    tmp.copy(n).multiplyScalar(n.dot(t))
    t.sub(tmp).normalize()
    tmp2.set(tan2[i * 3], tan2[i * 3 + 1], tan2[i * 3 + 2])
    const w = n.cross(t).dot(tmp2) < 0 ? -1 : 1
    tangentArray[i * 4] = t.x
    tangentArray[i * 4 + 1] = t.y
    tangentArray[i * 4 + 2] = t.z
    tangentArray[i * 4 + 3] = w
  }
  geometry.setAttribute('tangent', new THREE.BufferAttribute(tangentArray, 4))
  return geometry
}

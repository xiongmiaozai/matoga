/**
 * matoga - MC 模型：模型布局构建
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：MC 元素布局与 BB 模型布局构建
 */

import { isSpecialTexPath, resolveTextureRef } from '../mcv/asset-resolve.js'
import { rawUrl } from '../mcv/paths.js'
import { parseUv } from '../mcv/tex-ref-tools.js'
import { defaultFaceUv } from '../mcv/geometry.js'

/* 常量由主文件注入（§5.1：常量不搬，避免主文件引用消失） */
let _get_FACE_KEYS = () => undefined
let _get_TEX_REF_EXT_RE = () => undefined
let _get_MAX_ELEMENTS = () => undefined

export function setHooks(h) {
  if (h.get_FACE_KEYS) _get_FACE_KEYS = h.get_FACE_KEYS
  if (h.get_TEX_REF_EXT_RE) _get_TEX_REF_EXT_RE = h.get_TEX_REF_EXT_RE
  if (h.get_MAX_ELEMENTS) _get_MAX_ELEMENTS = h.get_MAX_ELEMENTS
}

export function parseVec3(v, fallback) {
  if (Array.isArray(v) && v.length >= 3 && v.every(n => Number.isFinite(+n))) return [+v[0], +v[1], +v[2]]
  if (typeof v === 'string') {
    const a = v.split(',').map(s => +s.trim())
    if (a.length >= 3 && a.every(n => Number.isFinite(n))) return a.slice(0, 3)
  }
  return fallback
}

export function expandElementFaces(el) {
  let faces = el && el.faces && typeof el.faces === 'object' ? el.faces : {}
  if (faces.all && typeof faces.all === 'object') {
    faces = { ...faces }
    for (const k of _get_FACE_KEYS()) if (!faces[k]) faces[k] = faces.all
  }
  return faces
}

export function packMcmetaUrl(api, packName, texPath, fileRoot) {
  if (isSpecialTexPath(texPath)) return null
  return rawUrl(api, packName, texPath + '.mcmeta', fileRoot, true)
}

export function normFaceRotation(rot) {
  return Number.isFinite(+rot) ? (((Math.round(+rot / 90) * 90) % 360) + 360) % 360 : 0
}

export function texDisplayName(texPath) {
  if (isSpecialTexPath(texPath)) {
    /* 扩展引用显示名：data: → data / file: 与 URL → 取文件名去扩展 */
    if (/^data:/i.test(texPath)) return 'data'
    let raw = texPath
    try {
      if (/^file:/i.test(texPath)) raw = texPath.replace(/^file:/i, '')
      else if (/^https?:\/\//i.test(texPath)) raw = new URL(texPath).pathname
      else raw = decodeURIComponent(new URL(texPath, 'http://matoga.local').searchParams.get('path') || texPath)
    } catch {}
    return (String(raw).split('/').pop() || 'texture').replace(_get_TEX_REF_EXT_RE(), '')
  }
  return texPath.replace(/^assets\/[^/]+\/textures\//, '').replace(_get_TEX_REF_EXT_RE(), '')
}

export function buildMcLayout(elements, textures, api, packName, fileRoot) {
  const texList = []
  const texPaths = []
  const texIndex = new Map()
  const texIndexOf = texPath => {
    if (!texIndex.has(texPath)) {
      texIndex.set(texPath, texList.length)
      texList.push({
        name: texDisplayName(texPath),
        url: rawUrl(api, packName, texPath, fileRoot, false),
        mcmetaUrl: packMcmetaUrl(api, packName, texPath, fileRoot)
      })
      texPaths.push(texPath)
    }
    return texIndex.get(texPath)
  }
  const outElements = []
  const list = (Array.isArray(elements) ? elements : []).slice(0, _get_MAX_ELEMENTS())
  for (const el of list) {
    if (!el || typeof el !== 'object') continue
    const faces = expandElementFaces(el)
    const from = parseVec3(el.from, [0, 0, 0])
    const to = parseVec3(el.to, [16, 16, 16])
    const out = {}
    for (const key of _get_FACE_KEYS()) {
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

export function buildBbLayout(json) {
  json = json && typeof json === 'object' ? json : {}
  const uvScale = Number.isFinite(+json.resolution) && +json.resolution > 0 ? +json.resolution : 16
  const raw = Array.isArray(json.textures) ? json.textures : []
  const texList = []
  const texOrigin = raw.map(tex => {
    if (tex && typeof tex.source === 'string' && tex.source.startsWith('data:')) {
      texList.push({ name: tex.name || 'texture ' + texList.length, url: tex.source })
      return texList.length - 1
    }
    return -1
  })
  const outElements = []
  const list = (Array.isArray(json.elements) ? json.elements : []).slice(0, _get_MAX_ELEMENTS())
  for (const el of list) {
    if (!el || typeof el !== 'object') continue
    const faces = expandElementFaces(el)
    const from = parseVec3(el.from, [0, 0, 0])
    const to = parseVec3(el.to, [16, 16, 16])
    const out = {}
    for (const key of _get_FACE_KEYS()) {
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

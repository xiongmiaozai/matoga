/**
 * matoga - MC 模型：贴图引用与模型解析工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：贴图引用互转、父模型递归解析、模板贴图借用、面 UV 应用
 */

import { apiUrl, joinPath } from '../url-utils.js'
import { rawUrl, fetchJson, parentModelPath, fetchOkData } from '../mcv/paths.js'
import { defaultFaceUv } from '../mcv/geometry.js'

/* 常量由主文件注入（§5.1：常量不搬，避免主文件引用消失） */
let _get_modelJsonCache = () => undefined
let _get_BUILTIN_PARENT_MODELS = () => undefined
let _get_MAX_PARENT_DEPTH = () => undefined
let _get_FACE_KEYS = () => undefined
let _get_FACE_ROT_ORDER = () => undefined
let _get_MAT_INDEX = () => undefined

export function setHooks(h) {
  if (h.get_modelJsonCache) _get_modelJsonCache = h.get_modelJsonCache
  if (h.get_BUILTIN_PARENT_MODELS) _get_BUILTIN_PARENT_MODELS = h.get_BUILTIN_PARENT_MODELS
  if (h.get_MAX_PARENT_DEPTH) _get_MAX_PARENT_DEPTH = h.get_MAX_PARENT_DEPTH
  if (h.get_FACE_KEYS) _get_FACE_KEYS = h.get_FACE_KEYS
  if (h.get_FACE_ROT_ORDER) _get_FACE_ROT_ORDER = h.get_FACE_ROT_ORDER
  if (h.get_MAT_INDEX) _get_MAT_INDEX = h.get_MAT_INDEX
}

export function packRelToMcRef(rel) {
  const m = String(rel).match(/^assets\/([^/]+)\/textures\/(.+)\.(png|jpe?g|webp|gif|bmp)$/i)
  return m ? m[1] + ':' + m[2] : null
}

export function texUrlToRef(url, ctx) {
  if (typeof url !== 'string') return null
  if (!url) return ''
  if (/^data:/i.test(url)) return url
  let path = url
  if (/^https?:\/\//i.test(url)) {
    /* 外部 URL 原样保留；LAN apiUrl 包装（http 前缀 + token）的站内 URL 剥离前缀 */
    const ai = url.indexOf('/api/')
    if (ai < 0) return url
    path = url.slice(ai)
  }
  if (!path.startsWith('/api/')) return path /* 相对/未知形式原样 */
  const fm = path.match(/^\/api\/file\/raw\?path=([^&]+)/)
  if (fm) return 'file:' + decodeURIComponent(fm[1])
  const bm = path.match(/^\/api\/(mc-packs|mc-official)\/([^/]+)\/raw\?path=([^&]+)/)
  if (bm) {
    const std = packRelToMcRef(decodeURIComponent(bm[3]))
    if (std && ctx && ctx.api === '/api/' + bm[1] && ctx.packName === decodeURIComponent(bm[2])) return std
    if (std && !ctx) return std
    return path /* 跨包：保留站内 URL 引用（重新打开可直接加载） */
  }
  return path
}

export async function resolveMcModelRaw(api, packName, rel, depth = 0, fileRoot) {
  const url = rawUrl(api, packName, rel, fileRoot, true)
  let model
  if (_get_modelJsonCache().has(url)) {
    model = await _get_modelJsonCache().get(url)
  } else {
    const p = fetchJson(url).catch(e => {
      const builtin = _get_BUILTIN_PARENT_MODELS()[rel]
      if (!builtin) {
        _get_modelJsonCache().delete(url)
        throw e
      }
      return builtin
    })
    _get_modelJsonCache().set(url, p)
    model = await p
  }
  if (!model || typeof model !== 'object') throw new Error('invalid model json')
  let elements = Array.isArray(model.elements) ? model.elements : null
  const textures = model.textures && typeof model.textures === 'object' ? model.textures : {}
  if (model.parent && depth < _get_MAX_PARENT_DEPTH()) {
    const parentRel = parentModelPath(model.parent)
    if (parentRel) {
      try {
        const p = await resolveMcModelRaw(api, packName, parentRel, depth + 1, fileRoot)
        if (!elements && p.elements.length) elements = p.elements
        const merged = { ...p.textures }
        for (const k in textures) merged[k] = textures[k]
        return { elements: elements || [], textures: merged }
      } catch {}
    }
  }
  return { elements: elements || [], textures }
}

export async function borrowTemplateTextures(api, packName, rel, fileRoot) {
  if (typeof rel !== 'string' || !rel) return null
  const li = rel.lastIndexOf('/')
  if (li < 0) return null
  const dir = rel.slice(0, li)
  const selfName = rel.slice(li + 1)
  const m = rel.match(/^assets\/([^/]+)\/models\/(.+)\.json$/)
  if (!m) return null
  const withNs = m[1] + ':' + m[2]
  const noNs = m[2]
  /* 同级子模型候选文件名：包模式走 entries 接口，fileRoot 模式走 compare/scan 非递归 */
  let candidates
  try {
    if (fileRoot) {
      const res = await fetch(apiUrl('/api/compare/scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: joinPath(fileRoot, dir), recursive: false })
      })
      const j = await res.json()
      const ents = j && j.ok && j.data && Array.isArray(j.data.entries) ? j.data.entries : []
      candidates = ents
        .map(e => e && e.name)
        .filter(n => typeof n === 'string' && n.endsWith('.json') && n !== selfName && !n.startsWith('template_'))
    } else {
      if (typeof api !== 'string' || typeof packName !== 'string' || !packName) return null
      const entries = await fetchOkData(`${api}/${encodeURIComponent(packName)}/entries?dir=${encodeURIComponent(dir)}`)
      const files = entries && Array.isArray(entries.files) ? entries.files : []
      candidates = files
        .map(f => f && f.name)
        .filter(n => typeof n === 'string' && n.endsWith('.json') && n !== selfName && !n.startsWith('template_'))
    }
  } catch {
    return null
  }
  /* 候选优先级：文件名包含父模型基础名的子模型最可能引用该 parent（如 coral_fan 的
     子模型 brain_coral_fan / tube_coral_fan 均含 "coral_fan"），优先探测；同级目录
     可能有数千 json，仅前 60 会被 fetch，按相关性排序避免漏掉真正引用者 */
  const base = selfName.replace(/\.json$/i, '')
  const matched = candidates.filter(n => n.includes(base))
  const rest = matched.length < 60 ? candidates.filter(n => !n.includes(base)) : []
  const ordered = matched.length ? matched.concat(rest) : candidates
  for (const name of ordered.slice(0, 60)) {
    const childRel = dir + '/' + name
    let child
    try {
      child = await fetchJson(rawUrl(api, packName, childRel, fileRoot, true))
    } catch {
      continue
    }
    if (!child || typeof child !== 'object' || typeof child.parent !== 'string') continue
    const cp = child.parent
    const cpNoNs = cp.includes(':') ? cp.slice(cp.indexOf(':') + 1) : cp
    if (cp !== withNs && cp !== noNs && cpNoNs !== withNs && cpNoNs !== noNs) continue
    const ct = child.textures && typeof child.textures === 'object' ? child.textures : null
    if (ct && Object.keys(ct).length) return ct
  }
  return null
}

export function parseUv(uv) {
  const a = Array.isArray(uv) ? uv : typeof uv === 'string' ? uv.split(',').map(s => +s.trim()) : null
  if (a && a.length === 4 && a.every(n => Number.isFinite(n))) return a
  return null
}

export function applyFaceUvs(geo, faces, uvScale, from, to) {
  if (!faces || typeof faces !== 'object') return
  const uvAttr = geo.attributes.uv
  if (!uvAttr) return
  for (const key of _get_FACE_KEYS()) {
    const f = faces[key]
    if (!f || typeof f !== 'object') continue
    const uv = parseUv(f.uv) || defaultFaceUv(key, from, to, uvScale)
    if (!uv) continue
    /* u1/u2 与 v1/v2 支持翻转（uv[2] < uv[0] 时为水平镜像采样） */
    const u1 = uv[0] / uvScale,
      u2 = uv[2] / uvScale
    const v1 = 1 - uv[1] / uvScale,
      v2 = 1 - uv[3] / uvScale
    const corners = [
      [u1, v1],
      [u2, v1],
      [u1, v2],
      [u2, v2]
    ]
    const rot = Number.isFinite(+f.rotation) ? (((Math.round(+f.rotation / 90) * 90) % 360) + 360) % 360 : 0
    const order = _get_FACE_ROT_ORDER()[rot] || [0, 1, 2, 3]
    const i = _get_MAT_INDEX()[key] * 4
    for (let k = 0; k < 4; k++) {
      const c = corners[order[k]]
      uvAttr.setXY(i + k, c[0], c[1])
    }
  }
  uvAttr.needsUpdate = true
}

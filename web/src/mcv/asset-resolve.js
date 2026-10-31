/**
 * matoga - MC 模型：模型资产解析
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：贴图引用解析、模型资产解析、item 定义与模板借用
 */

import { textureAssetPath } from '../mcv/tex-tools.js'
import { resolveMcModelRaw, borrowTemplateTextures } from '../mcv/tex-ref-tools.js'
import { rawUrl, fetchJson, parentModelPath } from '../mcv/paths.js'
import { resolveItemDefRefs } from '../mcv/geometry.js'

/* 常量由主文件注入（§5.1：常量不搬，避免主文件引用消失） */
let _get_SPECIAL_TEX_RE = () => undefined
let _get_TEX_REF_FALLBACK = () => undefined
let _get_MAX_ITEM_DEF_REFS = () => undefined

export function setHooks(h) {
  if (h.get_SPECIAL_TEX_RE) _get_SPECIAL_TEX_RE = h.get_SPECIAL_TEX_RE
  if (h.get_TEX_REF_FALLBACK) _get_TEX_REF_FALLBACK = h.get_TEX_REF_FALLBACK
  if (h.get_MAX_ITEM_DEF_REFS) _get_MAX_ITEM_DEF_REFS = h.get_MAX_ITEM_DEF_REFS
}

export function isSpecialTexPath(p) {
  return typeof p === 'string' && _get_SPECIAL_TEX_RE().test(p)
}

export function texPathForRef(ref) {
  if (typeof ref !== 'string') return null
  if (isSpecialTexPath(ref)) return ref
  return textureAssetPath(ref) || ref
}

export function writeMcTexRef(textures, oldTexPath, newRef) {
  if (!textures || typeof textures !== 'object' || typeof oldTexPath !== 'string' || typeof newRef !== 'string')
    return 0
  let n = 0
  for (const k in textures) {
    const val = textures[k]
    if (typeof val !== 'string') continue
    if (oldTexPath === '') {
      if (val === '') {
        textures[k] = newRef
        n++
      }
      continue
    }
    if (!val) continue
    const hit = isSpecialTexPath(val) ? val === oldTexPath : val === oldTexPath || textureAssetPath(val) === oldTexPath
    if (hit) {
      textures[k] = newRef
      n++
      continue
    }
    if (val.startsWith('#') && resolveTextureRef(textures, '#' + k) === oldTexPath) {
      textures[k] = newRef
      n++
    }
  }
  return n
}

export function resolveTextureRef(textures, ref, seen) {
  if (typeof ref !== 'string' || !ref) return null
  const guard = seen || new Set()
  if (guard.has(ref)) return null
  guard.add(ref)
  if (ref.startsWith('#')) {
    const key = ref.slice(1)
    const val = textures && typeof textures === 'object' ? textures[key] : undefined
    if (typeof val === 'string' && val) return resolveTextureRef(textures, val, guard)
    if (val && typeof val === 'object' && typeof val.sprite === 'string' && val.sprite)
      return resolveTextureRef(textures, val.sprite, guard)
    for (const alt of _get_TEX_REF_FALLBACK()[key] || []) {
      const hit = resolveTextureRef(textures, '#' + alt, guard)
      if (hit) return hit
    }
    return null
  }
  /* 扩展引用（data:/file:/URL）直接作为贴图路径，不走命名空间解析 */
  if (isSpecialTexPath(ref)) return ref
  return textureAssetPath(ref)
}

export function expandTextureAliases(textures) {
  const out = { ...(textures && typeof textures === 'object' ? textures : {}) }
  const fill = (src, keys) => {
    if (typeof src !== 'string' || !src) return
    for (const k of keys) if (out[k] == null) out[k] = src
  }
  fill(out.all, ['down', 'up', 'north', 'south', 'east', 'west'])
  fill(out.side, ['north', 'south', 'east', 'west'])
  return out
}

export async function resolveMcModel(api, packName, rel, depth = 0, fileRoot) {
  const { elements, textures } = await resolveMcModelRaw(api, packName, rel, depth, fileRoot)
  return { elements, textures: expandTextureAliases(textures) }
}

export function isItemDefPath(rel) {
  return typeof rel === 'string' && /^assets\/[^/]+\/items\/[^/]+\.json$/.test(rel)
}

export function texturesHasConcreteRef(textures) {
  if (!textures || typeof textures !== 'object') return false
  for (const v of Object.values(textures)) {
    if (typeof v === 'string' && v && v[0] !== '#') return true
  }
  return false
}

export function hasUnresolvedTexRefs(elements, textures) {
  if (!Array.isArray(elements) || !elements.length) return false
  const tex = textures && typeof textures === 'object' ? textures : null
  for (const el of elements) {
    const faces = el && typeof el === 'object' && el.faces && typeof el.faces === 'object' ? el.faces : null
    if (!faces) continue
    for (const f of Object.values(faces)) {
      const t = f && typeof f === 'object' && typeof f.texture === 'string' ? f.texture : ''
      if (t[0] !== '#') continue
      if (!tex || !(t.slice(1) in tex)) return true
    }
  }
  return false
}

export function shulkerBoxEntityTexRef(ref) {
  let ns = 'minecraft',
    rest = ref
  const ci = ref.indexOf(':')
  if (ci >= 0) {
    ns = ref.slice(0, ci)
    rest = ref.slice(ci + 1)
  }
  return `${ns}:entity/shulker/${rest}`
}

export async function resolveMcModelAsset(api, packName, rel, fileRoot) {
  if (!isItemDefPath(rel)) {
    try {
      let { elements, textures } = await resolveMcModel(api, packName, rel, 0, fileRoot)
      /* 模板贴图借用：有几何体且 textures 无任何具体贴图引用（空表或全 # 变量引用），
         或 elements 引用了 textures 表未定义的 #变量（混合模板如 flower_pot_cross：
         有 flowerpot/dirt 具体引用但 #plant 未定义）→ 借子模型 textures 补全。
         合并而非替换：当前 textures 的具体引用保留，借来的子模型 textures 补缺失键 */
      if (elements.length && (!texturesHasConcreteRef(textures) || hasUnresolvedTexRefs(elements, textures))) {
        const borrowed = await borrowTemplateTextures(api, packName, rel, fileRoot)
        if (borrowed) textures = expandTextureAliases({ ...borrowed, ...textures })
      }
      return { parts: [{ elements, textures, transform: null, tints: null }] }
    } catch {
      return { parts: [] }
    }
  }
  const url = rawUrl(api, packName, rel, fileRoot, true)
  let def = null
  try {
    def = await fetchJson(url)
  } catch {}
  const refs = resolveItemDefRefs(def && def.model).slice(0, _get_MAX_ITEM_DEF_REFS())
  const parts = []
  for (const r of refs) {
    if (r.shulkerBox) {
      const entityRef = shulkerBoxEntityTexRef(r.shulkerBox)
      parts.push({
        elements: [
          {
            from: [0, 0, 0],
            to: [16, 16, 16],
            faces: {
              down: { texture: '#all' },
              up: { texture: '#all' },
              north: { texture: '#all' },
              south: { texture: '#all' },
              west: { texture: '#all' },
              east: { texture: '#all' }
            }
          }
        ],
        textures: { all: entityRef, particle: entityRef },
        transform: r.transformation || null,
        tints: null
      })
      continue
    }
    const mp = parentModelPath(r.model)
    if (!mp) continue
    try {
      const { elements, textures } = await resolveMcModel(api, packName, mp, 0, fileRoot)
      parts.push({ elements, textures, transform: r.transformation || null, tints: r.tints || null })
    } catch {}
  }
  return { parts }
}

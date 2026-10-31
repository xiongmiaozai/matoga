/**
 * matoga - MC 模型：贴图与着色工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：贴图路径判定、缓存键、着色采样、2D 色调推断
 */

import * as THREE from 'three'
import { texCacheKey, rawUrl } from '../mcv/paths.js'

/* 常量由主文件注入（§5.1：常量不搬，避免主文件引用消失） */
let _get_colormapCache = () => undefined
let _get_CONSTANT_TINTS = () => undefined
let _get_currentBiome = () => undefined
let _get_TEX_REF_EXT_RE = () => undefined
let _get_texCache = () => undefined

export function setHooks(h) {
  if (h.get_colormapCache) _get_colormapCache = h.get_colormapCache
  if (h.get_CONSTANT_TINTS) _get_CONSTANT_TINTS = h.get_CONSTANT_TINTS
  if (h.get_currentBiome) _get_currentBiome = h.get_currentBiome
  if (h.get_TEX_REF_EXT_RE) _get_TEX_REF_EXT_RE = h.get_TEX_REF_EXT_RE
  if (h.get_texCache) _get_texCache = h.get_texCache
}

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function colormapRel(type) {
  return `assets/minecraft/textures/colormap/${type}.png`
}

export function loadColormapData(api, packName, type, fileRoot) {
  const ck = texCacheKey(api, packName, colormapRel(type), fileRoot)
  if (!_get_colormapCache().has(ck)) {
    const url = rawUrl(api, packName, colormapRel(type), fileRoot, false)
    const p = (async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) return null
        const blob = await res.blob()
        if (typeof createImageBitmap !== 'function') return null
        const bmp = await createImageBitmap(blob)
        const w = bmp.width,
          h = bmp.height
        const ctx =
          typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(w, h).getContext('2d')
            : (() => {
                const c = document.createElement('canvas')
                c.width = w
                c.height = h
                return c.getContext('2d')
              })()
        ctx.drawImage(bmp, 0, 0)
        return ctx.getImageData(0, 0, w, h)
      } catch {
        return null
      }
    })()
    _get_colormapCache().set(ck, p)
  }
  return _get_colormapCache().get(ck)
}

export function sampleColormap(img, temp, downfall) {
  if (!img) return null
  const W = img.width,
    H = img.height,
    d = img.data
  const ct = clamp01(temp),
    cd = clamp01(downfall)
  const adjD = cd * ct
  const x = Math.min(W - 1, Math.max(0, Math.floor((1 - ct) * (W - 1))))
  const y = Math.min(H - 1, Math.max(0, Math.floor((1 - adjD) * (H - 1))))
  const i = (y * W + x) * 4
  return new THREE.Color(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255)
}

export async function resolveTintColor(tintIndex, tints, biome, texPath, api, packName, fileRoot, fallbackRoot) {
  let tint = null
  if (Array.isArray(tints) && tints[tintIndex]) tint = tints[tintIndex]
  let type = tint && typeof tint.type === 'string' ? tint.type.replace(/^[^:]*:/, '') : ''
  if (!type) {
    const tn = (texPath || '').toLowerCase()
    type = tn.includes('leaves') || tn.includes('vine') || tn.includes('lily') ? 'foliage' : 'grass'
  }
  const temp = tint && Number.isFinite(+tint.temperature) ? +tint.temperature : biome.temperature
  const down = tint && Number.isFinite(+tint.downfall) ? +tint.downfall : biome.downfall
  if (type === 'constant') {
    const v = tint && Number.isFinite(+tint.value) ? +tint.value | 0 : 0xffffff
    const rgb = v & 0xffffff
    return new THREE.Color(((rgb >> 16) & 0xff) / 255, ((rgb >> 8) & 0xff) / 255, (rgb & 0xff) / 255)
  }
  const cmType = type === 'foliage' ? 'foliage' : 'grass'
  let img = await loadColormapData(api, packName, cmType, fileRoot)
  if (!img && fallbackRoot) img = await loadColormapData(api, packName, cmType, fallbackRoot)
  return sampleColormap(img, temp, down)
}

export function infer2dTintType(base) {
  if (_get_CONSTANT_TINTS()[base]) return 'constant'
  if (/^(vine|lily_pad|leaf_litter)$/.test(base)) return 'foliage'
  if (/^bamboo_/.test(base)) return 'grass'
  if (/_leaves$/.test(base)) return 'foliage'
  if (
    /^(grass_block_top|grass_block_side_overlay|short_grass|fern|tall_grass_top|tall_grass_bottom|large_fern_top|large_fern_bottom|sugar_cane|bush|wildflowers|pink_petals|pumpkin_stem|melon_stem|attached_pumpkin_stem|attached_melon_stem|short_dry_grass|tall_dry_grass|seagrass|tall_seagrass_top|tall_seagrass_bottom)$/.test(
      base
    )
  )
    return 'grass'
  return null
}

export async function sampleTintForTexture(texFullPath) {
  if (!texFullPath) return null
  const norm = String(texFullPath).replace(/\\/g, '/')
  const base = norm
    .split('/')
    .pop()
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
  const type = infer2dTintType(base)
  if (!type) return null
  if (type === 'constant') {
    const rgb = _get_CONSTANT_TINTS()[base]
    return { r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 }
  }
  const amIdx = norm.toLowerCase().indexOf('/assets/minecraft/textures/')
  if (amIdx < 0) return null
  const fileRoot = texFullPath.slice(0, amIdx)
  const cmType = type === 'foliage' ? 'foliage' : 'grass'
  const img = await loadColormapData(undefined, undefined, cmType, fileRoot)
  const c = sampleColormap(img, _get_currentBiome().temperature, _get_currentBiome().downfall)
  return c ? { r: c.r, g: c.g, b: c.b } : null
}

export function textureAssetPath(ref) {
  if (typeof ref !== 'string' || !ref) return null
  let ns = 'minecraft',
    rest = ref
  const ci = ref.indexOf(':')
  if (ci >= 0) {
    ns = ref.slice(0, ci)
    rest = ref.slice(ci + 1)
  }
  if (!rest) return null
  return `assets/${ns}/textures/${_get_TEX_REF_EXT_RE().test(rest) ? rest : rest + '.png'}`
}

export function loadTextureCached(key, url) {
  if (!_get_texCache().has(key)) {
    const loader = new THREE.TextureLoader()
    /* 失败不缓存（下次可重试） */
    const p = loader.loadAsync(url).catch(() => {
      _get_texCache().delete(key)
      return null
    })
    _get_texCache().set(key, p)
  }
  return _get_texCache().get(key)
}

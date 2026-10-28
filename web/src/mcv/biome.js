/**
 * matoga - MC 模型 3D 视口：生物群系染色
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 原样搬出，逻辑未改。
 *
 * MC 草方块/草丛/叶子等面标记 tintindex，渲染时用 colormap（grass.png /
 * foliage.png，256×256，横轴 temperature 纵轴 downfall）采样一个颜色，
 * 与灰度基底贴图逐像素相乘（MeshPhysicalMaterial.color × map）。
 * 1.21.4+ items/*.json 用 tints 数组显式声明染色类型与参数；方块模型仅标记
 * tintindex，类型按贴图名启发式推断（leaves/vine/lily → foliage，余 → grass）。
 * constant 类型为固定颜色（value 低 24 位 RGB）。
 */

import * as THREE from 'three'
import { rawUrl, texCacheKey } from './utils.js'

const BIOMES = [
  { id: 'plains', temperature: 0.5, downfall: 0.4 },
  { id: 'forest', temperature: 0.7, downfall: 0.8 },
  { id: 'dark_forest', temperature: 0.7, downfall: 0.8 },
  { id: 'jungle', temperature: 0.95, downfall: 0.9 },
  { id: 'desert', temperature: 2.0, downfall: 0.0 },
  { id: 'savanna', temperature: 1.2, downfall: 0.0 },
  { id: 'swamp', temperature: 0.8, downfall: 0.9 },
  { id: 'taiga', temperature: 0.25, downfall: 0.8 },
  { id: 'snowy', temperature: 0.0, downfall: 0.5 },
  { id: 'mushroom', temperature: 0.9, downfall: 1.0 },
  { id: 'beach', temperature: 0.5, downfall: 0.4 },
  { id: 'badlands', temperature: 2.0, downfall: 0.0 },
]
let currentBiome = BIOMES[0]
const colormapCache = new Map()   /* key → Promise<ImageData|null> */

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v }

function colormapRel(type) { return `assets/minecraft/textures/colormap/${type}.png` }

function loadColormapData(api, packName, type, fileRoot) {
  const ck = texCacheKey(api, packName, colormapRel(type), fileRoot)
  if (!colormapCache.has(ck)) {
    const url = rawUrl(api, packName, colormapRel(type), fileRoot, false)
    const p = (async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) return null
        const blob = await res.blob()
        if (typeof createImageBitmap !== 'function') return null
        const bmp = await createImageBitmap(blob)
        const w = bmp.width, h = bmp.height
        const ctx = typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(w, h).getContext('2d')
          : (() => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c.getContext('2d') })()
        ctx.drawImage(bmp, 0, 0)
        return ctx.getImageData(0, 0, w, h)
      } catch { return null }
    })()
    colormapCache.set(ck, p)
  }
  return colormapCache.get(ck)
}

function sampleColormap(img, temp, downfall) {
  if (!img) return null
  const W = img.width, H = img.height, d = img.data
  const ct = clamp01(temp), cd = clamp01(downfall)
  const adjD = cd * ct
  const x = Math.min(W - 1, Math.max(0, Math.floor((1 - ct) * (W - 1))))
  const y = Math.min(H - 1, Math.max(0, Math.floor((1 - adjD) * (H - 1))))
  const i = (y * W + x) * 4
  return new THREE.Color(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255)
}

/* tintindex + tints（item 定义）→ 染色颜色；texPath 用于无 tints 时启发式推断类型 */
async function resolveTintColor(tintIndex, tints, biome, texPath, api, packName, fileRoot, fallbackRoot) {
  let tint = null
  if (Array.isArray(tints) && tints[tintIndex]) tint = tints[tintIndex]
  let type = tint && typeof tint.type === 'string' ? tint.type.replace(/^[^:]*:/, '') : ''
  if (!type) {
    const tn = (texPath || '').toLowerCase()
    type = (tn.includes('leaves') || tn.includes('vine') || tn.includes('lily')) ? 'foliage' : 'grass'
  }
  const temp = tint && Number.isFinite(+tint.temperature) ? +tint.temperature : biome.temperature
  const down = tint && Number.isFinite(+tint.downfall) ? +tint.downfall : biome.downfall
  if (type === 'constant') {
    const v = tint && Number.isFinite(+tint.value) ? (+tint.value | 0) : 0xffffff
    const rgb = v & 0xffffff
    return new THREE.Color((rgb >> 16 & 0xff) / 255, (rgb >> 8 & 0xff) / 255, (rgb & 0xff) / 255)
  }
  const cmType = type === 'foliage' ? 'foliage' : 'grass'
  let img = await loadColormapData(api, packName, cmType, fileRoot)
  if (!img && fallbackRoot) img = await loadColormapData(api, packName, cmType, fallbackRoot)
  return sampleColormap(img, temp, down)
}

export function getMcBiomes() { return BIOMES }
export function getCurrentBiome() { return currentBiome }
export function setCurrentBiome(id) {
  const b = BIOMES.find(x => x.id === id)
  if (b) currentBiome = b
}

/* 2D 贴图预览染色：按贴图名推断 tint 类型（无 tintindex 信息，用白名单）。
    grass → grass colormap，foliage → foliage colormap；constant → 固定色（水/熔岩）；
    返回 null 表示不染色。
    bamboo_* 优先匹配 grass（bamboo 叶用草色），避免落到 _leaves → foliage */
const CONSTANT_TINTS = {
  water_still: [0x3f, 0x76, 0xe4],
  water_flow: [0x3f, 0x76, 0xe4],
  lava_still: [0xfe, 0xa1, 0x00],
  lava_flow: [0xfe, 0xa1, 0x00],
}
function infer2dTintType(base) {
  if (CONSTANT_TINTS[base]) return 'constant'
  if (/^(vine|lily_pad|leaf_litter)$/.test(base)) return 'foliage'
  if (/^bamboo_/.test(base)) return 'grass'
  if (/_leaves$/.test(base)) return 'foliage'
  if (/^(grass_block_top|grass_block_side_overlay|short_grass|fern|tall_grass_top|tall_grass_bottom|large_fern_top|large_fern_bottom|sugar_cane|bush|wildflowers|pink_petals|pumpkin_stem|melon_stem|attached_pumpkin_stem|attached_melon_stem|short_dry_grass|tall_dry_grass|seagrass|tall_seagrass_top|tall_seagrass_bottom)$/.test(base)) return 'grass'
  return null
}

/* 供 2D 贴图预览复用：贴图绝对路径 → 当前生物群系下的染色颜色 {r,g,b} 0-1 或 null。
    constant 类型直接返回固定色；grass/foliage 从路径中 assets/minecraft/textures/
    前缀推断资源包根，加载 colormap 并采样 */
export async function sampleTintForTexture(texFullPath) {
  if (!texFullPath) return null
  const norm = String(texFullPath).replace(/\\/g, '/')
  const base = norm.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase()
  const type = infer2dTintType(base)
  if (!type) return null
  if (type === 'constant') {
    const rgb = CONSTANT_TINTS[base]
    return { r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 }
  }
  const amIdx = norm.toLowerCase().indexOf('/assets/minecraft/textures/')
  if (amIdx < 0) return null
  const fileRoot = texFullPath.slice(0, amIdx)
  const cmType = type === 'foliage' ? 'foliage' : 'grass'
  const img = await loadColormapData(undefined, undefined, cmType, fileRoot)
  const c = sampleColormap(img, currentBiome.temperature, currentBiome.downfall)
  return c ? { r: c.r, g: c.g, b: c.b } : null
}

export { resolveTintColor }

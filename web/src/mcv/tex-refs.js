/**
 * matoga - 材质 3D 视口：tex-refs
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */

import * as THREE from 'three'

export const TEX_REF_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i

/* matoga 扩展贴图引用（模型 textures 表值直接可加载，跳过命名空间解析）：
    data:<dataURL> 内嵌 / file:<绝对磁盘路径> / 站内 URL（/api/...） / 外部 http(s) URL。
    UV 编辑器替换的任意来源贴图以此形式持久化到模型 JSON，重新打开自动加载 */
export const SPECIAL_TEX_RE = /^(data:|file:|https?:\/\/|\/)/i

export function isSpecialTexPath(p) {
  return typeof p === 'string' && SPECIAL_TEX_RE.test(p)
}

export function textureAssetPath(ref) {
  if (typeof ref !== 'string' || !ref) return null
  let ns = 'minecraft', rest = ref
  const ci = ref.indexOf(':')
  if (ci >= 0) { ns = ref.slice(0, ci); rest = ref.slice(ci + 1) }
  if (!rest) return null
  return `assets/${ns}/textures/${TEX_REF_EXT_RE.test(rest) ? rest : rest + '.png'}`
}

/* 引用值 → 贴图路径（扩展引用原样；标准引用走命名空间解析） */
export function texPathForRef(ref) {
  if (typeof ref !== 'string') return null
  if (isSpecialTexPath(ref)) return ref
  return textureAssetPath(ref) || ref
}

/* 包内贴图路径 → 标准 MC 引用（assets/<ns>/textures/<rest>.png → <ns>:<rest>） */
export function packRelToMcRef(rel) {
  const m = String(rel).match(/^assets\/([^/]+)\/textures\/(.+)\.(png|jpe?g|webp|gif|bmp)$/i)
  return m ? (m[1] + ':' + m[2]) : null
}

/* 替换贴图 URL → 模型贴图引用（智能引用）：
    '' → 移除；dataURL → data: 内嵌；外部 http(s) → 原样；
    站内 file raw URL → file:<磁盘路径>；站内包 raw URL → 模型包上下文
    （ctx = { api, packName }，可缺省）匹配时转标准 MC 引用（保持 MC 兼容），
    跨包保留站内 URL（重新打开可直接加载） */
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
  if (!path.startsWith('/api/')) return path   /* 相对/未知形式原样 */
  const fm = path.match(/^\/api\/file\/raw\?path=([^&]+)/)
  if (fm) return 'file:' + decodeURIComponent(fm[1])
  const bm = path.match(/^\/api\/(mc-packs|mc-official)\/([^/]+)\/raw\?path=([^&]+)/)
  if (bm) {
    const std = packRelToMcRef(decodeURIComponent(bm[3]))
    if (std && ctx && ctx.api === '/api/' + bm[1] && ctx.packName === decodeURIComponent(bm[2])) return std
    return path   /* 跨包：保留站内 URL 引用（重新打开可直接加载） */
  }
  return path
}

/* 模型 textures 表贴图引用写回：解析命中 oldTexPath 的键改写为 newRef。
    直接持有该路径的键（含 #互引链命中）统一改写到新值；oldTexPath = '' 匹配被移除的空键 */
export function writeMcTexRef(textures, oldTexPath, newRef) {
  if (!textures || typeof textures !== 'object' || typeof oldTexPath !== 'string' || typeof newRef !== 'string') return 0
  let n = 0
  for (const k in textures) {
    const val = textures[k]
    if (typeof val !== 'string') continue
    if (oldTexPath === '') {
      if (val === '') { textures[k] = newRef; n++ }
      continue
    }
    if (!val) continue
    const hit = isSpecialTexPath(val)
      ? val === oldTexPath
      : (val === oldTexPath || textureAssetPath(val) === oldTexPath)
    if (hit) { textures[k] = newRef; n++; continue }
    if (val.startsWith('#') && resolveTextureRef(textures, '#' + k) === oldTexPath) { textures[k] = newRef; n++ }
  }
  return n
}

/* #引用键未定义时的方向别名回退（社区模型常见断链：faces 引用 #up/#north 而
   textures 表内仅有 top/bottom 等非标键，或反向命名）。仅补原本解析失败
   （灰色占位 / UV 面跳过）的场景，已定义键不受影响；防环 guard 贯穿回退链 */
export const TEX_REF_FALLBACK = {
  north: ['side', 'all'], south: ['side', 'all'], east: ['side', 'all'], west: ['side', 'all'],
  side: ['all'], all: ['side'],
  up: ['top', 'all'], top: ['up', 'all'],
  down: ['bottom', 'all'], bottom: ['down', 'all'],
}

/* 解析 "#side" 引用链（textures 表内互引，防环）到最终贴图路径 */
export function resolveTextureRef(textures, ref, seen) {
  if (typeof ref !== 'string' || !ref) return null
  const guard = seen || new Set()
  if (guard.has(ref)) return null
  guard.add(ref)
  if (ref.startsWith('#')) {
    const key = ref.slice(1)
    const val = (textures && typeof textures === 'object') ? textures[key] : undefined
    if (typeof val === 'string' && val) return resolveTextureRef(textures, val, guard)
    if (val && typeof val === 'object' && typeof val.sprite === 'string' && val.sprite) return resolveTextureRef(textures, val.sprite, guard)
    for (const alt of TEX_REF_FALLBACK[key] || []) {
      const hit = resolveTextureRef(textures, '#' + alt, guard)
      if (hit) return hit
    }
    return null
  }
  /* 扩展引用（data:/file:/URL）直接作为贴图路径，不走命名空间解析 */
  if (isSpecialTexPath(ref)) return ref
  return textureAssetPath(ref)
}

/* 旧版/社区包的贴图别名展开（vanilla Deserializer 行为）：
   all → 六方向，side → 四水平方向（putIfAbsent 语义；保留原键以便 "#all" 引用仍可解析） */
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

/* ── 内置 vanilla 基础模型（parent 断链兜底）────────────────
    普通资源包不含 vanilla 基类文件（block/cube 等），模型 parent 链指向它们时
    fetch 404 → 旧实现静默吞掉 → elements/textures 丢失 → 空模型或贴图全灰。
    兜底：fetch 失败时按包内相对路径查此表继续解析（包内存在同路径文件时优先包内
    覆盖版本）；textures 键与 vanilla 一致，配合 expandTextureAliases 展开工作。
    未收录的衍生基类（cube_column 等）断链时仍按原行为跳过。 */

export function spriteTexKey(textures) {
  if (!textures || typeof textures !== 'object') return null
  if (textures.layer0 != null) return '#layer0'
  if (textures.particle != null) return '#particle'
  return null
}



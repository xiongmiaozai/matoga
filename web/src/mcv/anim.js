/**
 * matoga - 材质 3D 视口：anim
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */

import * as THREE from 'three'
import { fetchJson } from './utils.js'

export const TICKS_PER_SEC = 20

/* mcmeta JSON → 动画定义（非法 / 单帧 → null）；timeline 为 [{ index, ticks }]（ticks ≥ 1 整数） */
export function parseAnimMeta(meta, texW, texH) {
  const anim = (meta && typeof meta === 'object') ? meta.animation : null
  if (!anim || typeof anim !== 'object') return null
  const w = Number.isFinite(+texW) ? +texW : 0
  const h = Number.isFinite(+texH) ? +texH : 0
  if (w <= 0 || h <= 0) return null
  const fw = Number.isFinite(+anim.width) && +anim.width > 0 ? Math.floor(+anim.width) : w
  const fh = Number.isFinite(+anim.height) && +anim.height > 0 ? Math.floor(+anim.height) : fw
  if (fw <= 0 || fh <= 0 || fw > w || fh > h) return null
  const frameCount = Math.floor(h / fh)
  if (frameCount <= 1) return null
  const defaultTicks = Math.max(1, Math.round(Number.isFinite(+anim.frametime) ? +anim.frametime : 1))
  const timeline = []
  if (Array.isArray(anim.frames)) {
    for (const f of anim.frames) {
      let index = -1, ticks = defaultTicks
      if (typeof f === 'number' && Number.isFinite(f)) index = Math.floor(f)
      else if (f && typeof f === 'object' && Number.isFinite(+f.index)) {
        index = Math.floor(+f.index)
        if (Number.isFinite(+f.time) && +f.time > 0) ticks = Math.max(1, Math.round(+f.time))
      }
      if (index < 0 || index >= frameCount) continue
      timeline.push({ index, ticks })
    }
  }
  if (!timeline.length) for (let i = 0; i < frameCount; i++) timeline.push({ index: i, ticks: defaultTicks })
  const totalTicks = timeline.reduce((s, f) => s + f.ticks, 0)
  return { texW: w, texH: h, frameW: fw, frameH: fh, frameCount, timeline, totalSec: totalTicks / TICKS_PER_SEC }
}

/* 播放时刻（秒）→ 帧号：帧边界均为整数 tick，换算到 tick 域比较（避免浮点累积误差），循环播放 */
export function animFrameIndexAt(anim, tSec) {
  const tl = anim && anim.timeline
  if (!tl || !tl.length) return 0
  const totalSec = anim.totalSec
  const t = totalSec > 0 ? (tSec % totalSec) : 0
  const tick = Math.max(0, Math.floor(t * TICKS_PER_SEC))
  let acc = 0
  for (const f of tl) {
    acc += f.ticks
    if (tick < acc) return f.index
  }
  return tl[tl.length - 1].index
}

/* 贴图采样矩阵 → 指定帧（几何 UV 已归一化 [0,1]；越界 clamp）。
    half-texel inset：采样窗口自帧边界内收半像素（texel 域 [i·fh+0.5, (i+1)·fh-0.5]），
    NearestFilter 取整后仍覆盖帧内全部行/列（视觉无损失），但窗口永不触碰帧边界——
    否则边界精确压在 texel 分界上，光栅化插值的浮点误差叠加 RepeatWrapping 会把
    相邻帧的边缘行采进来（帧数非 2 的幂时 offset 本身就有 float 表示误差），
    渲染为面边缘的水平/垂直渗色线 */
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

/* mcmeta 原始 JSON 缓存（404 / 解析失败 → null 一并缓存：非动画贴图不反复探测） */
export const animMetaCache = new Map()   /* key → Promise<object|null> */

export function loadAnimMetaCached(key, url) {
  if (!animMetaCache.has(key)) animMetaCache.set(key, fetchJson(url).catch(() => null))
  return animMetaCache.get(key)
}

/* 动画贴图注册表 + rAF 驱动循环（注册表空时停转；无 rAF 环境（node 单测）安全跳过） */
export const animatedTexs = new Map()   /* THREE.Texture → anim */
export let animRAF = 0

export function scheduleAnimTick() {
  if (animRAF || typeof requestAnimationFrame !== 'function') return
  animRAF = requestAnimationFrame(() => {
    animRAF = 0
    if (!animatedTexs.size) return
    const now = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now()
    for (const [tex, anim] of animatedTexs) applyTexAnimFrame(tex, anim, animFrameIndexAt(anim, now / 1000))
    scheduleAnimTick()
  })
}

export function texImageSize(tex) {
  const img = tex && tex.image
  if (!img) return null
  const w = +img.naturalWidth || +img.width || 0
  const h = +img.naturalHeight || +img.height || 0
  return (w > 0 && h > 0) ? { w, h } : null
}

/* 收集 group 内动画贴图的 { tex, anim }（去重；离屏缩略图多帧渲染用：
    逐帧 applyTexAnimFrame + animFrameIndexAt 驱动采样窗口） */
export function getModelTexAnims(group) {
  const out = []
  if (!group || typeof group.traverse !== 'function') return out
  group.traverse(o => {
    if (!o || !o.isMesh) return
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])
    for (const m of mats) {
      if (!m || !m.map || !animatedTexs.has(m.map)) continue
      if (out.some(e => e.tex === m.map)) continue
      out.push({ tex: m.map, anim: animatedTexs.get(m.map) })
    }
  })
  return out
}

/* 贴图加载完成后：按 mcmeta 配置动画采样（首帧 + 注册驱动循环）；非动画仅设像素风参数。
   metaPromise 由调用方与贴图加载并行发起（此处只做解析与应用），返回 anim | null */
export function attachPackTexture(tex, metaPromise) {
  if (!tex) return Promise.resolve(null)
  const size = texImageSize(tex)
  if (!size) { applyTexParams(tex); return Promise.resolve(null) }
  return metaPromise.then(meta => {
    applyTexParams(tex)
    const anim = parseAnimMeta(meta, size.w, size.h)
    if (!anim) return null
    applyTexAnimFrame(tex, anim, 0)
    animatedTexs.set(tex, anim)
    scheduleAnimTick()
    return anim
  }).catch(() => { applyTexParams(tex); return null })
}

/* 仅配置动画采样（不修改 filter/wrap，由调用方预先设置）；用于非包通道（如左右对比预览）
    复用本模块 animatedTexs 注册表与 rAF 循环；metaPromise 解析为 mcmeta JSON 或 null。
    返回 anim | null（终态 resolve）。贴图需已设好 RepeatWrapping（applyTexAnimFrame 用 repeat/offset） */
export function attachTextureAnimOnly(tex, metaPromise) {
  if (!tex) return Promise.resolve(null)
  const size = texImageSize(tex)
  if (!size) return Promise.resolve(null)
  return Promise.resolve(metaPromise).then(meta => {
    const anim = parseAnimMeta(meta, size.w, size.h)
    if (!anim) return null
    applyTexAnimFrame(tex, anim, 0)
    animatedTexs.set(tex, anim)
    scheduleAnimTick()
    return anim
  }).catch(() => null)
}

/* 从动画注册表移除贴图（贴图 dispose / 替换前调用，避免 rAF 操作已释放贴图） */
export function unloadTextureAnim(tex) {
  if (tex && animatedTexs.has(tex)) animatedTexs.delete(tex)
}

/* MC 贴图像素风参数（同步/异步两条赋值路径共用） */
export function applyTexParams(tex) {
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}




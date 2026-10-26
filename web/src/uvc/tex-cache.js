/**
 * matoga - UV 编辑器贴图缓存（Image + 动画元数据）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出，逻辑未改；
 * 跨实例共享缓存，requestDraw 改为显式参数（每实例各自的重绘节流器）。
 */

import { parseAnimMeta } from '../mc-model-viewer.js'
import { IMG_CACHE_MAX } from './consts.js'

/* 贴图 / 动画元数据缓存（跨实例共享，key 均为 URL） */
export const imgCache = new Map()   /* url → { img, ok, done } */
export const animCache = new Map()  /* mcmetaUrl → { meta, anim, parsedFor, failed } */

/* ── 贴图加载（Image 缓存）────────────────────────── */

export function loadTexImage(url, requestDraw) {
  let rec = imgCache.get(url)
  if (rec) return rec
  if (imgCache.size > IMG_CACHE_MAX) imgCache.clear()
  rec = { img: null, ok: false, done: false }
  imgCache.set(url, rec)
  const img = new Image()
  img.onload = () => { rec.img = img; rec.ok = true; rec.done = true; requestDraw() }
  img.onerror = () => { rec.img = null; rec.ok = false; rec.done = true; requestDraw() }
  img.src = url
  return rec
}

/* ── 动画贴图元数据（.png.mcmeta）──────────────────────
   UV 编辑器为静态分析工具：动画贴图固定显示首帧（帧 0 顶部区域），
   面矩形 UV 坐标即帧内像素坐标；缓存 null = 非动画或仍在加载。
   mcmeta 原始 JSON 只请求一次；解析在贴图真实尺寸就绪后重试
   （首次调用时贴图可能未加载，临时尺寸会误判单帧 → 贴图 onload
   后以 naturalWidth/Height 重新解析出帧区域）。 */

export function tryParseAnim(entry, texW, texH, requestDraw) {
  if (!entry || !entry.meta || entry.anim || entry.failed) return
  const w = +texW || 0, h = +texH || 0
  if (w <= 0 || h <= 0) return
  const sizeKey = w + 'x' + h
  if (entry.parsedFor === sizeKey) return   /* 同尺寸已解析（null 不重试） */
  entry.parsedFor = sizeKey
  const anim = parseAnimMeta(entry.meta, w, h)
  if (anim) {
    entry.anim = { frameW: anim.frameW, frameH: anim.frameH, frames: anim.frameCount }
    requestDraw()
  }
}

export function loadTexAnimInfo(tex, texW, texH, requestDraw) {
  const url = (tex && typeof tex.mcmetaUrl === 'string') ? tex.mcmetaUrl : null
  if (!url) return null
  if (!animCache.has(url)) {
    animCache.set(url, { meta: null, anim: null, parsedFor: null, failed: false })
    fetch(url)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status))))
      .then(meta => {
        const entry = animCache.get(url)
        if (!entry || typeof meta !== 'object' || !meta) return
        entry.meta = meta
        tryParseAnim(entry, texW, texH, requestDraw)
      })
      .catch(() => {
        const entry = animCache.get(url)
        if (entry) entry.failed = true
      })
  }
  const entry = animCache.get(url)
  tryParseAnim(entry, texW, texH, requestDraw)
  return entry ? entry.anim : null
}

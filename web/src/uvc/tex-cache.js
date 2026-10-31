/**
 * matoga - UV 编辑器：贴图缓存加载
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出（正文逐字未改）。
 * 职责：贴图图片与动画元数据的两级缓存（避免重复解码与重复 fetch）。
 */

import { parseAnimMeta } from '../mc-model-viewer.js'

let _get_imgCache = () => undefined
let _get_animCache = () => undefined
let _get_IMG_CACHE_MAX = () => undefined
let _get_ANIM_CACHE_MAX = () => undefined
let _requestDraw
let _tryParseAnim

export function setHooks(h) {
  if (h.get_imgCache) _get_imgCache = h.get_imgCache
  if (h.get_animCache) _get_animCache = h.get_animCache
  if (h.get_IMG_CACHE_MAX) _get_IMG_CACHE_MAX = h.get_IMG_CACHE_MAX
  if (h.get_ANIM_CACHE_MAX) _get_ANIM_CACHE_MAX = h.get_ANIM_CACHE_MAX
  if (h.requestDraw) _requestDraw = h.requestDraw
  if (h.tryParseAnim) _tryParseAnim = h.tryParseAnim
}

export function loadTexImage(url) {
  let rec = _get_imgCache().get(url)
  if (rec) return rec
  if (_get_imgCache().size > _get_IMG_CACHE_MAX()) _get_imgCache().clear()
  rec = { img: null, ok: false, done: false }
  _get_imgCache().set(url, rec)
  const img = new Image()
  img.onload = () => {
    rec.img = img
    rec.ok = true
    rec.done = true
    _requestDraw()
  }
  img.onerror = () => {
    rec.img = null
    rec.ok = false
    rec.done = true
    _requestDraw()
  }
  img.src = url
  return rec
}

export function loadTexAnimInfo(tex, texW, texH) {
  const url = tex && typeof tex.mcmetaUrl === 'string' ? tex.mcmetaUrl : null
  if (!url) return null
  if (!_get_animCache().has(url)) {
    if (_get_animCache().size > _get_ANIM_CACHE_MAX()) _get_animCache().clear()
    _get_animCache().set(url, { meta: null, anim: null, parsedFor: null, failed: false })
    fetch(url)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status))))
      .then(meta => {
        const entry = _get_animCache().get(url)
        if (!entry || typeof meta !== 'object' || !meta) return
        entry.meta = meta
        _tryParseAnim(entry, texW, texH)
      })
      .catch(() => {
        const entry = _get_animCache().get(url)
        if (entry) entry.failed = true
      })
  }
  const entry = _get_animCache().get(url)
  _tryParseAnim(entry, texW, texH)
  return entry ? entry.anim : null
}

/* 动画元数据解析（贴图真实尺寸就绪后重试；同尺寸只解析一次） */
export function tryParseAnim(entry, texW, texH) {
  if (!entry || !entry.meta || entry.anim || entry.failed) return
  const w = +texW || 0,
    h = +texH || 0
  if (w <= 0 || h <= 0) return
  const sizeKey = w + 'x' + h
  if (entry.parsedFor === sizeKey) return /* 同尺寸已解析（null 不重试） */
  entry.parsedFor = sizeKey
  const anim = parseAnimMeta(entry.meta, w, h)
  if (anim) {
    entry.anim = { frameW: anim.frameW, frameH: anim.frameH, frames: anim.frameCount }
    _requestDraw()
  }
}

/**
 * matoga - 模型缩略图：生成与去重入口
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 model-thumb.js 按职责搬出，逻辑未改。
 */
import { fetchJson, renderModelThumb } from './render.js'
import { generating, memCache } from './constants.js'

async function generateModelThumb(spec) {
  const key = spec.path
  const noCache = !!spec.noCache
  if (!noCache) {
    try {
      const info = await fetchJson('/api/asset/model-thumb-info?key=' + encodeURIComponent(key) + '&mtime=' + (spec.mtime || 0))
      if (info && info.exists && !info.stale && info.thumbUrl) {
        const n = Number(info.frameCount) || 1
        const urls = []
        for (let i = 0; i < n; i++) urls.push(info.thumbUrl + (i ? '&frame=' + i : ''))
        return { urls, delay: Number(info.frameDelay) || 0 }
      }
    } catch {}
  }
  let out
  try { out = await renderModelThumb(spec) }
  catch { return null }
  if (!out || !out.frames || !out.frames.length) return null
  if (!noCache && out.complete) {
    try {
      const saved = await fetchJson('/api/asset/model-thumb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key, mtime: spec.mtime || 0,
          frames: out.frames.map((dataUrl, i) => ({ dataUrl, delay: i ? 0 : out.delay })),
        }),
      })
      if (saved && saved.thumbUrl) {
        const n = out.frames.length
        const urls = []
        for (let i = 0; i < n; i++) urls.push(saved.thumbUrl + (i ? '&frame=' + i : ''))
        return { urls, delay: out.delay }
      }
    } catch {}
  }
  return { urls: out.frames, delay: out.complete ? out.delay : 0 }
}

/* 对外：确保某模型资产的缩略图就绪（带内存级去重）；返回 { urls, delay } | null
    （item.thumb 兼容设为帧 0 URL，其他 UI 引用单图）。
    不以 item.thumb 短路：favorites/recent 持久化恢复的 thumb 是旧渲染的单帧 URL，
    短路会导致 stale 缓存永不重新校验（旧坏图被锁定）且动画模型退化为静态单帧；
    改为始终走缓存校验 + 按需重渲染，失败时回退旧 thumb（不至于空白） */
export function ensureModelThumb(item) {
  const spec = item && item.modelThumb
  if (!spec || typeof spec.path !== 'string') return Promise.resolve(null)
  if (memCache.has(spec.path)) return Promise.resolve(memCache.get(spec.path))
  if (!generating.has(spec.path)) {
    generating.set(spec.path, generateModelThumb(spec).then(anim => {
      if (anim) { memCache.set(spec.path, anim); item.thumb = anim.urls[0] }
      else if (item.thumb) anim = { urls: [item.thumb], delay: 0 }
      generating.delete(spec.path)
      return anim
    }).catch(() => { generating.delete(spec.path); return null }))
  }
  return generating.get(spec.path)
}

/**
 * matoga - 模型缩略图：懒加载观察
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 model-thumb.js 按职责搬出，逻辑未改。
 */
import { S } from './state.js'
import { watched } from './constants.js'
import { applyThumb } from './render.js'
import { ensureModelThumb } from './ensure.js'

export function getIO() {
  if (S.io) return S.io
  S.io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      const item = watched.get(e.target)
      S.io.unobserve(e.target)
      if (item) {
        ensureModelThumb(item).then(anim => { if (anim) applyThumb(e.target, anim) }).catch(() => {})
      }
    }
  }, { rootMargin: '200px' })
  return S.io
}

/* 对外：扫描容器内携带 _modelThumbItem 引用的缩略图占位，进入视口后懒加载生成 */
export function observeModelThumbs(root) {
  if (!root || !root.querySelectorAll) return
  for (const th of root.querySelectorAll('.ac-thumb')) {
    const item = th._modelThumbItem
    if (!item || !item.modelThumb) continue
    if (th.querySelector('img')) continue
    watched.set(th, item)
    getIO().observe(th)
  }
}

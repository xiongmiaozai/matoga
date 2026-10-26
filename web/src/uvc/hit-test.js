/**
 * matoga - UV 编辑器命中测试
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出，逻辑未改；rects/handles 改为显式参数。
 */

import { HANDLE_HIT } from './consts.js'

/**
 * 命中面矩形（后绘制者在上，用 findLast 取最上层）。
 * @param {Array} rects state.rects
 * @param {number} mx 画布内 x（CSS px）
 * @param {number} my 画布内 y（CSS px）
 */
export function hitRect(rects, mx, my) {
  return rects.findLast(rc => mx >= rc.x && mx <= rc.x + rc.w && my >= rc.y && my <= rc.y + rc.h)
}

/**
 * 命中缩放手柄（方形命中区，边长 2*HANDLE_HIT）。
 * @param {Array} handles state.handles
 * @param {number} mx 画布内 x（CSS px）
 * @param {number} my 画布内 y（CSS px）
 */
export function hitHandle(handles, mx, my) {
  for (const h of handles) {
    if (Math.abs(mx - h.x) <= HANDLE_HIT && Math.abs(my - h.y) <= HANDLE_HIT) return h
  }
  return null
}

/** 贴图 URL 是否可用于 <img> / fetch（data:、http(s):、站内绝对路径） */
export function isUsableTexUrl(url) {
  return typeof url === 'string' && (url.startsWith('data:') || /^https?:\/\//i.test(url) || url.startsWith('/'))
}

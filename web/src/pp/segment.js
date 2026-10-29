/**
 * matoga - 预览面板：分段按钮绑定
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 preview-panel.js 原样搬出，逻辑未改。由各模块共用。
 */

import { $ } from '../core.js'

/**
 * 把一组按钮绑成单选分段控件：点击后切换 active 并回调 data-* 值。
 * @param {string} segId 容器元素 id
 * @param {string} attr  dataset 属性名
 * @param {(value: string) => void} fn 回调
 */
export function bindSegment(segId, attr, fn) {
  const seg = $(segId)
  if (!seg) return
  seg.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      fn(btn.dataset[attr])
    })
  })
}

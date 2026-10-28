/**
 * matoga - 总资产库：包内浏览（浏览视图偏好持久化）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 pack-browser.js 按职责搬出，逻辑未改。
 */
export function pbLoadView() {
  try {
    const v = localStorage.getItem('matoga:pbView')
    return v === 'grid' || v === 'list' ? v : 'list'
  } catch { return 'list' }
}

export function pbSaveView(v) {
  try { localStorage.setItem('matoga:pbView', v) } catch {}
}


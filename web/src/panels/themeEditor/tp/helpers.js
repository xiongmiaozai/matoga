/**
 * matoga - 主题编辑器面板：格式化辅助
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 panel.js 按职责搬出，逻辑未改。
 */
export function isColorVal(v) {
  return typeof v === 'string' && (v.startsWith('#') || v.startsWith('rgb'))
}

export function hexify(v) {
  if (!v || typeof v !== 'string') return '#000000'
  if (v.startsWith('#')) return v.length === 7 || v.length === 4 ? v : '#000000'
  return '#000000'
}


export function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )
}


export function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .trim()
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'theme-' + Date.now().toString(36)
  )
}


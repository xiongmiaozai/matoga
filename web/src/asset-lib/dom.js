/**
 * matoga - 总资产库：DOM / 存储微工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，不含任何面板运行时状态。
 */

export function el(tag, cls, html) {
  const d = document.createElement(tag)
  if (cls) d.className = cls
  if (html != null) d.innerHTML = html
  return d
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16)
  let r = (n >> 16) + amt, g = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b))
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}

export function loadList(key) {
  try { return JSON.parse(localStorage.getItem(key)) || [] } catch { return [] }
}

export function saveList(key, arr) {
  try { localStorage.setItem(key, JSON.stringify(arr)) } catch {}
}

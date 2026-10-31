/**
 * matoga - 目录树选择器：提示
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 folder-tree.js 原样搬出，逻辑未改。零闭包依赖：只操作 #toast 元素，
 * 定时器挂在函数自身的 _t 属性上。
 */

/**
 * 在 #toast 上显示一条短提示（2 秒后自动收起）。
 * @param {string} msg
 */
export function toast(msg) {
  const el = document.getElementById('toast')
  if (!el) return
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => el.classList.remove('show'), 2000)
}

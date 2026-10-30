/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 无 DOM 依赖的 URL/路径工具函数，供 utils.js 和 mc-model-viewer.js 共享。
 * mc-model-viewer.js 在 Node 单测（NR_M3D_STUB）环境下加载，不能导入触发 DOM 查询的 core.js。
 */

export function fileUrl(p) {
  return '/api/file/raw?path=' + encodeURIComponent(p)
}

export function apiUrl(p) {
  return typeof window !== 'undefined' && window.matogaCore && window.matogaCore.url ? window.matogaCore.url(p) : p
}

export function joinPath(base, rel) {
  const b = base.replace(/\\/g, '/').replace(/\/+$/, '')
  const r = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  return b + '/' + r
}
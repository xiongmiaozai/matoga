/**
 * matoga - 材质贴图对比工具：结果渲染模块状态
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 render.js 原样搬出，逻辑未改。
 * let 绑定经 ESM 导入只读，故用 setter 写入、getter 读取。
 */

export const _rowMap = new Map()

export let _filteredCache = null
export let _renderedCount = 0
export let _lastBaseSet = []

export function setFilteredCache(v) { _filteredCache = v }
export function setRenderedCount(v) { _renderedCount = v }
export function setLastBaseSet(v) { _lastBaseSet = v }

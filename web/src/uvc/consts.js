/**
 * matoga - UV 编辑器常量
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出，逻辑未改。
 */

export const ZOOM_STEPS = ['fit', 1, 2, 4, 8, 16]
export const IMG_CACHE_MAX = 48
export const UNDO_MAX = 120
export const HANDLE_HIT = 6      /* 手柄命中半径（CSS px） */
export const HANDLE_DRAW = 5     /* 手柄半边长（CSS px） */

export const HANDLE_CURSOR = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize'
}

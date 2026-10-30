/**
 * matoga - 工作区：共享状态
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 workspace.js 原样搬出。这些状态被多个子模块读写，而 ESM 导入绑定只读
 * （对导入的 let 赋值会抛 "Assignment to constant variable"），故统一挂在 S 上。
 */
import { DEFAULT_PANEL_DEFS } from './panel-defs.js'

export const S = {
  layout: null,          // golden-layout 实例
  layoutRoot: null,
  barEl: null,
  panelEls: null,
  cloneObservers: null,
  activePreset: null,
  userPresets: [],
  saveTimer: null,
  glReady: false,
  suppressAutoSave: false,
  panelDefs: DEFAULT_PANEL_DEFS,   // 运行时由 getPanelDefs() 覆盖
  allPanelIds: new Set(DEFAULT_PANEL_DEFS.map(d => d.id)),
  panelHomes: new Map(),
}

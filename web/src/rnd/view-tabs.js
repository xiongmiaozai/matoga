/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 render.js L1035-L1039 原样搬出（正文逐字未改）。
 */

import { state } from '../core.js'
export function initViewTabs() {
  document.querySelectorAll('input[name="viewMode"]').forEach(r => {
    r.checked = r.value === state.viewMode
  })
}

/**
 * matoga - 3D 视口独立面板（模块化）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 由 panel-loader 动态加载。export init() 供加载器调用。
 * 3D 引擎为单例（一个 WebGL canvas）：本面板注册为视口宿主之一，
 * 可见或被点击时接管真实视口；预览面板的 3D tab 保留同等接管能力。
 */

import { registerMaterial3DHost, toggleFullscreen } from '../../material3d.js'

export function init() {
  const host = document.getElementById('material3dStandaloneHost')
  if (host) registerMaterial3DHost(host)

  const fsBtn = document.getElementById('m3dStandaloneFullscreenBtn')
  if (fsBtn) fsBtn.addEventListener('click', () => toggleFullscreen())

  /* UV 编辑器面板（按需切换；无模型时面板显示空态提示） */
  const uvBtn = document.getElementById('m3dStandaloneUvBtn')
  if (uvBtn) uvBtn.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('workspace:toggle-panel', { detail: { id: 'uvEditor' } }))
  })
}
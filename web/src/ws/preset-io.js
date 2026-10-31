/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 workspace.js L755-L792 原样搬出（正文逐字未改）。
 * 段外本地符号经 setHooks 注入：call（const 箭头函数，直接注入）、
 * userPresets（可变状态，getter 转发）
 */

import { showToast } from '../core.js'
import { renderWorkspaceBar } from '../ws/workspace-bar.js'

/* 以下变量由主模块经 setHooks 注入。正文按裸标识符引用，故模块级声明。 */
let call
let _get_userPresets = () => ({})
export function setHooks(h) {
  call = h.call
  if (h.get_userPresets) _get_userPresets = h.get_userPresets
}

export async function importPreset(onDone) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.addEventListener('change', async () => {
    const file = input.files[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (data.presets) {
        for (const [n, p] of Object.entries(data.presets)) {
          if (p && p.config) {
            await call('PUT', '/api/workspace/preset', { name: n, config: p.config })
            _get_userPresets()[n] = { config: p.config }
          }
        }
        renderWorkspaceBar()
        if (onDone) onDone()
        showToast('已批量导入预设')
      } else {
        if (!data.name || !data.config) {
          showToast('无效的预设文件')
          return
        }
        await call('PUT', '/api/workspace/preset', { name: data.name, config: data.config })
        _get_userPresets()[data.name] = { config: data.config }
        renderWorkspaceBar()
        if (onDone) onDone()
        showToast('已导入「' + data.name + '」')
      }
    } catch (e) {
      showToast('导入失败: ' + e.message)
    }
  })
  input.click()
}

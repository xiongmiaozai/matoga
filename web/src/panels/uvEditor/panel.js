/**
 * matoga - UV 编辑器面板（独立 UV 工作区）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT.
 *
 * 由 panel-loader 动态加载，export init() 供加载器调用。
 * 画布 / 编辑 / 导出内核复用 uv-S.editor-core.js（与 UV 浮窗同源）。
 *
 * 模型来源（下拉选择）：
 *  - 「3D 视口当前模型」：与浮窗完全等价的联动模式（编辑实时写回视口模型 + 高亮联动）
 *  - 导入模型 / 自定义模型：离线打开（fetch JSON → buildMcLayout / buildBbLayout），
 *    编辑写回本地 JSON 副本，「保存」PUT 回模型库（im 新增覆盖更新接口，cm 复用已有 PUT）
 *
 * 离线模式的贴图：
 *  - bbmodel 内嵌贴图（dataURL）正常显示，替换后随保存写回 json.textures[].source
 *  - MC .json 引用包内贴图（无包上下文）：底图缺失红斜纹警示，UV 几何编辑不受影响
 */

import { showToast } from '../../core.js'
import { apiUrl } from '../../utils.js'
import { createUvEditor } from '../../uv-editor-core.js'
import {
  buildMcLayout, buildBbLayout,
  getLastModelLayout,
  updateModelFaceUv, updateModelFaceRotation, updateModelTexture, clearModelTexture,
  highlightModelFace, exportActiveModelJson,
  texUrlToRef, writeMcTexRef, texPathForRef,
} from '../../mc-model-viewer.js'
import { isCustomModelActive } from '../../material3d.js'
import { t, onLocaleChange } from '../../i18n.js'
import { S } from './up/state.js'

import { currentLayout } from './up/context.js'
import { hooks } from './up/hooks.js'
import { updateHint } from './up/status.js'
import { loadModelOptions, openOfflineModel, saveOfflineModel } from './up/offline.js'
export function init() {
  if (S.inited) return
  const host = document.getElementById('uvEditorHost')
  if (!host) return
  S.inited = true

  S.sel = document.getElementById('uvModelSel')
  S.saveBtn = document.getElementById('uvSaveBtn')
  S.hintEl = document.getElementById('uvPanelHint')
  const refreshBtn = document.getElementById('uvModelRefreshBtn')

  S.editor = createUvEditor({
    container: host,
    visible: () => host.isConnected && host.clientWidth > 0,
    getLayout: currentLayout,
    hooks,
    onDirty: () => updateHint(),
  })

  if (S.sel) {
    S.sel.value = 'viewport'
    S.sel.addEventListener('change', () => {
      const v = S.sel.value
      if (v === 'viewport' || !v) {
        S.source = { mode: 'viewport' }
        updateHint()
        if (S.editor) S.editor.refresh()
        return
      }
      const ci = v.indexOf(':')
      if (ci <= 0) return
      const kind = v.slice(0, ci)
      const id = v.slice(ci + 1)
      openOfflineModel(kind, id)
    })
  }
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadModelOptions().catch(() => {}))
  if (S.saveBtn) S.saveBtn.addEventListener('click', () => saveOfflineModel())

  onLocaleChange(() => {
    updateHint()
    loadModelOptions().catch(() => {})
  })

  loadModelOptions().catch(() => {})
}
/**
 * matoga - UV 贴图视图（浮动窗口壳）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 3D 视口打开 MC .json / Blockbench .bbmodel 模型后，以 2D 方式展示模型贴图：
 * 画布 / 编辑 / 导出逻辑见 uv-editor-core.js（可实例化内核），
 * 本模块只负责浮窗宿主与 3D 视口数据源接线：
 *  - 数据源：mc-model-viewer 的 lastLayout（模型展示成功后经 mcmodel:shown 通知刷新；
 *    视口模型被清除时 isCustomModelActive() 为 false，窗口回退空态提示）
 *  - 编辑联动：updateModelFaceUv / updateModelFaceRotation / updateModelTexture /
 *    highlightModelFace / exportActiveModelJson（实时写回 3D 视口活跃模型）
 */

import { createFloatingWindow } from './floating-window.js'
import { createUvEditor } from './uv-editor-core.js'
import {
  getLastModelLayout,
  updateModelFaceUv, updateModelFaceRotation, updateModelTexture, clearModelTexture,
  highlightModelFace, exportActiveModelJson,
} from './mc-model-viewer.js'
import { isCustomModelActive } from './material3d.js'
import { t, onLocaleChange } from './i18n.js'

let win = null
let editor = null

/* ── 初始化（幂等）────────────────────────────────── */

export function initUvView() {
  if (win) return win

  win = createFloatingWindow({
    id: 'uvView',
    title: t('uv.title'),
    icon: 'i-grid',
    x: 260, y: 110, w: 500, h: 560,
    open: false,
  })

  editor = createUvEditor({
    container: win.body,
    visible: () => win.isOpen(),
    getLayout: () => (typeof isCustomModelActive === 'function' && isCustomModelActive())
      ? getLastModelLayout()
      : null,
    hooks: {
      onFaceUv: updateModelFaceUv,
      onFaceRotation: updateModelFaceRotation,
      /* 空串 = 移除材质（面变纯色）；否则替换贴图 */
      onTexture: (texIndex, texUrl, layout) => {
        if (texUrl === '') return clearModelTexture(texIndex, layout)
        return updateModelTexture(texIndex, texUrl, layout)
      },
      highlightFace: highlightModelFace,
      exportJson: exportActiveModelJson,
    },
  })

  win.onToggle = (open) => { if (open) editor.refresh() }
  onLocaleChange(() => { if (win) win.setTitle(t('uv.title')) })

  return win
}

export function toggleUvView() {
  initUvView()
  win.toggle()
}

export function refreshUvView() {
  if (editor) editor.refresh()
}
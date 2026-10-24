/**
 * matoga - 节点画布独立页入口（node-editor.html 宿主）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 历史上 node-editor.html 内嵌约 1700 行与 src/node-canvas.js 重复的旧版引擎，
 * 现收敛为薄入口：预览面板链 → initNodeCanvas() → embed 消息协议。
 * 引擎本体与主页共用 web/src/node-canvas.js（单一事实来源）。
 */

import { initNodeCanvas, addNodeAt, addTextureAt, loadPreset } from './node-canvas.js'

/* ── 预览面板公共模块（i18n + 2D + 3D 参数面板），失败降级不阻塞画布 ── */
import('./i18n.js').then(m => m.initI18n())
  .then(() => import('./preview2d.js')).then(m => m.initPreview2D())
  .then(() => import('./preview-panel.js')).then(m => m.initPreviewPanel())
  .catch(e => console.warn('preview panel init failed', e))

/* ── 3D 联动状态徽标（node-canvas.js 已静态加载 material3d） ── */
const m3dBadge = document.getElementById('m3dBadge')
function setBadge(text, kind) {
  if (!m3dBadge) return
  m3dBadge.textContent = text
  m3dBadge.className = 'm3d-badge' + (kind ? (' ' + kind) : '')
}
setBadge('初始化中…', '')
try {
  initNodeCanvas()
  setBadge('3D 就绪', 'ok')
} catch (e) {
  setBadge('3D 错误: ' + e.message, 'err')
  console.error(e)
}

/* ── embed 模式：被 iframe 嵌入时隐藏顶栏、左侧节点库、右侧预览 ── */
if (new URLSearchParams(location.search).get('embed')) {
  document.body.classList.add('embed')
}

/* ── embed 消息协议（与主页/资产库联动） ── */
window.addEventListener('message', (ev) => {
  const d = ev.data
  if (!d || typeof d !== 'object') return
  try {
    switch (d.type) {
      case 'ping':
        if (ev.source) ev.source.postMessage({ type: 'pong' }, '*')
        break
      case 'addNode':
        addNodeAt(d.nodeType, d.x, d.y)
        break
      case 'addTexture':
        addTextureAt(d.path, d.name, d.x, d.y)
        break
      case 'loadPreset':
        loadPreset(d.preset)
        break
    }
  } catch (e) { console.warn('[embed] message handler error', e) }
})

/* 通知父窗口已就绪 */
if (window.parent && window.parent !== window) {
  window.parent.postMessage({ type: 'nodeEditorReady' }, '*')
}
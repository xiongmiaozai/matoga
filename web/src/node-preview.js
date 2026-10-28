/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { getNodeDetail } from './node-canvas.js'
import { t, onLocaleChange } from './i18n.js'
import { createFloatingWindow } from './floating-window.js'
import { getMode, setMode, setAsset } from './node-preview/state.js'
import { viewEl } from './node-preview/parts.js'
import { renderHead, renderStage, renderProps, renderPorts, renderEvalOut } from './node-preview/node-detail.js'
import { renderAsset, onAssetAction } from './node-preview/asset-detail.js'
import { renderPackTextures } from './node-preview/pack-textures.js'

// 节点详情侧状态（仅本文件使用，不外发）
let _initialized = false
let _activeId = null      // 当前展示的节点 id
let _activeCount = 0      // 触发选中时的选中数量（多选提示）
let _selTimer = null
let _chgTimer = null

// ---- 节点详情侧渲染（L39-L139 已移入 node-preview/node-detail.js）----

function render(){
  if (getMode() === 'asset'){ renderAsset(); return }
  const box = viewEl()
  if (!box) return
  const d = _activeId ? getNodeDetail(_activeId) : null
  if (!d){
    _activeId = null
    box.innerHTML = `<div class="np-empty">${t('np.empty')}</div>`
    return
  }
  const multi = _activeCount > 1
    ? `<div class="np-multi">${t('np.multiSelected', { n: _activeCount })}</div>`
    : ''
  box.innerHTML = `
    ${multi}
    ${renderHead(d)}
    ${renderStage(d)}
    <div class="np-scroll">
      ${renderProps(d)}
      ${renderPorts(d)}
      ${renderEvalOut(d)}
    </div>`
}

/* ── 交互 ───────────────────────────────── */
function onStageClick(e){
  const img = e.target.closest('[data-np-act="open-image"]')
  if (img && img.src){
    try{ window.open(img.src, '_blank', 'noopener') }catch(err){}
  }
}

/* ── 初始化 ─────────────────────────────── */
export { render as renderNodePreview }

export function initNodePreview(){
  if (_initialized) return
  _initialized = true

  const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 800
  const fw = createFloatingWindow({
    id: 'nodePreview',
    title: t('panel.nodePreview'),
    icon: 'i-eye',
    x: 20,
    y: Math.max(72, vh - 556),
    w: Math.min(360, vw - 40),
    h: Math.min(480, vh - 180),
  })

  let view = document.getElementById('nodePreviewView')
  if (!view){
    view = document.createElement('div')
    view.id = 'nodePreviewView'
    view.className = 'np-view'
  }
  fw.body.appendChild(view)

  view.addEventListener('click', (e) => { onStageClick(e); onAssetAction(e) })

  // 资产详情（资产库点击卡片，原「资产详情」窗口并入此处展示）
  document.addEventListener('nodepreview:show-asset', (e) => {
    setAsset(e.detail || null)
    setMode('asset')
    fw.open()   // 窗口曾被关闭时自动弹出并置顶，避免详情渲染进隐藏窗口
    render()
  })
  document.addEventListener('nodepreview:hide-asset', () => {
    setAsset(null)
    setMode('node')
    render()
  })

  // 节点选中（画布点击 / 关系树点击 / 上下游选择）→ 切换预览目标
  document.addEventListener('nodegraph:selected', (e) => {
    clearTimeout(_selTimer)
    _selTimer = setTimeout(() => {
      const detail = e.detail || {}
      _activeId = detail.id || null
      _activeCount = detail.count || 0
      if (_activeId) setMode('node')
      render()
    }, 80)
  })

  // 图结构 / 属性变化 → 刷新详情；节点被删除则回到空状态
  document.addEventListener('nodegraph:changed', () => {
    clearTimeout(_chgTimer)
    _chgTimer = setTimeout(() => {
      if (_activeId && !getNodeDetail(_activeId)) _activeId = null
      render()
    }, 160)
  })

  onLocaleChange(() => {
    fw.setTitle(t('panel.nodePreview'))
    render()
  })
  render()
}

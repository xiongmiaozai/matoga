/**
 * matoga - UV 贴图库选择器（浮动窗口）—— 材质球模式
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT.
 *
 * 供 UV 编辑器（uv-editor-core）「贴图库」按钮调用：
 *   openTexPicker() → Promise<{ name, url, normal, specular } | null>
 *   - name：材质名（主图去扩展名 + 后缀剥离后的 groupKey）
 *   - url：主图 raw URL（写入 UV 槽位）
 *   - normal：法线贴图（-n/_n）raw URL，无则空串（3D 视口 PBR 预览）
 *   - specular：高光贴图（-s/_s）raw URL，无则空串（3D 视口 PBR 预览）
 * 数据源：/api/asset/tex（MC 材质包 + 官方包贴图聚合，每包按类别分组）。
 * raw URL 构造与 asset-library 一致：
 *   zip 包  → /api/mc-official|mc-packs/<name>/raw?path=<rel>
 *   dir 包  → /api/file/raw?path=<root>/<rel>
 * URL 经 apiUrl() 包装（LAN 模式自动附加 token）。
 * 展示：按文件名后缀（_n/-n/_s/-s/_h/-h/_e/-e）聚合为材质组（材质球），
 *   以主图为缩略图，角标标识配套法线(N)/高光(S)/高度(H)/自发光(E)；
 *   仅展示含主图的材质组（材质球以主图为代表）。
 * 交互：包下拉 + 名称搜索（前端过滤）+ 缩略图网格 + 分页加载（每页 80），
 * 点击材质组即 resolve 并关窗。
 */

import { createFloatingWindow } from './floating-window.js'
import { apiUrl, setTexDragData, parseTexGroup } from './utils.js'
import { t, onLocaleChange } from './i18n.js'
import { S } from './uvpick/state.js'

import { applyFilter, refreshView, renderGrid } from './uvpick/grid.js'
function initPicker() {
  if (S.win) return S.win

  S.win = createFloatingWindow({
    id: 'uvTexPicker',
    title: t('uv.pickerTitle'),
    icon: 'i-image',
    x: 320, y: 120, w: 620, h: 520,
    open: false,
  })

  const wrap = document.createElement('div')
  wrap.className = 'uvp-wrap'

  const toolbar = document.createElement('div')
  toolbar.className = 'uvp-toolbar'
  S.packSel = document.createElement('select')
  S.packSel.className = 'uvp-pack-sel'
  S.packSel.title = t('uv.pickerPackTitle')
  S.packSel.addEventListener('change', () => {
    S.packIdx = +S.packSel.value || 0
    applyFilter()
  })
  toolbar.appendChild(S.packSel)
  S.searchInput = document.createElement('input')
  S.searchInput.type = 'search'
  S.searchInput.className = 'uvp-search'
  S.searchInput.placeholder = t('uv.pickerSearch')
  S.searchInput.addEventListener('input', () => {
    S.searchText = S.searchInput.value || ''
    applyFilter()
  })
  toolbar.appendChild(S.searchInput)
  S.statusEl = document.createElement('span')
  S.statusEl.className = 'uvp-status'
  toolbar.appendChild(S.statusEl)
  wrap.appendChild(toolbar)

  const gridWrap = document.createElement('div')
  gridWrap.className = 'uvp-grid-wrap'
  S.gridEl = document.createElement('div')
  S.gridEl.className = 'uvp-grid'
  gridWrap.appendChild(S.gridEl)
  S.emptyEl = document.createElement('div')
  S.emptyEl.className = 'uvp-empty'
  S.emptyEl.textContent = t('uv.pickerNoMatch')
  gridWrap.appendChild(S.emptyEl)
  S.moreBtn = document.createElement('button')
  S.moreBtn.className = 'uvp-more'
  S.moreBtn.textContent = t('uv.pickerMore')
  S.moreBtn.style.display = 'none'
  S.moreBtn.addEventListener('click', () => renderGrid())
  gridWrap.appendChild(S.moreBtn)
  wrap.appendChild(gridWrap)

  S.win.body.appendChild(wrap)

  S.win.onToggle = (open) => {
    if (!open && S.resolve) {
      try { S.resolve(null) } catch {}
      S.resolve = null
    }
  }

  onLocaleChange(() => {
    if (!S.win) return
    S.win.setTitle(t('uv.pickerTitle'))
    if (S.searchInput) S.searchInput.placeholder = t('uv.pickerSearch')
    if (S.moreBtn) S.moreBtn.textContent = t('uv.pickerMore')
    if (S.packSel) S.packSel.title = t('uv.pickerPackTitle')
  })

  return S.win
}

/* ── 入口：打开选择器，选择材质组 resolve { name, url, normal, specular }；关闭未选 resolve null ── */

export async function openTexPicker() {
  initPicker()

  S.searchText = ''
  if (S.searchInput) S.searchInput.value = ''
  S.win.open()
  await refreshView()
  return new Promise((resolve) => { S.resolve = resolve })
}
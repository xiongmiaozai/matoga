/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Adobe 风格浮动面板系统：基于 Golden-Layout，DOM 迁移法保留现有功能逻辑。
 */

import { GoldenLayout, LayoutConfig } from 'golden-layout'
import { $, showToast } from './core.js'
import { sanitizeLayoutConfig } from './layout-config.js'
import { getPanelDefs } from './panel-loader.js'
import { showPrompt, showConfirm } from './ws/dialogs.js'
import { DEFAULT_PANEL_DEFS, comp, stack, col, row } from './ws/panel-defs.js'
import {
  collectComponentTypes,
  countComponentTypes,
  isConfigComplete,
  getDefaultConfig,
} from './ws/layout-tree.js'
import {
  presetNames,
  getPresetConfig,
  setPreset,
  deletePresetEntry,
  renamePresetEntry,
  buildPresetExport,
  presetExportFileName,
  buildAllPresetsExport,
  ALL_PRESETS_FILE_NAME,
  parsePresetImport,
} from './ws/preset-model.js'
import { S } from './ws/state.js'

import { activatePreset, createNewPreset, deletePreset, duplicatePreset, exportAllPresets, exportPreset, importPreset, loadPresets, renamePresetDialog, resetCurrent, saveCurrent, saveCurrentAs } from './ws/presets.js'
import { createLayoutRoot, extractPanels, focusPanel, restorePanelsToClassic } from './ws/panels.js'
import { initGoldenLayout, notifyResize } from './ws/layout.js'
const call = (m, p, b) => window.matogaCore.call(m, p, b)

/* 面板清单：默认值来自 ws/panel-defs.js，运行时由 getPanelDefs() 覆盖为清单实况 */

function renderWorkspaceBar() {
  if (!S.barEl) return
  const allNames = presetNames(S.activePreset, S.userPresets)
  S.barEl.innerHTML = ''
  const label = document.createElement('span')
  label.className = 'workspace-bar-label'
  label.textContent = '工作区'
  S.barEl.appendChild(label)

  for (const name of allNames) {
    const tab = document.createElement('div')
    tab.className = 'workspace-tab' + (name === S.activePreset ? ' active' : '')
    const nameSpan = document.createElement('span')
    nameSpan.className = 'ws-name'
    nameSpan.textContent = name
    tab.appendChild(nameSpan)
    if (S.userPresets[name]) {
      const close = document.createElement('span')
      close.className = 'ws-close'
      close.title = '删除'
      close.textContent = '×'
      tab.appendChild(close)
    }
    tab.addEventListener('click', (e) => {
      if (e.target.classList.contains('ws-close')) {
        e.stopPropagation()
        deletePreset(name)
        return
      }
      activatePreset(name)
    })
    S.barEl.appendChild(tab)
  }

  const actions = document.createElement('div')
  actions.className = 'workspace-bar-actions'
  const addWinBtn = document.createElement('button')
  addWinBtn.id = 'addWinBtn'
  addWinBtn.textContent = '+ 面板'
  addWinBtn.title = '添加新面板到当前工作区'
  addWinBtn.addEventListener('click', addWindowMenu)
  const manageBtn = document.createElement('button')
  manageBtn.textContent = '管理'
  manageBtn.title = '管理工作区预设'
  manageBtn.addEventListener('click', openPresetManager)
  const saveBtn = document.createElement('button')
  saveBtn.textContent = '保存'
  saveBtn.title = '覆盖保存当前工作区布局'
  saveBtn.addEventListener('click', saveCurrent)
  const saveAsBtn = document.createElement('button')
  saveAsBtn.textContent = '另存为…'
  saveAsBtn.title = '将当前布局保存为新工作区'
  saveAsBtn.addEventListener('click', saveCurrentAs)
  const resetBtn = document.createElement('button')
  resetBtn.textContent = '重置'
  resetBtn.title = '重置当前工作区到默认布局'
  resetBtn.addEventListener('click', resetCurrent)
  actions.appendChild(addWinBtn)
  actions.appendChild(manageBtn)
  actions.appendChild(saveBtn)
  actions.appendChild(saveAsBtn)
  actions.appendChild(resetBtn)
  S.barEl.appendChild(actions)
}

function addWindowMenu() {
  const existing = document.getElementById('addWinMenu')
  if (existing) { existing.remove(); return }

  const counts = {}
  try {
    const cfg = S.layout.toConfig()
    const root = cfg.root || cfg
    ;(function walk(n) {
      if (!n || typeof n !== 'object') return
      if (n.type === 'component' && n.componentType) counts[n.componentType] = (counts[n.componentType] || 0) + 1
      if (Array.isArray(n.content)) n.content.forEach(walk)
    })(root)
  } catch {}

  let stacks = []
  try { stacks = S.layout.getAllStacks() } catch {}
  let activeStack = null
  for (const s of stacks) {
    try { if (s.getActiveContentItem()) { activeStack = s; break } } catch {}
  }

  const menu = document.createElement('div')
  menu.id = 'addWinMenu'
  menu.className = 'add-win-menu'

  const header = document.createElement('div')
  header.className = 'add-win-header'
  header.textContent = '选择要添加的面板'
  menu.appendChild(header)

  for (const def of S.panelDefs) {
    const item = document.createElement('div')
    item.className = 'add-win-item'
    const cnt = counts[def.id] || 0
    item.innerHTML =
      '<svg class="ico ico-sm aw-ico"><use href="#' + def.icon + '"/></svg>' +
      '<span class="aw-name">' + def.title + '</span>' +
      (cnt > 0 ? '<span class="aw-count">已打开</span>' : '')
    item.addEventListener('click', (e) => {
      const closeMenu = () => { menu.remove(); document.removeEventListener('keydown', onKey) }
      if (counts[def.id] > 0) {
        const focused = focusPanel(def.id)
        showToast(focused ? '「' + def.title + '」已打开，已聚焦该面板' : '「' + def.title + '」已在布局中')
        closeMenu()
        return
      }
      const altNew = e.altKey
      try {
        if (altNew) {
          try { S.layout.addComponentAtLocation(def.id, {}, def.title, [{ typeId: 3, index: undefined }]) }
          catch { S.layout.addComponent(def.id, {}, def.title) }
        } else if (activeStack) {
          activeStack.addComponent(def.id, {}, def.title)
        } else {
          S.layout.addComponent(def.id, {}, def.title)
        }
        showToast('已添加「' + def.title + '」' + (altNew ? ' · 新标签组' : ''))
      } catch (err) { showToast('添加失败: ' + err.message) }
      closeMenu()
    })
    menu.appendChild(item)
  }

  const hint = document.createElement('div')
  hint.className = 'add-win-hint'
  hint.textContent = activeStack ? '点击 → 添加 / 聚焦面板 · Alt+点击 → 新建标签组' : '点击 → 添加 / 聚焦面板'
  menu.appendChild(hint)

  document.body.appendChild(menu)

  const btn = document.getElementById('addWinBtn')
  if (btn) {
    const r = btn.getBoundingClientRect()
    const mw = menu.offsetWidth, mh = menu.offsetHeight
    let left = r.left, top = r.bottom + 4
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4)
    menu.style.left = left + 'px'
    menu.style.top = top + 'px'
  }

  function onKey(e) { if (e.key === 'Escape') { menu.remove(); document.removeEventListener('keydown', onKey) } }
  document.addEventListener('keydown', onKey)
  setTimeout(() => {
    document.addEventListener('click', function onOutside(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', onOutside); document.removeEventListener('keydown', onKey) }
    })
  }, 0)
}

function openPresetManager() {
  const existing = document.getElementById('presetMgrOverlay')
  if (existing) { existing.remove(); return }

  const overlay = document.createElement('div')
  overlay.id = 'presetMgrOverlay'
  overlay.className = 'preset-mgr-overlay'

  const dlg = document.createElement('div')
  dlg.className = 'preset-mgr-dlg'

  const head = document.createElement('div')
  head.className = 'preset-mgr-head'
  head.innerHTML = '<span class="pm-title">工作区预设管理</span><span class="pm-x" id="presetMgrClose">✕</span>'
  dlg.appendChild(head)

  const body = document.createElement('div')
  body.className = 'preset-mgr-body'

  const list = document.createElement('div')
  list.className = 'preset-mgr-list'

  function renderList() {
    list.innerHTML = ''
    const allNames = presetNames(S.activePreset, S.userPresets)
    for (const name of allNames) {
      const isSaved = !!S.userPresets[name]
      const item = document.createElement('div')
      item.className = 'preset-mgr-item' + (name === S.activePreset ? ' active' : '')
      const nameSpan = document.createElement('span')
      nameSpan.className = 'pm-name'
      nameSpan.textContent = name
      item.appendChild(nameSpan)
      const tag = document.createElement('span')
      tag.className = 'pm-tag'
      tag.textContent = isSaved ? '自定义' : '未保存'
      item.appendChild(tag)
      const acts = document.createElement('div')
      acts.className = 'pm-actions'
      const mkBtn = (act, text, cls) => {
        const b = document.createElement('button')
        b.className = cls || 'pm-btn'
        b.dataset.act = act
        b.textContent = text
        return b
      }
      acts.appendChild(mkBtn('activate', '激活'))
      if (isSaved) {
        acts.appendChild(mkBtn('duplicate', '复制'))
        acts.appendChild(mkBtn('rename', '重命名'))
        acts.appendChild(mkBtn('delete', '删除', 'pm-btn pm-danger'))
        acts.appendChild(mkBtn('export', '导出'))
      }
      item.appendChild(acts)
      item.addEventListener('click', (e) => {
        const btn = e.target.closest('.pm-btn')
        if (!btn) return
        e.stopPropagation()
        const act = btn.dataset.act
        if (act === 'activate') { activatePreset(name); renderList() }
        else if (act === 'duplicate') duplicatePreset(name).then(renderList)
        else if (act === 'rename') renamePresetDialog(name, renderList)
        else if (act === 'delete') deletePreset(name).then(renderList)
        else if (act === 'export') exportPreset(name)
      })
      list.appendChild(item)
    }
  }
  renderList()
  body.appendChild(list)
  dlg.appendChild(body)

  const foot = document.createElement('div')
  foot.className = 'preset-mgr-foot'
  foot.innerHTML =
    '<button class="pm-foot-btn" id="pmNew">新建工作区</button>' +
    '<button class="pm-foot-btn" id="pmImport">导入预设</button>' +
    '<button class="pm-foot-btn" id="pmExportAll">导出全部</button>' +
    '<div class="pm-foot-spacer"></div>' +
    '<button class="pm-foot-btn pm-primary" id="pmCloseBtn">关闭</button>'
  dlg.appendChild(foot)
  overlay.appendChild(dlg)
  document.body.appendChild(overlay)

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.id === 'presetMgrClose' || e.target.id === 'pmCloseBtn') overlay.remove()
  })
  document.getElementById('pmNew').addEventListener('click', () => createNewPreset(renderList))
  document.getElementById('pmImport').addEventListener('click', () => importPreset(renderList))
  document.getElementById('pmExportAll').addEventListener('click', exportAllPresets)
}

export async function initWorkspace() {
  try {
    const defs = getPanelDefs()
    if (defs && defs.length) {
      S.panelDefs = defs
      S.allPanelIds = new Set(S.panelDefs.map(d => d.id))
    }
    extractPanels()
    createLayoutRoot()
    document.body.classList.add('gl-active')
    await new Promise(r => requestAnimationFrame(r))
    const savedConfig = await loadPresets()
    initGoldenLayout(savedConfig)
    renderWorkspaceBar()
    S.glReady = true
    document.addEventListener('workspace:focus-panel', (e) => {
      const id = e.detail && e.detail.id
      if (id) focusPanel(id)
    })
    if (S.layout) S.layout.updateSizeFromContainer()
    setTimeout(notifyResize, 100)
  } catch (e) {
    console.error('[workspace] init failed, fallback to classic S.layout', e)
    try { restorePanelsToClassic() } catch {}
    document.body.classList.remove('gl-active')
    if (S.layoutRoot) S.layoutRoot.style.display = 'none'
    if (S.barEl) S.barEl.style.display = 'none'
  }
}

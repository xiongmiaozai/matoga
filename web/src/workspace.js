/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Adobe 风格浮动面板系统：基于 Golden-Layout，DOM 迁移法保留现有功能逻辑。
 */

import { getPanelDefs } from './panel-loader.js'
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

import { activatePreset, deletePreset, loadPresets, resetCurrent, saveCurrent, saveCurrentAs } from './ws/presets.js'
import { createLayoutRoot, extractPanels, focusPanel, restorePanelsToClassic } from './ws/panels.js'
import { initGoldenLayout, notifyResize } from './ws/layout.js'
import { addWindowMenu, openPresetManager } from './ws/menus.js'
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

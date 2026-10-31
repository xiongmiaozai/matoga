/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 workspace.js L777-L1061 原样搬出（正文逐字未改）。
 * 段外本地符号经 setHooks 注入：
 *   只读状态（getter 转发）：barEl, activePreset, userPresets, saveError, layout, PANEL_DEFS
 *   函数：deletePreset, activatePreset, flushAutoSave, createNewPreset,
 *         saveCurrent, saveCurrentAs, resetCurrent, openPresetManager,
 *         focusPanel, addWindowMenu
 */

import { showToast } from '../core.js'

/* 以下变量由主模块经 setHooks 注入。正文按裸标识符引用，故模块级声明。 */
let _get_barEl = () => undefined
let _get_activePreset = () => undefined
let _get_userPresets = () => undefined
let deletePreset
let activatePreset
let _get_saveError = () => undefined
let flushAutoSave
let createNewPreset
let saveCurrent
let saveCurrentAs
let resetCurrent
let openPresetManager
let _get_layout = () => undefined
let _get_PANEL_DEFS = () => undefined
let focusPanel
let addWindowMenu
export function setHooks(h) {
  if (h.get_barEl) _get_barEl = h.get_barEl
  if (h.get_activePreset) _get_activePreset = h.get_activePreset
  if (h.get_userPresets) _get_userPresets = h.get_userPresets
  deletePreset = h.deletePreset
  activatePreset = h.activatePreset
  if (h.get_saveError) _get_saveError = h.get_saveError
  flushAutoSave = h.flushAutoSave
  createNewPreset = h.createNewPreset
  saveCurrent = h.saveCurrent
  saveCurrentAs = h.saveCurrentAs
  resetCurrent = h.resetCurrent
  openPresetManager = h.openPresetManager
  if (h.get_layout) _get_layout = h.get_layout
  if (h.get_PANEL_DEFS) _get_PANEL_DEFS = h.get_PANEL_DEFS
  focusPanel = h.focusPanel
  addWindowMenu = h.addWindowMenu
}

export function renderWorkspaceBar() {
  if (!_get_barEl()) return
  const allNames = [...new Set([_get_activePreset(), ...Object.keys(_get_userPresets())])].filter(Boolean)
  _get_barEl().innerHTML = ''
  const inHeader = _get_barEl().classList.contains('in-header')
  if (!inHeader) {
    const label = document.createElement('span')
    label.className = 'workspace-bar-label'
    label.textContent = '工作区'
    _get_barEl().appendChild(label)

    for (const name of allNames) {
      const tab = document.createElement('div')
      tab.className = 'workspace-tab' + (name === _get_activePreset() ? ' active' : '')
      const nameSpan = document.createElement('span')
      nameSpan.className = 'ws-name'
      nameSpan.textContent = name
      tab.appendChild(nameSpan)
      if (_get_userPresets()[name]) {
        const close = document.createElement('span')
        close.className = 'ws-close'
        close.title = '删除'
        close.textContent = '×'
        tab.appendChild(close)
      }
      tab.addEventListener('click', e => {
        if (e.target.classList.contains('ws-close')) {
          e.stopPropagation()
          deletePreset(name)
          return
        }
        activatePreset(name)
      })
      _get_barEl().appendChild(tab)
    }
  }

  const actions = document.createElement('div')
  actions.className = 'workspace-bar-actions'
  if (inHeader) {
    const btn = document.createElement('button')
    btn.className = 'ws-btn'
    const btnLabel = document.createElement('span')
    btnLabel.className = 'ws-btn-label'
    btnLabel.textContent = _get_activePreset() || '工作区'
    const caret = document.createElement('span')
    caret.className = 'ws-btn-caret'
    caret.textContent = '▾'
    btn.appendChild(btnLabel)
    btn.appendChild(caret)
    if (_get_saveError()) {
      const errBtn = document.createElement('button')
      errBtn.className = 'ws-save-error-btn'
      errBtn.title = '布局保存失败：' + _get_saveError() + '（点击重试）'
      errBtn.textContent = '⚠'
      errBtn.setAttribute('data-ws-action', 'retry-save')
      errBtn.addEventListener('click', () => {
        flushAutoSave()
      })
      actions.appendChild(errBtn)
    }
    actions.appendChild(btn)
    _get_barEl().appendChild(actions)

    const dd = document.createElement('div')
    dd.className = 'ws-dropdown'
    dd.hidden = true
    _get_barEl().appendChild(dd)

    let ddOpen = false
    function closeDd() {
      dd.hidden = true
      btn.classList.remove('open')
      ddOpen = false
    }
    function openDd() {
      dd.innerHTML = ''
      for (const name of allNames) {
        const item = document.createElement('div')
        item.className = 'ws-dd-item' + (name === _get_activePreset() ? ' active' : '')
        const labelEl = document.createElement('span')
        labelEl.className = 'ws-dd-label'
        labelEl.textContent = name
        item.appendChild(labelEl)
        if (name === _get_activePreset()) {
          const check = document.createElement('span')
          check.className = 'ws-dd-check'
          check.textContent = '✓'
          item.appendChild(check)
        }
        item.addEventListener('click', e => {
          e.stopPropagation()
          closeDd()
          activatePreset(name)
        })
        dd.appendChild(item)
      }
      const sep1 = document.createElement('div')
      sep1.className = 'ws-dd-sep'
      dd.appendChild(sep1)
      const acts = [
        { fn: createNewPreset, label: '新建工作区…' },
        { fn: saveCurrent, label: '保存' },
        { fn: saveCurrentAs, label: '另存为…' },
        { fn: resetCurrent, label: '重置为默认布局' }
      ]
      for (const act of acts) {
        const aItem = document.createElement('div')
        aItem.className = 'ws-dd-item'
        const aLabel = document.createElement('span')
        aLabel.className = 'ws-dd-label'
        aLabel.textContent = act.label
        aItem.appendChild(aLabel)
        aItem.addEventListener('click', e => {
          e.stopPropagation()
          closeDd()
          act.fn()
        })
        dd.appendChild(aItem)
      }
      const sep2 = document.createElement('div')
      sep2.className = 'ws-dd-sep'
      dd.appendChild(sep2)
      const mgrItem = document.createElement('div')
      mgrItem.className = 'ws-dd-item'
      const mgrLabel = document.createElement('span')
      mgrLabel.className = 'ws-dd-label'
      mgrLabel.textContent = '管理工作区…'
      mgrItem.appendChild(mgrLabel)
      mgrItem.addEventListener('click', e => {
        e.stopPropagation()
        closeDd()
        openPresetManager()
      })
      dd.appendChild(mgrItem)

      const panelSep = document.createElement('div')
      panelSep.className = 'ws-dd-sep'
      dd.appendChild(panelSep)

      const panelHeader = document.createElement('div')
      panelHeader.className = 'ws-dd-group-label'
      panelHeader.textContent = '面板'
      dd.appendChild(panelHeader)

      const panelCounts = {}
      try {
        const cfg = _get_layout().toConfig()
        const root = cfg.root || cfg
        ;(function walk(n) {
          if (!n || typeof n !== 'object') return
          if (n.type === 'component' && n.componentType)
            panelCounts[n.componentType] = (panelCounts[n.componentType] || 0) + 1
          if (Array.isArray(n.content)) n.content.forEach(walk)
        })(root)
      } catch {}

      let panelStack = null
      try {
        for (const s of _get_layout().getAllStacks()) {
          if (s.getActiveContentItem()) {
            panelStack = s
            break
          }
        }
      } catch {}

      for (const def of _get_PANEL_DEFS()) {
        const pItem = document.createElement('div')
        pItem.className = 'ws-dd-item ws-dd-panel'
        const left = document.createElement('span')
        left.className = 'ws-dd-label'
        left.innerHTML =
          '<svg class="ico ico-sm ws-dd-ico"><use href="#' +
          def.icon +
          '"/></svg>' +
          '<span class="ws-dd-name">' +
          def.title +
          '</span>'
        pItem.appendChild(left)
        if (panelCounts[def.id] > 0) {
          const tag = document.createElement('span')
          tag.className = 'ws-dd-tag'
          tag.textContent = '已开'
          pItem.appendChild(tag)
        }
        pItem.addEventListener('click', e => {
          e.stopPropagation()
          if (panelCounts[def.id] > 0) {
            focusPanel(def.id)
            showToast('「' + def.title + '」已打开，已聚焦')
          } else {
            try {
              if (e.altKey) {
                try {
                  _get_layout().addComponentAtLocation(def.id, {}, def.title, [{ typeId: 3, index: undefined }])
                } catch {
                  _get_layout().addComponent(def.id, {}, def.title)
                }
              } else if (panelStack) {
                panelStack.addComponent(def.id, {}, def.title)
              } else {
                _get_layout().addComponent(def.id, {}, def.title)
              }
              showToast('已添加「' + def.title + '」' + (e.altKey ? ' · 新标签组' : ''))
            } catch (err) {
              showToast('添加失败: ' + err.message)
            }
          }
          closeDd()
        })
        dd.appendChild(pItem)
      }

      const panelHint = document.createElement('div')
      panelHint.className = 'ws-dd-hint'
      panelHint.textContent = '点击 → 添加 / 聚焦 · Alt+点击 → 新建标签组'
      dd.appendChild(panelHint)

      const rect = btn.getBoundingClientRect()
      const ctxEl = _get_barEl().closest('.app-header') || _get_barEl().parentElement
      const ctxRect = ctxEl.getBoundingClientRect()
      dd.style.left = rect.left - ctxRect.left + 'px'
      dd.style.top = rect.bottom - ctxRect.top + 'px'
      dd.hidden = false
      btn.classList.add('open')
      ddOpen = true
    }
    btn.addEventListener('click', e => {
      e.stopPropagation()
      if (ddOpen) closeDd()
      else openDd()
    })
    document.addEventListener('click', e => {
      if (ddOpen && !dd.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeDd()
    })
    return
  }
  const addWinBtn = document.createElement('button')
  addWinBtn.id = 'addWinBtn'
  addWinBtn.textContent = '+ 面板'
  addWinBtn.title = '添加新面板到当前工作区'
  addWinBtn.setAttribute('data-ws-action', 'add')
  addWinBtn.addEventListener('click', addWindowMenu)
  const manageBtn = document.createElement('button')
  manageBtn.textContent = '管理'
  manageBtn.title = '管理工作区预设'
  manageBtn.setAttribute('data-ws-action', 'manage')
  manageBtn.addEventListener('click', openPresetManager)
  const saveBtn = document.createElement('button')
  saveBtn.textContent = '保存'
  saveBtn.title = '覆盖保存当前工作区布局'
  saveBtn.setAttribute('data-ws-action', 'save')
  saveBtn.addEventListener('click', saveCurrent)
  const saveAsBtn = document.createElement('button')
  saveAsBtn.textContent = '另存为…'
  saveAsBtn.title = '将当前布局保存为新工作区'
  saveAsBtn.setAttribute('data-ws-action', 'saveas')
  saveAsBtn.addEventListener('click', saveCurrentAs)
  const resetBtn = document.createElement('button')
  resetBtn.textContent = '重置'
  resetBtn.title = '重置当前工作区到默认布局'
  resetBtn.setAttribute('data-ws-action', 'reset')
  resetBtn.addEventListener('click', resetCurrent)
  if (_get_saveError()) {
    const errBtn = document.createElement('button')
    errBtn.className = 'ws-save-error-btn'
    errBtn.title = '布局保存失败：' + _get_saveError() + '（点击重试）'
    errBtn.textContent = '⚠'
    errBtn.setAttribute('data-ws-action', 'retry-save')
    errBtn.addEventListener('click', () => {
      flushAutoSave()
    })
    actions.appendChild(errBtn)
  }
  actions.appendChild(addWinBtn)
  actions.appendChild(manageBtn)
  actions.appendChild(saveBtn)
  actions.appendChild(saveAsBtn)
  actions.appendChild(resetBtn)
  _get_barEl().appendChild(actions)
}

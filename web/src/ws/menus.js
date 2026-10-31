/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 workspace.js L1116-L1336 原样搬出（正文逐字未改）。
 * 段外本地符号经 setHooks 注入：
 *   只读状态（getter 转发）：layout, PANEL_DEFS, activePreset, userPresets
 *   函数：focusPanel, activatePreset, duplicatePreset, renamePresetDialog, deletePreset, exportPreset, createNewPreset, importPreset, exportAllPresets
 */

import { showToast } from '../core.js'

/* 以下变量由主模块经 setHooks 注入。正文按裸标识符引用，故模块级声明。 */
let _get_layout = () => undefined
let _get_PANEL_DEFS = () => undefined
let focusPanel
let _get_activePreset = () => undefined
let _get_userPresets = () => undefined
let activatePreset
let duplicatePreset
let renamePresetDialog
let deletePreset
let exportPreset
let createNewPreset
let importPreset
let exportAllPresets
export function setHooks(h) {
  if (h.get_layout) _get_layout = h.get_layout
  if (h.get_PANEL_DEFS) _get_PANEL_DEFS = h.get_PANEL_DEFS
  focusPanel = h.focusPanel
  if (h.get_activePreset) _get_activePreset = h.get_activePreset
  if (h.get_userPresets) _get_userPresets = h.get_userPresets
  activatePreset = h.activatePreset
  duplicatePreset = h.duplicatePreset
  renamePresetDialog = h.renamePresetDialog
  deletePreset = h.deletePreset
  exportPreset = h.exportPreset
  createNewPreset = h.createNewPreset
  importPreset = h.importPreset
  exportAllPresets = h.exportAllPresets
}

export function addWindowMenu() {
  const existing = document.getElementById('addWinMenu')
  if (existing) {
    existing.remove()
    return
  }

  const counts = {}
  try {
    const cfg = _get_layout().toConfig()
    const root = cfg.root || cfg
    ;(function walk(n) {
      if (!n || typeof n !== 'object') return
      if (n.type === 'component' && n.componentType) counts[n.componentType] = (counts[n.componentType] || 0) + 1
      if (Array.isArray(n.content)) n.content.forEach(walk)
    })(root)
  } catch {}

  let stacks = []
  try {
    stacks = _get_layout().getAllStacks()
  } catch {}
  let activeStack = null
  for (const s of stacks) {
    try {
      if (s.getActiveContentItem()) {
        activeStack = s
        break
      }
    } catch {}
  }

  const menu = document.createElement('div')
  menu.id = 'addWinMenu'
  menu.className = 'add-win-menu'

  const header = document.createElement('div')
  header.className = 'add-win-header'
  header.textContent = '选择要添加的面板'
  menu.appendChild(header)

  for (const def of _get_PANEL_DEFS()) {
    const item = document.createElement('div')
    item.className = 'add-win-item'
    const cnt = counts[def.id] || 0
    item.innerHTML =
      '<svg class="ico ico-sm aw-ico"><use href="#' +
      def.icon +
      '"/></svg>' +
      '<span class="aw-name">' +
      def.title +
      '</span>' +
      (cnt > 0 ? '<span class="aw-count">已打开</span>' : '')
    item.addEventListener('click', e => {
      const closeMenu = () => {
        menu.remove()
        document.removeEventListener('keydown', onKey)
      }
      if (counts[def.id] > 0) {
        const focused = focusPanel(def.id)
        showToast(focused ? '「' + def.title + '」已打开，已聚焦该面板' : '「' + def.title + '」已在布局中')
        closeMenu()
        return
      }
      const altNew = e.altKey
      try {
        if (altNew) {
          try {
            _get_layout().addComponentAtLocation(def.id, {}, def.title, [{ typeId: 3, index: undefined }])
          } catch {
            _get_layout().addComponent(def.id, {}, def.title)
          }
        } else if (activeStack) {
          activeStack.addComponent(def.id, {}, def.title)
        } else {
          _get_layout().addComponent(def.id, {}, def.title)
        }
        showToast('已添加「' + def.title + '」' + (altNew ? ' · 新标签组' : ''))
      } catch (err) {
        showToast('添加失败: ' + err.message)
      }
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
    const mw = menu.offsetWidth,
      mh = menu.offsetHeight
    let left = r.left,
      top = r.bottom + 4
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4)
    menu.style.left = left + 'px'
    menu.style.top = top + 'px'
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      menu.remove()
      document.removeEventListener('keydown', onKey)
    }
  }
  document.addEventListener('keydown', onKey)
  setTimeout(() => {
    document.addEventListener('click', function onOutside(e) {
      if (!menu.contains(e.target)) {
        menu.remove()
        document.removeEventListener('click', onOutside)
        document.removeEventListener('keydown', onKey)
      }
    })
  }, 0)
}

export function openPresetManager() {
  const existing = document.getElementById('presetMgrOverlay')
  if (existing) {
    existing.remove()
    return
  }

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
    const allNames = [...new Set([_get_activePreset(), ...Object.keys(_get_userPresets())])].filter(Boolean)
    for (const name of allNames) {
      const isSaved = !!_get_userPresets()[name]
      const item = document.createElement('div')
      item.className = 'preset-mgr-item' + (name === _get_activePreset() ? ' active' : '')
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
      item.addEventListener('click', e => {
        const btn = e.target.closest('.pm-btn')
        if (!btn) return
        e.stopPropagation()
        const act = btn.dataset.act
        if (act === 'activate') {
          activatePreset(name)
          renderList()
        } else if (act === 'duplicate') duplicatePreset(name).then(renderList)
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

  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.id === 'presetMgrClose' || e.target.id === 'pmCloseBtn') overlay.remove()
  })
  document.getElementById('pmNew').addEventListener('click', () => createNewPreset(renderList))
  document.getElementById('pmImport').addEventListener('click', () => importPreset(renderList))
  document.getElementById('pmExportAll').addEventListener('click', exportAllPresets)
}

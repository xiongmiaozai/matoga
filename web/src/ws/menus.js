/**
 * matoga - 工作区：添加窗口菜单与预设管理对话框
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 workspace.js 搬出，逻辑未改。
 */
import { showToast } from '../core.js'
import { showPrompt, showConfirm } from './dialogs.js'
import { presetNames } from './preset-model.js'
import {
  activatePreset, createNewPreset, deletePreset, duplicatePreset,
  exportAllPresets, exportPreset, importPreset, renamePresetDialog,
} from './presets.js'
import { focusPanel } from './panels.js'
import { S } from './state.js'

export function addWindowMenu() {
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

export function openPresetManager() {
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


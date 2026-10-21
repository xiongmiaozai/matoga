/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Adobe 风格浮动面板系统：基于 Golden-Layout，DOM 迁移法保留现有功能逻辑。
 */

import { GoldenLayout, LayoutConfig } from 'golden-layout'
import { $, showToast } from './core.js'


const call = (m, p, b) => window.matogaCore.call(m, p, b)

function showPrompt(message, defaultValue) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'ws-dialog-overlay'
    const dlg = document.createElement('div')
    dlg.className = 'ws-dialog'
    const msg = document.createElement('div')
    msg.className = 'ws-dialog-msg'
    msg.textContent = message
    dlg.appendChild(msg)
    const input = document.createElement('input')
    input.className = 'ws-dialog-input'
    input.value = defaultValue || ''
    dlg.appendChild(input)
    const btns = document.createElement('div')
    btns.className = 'ws-dialog-btns'
    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'ws-dialog-btn'
    cancelBtn.textContent = '取消'
    const okBtn = document.createElement('button')
    okBtn.className = 'ws-dialog-btn primary'
    okBtn.textContent = '确定'
    btns.appendChild(cancelBtn)
    btns.appendChild(okBtn)
    dlg.appendChild(btns)
    overlay.appendChild(dlg)
    document.body.appendChild(overlay)
    input.focus()
    input.select()
    let done = false
    const finish = (val) => { if (done) return; done = true; overlay.remove(); resolve(val) }
    okBtn.addEventListener('click', () => finish(input.value))
    cancelBtn.addEventListener('click', () => finish(null))
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(input.value) }
      if (e.key === 'Escape') { e.preventDefault(); finish(null) }
    })
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null) })
  })
}

function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'ws-dialog-overlay'
    const dlg = document.createElement('div')
    dlg.className = 'ws-dialog'
    const msg = document.createElement('div')
    msg.className = 'ws-dialog-msg'
    msg.textContent = message
    dlg.appendChild(msg)
    const btns = document.createElement('div')
    btns.className = 'ws-dialog-btns'
    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'ws-dialog-btn'
    cancelBtn.textContent = '取消'
    const okBtn = document.createElement('button')
    okBtn.className = 'ws-dialog-btn primary'
    okBtn.textContent = '确定'
    btns.appendChild(cancelBtn)
    btns.appendChild(okBtn)
    dlg.appendChild(btns)
    overlay.appendChild(dlg)
    document.body.appendChild(overlay)
    okBtn.focus()
    let done = false
    const finish = (val) => { if (done) return; done = true; overlay.remove(); resolve(val) }
    okBtn.addEventListener('click', () => finish(true))
    cancelBtn.addEventListener('click', () => finish(false))
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false) })
    document.addEventListener('keydown', function onKey(e) {
      if (done) { document.removeEventListener('keydown', onKey); return }
      if (e.key === 'Escape') { e.preventDefault(); document.removeEventListener('keydown', onKey); finish(false) }
      if (e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', onKey); finish(true) }
    })
  })
}

const PANEL_DEFS = [
  { id: 'leftFolder',     title: '左侧 · 基准', icon: 'i-folder' },
  { id: 'rightFolder',    title: '右侧 · 对比', icon: 'i-folder' },
  { id: 'compareSettings',title: '对比设置',    icon: 'i-compare' },
  { id: 'actions',        title: '操作',        icon: 'i-swap' },
  { id: 'compare',        title: '对比结果',    icon: 'i-compare' },
  { id: 'preview',        title: '预览',        icon: 'i-image' },
  { id: 'detail',         title: '详情',        icon: 'i-layers' },
  { id: 'nodeCanvas',     title: '节点画布',    icon: 'i-node' },
  { id: 'nodeLibrary',    title: '节点库',      icon: 'i-layers' },
  { id: 'assetLibrary',   title: '总资产库',    icon: 'i-folder' },
]

function comp(id, title) { return { type: 'component', componentType: id, title, reorderEnabled: true, minSize: '120px' } }
function stack(c, size) { const s = { type: 'stack', content: c, minSize: '28px' }; if (size) s.size = size; return s }
function col(c, size) { return { type: 'column', size, content: c, minSize: '120px' } }
function row(c) { return { type: 'row', content: c, minSize: '120px' } }

const BUILTIN_PRESETS = {
  '默认': row([
    col([
      stack([comp('leftFolder', '左侧 · 基准')]),
      stack([comp('rightFolder', '右侧 · 对比')]),
      stack([comp('compareSettings', '对比设置')]),
      stack([comp('actions', '操作')]),
    ], '1fr'),
    stack([comp('compare', '对比结果')]),
    col([
      stack([comp('preview', '预览')]),
      stack([comp('detail', '详情')]),
    ], '1.3fr'),
  ]),
  '仅对比': row([stack([comp('compare', '对比结果')])]),
  '3D 调试': row([
    col([
      stack([comp('leftFolder', '左侧 · 基准')]),
      stack([comp('compareSettings', '对比设置')]),
    ], '1fr'),
    stack([comp('preview', '预览')]),
    col([
      stack([comp('compare', '对比结果')]),
      stack([comp('detail', '详情')]),
    ], '1.2fr'),
  ]),
  '2D 对比': row([
    col([
      stack([comp('leftFolder', '左侧 · 基准')]),
      stack([comp('rightFolder', '右侧 · 对比')]),
      stack([comp('compareSettings', '对比设置')]),
    ], '1fr'),
    stack([comp('compare', '对比结果')]),
    stack([comp('preview', '预览')]),
  ]),
  '全屏预览': row([
    col([
      stack([comp('leftFolder', '左侧 · 基准')]),
      stack([comp('actions', '操作')]),
    ], '0.8fr'),
    stack([comp('preview', '预览')]),
  ]),
  '双栏': row([
    col([
      stack([comp('leftFolder', '左侧 · 基准')]),
      stack([comp('rightFolder', '右侧 · 对比')]),
      stack([comp('compareSettings', '对比设置')]),
      stack([comp('actions', '操作')]),
    ], '1fr'),
    col([
      stack([comp('compare', '对比结果')]),
      stack([comp('detail', '详情')]),
    ], '1.5fr'),
  ]),
  '节点编辑': row([
    stack([comp('nodeLibrary', '节点库'), comp('assetLibrary', '总资产库')], '0.7fr'),
    stack([comp('nodeCanvas', '节点画布')]),
    stack([comp('preview', '预览')], '0.9fr'),
  ]),
}

let layout = null
let layoutRoot = null
let barEl = null
let panelEls = {}
let cloneObservers = []
let activePreset = '默认'
let userPresets = {}
let saveTimer = null
let glReady = false
let suppressAutoSave = false

const ALL_PANEL_IDS = new Set(PANEL_DEFS.map(d => d.id))

function collectComponentTypes(node, out) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'component' && node.componentType) out.add(node.componentType)
  const content = node.content
  if (Array.isArray(content)) for (const c of content) collectComponentTypes(c, out)
}

function isConfigComplete(config) {
  if (!config) return false
  const root = config.root || config
  if (!root) return false
  const found = new Set()
  collectComponentTypes(root, found)
  return found.size >= 2
}

function extractPanels() {
  const sidebarInner = document.querySelector('.sidebar-left .sidebar-inner')
  const cards = sidebarInner ? sidebarInner.querySelectorAll('.panel-card') : []
  panelEls = {
    leftFolder: $('leftCard'),
    rightFolder: $('rightCard'),
    compareSettings: cards[0],
    actions: cards[1],
    compare: document.querySelector('.center'),
    preview: $('previewPanelWrap'),
    detail: $('detailPanelWrap'),
    nodeCanvas: $('nodeCanvasPanelWrap'),
    nodeLibrary: $('nodeLibraryPanelWrap'),
    assetLibrary: $('assetLibraryPanelWrap'),
  }
}

function createLayoutRoot() {
  const ws = $('workspace')
  if (!ws) throw new Error('workspace not found')
  layoutRoot = document.createElement('div')
  layoutRoot.id = 'layoutRoot'
  layoutRoot.className = 'layout-root'
  ws.parentNode.insertBefore(layoutRoot, ws)

  barEl = document.createElement('div')
  barEl.className = 'workspace-bar'
  layoutRoot.parentNode.insertBefore(barEl, layoutRoot)
}

function registerComponents() {
  for (const def of PANEL_DEFS) {
    layout.registerComponentFactoryFunction(def.id, (container) => {
      const original = panelEls[def.id]
      if (!original) return
      const inUse = original.isConnected && original.parentElement && original.parentElement.closest('.lm_content')
      if (!inUse) {
        container.element.appendChild(original)
        original.style.display = ''
        original.classList.add('gl-panel-content')
      } else {
        const clone = createPanelClone(original)
        container.element.appendChild(clone)
        clone.style.display = ''
      }
    })
  }
}

function createPanelClone(original) {
  const clone = original.cloneNode(true)
  clone.classList.add('gl-panel-content', 'gl-panel-clone')
  clone.removeAttribute('id')
  clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'))
  bindCloneDelegation(clone, original)
  syncCloneFromOriginal(original, clone)
  return clone
}

function bindCloneDelegation(clone, original) {
  function getOrigEl(target) {
    const path = []
    let node = target
    while (node && node !== clone) {
      const parent = node.parentElement
      if (!parent) return null
      path.unshift(Array.from(parent.children).indexOf(node))
      node = parent
    }
    if (node !== clone) return null
    let result = original
    for (const i of path) {
      result = result.children[i]
      if (!result) return null
    }
    return result
  }
  const interactive = 'button, input, select, label, [data-act], th[data-key], .filter-btn, .view-tab, .sortable, .panel-card-title'
  clone.addEventListener('click', (e) => {
    const t = e.target.closest(interactive)
    if (!t) return
    const orig = getOrigEl(t)
    if (orig && orig !== original) orig.click()
  }, true)
  clone.addEventListener('input', (e) => {
    const orig = getOrigEl(e.target)
    if (orig && orig !== original) {
      orig.value = e.target.value
      orig.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }, true)
  clone.addEventListener('change', (e) => {
    const orig = getOrigEl(e.target)
    if (orig && orig !== original) {
      if (orig.type === 'checkbox' || orig.type === 'radio') orig.checked = e.target.checked
      else orig.value = e.target.value
      orig.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }, true)
  clone.addEventListener('dblclick', (e) => {
    const orig = getOrigEl(e.target)
    if (orig && orig !== original) orig.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  }, true)
}

function syncCloneFromOriginal(original, clone) {
  const observer = new MutationObserver(() => {
    if (!clone.isConnected) { observer.disconnect(); return }
    const html = original.innerHTML
    if (clone._lastHtml !== html) {
      clone._lastHtml = html
      clone.innerHTML = html
      clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'))
    }
  })
  observer.observe(original, { childList: true, subtree: true, characterData: true, attributes: true })
  cloneObservers.push(observer)
}

const GL_SETTINGS = {
  constrainDragToContainer: false,
  reorderEnabled: true,
  popoutWholeStack: false,
  closePopoutsOnUnload: true,
  responsiveMode: 'none',
  reorderOnTabMenuClick: true,
  popInOnClose: true,
}
const GL_DIMENSIONS = {
  borderWidth: 10,
  borderGrabWidth: 30,
  headerHeight: 28,
  dragProxyWidth: 300,
  dragProxyHeight: 200,
}

function applyConfig(config) {
  cloneObservers.forEach(o => o.disconnect())
  cloneObservers = []
  let cfg = config
  if (LayoutConfig.isResolved(config)) {
    cfg = LayoutConfig.fromResolved(config)
  } else if (config.root) {
    cfg = { root: config.root }
  } else {
    cfg = { root: config }
  }
  cfg.settings = GL_SETTINGS
  cfg.dimensions = GL_DIMENSIONS
  layout.loadLayout(cfg)
}

function getDefaultConfig() {
  return { root: BUILTIN_PRESETS[activePreset] || BUILTIN_PRESETS['默认'] }
}

function initGoldenLayout(savedConfig) {
  layout = new GoldenLayout(layoutRoot)
  layout.resizeWithContainerAutomatically = true
  registerComponents()
  const cfg = savedConfig || getDefaultConfig()
  applyConfig(cfg)
  layout.on('stateChanged', onStateChanged)
  layout.on('initialised', () => { notifyResize() })
}

function onStateChanged() {
  if (!glReady) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      let cfg = layout.toConfig()
      if (LayoutConfig.isResolved(cfg)) cfg = LayoutConfig.fromResolved(cfg)
      if (isConfigComplete(cfg)) {
        window.api.setConfig({ currentLayout: cfg })
        if (!suppressAutoSave) autoSavePreset(cfg)
      }
    } catch {}
    notifyResize()
  }, 300)
}

function autoSavePreset(cfg) {
  const name = activePreset
  if (!name) return
  userPresets[name] = userPresets[name] || {}
  userPresets[name].config = cfg
  userPresets[name].updatedAt = Date.now()
  call('PUT', '/api/workspace/preset', { name, config: cfg }).catch(() => {})
}

function suppressAutoSaveBriefly() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  suppressAutoSave = true
  setTimeout(() => { suppressAutoSave = false }, 400)
}

function flushAutoSave() {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  saveTimer = null
  try {
    let cfg = layout.toConfig()
    if (LayoutConfig.isResolved(cfg)) cfg = LayoutConfig.fromResolved(cfg)
    if (isConfigComplete(cfg)) {
      window.api.setConfig({ currentLayout: cfg })
      autoSavePreset(cfg)
    }
  } catch {}
}

function notifyResize() {
  window.dispatchEvent(new Event('resize'))
  setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
}

function renderWorkspaceBar() {
  if (!barEl) return
  const allNames = [...new Set([...Object.keys(BUILTIN_PRESETS), ...Object.keys(userPresets)])]
  barEl.innerHTML = ''
  const label = document.createElement('span')
  label.className = 'workspace-bar-label'
  label.textContent = '工作区'
  barEl.appendChild(label)

  for (const name of allNames) {
    const tab = document.createElement('div')
    tab.className = 'workspace-tab' + (name === activePreset ? ' active' : '')
    tab.innerHTML = `<span class="ws-name">${name}</span>` +
      (!BUILTIN_PRESETS[name] ? '<span class="ws-close" title="删除">×</span>' : '')
    tab.addEventListener('click', (e) => {
      if (e.target.classList.contains('ws-close')) {
        e.stopPropagation()
        deletePreset(name)
        return
      }
      activatePreset(name)
    })
    barEl.appendChild(tab)
  }

  const actions = document.createElement('div')
  actions.className = 'workspace-bar-actions'
  const addWinBtn = document.createElement('button')
  addWinBtn.id = 'addWinBtn'
  addWinBtn.textContent = '+ 窗口'
  addWinBtn.title = '添加新窗口到当前工作区'
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
  barEl.appendChild(actions)
}

async function loadPresets() {
  try {
    const data = await call('GET', '/api/workspace')
    userPresets = (data && data.presets) || {}
    activePreset = (data && data.active) || '默认'
  } catch {}
  const cfg = await window.api.getConfig()
  if (userPresets[activePreset] && userPresets[activePreset].config) {
    return isConfigComplete(userPresets[activePreset].config) ? userPresets[activePreset].config : null
  }
  if (cfg && cfg.currentLayout && activePreset === '默认') {
    return isConfigComplete(cfg.currentLayout) ? cfg.currentLayout : null
  }
  return null
}

async function saveCurrentAs() {
  const name = await showPrompt('工作区名称', '我的工作区')
  if (!name) return
  try {
    let cfg = layout.toConfig()
    if (LayoutConfig.isResolved(cfg)) cfg = LayoutConfig.fromResolved(cfg)
    if (!isConfigComplete(cfg)) { showToast('当前布局不完整，无法保存'); return }
    await call('PUT', '/api/workspace/preset', { name, config: cfg })
    userPresets[name] = { config: cfg }
    activePreset = name
    await call('PUT', '/api/workspace/active', { name })
    renderWorkspaceBar()
    showToast('已保存工作区「' + name + '」')
  } catch (e) { showToast('保存失败: ' + e.message) }
}

async function saveCurrent() {
  try {
    let cfg = layout.toConfig()
    if (LayoutConfig.isResolved(cfg)) cfg = LayoutConfig.fromResolved(cfg)
    if (!isConfigComplete(cfg)) { showToast('当前布局不完整，无法保存'); return }
    if (BUILTIN_PRESETS[activePreset] && !userPresets[activePreset]) {
      const name = await showPrompt('内置预设「' + activePreset + '」不能直接覆盖，请输入新名称保存', activePreset + ' 副本')
      if (!name) return
      await call('PUT', '/api/workspace/preset', { name, config: cfg })
      userPresets[name] = { config: cfg }
      activePreset = name
      await call('PUT', '/api/workspace/active', { name })
      renderWorkspaceBar()
      showToast('已保存工作区「' + name + '」')
    } else {
      await call('PUT', '/api/workspace/preset', { name: activePreset, config: cfg })
      userPresets[activePreset] = { config: cfg }
      renderWorkspaceBar()
      showToast('已保存当前工作区「' + activePreset + '」')
    }
  } catch (e) { showToast('保存失败: ' + e.message) }
}

async function deletePreset(name) {
  if (!await showConfirm('删除工作区「' + name + '」？')) return
  try {
    await call('DELETE', '/api/workspace/preset?name=' + encodeURIComponent(name))
    const wasActive = activePreset === name
    delete userPresets[name]
    if (wasActive) { await activatePreset('默认') }
    else { renderWorkspaceBar() }
    showToast('已删除')
  } catch (e) { showToast('删除失败: ' + e.message) }
}

async function activatePreset(name, force) {
  if (name === activePreset && !force) return
  flushAutoSave()
  activePreset = name
  let cfg = null
  if (userPresets[name] && userPresets[name].config) cfg = userPresets[name].config
  else if (BUILTIN_PRESETS[name]) cfg = { root: BUILTIN_PRESETS[name] }
  if (!cfg) { activePreset = '默认'; cfg = getDefaultConfig() }
  suppressAutoSaveBriefly()
  try {
    applyConfig(cfg)
    await call('PUT', '/api/workspace/active', { name: activePreset })
    notifyResize()
  } catch (e) { console.error('[workspace] activate failed', e) }
  renderWorkspaceBar()
}

async function resetCurrent() {
  const builtinName = BUILTIN_PRESETS[activePreset] ? activePreset : '默认'
  if (!BUILTIN_PRESETS[activePreset] && userPresets[activePreset]) {
    if (!await showConfirm('将工作区「' + activePreset + '」重置为默认布局？此操作不可撤销。')) return
  }
  const cfg = { root: BUILTIN_PRESETS[builtinName] }
  try {
    applyConfig(cfg)
    notifyResize()
  } catch (e) { console.error('[workspace] reset failed', e) }
  renderWorkspaceBar()
}

function getPresetConfig(name) {
  if (userPresets[name] && userPresets[name].config) return userPresets[name].config
  if (BUILTIN_PRESETS[name]) return { root: BUILTIN_PRESETS[name] }
  return null
}

async function renamePresetDialog(name, onDone) {
  const newName = await showPrompt('重命名工作区「' + name + '」', name)
  if (!newName || newName === name) return
  try {
    await call('PUT', '/api/workspace/rename', { oldName: name, newName })
    userPresets[newName] = userPresets[name]
    delete userPresets[name]
    if (activePreset === name) activePreset = newName
    renderWorkspaceBar()
    if (onDone) onDone()
    showToast('已重命名为「' + newName + '」')
  } catch (e) { showToast('重命名失败: ' + e.message) }
}

async function duplicatePreset(name) {
  const cfg = getPresetConfig(name)
  if (!cfg) return
  const newName = await showPrompt('复制工作区「' + name + '」为新预设', name + ' 副本')
  if (!newName) return
  try {
    await call('PUT', '/api/workspace/preset', { name: newName, config: cfg })
    userPresets[newName] = { config: cfg }
    renderWorkspaceBar()
    showToast('已复制为「' + newName + '」')
  } catch (e) { showToast('复制失败: ' + e.message) }
}

function exportPreset(name) {
  const cfg = getPresetConfig(name)
  if (!cfg) return
  const blob = new Blob([JSON.stringify({ name, config: cfg, version: 1 }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'workspace-' + name.replace(/[^\w\u4e00-\u9fa5]/g, '_') + '.json'
  a.click()
  URL.revokeObjectURL(a.href)
  showToast('已导出「' + name + '」')
}

function exportAllPresets() {
  const all = {}
  for (const [name, cfg] of Object.entries(BUILTIN_PRESETS)) all[name] = { config: { root: cfg }, builtin: true }
  for (const [name, p] of Object.entries(userPresets)) all[name] = p
  const blob = new Blob([JSON.stringify({ presets: all, version: 1 }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'workspaces-all.json'
  a.click()
  URL.revokeObjectURL(a.href)
  showToast('已导出全部预设')
}

async function importPreset(onDone) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.addEventListener('change', async () => {
    const file = input.files[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (data.presets) {
        for (const [n, p] of Object.entries(data.presets)) {
          if (p && p.config && !BUILTIN_PRESETS[n]) {
            await call('PUT', '/api/workspace/preset', { name: n, config: p.config })
            userPresets[n] = { config: p.config }
          }
        }
        renderWorkspaceBar()
        if (onDone) onDone()
        showToast('已批量导入预设')
      } else {
        if (!data.name || !data.config) { showToast('无效的预设文件'); return }
        await call('PUT', '/api/workspace/preset', { name: data.name, config: data.config })
        userPresets[data.name] = { config: data.config }
        renderWorkspaceBar()
        if (onDone) onDone()
        showToast('已导入「' + data.name + '」')
      }
    } catch (e) { showToast('导入失败: ' + e.message) }
  })
  input.click()
}

async function createNewPreset(onDone) {
  const templates = Object.keys(BUILTIN_PRESETS)
  const choice = await showPrompt('选择模板创建新工作区:\n' + templates.map((t, i) => (i + 1) + '. ' + t).join('\n') + '\n\n输入模板名或留空创建空白工作区', templates[0])
  if (choice === null) return
  let cfg
  if (choice && BUILTIN_PRESETS[choice]) cfg = { root: BUILTIN_PRESETS[choice] }
  else cfg = { root: row([stack([comp('compare', '对比结果')])]) }
  const newName = await showPrompt('新工作区名称', (choice && BUILTIN_PRESETS[choice]) ? choice + ' 副本' : '我的工作区')
  if (!newName) return
  try {
    await call('PUT', '/api/workspace/preset', { name: newName, config: cfg })
    userPresets[newName] = { config: cfg }
    activePreset = newName
    await call('PUT', '/api/workspace/active', { name: newName })
    applyConfig(cfg)
    renderWorkspaceBar()
    if (onDone) onDone()
    showToast('已创建工作区「' + newName + '」')
  } catch (e) { showToast('创建失败: ' + e.message) }
}

function addWindowMenu() {
  const existing = document.getElementById('addWinMenu')
  if (existing) { existing.remove(); return }

  const counts = {}
  try {
    const cfg = layout.toConfig()
    const root = cfg.root || cfg
    ;(function walk(n) {
      if (!n || typeof n !== 'object') return
      if (n.type === 'component' && n.componentType) counts[n.componentType] = (counts[n.componentType] || 0) + 1
      if (Array.isArray(n.content)) n.content.forEach(walk)
    })(root)
  } catch {}

  let stacks = []
  try { stacks = layout.getAllStacks() } catch {}
  let activeStack = null
  for (const s of stacks) {
    try { if (s.getActiveContentItem()) { activeStack = s; break } } catch {}
  }

  const menu = document.createElement('div')
  menu.id = 'addWinMenu'
  menu.className = 'add-win-menu'

  const header = document.createElement('div')
  header.className = 'add-win-header'
  header.textContent = '选择要添加的窗口'
  menu.appendChild(header)

  for (const def of PANEL_DEFS) {
    const item = document.createElement('div')
    item.className = 'add-win-item'
    const cnt = counts[def.id] || 0
    item.innerHTML =
      '<svg class="ico ico-sm aw-ico"><use href="#' + def.icon + '"/></svg>' +
      '<span class="aw-name">' + def.title + '</span>' +
      (cnt > 0 ? '<span class="aw-count">×' + cnt + '</span>' : '')
    item.addEventListener('click', (e) => {
      const altNew = e.altKey
      try {
        if (altNew) {
          try { layout.addComponentAtLocation(def.id, {}, def.title, [{ typeId: 3, index: undefined }]) }
          catch { layout.addComponent(def.id, {}, def.title) }
        } else if (activeStack) {
          activeStack.addComponent(def.id, {}, def.title)
        } else {
          layout.addComponent(def.id, {}, def.title)
        }
        showToast('已添加「' + def.title + '」' + (altNew ? ' · 新标签组' : ''))
      } catch (err) { showToast('添加失败: ' + err.message) }
      menu.remove()
      document.removeEventListener('keydown', onKey)
    })
    menu.appendChild(item)
  }

  const hint = document.createElement('div')
  hint.className = 'add-win-hint'
  hint.textContent = activeStack ? '点击 → 当前标签组 · Alt+点击 → 新建标签组' : '点击添加窗口'
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
    const allNames = [...new Set([...Object.keys(BUILTIN_PRESETS), ...Object.keys(userPresets)])]
    for (const name of allNames) {
      const isBuiltin = !!BUILTIN_PRESETS[name]
      const item = document.createElement('div')
      item.className = 'preset-mgr-item' + (name === activePreset ? ' active' : '')
      item.innerHTML =
        '<span class="pm-name">' + name + '</span>' +
        '<span class="pm-tag">' + (isBuiltin ? '内置' : '自定义') + '</span>' +
        '<div class="pm-actions">' +
          '<button class="pm-btn" data-act="activate">激活</button>' +
          '<button class="pm-btn" data-act="duplicate">复制</button>' +
          (isBuiltin ? '' : '<button class="pm-btn" data-act="rename">重命名</button>') +
          (isBuiltin ? '' : '<button class="pm-btn pm-danger" data-act="delete">删除</button>') +
          '<button class="pm-btn" data-act="export">导出</button>' +
        '</div>'
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
    extractPanels()
    createLayoutRoot()
    document.body.classList.add('gl-active')
    await new Promise(r => requestAnimationFrame(r))
    const savedConfig = await loadPresets()
    initGoldenLayout(savedConfig)
    renderWorkspaceBar()
    glReady = true
    if (layout) layout.updateSizeFromContainer()
    setTimeout(notifyResize, 100)
  } catch (e) {
    console.error('[workspace] init failed, fallback to classic layout', e)
    document.body.classList.remove('gl-active')
    if (layoutRoot) layoutRoot.style.display = 'none'
    if (barEl) barEl.style.display = 'none'
  }
}

export function getLayout() { return layout }
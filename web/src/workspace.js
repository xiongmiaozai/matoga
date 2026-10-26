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


const call = (m, p, b) => window.matogaCore.call(m, p, b)


let PANEL_DEFS = [
  { id: 'folderCard',     title: '文件夹选择', icon: 'i-folder' },
  { id: 'compareSettings',title: '对比设置',    icon: 'i-compare' },
  { id: 'actions',        title: '操作',        icon: 'i-swap' },
  { id: 'compare',        title: '贴图对比',    icon: 'i-compare' },
  { id: 'modelCategory',  title: '模型分类',    icon: 'i-cube' },
  { id: 'chart',          title: '可视化',      icon: 'i-pie' },
  { id: 'preview',        title: '预览',        icon: 'i-image' },
  { id: 'material3d',     title: '3D 视口',     icon: 'i-cube' },
  { id: 'detail',         title: '详情',        icon: 'i-layers' },
  { id: 'nodeCanvas',     title: '节点画布',    icon: 'i-node' },
  { id: 'nodeLibrary',    title: '节点库',      icon: 'i-layers' },
  { id: 'assetLibrary',   title: '总资产库',    icon: 'i-folder' },

  { id: 'uvEditor',       title: 'UV 编辑器',   icon: 'i-grid' },

]

function comp(id, title) { return { type: 'component', componentType: id, title, reorderEnabled: true, minSize: '120px' } }
function stack(c, size) { const s = { type: 'stack', content: c, minSize: '28px' }; if (size) s.size = size; return s }
function col(c, size) { return { type: 'column', size, content: c, minSize: '120px' } }
function row(c) { return { type: 'row', content: c, minSize: '120px' } }

const DEFAULT_LAYOUT = row([
  col([
    stack([comp('folderCard', '文件夹选择')]),
    stack([comp('compareSettings', '对比设置')]),
    stack([comp('actions', '操作')]),
  ], '1fr'),
  stack([comp('compare', '贴图对比'), comp('modelCategory', '模型分类'), comp('chart', '可视化')]),
  col([
    stack([comp('preview', '预览')]),
    stack([comp('detail', '详情')]),
  ], '1.3fr'),
])

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

let ALL_PANEL_IDS = new Set(PANEL_DEFS.map(d => d.id))

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

let panelHomes = []

function extractPanels() {
  const sidebarInner = document.querySelector('.sidebar-left .sidebar-inner')
  const cards = sidebarInner ? sidebarInner.querySelectorAll('.panel-card') : []
  panelEls = {
    folderCard: $('folderCard'),
    compareSettings: cards[0],
    actions: cards[1],
    compare: document.querySelector('.center'),
    modelCategory: $('modelCategoryPanelWrap'),
    chart: $('chartPanelWrap'),
    preview: $('previewPanelWrap'),
    material3d: $('material3dPanelWrap'),
    detail: $('detailPanelWrap'),
    nodeCanvas: $('nodeCanvasPanelWrap'),
    nodeLibrary: $('nodeLibraryPanelWrap'),
    assetLibrary: $('assetLibraryPanelWrap'),

    uvEditor: $('uvEditorPanelWrap'),

  }
  panelHomes = Object.values(panelEls)
    .filter(Boolean)
    .map((el) => ({ el, parent: el.parentElement, next: el.nextElementSibling }))
}

function restorePanelsToClassic() {
  for (const { el, parent, next } of panelHomes) {
    try {
      if (!parent || !el.isConnected) continue
      if (!el.parentElement || !el.parentElement.closest('#layoutRoot')) continue
      el.classList.remove('gl-panel-content')
      el.style.display = ''
      const anchor = next && next.parentElement === parent ? next : null
      parent.insertBefore(el, anchor)
    } catch {}
  }
}

function reconcileOrphanPanels() {
  for (const { el, parent, next } of panelHomes) {
    try {
      if (el.isConnected || !parent) continue
      el.classList.remove('gl-panel-content')
      el.style.display = ''
      const anchor = next && next.parentElement === parent ? next : null
      parent.insertBefore(el, anchor)
    } catch {}
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
  stripCloneViewport(clone)
  bindCloneDelegation(clone, original)
  syncCloneFromOriginal(original, clone)
  return clone
}

function stripCloneViewport(clone) {
  clone.querySelectorAll('.material3d-container').forEach(c => {
    c.querySelectorAll('canvas').forEach(cv => cv.remove())
    c.classList.remove('m3d-host-active')
    const hint = c.querySelector('.m3d-host-empty')
    if (hint) hint.style.display = 'none'
  })
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
      stripCloneViewport(clone)
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

function sanitizeConfig(config) {
  let cfg = config
  if (!cfg || typeof cfg !== 'object') return getDefaultConfig()
  if (LayoutConfig.isResolved(cfg)) {
    try { cfg = LayoutConfig.fromResolved(cfg) } catch { return getDefaultConfig() }
  }
  const root = cfg.root || cfg
  if (!root || typeof root !== 'object') return getDefaultConfig()
  const cleaned = sanitizeLayoutConfig(root, ALL_PANEL_IDS)
  if (!cleaned) return getDefaultConfig()
  return cfg.root ? { ...cfg, root: cleaned } : { root: cleaned }
}

function applyConfig(config) {
  cloneObservers.forEach(o => o.disconnect())
  cloneObservers = []
  const cfg = sanitizeConfig(config)
  cfg.settings = GL_SETTINGS
  cfg.dimensions = GL_DIMENSIONS
  layout.loadLayout(cfg)
  reconcileOrphanPanels()
  const comps = new Set()
  collectComponentTypes(cfg.root, comps)
  document.dispatchEvent(new CustomEvent('workspace:activated', { detail: { components: [...comps] } }))
}

function getDefaultConfig() {
  return { root: JSON.parse(JSON.stringify(DEFAULT_LAYOUT)) }
}

function initGoldenLayout(savedConfig) {
  layout = new GoldenLayout(layoutRoot)
  layout.resizeWithContainerAutomatically = true
  registerComponents()
  try {
    applyConfig(savedConfig)
  } catch (e) {
    console.error('[workspace] load saved config failed, fallback to default layout', e)
    applyConfig(getDefaultConfig())
  }
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
  const allNames = [...new Set([activePreset, ...Object.keys(userPresets)])].filter(Boolean)
  barEl.innerHTML = ''
  const label = document.createElement('span')
  label.className = 'workspace-bar-label'
  label.textContent = '工作区'
  barEl.appendChild(label)

  for (const name of allNames) {
    const tab = document.createElement('div')
    tab.className = 'workspace-tab' + (name === activePreset ? ' active' : '')
    const nameSpan = document.createElement('span')
    nameSpan.className = 'ws-name'
    nameSpan.textContent = name
    tab.appendChild(nameSpan)
    if (userPresets[name]) {
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
    barEl.appendChild(tab)
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
  barEl.appendChild(actions)
}

function sanitizeSavedConfig(config, presetName) {
  const fixed = sanitizeConfig(config)
  if (JSON.stringify(fixed) === JSON.stringify(config)) return config
  if (presetName) {
    userPresets[presetName] = userPresets[presetName] || {}
    userPresets[presetName].config = fixed
    userPresets[presetName].updatedAt = Date.now()
    call('PUT', '/api/workspace/preset', { name: presetName, config: fixed }).catch(() => {})
  }
  try { window.api.setConfig({ currentLayout: fixed }) } catch {}
  return fixed
}

async function loadPresets() {
  let data = null
  let fetchFailed = false
  try {
    data = await call('GET', '/api/workspace')
  } catch {
    fetchFailed = true
  }
  if (fetchFailed) {
    console.error('[workspace] load presets failed, skip seeding to avoid overwriting server data')
    return null
  }
  userPresets = (data && data.presets) || {}
  activePreset = (data && data.active) || '默认'
  if (!userPresets[activePreset]) activePreset = '默认'
  if (!Object.keys(userPresets).length) {
    const seed = getDefaultConfig()
    userPresets['默认'] = { config: seed }
    call('PUT', '/api/workspace/preset', { name: '默认', config: seed }).catch(() => {})
    call('PUT', '/api/workspace/active', { name: '默认' }).catch(() => {})
    return seed
  }
  const cfg = await window.api.getConfig()
  if (userPresets[activePreset] && userPresets[activePreset].config) {
    if (!isConfigComplete(userPresets[activePreset].config)) return null
    return sanitizeSavedConfig(userPresets[activePreset].config, activePreset)
  }
  if (cfg && cfg.currentLayout && activePreset === '默认') {
    if (!isConfigComplete(cfg.currentLayout)) return null
    return sanitizeSavedConfig(cfg.currentLayout, null)
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
    await call('PUT', '/api/workspace/preset', { name: activePreset, config: cfg })
    userPresets[activePreset] = { config: cfg }
    renderWorkspaceBar()
    showToast('已保存当前工作区「' + activePreset + '」')
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

  if (!cfg) { activePreset = '默认'; cfg = getDefaultConfig() }
  suppressAutoSaveBriefly()
  try {
    applyConfig(cfg)
    await call('PUT', '/api/workspace/active', { name: activePreset })
    notifyResize()
  } catch (e) {
    console.error('[workspace] activate failed', e)
    try { applyConfig(getDefaultConfig()) } catch (e2) { console.error('[workspace] activate fallback failed', e2) }
  }
  renderWorkspaceBar()
}

async function resetCurrent() {
  if (userPresets[activePreset]) {
    if (!await showConfirm('将工作区「' + activePreset + '」重置为默认布局？此操作不可撤销。')) return
  }
  const cfg = getDefaultConfig()
  try {
    applyConfig(cfg)
    notifyResize()
  } catch (e) { console.error('[workspace] reset failed', e) }
  renderWorkspaceBar()
}

function getPresetConfig(name) {
  if (userPresets[name] && userPresets[name].config) return userPresets[name].config

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
          if (p && p.config) {
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
  const templates = Object.keys(userPresets)
  let cfg = { root: row([stack([comp('compare', '贴图对比')])]) }
  let nameHint = '我的工作区'
  if (templates.length) {
    const choice = await showPrompt('选择模板创建新工作区:\n' + templates.map((t, i) => (i + 1) + '. ' + t).join('\n') + '\n\n输入模板名或留空创建空白工作区', templates[0])
    if (choice === null) return
    if (choice && userPresets[choice] && userPresets[choice].config) {
      cfg = userPresets[choice].config
      nameHint = choice + ' 副本'
    }
  }
  const newName = await showPrompt('新工作区名称', nameHint)
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

function findComponentItem(item, id) {
  if (!item) return null
  const ct = item.componentType
  if (ct !== undefined && ct !== null && (ct === id || ct.id === id)) return item
  for (const c of item.contentItems || []) {
    const r = findComponentItem(c, id)
    if (r) return r
  }
  return null
}

function focusPanel(id) {
  if (!layout || !layout.rootItem) return false
  const target = findComponentItem(layout.rootItem, id)
  if (!target) return false
  let child = target
  let p = target.parent
  while (p) {
    if (p.type === 'stack') { try { p.setActiveContentItem(child) } catch {} }
    child = p
    p = p.parent
  }
  return true
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
  header.textContent = '选择要添加的面板'
  menu.appendChild(header)

  for (const def of PANEL_DEFS) {
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
          try { layout.addComponentAtLocation(def.id, {}, def.title, [{ typeId: 3, index: undefined }]) }
          catch { layout.addComponent(def.id, {}, def.title) }
        } else if (activeStack) {
          activeStack.addComponent(def.id, {}, def.title)
        } else {
          layout.addComponent(def.id, {}, def.title)
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
    const allNames = [...new Set([activePreset, ...Object.keys(userPresets)])].filter(Boolean)
    for (const name of allNames) {
      const isSaved = !!userPresets[name]
      const item = document.createElement('div')
      item.className = 'preset-mgr-item' + (name === activePreset ? ' active' : '')
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
      PANEL_DEFS = defs
      ALL_PANEL_IDS = new Set(PANEL_DEFS.map(d => d.id))
    }
    extractPanels()
    createLayoutRoot()
    document.body.classList.add('gl-active')
    await new Promise(r => requestAnimationFrame(r))
    const savedConfig = await loadPresets()
    initGoldenLayout(savedConfig)
    renderWorkspaceBar()
    glReady = true
    document.addEventListener('workspace:focus-panel', (e) => {
      const id = e.detail && e.detail.id
      if (id) focusPanel(id)
    })
    if (layout) layout.updateSizeFromContainer()
    setTimeout(notifyResize, 100)
  } catch (e) {
    console.error('[workspace] init failed, fallback to classic layout', e)
    try { restorePanelsToClassic() } catch {}
    document.body.classList.remove('gl-active')
    if (layoutRoot) layoutRoot.style.display = 'none'
    if (barEl) barEl.style.display = 'none'
  }
}

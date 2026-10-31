/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Adobe 风格浮动面板系统：基于 Golden-Layout，DOM 迁移法保留现有功能逻辑。
 */

import { GoldenLayout, LayoutConfig } from 'golden-layout'
import { $, showToast } from './core.js'
import { sanitizeLayoutConfig, migrateLayoutConfig, LAYOUT_VERSION } from './layout-config.js'
import { getPanelDefs } from './panel-loader.js'
import { computeSplitRatio } from './splitter-ratio.js'
import { responsive } from './responsive.js'
import { renderWorkspaceBar, setHooks as setWorkspaceBarHooks } from './ws/workspace-bar.js'
import { addWindowMenu, openPresetManager, setHooks as setWsMenusHooks } from './ws/menus.js'
import { showPrompt, showConfirm } from './ws/dialogs.js'
import { bindSplitterDragTip } from './ws/splitter-bind.js'
import { bindCloneDelegation } from './ws/clone-bind.js'
import { importPreset, setHooks as setPresetIoHooks } from './ws/preset-io.js'

const call = (m, p, b) => window.matogaCore.call(m, p, b)

let PANEL_DEFS = [
  { id: 'folderCard', title: '文件夹选择', icon: 'i-folder' },
  { id: 'categoryFilter', title: '分类筛选', icon: 'i-filter' },
  { id: 'compare', title: '贴图对比', icon: 'i-compare' },
  { id: 'modelCategory', title: '模型分类', icon: 'i-cube' },

  { id: 'preview', title: '预览', icon: 'i-image' },
  { id: 'material3d', title: '3D 视口', icon: 'i-cube' },
  { id: 'nodeCanvas', title: '节点画布', icon: 'i-node' },
  { id: 'nodeLibrary', title: '节点库', icon: 'i-layers' },
  { id: 'assetLibrary', title: '总资产库', icon: 'i-folder' },

  { id: 'uvEditor', title: 'UV 编辑器', icon: 'i-grid' },
  { id: 'nodeRel', title: '节点关系', icon: 'i-tree' },
  { id: 'nodePreview', title: '节点预览', icon: 'i-eye' }
]

function comp(id, title) {
  return { type: 'component', componentType: id, title, reorderEnabled: true, minSize: '120px' }
}
function stack(c, size) {
  const s = { type: 'stack', content: c, minSize: '28px' }
  if (size) s.size = size
  return s
}
function col(c, size) {
  return { type: 'column', size, content: c, minSize: '120px' }
}
function row(c) {
  return { type: 'row', content: c, minSize: '120px' }
}

const DEFAULT_LAYOUT = row([
  stack([comp('folderCard', '文件夹选择')], '0.7fr'),
  col([
    stack([comp('categoryFilter', '分类筛选')], '0.3fr'),
    stack([comp('compare', '贴图对比'), comp('modelCategory', '模型分类')], '1.4fr')
  ], '1.7fr'),
  col([stack([comp('preview', '预览')])], '1.1fr')
])

const COMPACT_LAYOUT = row([
  stack([comp('folderCard', '文件夹选择')], '0.8fr'),
  col([
    stack([comp('categoryFilter', '分类筛选')], '0.3fr'),
    stack([comp('compare', '贴图对比'), comp('modelCategory', '模型分类')], '1.9fr')
  ], '2.2fr')
])

const STACKED_LAYOUT = col([
  stack([comp('categoryFilter', '分类筛选')], '0.3fr'),
  stack([comp('compare', '贴图对比'), comp('modelCategory', '模型分类')], '1fr'),
  stack([comp('preview', '预览')], '0.6fr')
])

const SINGLE_LAYOUT = stack([
  comp('categoryFilter', '分类筛选'),
  comp('compare', '贴图对比'),
  comp('modelCategory', '模型分类'),
  comp('preview', '预览')
])

function getAdaptiveLayout() {
  const bp = responsive.breakpoint
  if (bp === 'xs') return SINGLE_LAYOUT
  if (bp === 'sm') return STACKED_LAYOUT
  if (bp === 'md') return COMPACT_LAYOUT
  return DEFAULT_LAYOUT
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
  panelEls = {
    folderCard: $('folderCard'),
    categoryFilter: $('categoryFilterPanelWrap'),
    compare: document.querySelector('.center'),
    modelCategory: $('modelCategoryPanelWrap'),

    preview: $('previewPanelWrap'),
    material3d: $('material3dPanelWrap'),

    nodeCanvas: $('nodeCanvasPanelWrap'),
    nodeLibrary: $('nodeLibraryPanelWrap'),
    assetLibrary: $('assetLibraryPanelWrap'),

    uvEditor: $('uvEditorPanelWrap'),
    nodeRel: $('nodeRelPanelWrap'),
    nodePreview: $('nodePreviewPanelWrap')
  }

  panelHomes = Object.values(panelEls)
    .filter(Boolean)
    .map(el => ({ el, parent: el.parentElement, next: el.nextElementSibling }))
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
  const hwHost = document.getElementById('headerWorkspace')
  if (hwHost) {
    hwHost.appendChild(barEl)
    barEl.classList.add('in-header')
  } else {
    layoutRoot.parentNode.insertBefore(barEl, layoutRoot)
  }
}

function registerComponents() {
  for (const def of PANEL_DEFS) {
    layout.registerComponentFactoryFunction(def.id, container => {
      const original = panelEls[def.id]
      if (!original) return
      const inUse = original.isConnected && original.parentElement && original.parentElement.closest('.lm_content')
      if (!inUse) {
        container.element.appendChild(original)
        original.style.display = ''
        original.classList.add('gl-panel-content')
        original.setAttribute('data-panel-id', def.id)
      } else {
        const clone = createPanelClone(original)
        container.element.appendChild(clone)
        clone.style.display = ''
        clone.setAttribute('data-panel-id', def.id)
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

function syncCloneFromOriginal(original, clone) {
  const observer = new MutationObserver(() => {
    if (!clone.isConnected) {
      observer.disconnect()
      return
    }
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
  popInOnClose: true
}
const GL_DIMENSIONS = {
  borderWidth: 10,
  borderGrabWidth: 30,
  headerHeight: 28,
  dragProxyWidth: 300,
  dragProxyHeight: 200
}

function sanitizeConfig(config) {
  let cfg = migrateLayoutConfig(config)
  if (!cfg || typeof cfg !== 'object') return getDefaultConfig()
  if (LayoutConfig.isResolved(cfg)) {
    try {
      cfg = LayoutConfig.fromResolved(cfg)
    } catch {
      return getDefaultConfig()
    }
  }
  const root = cfg.root || cfg
  if (!root || typeof root !== 'object') return getDefaultConfig()
  const cleaned = sanitizeLayoutConfig(root, ALL_PANEL_IDS)
  if (!cleaned) return getDefaultConfig()
  return cfg.root ? { ...cfg, root: cleaned } : { __v: LAYOUT_VERSION, root: cleaned }
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
  document.dispatchEvent(
    new CustomEvent('workspace:activated', { detail: { components: [...comps], name: activePreset } })
  )
}

function getDefaultConfig() {
  return { __v: LAYOUT_VERSION, root: JSON.parse(JSON.stringify(DEFAULT_LAYOUT)) }
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
  layout.on('initialised', () => {
    bindWorkspaceKeyboard()
    notifyResize()
  })
}

let saveError = null

function reportSaveError(e) {
  saveError = e && e.message ? e.message : String(e || 'unknown')
  console.warn('[workspace] save layout failed', e)
  window.dispatchEvent(new CustomEvent('workspace:save-error', { detail: { message: saveError } }))
  renderWorkspaceBar()
}

function clearSaveError() {
  if (!saveError) return
  saveError = null
  renderWorkspaceBar()
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
        clearSaveError()
      }
    } catch (e) {
      reportSaveError(e)
    }
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
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  suppressAutoSave = true
  setTimeout(() => {
    suppressAutoSave = false
  }, 400)
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
      clearSaveError()
    }
  } catch (e) {
    reportSaveError(e)
  }
}

function notifyResize() {
  bindSplitterKeyboard()
  window.dispatchEvent(new Event('resize'))
  setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
}

function bindSplitterKeyboard() {
  document.querySelectorAll('.lm_splitter').forEach(s => {
    if (s.dataset.wsSplitterBound) return
    s.dataset.wsSplitterBound = '1'
    s.setAttribute('tabindex', '0')
    s.setAttribute('role', 'separator')
    const horizontal = s.classList.contains('lm_horizontal')
    s.setAttribute('aria-orientation', horizontal ? 'vertical' : 'horizontal')

    s.addEventListener('keydown', onSplitterKey)
    s.addEventListener('dblclick', onSplitterDblClick)
    if (!s.title) s.title = '拖拽调整比例 · 双击复位 · 方向键微调'
    bindSplitterDragTip(s)
  })
}

function onSplitterKey(e) {
  const splitter = e.currentTarget
  const horizontal = splitter.classList.contains('lm_horizontal')
  let step = 0
  if (horizontal) {
    if (e.key === 'ArrowLeft') step = -8
    else if (e.key === 'ArrowRight') step = 8
  } else {
    if (e.key === 'ArrowUp') step = -8
    else if (e.key === 'ArrowDown') step = 8
  }
  if (!step) return
  if (e.shiftKey) step *= 5
  e.preventDefault()
  const rect = splitter.getBoundingClientRect()
  const x0 = rect.left + rect.width / 2
  const y0 = rect.top + rect.height / 2
  const dx = horizontal ? step : 0
  const dy = horizontal ? 0 : step
  const Ctor = window.PointerEvent ? window.PointerEvent : MouseEvent
  const opts = { bubbles: true, cancelable: true, clientX: x0, clientY: y0, button: 0 }
  splitter.dispatchEvent(new Ctor('pointerdown', opts))
  document.dispatchEvent(new Ctor('pointermove', { ...opts, clientX: x0 + dx, clientY: y0 + dy }))
  document.dispatchEvent(new Ctor('pointerup', { ...opts, clientX: x0 + dx, clientY: y0 + dy }))
}

function dragSplitterTo(splitter, targetX, targetY) {
  const rect = splitter.getBoundingClientRect()
  const x0 = rect.left + rect.width / 2
  const y0 = rect.top + rect.height / 2
  const Ctor = window.PointerEvent ? window.PointerEvent : MouseEvent
  const opts = { bubbles: true, cancelable: true, button: 0 }
  splitter.dispatchEvent(new Ctor('pointerdown', { ...opts, clientX: x0, clientY: y0 }))
  document.dispatchEvent(new Ctor('pointermove', { ...opts, clientX: targetX, clientY: targetY }))
  document.dispatchEvent(new Ctor('pointerup', { ...opts, clientX: targetX, clientY: targetY }))
}

function onSplitterDblClick(e) {
  const splitter = e.currentTarget
  const prev = splitter.previousElementSibling
  const next = splitter.nextElementSibling
  if (!prev || !next) return
  const prevRect = prev.getBoundingClientRect()
  const nextRect = next.getBoundingClientRect()
  const sr = splitter.getBoundingClientRect()
  const { horizontal } = computeSplitRatio(prevRect, nextRect)
  const targetX = horizontal ? (prevRect.left + nextRect.right) / 2 : sr.left + sr.width / 2
  const targetY = horizontal ? sr.top + sr.height / 2 : (prevRect.top + nextRect.bottom) / 2
  dragSplitterTo(splitter, targetX, targetY)
}

function collectComponentItems(node, out) {
  if (!node) return
  if (node.isComponent) {
    out.push(node)
    return
  }
  if (node.contentItems) for (const c of node.contentItems) collectComponentItems(c, out)
}

function focusNextPanel(dir) {
  if (!layout || !layout.rootItem) return
  const items = []
  collectComponentItems(layout.rootItem, items)
  if (!items.length) return
  let idx = -1
  try {
    const active = layout.getActiveContentItem()
    if (active) idx = items.indexOf(active)
  } catch {}
  idx = (idx + dir + items.length) % items.length
  const target = items[idx]
  const stack = target.parent
  if (stack && stack.isStack) {
    try {
      stack.setActiveComponentItem(target, true)
    } catch (e) {
      console.warn('[workspace] focus panel failed', e)
    }
  }
}

function toggleMaximiseActive() {
  if (!layout) return
  let active = null
  try {
    active = layout.getActiveContentItem()
  } catch {}
  if (!active) return
  const stack = active.isStack ? active : active.parent
  if (stack && stack.isStack) {
    try {
      stack.toggleMaximise()
    } catch (e) {
      console.warn('[workspace] maximise failed', e)
    }
  }
}

function bindWorkspaceKeyboard() {
  if (window.__wsKeyboardBound) return
  window.__wsKeyboardBound = true
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented) return
    const t = e.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (e.key === '`' && e.shiftKey) {
      e.preventDefault()
      toggleMaximiseActive()
      return
    }
    if (e.key === '`' && !e.shiftKey) {
      e.preventDefault()
      focusNextPanel(1)
      return
    }
    if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault()
      focusNextPanel(1)
      return
    }
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault()
      focusNextPanel(-1)
      return
    }
  })
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
  try {
    window.api.setConfig({ currentLayout: fixed })
  } catch (e) {
    reportSaveError(e)
  }
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
    if (!isConfigComplete(cfg)) {
      showToast('当前布局不完整，无法保存')
      return
    }
    await call('PUT', '/api/workspace/preset', { name, config: cfg })
    userPresets[name] = { config: cfg }
    activePreset = name
    await call('PUT', '/api/workspace/active', { name })
    renderWorkspaceBar()
    showToast('已保存工作区「' + name + '」')
  } catch (e) {
    showToast('保存失败: ' + e.message)
  }
}

async function saveCurrent() {
  try {
    let cfg = layout.toConfig()
    if (LayoutConfig.isResolved(cfg)) cfg = LayoutConfig.fromResolved(cfg)
    if (!isConfigComplete(cfg)) {
      showToast('当前布局不完整，无法保存')
      return
    }
    await call('PUT', '/api/workspace/preset', { name: activePreset, config: cfg })
    userPresets[activePreset] = { config: cfg }
    renderWorkspaceBar()
    showToast('已保存当前工作区「' + activePreset + '」')
  } catch (e) {
    showToast('保存失败: ' + e.message)
  }
}

async function deletePreset(name) {
  if (!(await showConfirm('删除工作区「' + name + '」？'))) return
  try {
    await call('DELETE', '/api/workspace/preset?name=' + encodeURIComponent(name))
    const wasActive = activePreset === name
    delete userPresets[name]
    if (wasActive) {
      await activatePreset('默认')
    } else {
      renderWorkspaceBar()
    }
    showToast('已删除')
  } catch (e) {
    showToast('删除失败: ' + e.message)
  }
}

async function activatePreset(name, force) {
  if (name === activePreset && !force) return
  flushAutoSave()
  activePreset = name
  let cfg = null
  if (userPresets[name] && userPresets[name].config) cfg = userPresets[name].config

  if (!cfg) {
    activePreset = '默认'
    cfg = getDefaultConfig()
  }
  suppressAutoSaveBriefly()
  try {
    applyConfig(cfg)
    await call('PUT', '/api/workspace/active', { name: activePreset })
    notifyResize()
  } catch (e) {
    console.error('[workspace] activate failed', e)
    try {
      applyConfig(getDefaultConfig())
    } catch (e2) {
      console.error('[workspace] activate fallback failed', e2)
    }
  }
  renderWorkspaceBar()
}

async function resetCurrent() {
  const saved = userPresets[activePreset] && userPresets[activePreset].config
  if (saved) {
    if (!(await showConfirm('将工作区「' + activePreset + '」重置为保存时的布局？此操作不可撤销。'))) return
  }
  let cfg = saved
  if (!cfg || !isConfigComplete(cfg)) cfg = getDefaultConfig()
  suppressAutoSaveBriefly()
  try {
    applyConfig(cfg)
    notifyResize()
  } catch (e) {
    console.error('[workspace] reset failed', e)
  }
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
  } catch (e) {
    showToast('重命名失败: ' + e.message)
  }
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
  } catch (e) {
    showToast('复制失败: ' + e.message)
  }
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

async function createNewPreset(onDone) {
  const templates = Object.keys(userPresets)
  let cfg = { root: row([stack([comp('compare', '贴图对比')])]) }
  let nameHint = '我的工作区'
  if (templates.length) {
    const choice = await showPrompt(
      '选择模板创建新工作区:\n' +
        templates.map((t, i) => i + 1 + '. ' + t).join('\n') +
        '\n\n输入模板名或留空创建空白工作区',
      templates[0]
    )
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
  } catch (e) {
    showToast('创建失败: ' + e.message)
  }
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
    if (p.type === 'stack') {
      try {
        p.setActiveContentItem(child)
      } catch {}
    }
    child = p
    p = p.parent
  }
  return true
}

function togglePanel(id) {
  if (!layout || !layout.rootItem) return
  const def = PANEL_DEFS.find(d => d.id === id)
  if (!def) return
  const existing = findComponentItem(layout.rootItem, id)
  if (existing) {
    focusPanel(id)
    return
  }
  let stack = null
  try {
    for (const s of layout.getAllStacks()) {
      if (s.getActiveContentItem()) { stack = s; break }
    }
  } catch {}
  try {
    if (stack) {
      stack.addComponent(def.id, {}, def.title)
    } else {
      layout.addComponent(def.id, {}, def.title)
    }
  } catch (err) {
    console.error('[workspace] togglePanel add failed', err)
  }
}

export async function initWorkspace() {
  try {
    responsive.init()
    responsive.applyBodyClasses()
    initSidebarInteractions()
    const defs = getPanelDefs()
    if (defs && defs.length) {
      const ids = new Set(defs.map(d => d.id))
      if (!ids.has('folderCard')) defs.unshift({ id: 'folderCard', title: '文件夹选择', icon: 'i-folder' })
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
    document.addEventListener('workspace:focus-panel', e => {
      const id = e.detail && e.detail.id
      if (id) focusPanel(id)
    })
    document.addEventListener('workspace:toggle-panel', e => {
      const id = e.detail && e.detail.id
      if (id) togglePanel(id)
    })
    if (layout) layout.updateSizeFromContainer()
    setTimeout(notifyResize, 100)
    initResponsiveListeners()
  } catch (e) {
    console.error('[workspace] init failed, fallback to classic layout', e)
    try {
      restorePanelsToClassic()
    } catch {}
    document.body.classList.remove('gl-active')
    if (layoutRoot) layoutRoot.style.display = 'none'
    if (barEl) barEl.style.display = 'none'
  }
}

function initResponsiveListeners() {
  responsive.onChange((type, detail) => {
    if (type === 'breakpoint-change') {
      handleBreakpointChange(detail)
    } else if (type === 'resize') {
      handleResize(detail)
    } else if (type === 'orientation-change') {
      handleOrientationChange(detail)
    }
  })
  window.addEventListener('responsive:breakpoint-change', () => {
    responsive.applyBodyClasses()
  })
}

let lastBreakpointLayout = null
function handleBreakpointChange(detail) {
  const { from, to } = detail
  console.info('[workspace] breakpoint change:', from, '→', to)
  responsive.applyBodyClasses()
  if (!glReady || !layout) return
  if (to === 'xs' || to === 'sm') {
    if (from !== 'xs' && from !== 'sm') {
      lastBreakpointLayout = layout.toConfig()
      try {
        const adaptiveCfg = { __v: LAYOUT_VERSION, root: JSON.parse(JSON.stringify(getAdaptiveLayout())) }
        suppressAutoSaveBriefly()
        applyConfig(adaptiveCfg)
        notifyResize()
      } catch (e) {
        console.warn('[workspace] adaptive layout switch failed', e)
      }
    }
  } else if (from === 'xs' || from === 'sm') {
    if (lastBreakpointLayout) {
      try {
        suppressAutoSaveBriefly()
        applyConfig(lastBreakpointLayout)
        notifyResize()
      } catch (e) {
        console.warn('[workspace] restore layout failed', e)
      }
      lastBreakpointLayout = null
    }
  }
  if (to === 'md') {
    autoCollapseSidebars()
  }
  try {
    layout.updateSizeFromContainer()
  } catch {}
  setTimeout(notifyResize, 50)
}

function handleResize(_detail) {
  if (!glReady || !layout) return
  try {
    layout.updateSizeFromContainer()
  } catch {}
}

function handleOrientationChange(_detail) {
  responsive.applyBodyClasses()
  if (!glReady || !layout) return
  try {
    layout.updateSizeFromContainer()
  } catch {}
  setTimeout(notifyResize, 100)
}

function autoCollapseSidebars() {
  /* GL 模式下 #workspace 被 display:none，操作 #sidebarLeft/Right 无意义；
     GL 布局的响应式自适应已由 handleBreakpointChange 的布局切换处理 */
  if (glReady) return
  const leftSidebar = $('sidebarLeft')
  const rightSidebar = $('sidebarRight')
  if (responsive.shouldAutoCollapseSidebar()) {
    if (leftSidebar && !leftSidebar.classList.contains('collapsed')) {
      leftSidebar.classList.add('collapsed')
    }
    if (rightSidebar && !rightSidebar.classList.contains('collapsed')) {
      rightSidebar.classList.add('collapsed')
    }
  }
}
/* 经典布局（GL 失败回退 / GL 未就绪）下的侧栏折叠 + resizer 拖拽交互。
   GL 模式下按钮与 resizer 被 display:none 隐藏，绑定无害。 */
function initSidebarInteractions() {
  const left = $('sidebarLeft')
  const right = $('sidebarRight')
  const collapseLeft = $('collapseLeftBtn')
  const collapseRight = $('collapseRightBtn')
  const resizerLeft = document.querySelector('.resizer[data-resize="left"]')
  const resizerRight = document.querySelector('.resizer[data-resize="right"]')

  if (collapseLeft && left) {
    collapseLeft.addEventListener('click', () => {
      left.classList.toggle('collapsed')
    })
  }
  if (collapseRight && right) {
    collapseRight.addEventListener('click', () => {
      right.classList.toggle('collapsed')
    })
  }

  function bindResizer(resizer, sidebar, side) {
    if (!resizer || !sidebar) return
    resizer.addEventListener('pointerdown', e => {
      if (sidebar.classList.contains('collapsed')) return
      e.preventDefault()
      const startX = e.clientX
      const startW = sidebar.getBoundingClientRect().width
      const minW = 180
      const maxW = Math.max(minW, window.innerWidth * 0.6)
      resizer.classList.add('dragging')
      resizer.setPointerCapture(e.pointerId)
      function onMove(ev) {
        const delta = ev.clientX - startX
        const w = side === 'left' ? startW + delta : startW - delta
        sidebar.style.width = Math.min(maxW, Math.max(minW, w)) + 'px'
      }
      function onUp(ev) {
        resizer.classList.remove('dragging')
        try { resizer.releasePointerCapture(ev.pointerId) } catch {}
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    })
  }
  bindResizer(resizerLeft, left, 'left')
  bindResizer(resizerRight, right, 'right')
}


/* 工作区栏模块的段外依赖注入（状态只读，用 getter 转发） */
setWorkspaceBarHooks({
  get_barEl: () => barEl,
  get_activePreset: () => activePreset,
  get_userPresets: () => userPresets,
  get_saveError: () => saveError,
  get_layout: () => layout,
  get_PANEL_DEFS: () => PANEL_DEFS,
  deletePreset: deletePreset,
  activatePreset: activatePreset,
  flushAutoSave: flushAutoSave,
  createNewPreset: createNewPreset,
  saveCurrent: saveCurrent,
  saveCurrentAs: saveCurrentAs,
  resetCurrent: resetCurrent,
  openPresetManager: openPresetManager,
  focusPanel: focusPanel,
  addWindowMenu: addWindowMenu
})


/* 窗口菜单与预设管理模块的段外依赖注入（状态只读，getter 转发） */
setWsMenusHooks({
  get_layout: () => layout,
  get_PANEL_DEFS: () => PANEL_DEFS,
  get_activePreset: () => activePreset,
  get_userPresets: () => userPresets,
  focusPanel: focusPanel,
  activatePreset: activatePreset,
  duplicatePreset: duplicatePreset,
  renamePresetDialog: renamePresetDialog,
  deletePreset: deletePreset,
  exportPreset: exportPreset,
  createNewPreset: createNewPreset,
  importPreset: importPreset,
  exportAllPresets: exportAllPresets
})


/* 预设导入模块的段外依赖注入 */
setPresetIoHooks({
  call: call,
  get_userPresets: () => userPresets
})

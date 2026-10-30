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

const call = (m, p, b) => window.matogaCore.call(m, p, b)

function showPrompt(message, defaultValue) {
  return new Promise(resolve => {
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
    const finish = val => {
      if (done) return
      done = true
      overlay.remove()
      resolve(val)
    }
    okBtn.addEventListener('click', () => finish(input.value))
    cancelBtn.addEventListener('click', () => finish(null))
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        finish(input.value)
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        finish(null)
      }
    })
    overlay.addEventListener('click', e => {
      if (e.target === overlay) finish(null)
    })
  })
}

function showConfirm(message) {
  return new Promise(resolve => {
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
    const finish = val => {
      if (done) return
      done = true
      overlay.remove()
      resolve(val)
    }
    okBtn.addEventListener('click', () => finish(true))
    cancelBtn.addEventListener('click', () => finish(false))
    overlay.addEventListener('click', e => {
      if (e.target === overlay) finish(false)
    })
    document.addEventListener('keydown', function onKey(e) {
      if (done) {
        document.removeEventListener('keydown', onKey)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        document.removeEventListener('keydown', onKey)
        finish(false)
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        document.removeEventListener('keydown', onKey)
        finish(true)
      }
    })
  })
}

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
  const interactive =
    'button, input, select, label, [data-act], th[data-key], .filter-btn, .view-tab, .sortable, .panel-card-title'
  clone.addEventListener(
    'click',
    e => {
      const t = e.target.closest(interactive)
      if (!t) return
      const orig = getOrigEl(t)
      if (orig && orig !== original) orig.click()
    },
    true
  )
  clone.addEventListener(
    'input',
    e => {
      const orig = getOrigEl(e.target)
      if (orig && orig !== original) {
        orig.value = e.target.value
        orig.dispatchEvent(new Event('input', { bubbles: true }))
      }
    },
    true
  )
  clone.addEventListener(
    'change',
    e => {
      const orig = getOrigEl(e.target)
      if (orig && orig !== original) {
        if (orig.type === 'checkbox' || orig.type === 'radio') orig.checked = e.target.checked
        else orig.value = e.target.value
        orig.dispatchEvent(new Event('change', { bubbles: true }))
      }
    },
    true
  )
  clone.addEventListener(
    'dblclick',
    e => {
      const orig = getOrigEl(e.target)
      if (orig && orig !== original) orig.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    },
    true
  )
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

function bindSplitterDragTip(splitter) {
  if (splitter.dataset.wsTipBound) return
  splitter.dataset.wsTipBound = '1'
  let tip = null
  let raf = 0
  let tipTimer = 0
  const neighbours = () => {
    const prev = splitter.previousElementSibling
    const next = splitter.nextElementSibling
    return prev && next ? [prev, next] : null
  }
  const doUpdate = () => {
    const pair = neighbours()
    if (!pair) return
    const [prev, next] = pair
    const pr = prev.getBoundingClientRect()
    const nr = next.getBoundingClientRect()
    if (pr.width === 0 && pr.height === 0) return
    const sr = splitter.getBoundingClientRect()
    const { a, b } = computeSplitRatio(pr, nr)
    if (!tip) {
      tip = document.createElement('div')
      tip.className = 'lm-splitter-tip'
      document.body.appendChild(tip)
      requestAnimationFrame(() => tip && tip.classList.add('lm-show'))
    }
    tip.textContent = a + ' : ' + b
    tip.style.left = sr.left + sr.width / 2 + 'px'
    tip.style.top = sr.top + sr.height / 2 + 'px'
    window.dispatchEvent(new Event('resize'))
  }
  const update = () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      doUpdate()
    })
  }
  const end = () => {
    splitter.removeEventListener('pointermove', update)
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
    const pair = neighbours()
    if (pair) pair.forEach(el => el.classList.remove('lm-split-active'))

    window.dispatchEvent(new Event('resize'))
    if (tip) {
      tip.classList.remove('lm-show')
      const old = tip
      clearTimeout(tipTimer)
      tipTimer = setTimeout(() => old.remove(), 130)
      tip = null
    }
  }
  splitter.addEventListener('pointerdown', () => {
    const pair = neighbours()
    if (pair) pair.forEach(el => el.classList.add('lm-split-active'))

    doUpdate()
    splitter.addEventListener('pointermove', update)
    splitter.addEventListener('pointerup', end, { once: true })
    document.addEventListener('pointerup', end, { once: true })
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

function renderWorkspaceBar() {
  if (!barEl) return
  const allNames = [...new Set([activePreset, ...Object.keys(userPresets)])].filter(Boolean)
  barEl.innerHTML = ''
  const inHeader = barEl.classList.contains('in-header')
  if (!inHeader) {
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
      tab.addEventListener('click', e => {
        if (e.target.classList.contains('ws-close')) {
          e.stopPropagation()
          deletePreset(name)
          return
        }
        activatePreset(name)
      })
      barEl.appendChild(tab)
    }
  }

  const actions = document.createElement('div')
  actions.className = 'workspace-bar-actions'
  if (inHeader) {
    const btn = document.createElement('button')
    btn.className = 'ws-btn'
    const btnLabel = document.createElement('span')
    btnLabel.className = 'ws-btn-label'
    btnLabel.textContent = activePreset || '工作区'
    const caret = document.createElement('span')
    caret.className = 'ws-btn-caret'
    caret.textContent = '▾'
    btn.appendChild(btnLabel)
    btn.appendChild(caret)
    if (saveError) {
      const errBtn = document.createElement('button')
      errBtn.className = 'ws-save-error-btn'
      errBtn.title = '布局保存失败：' + saveError + '（点击重试）'
      errBtn.textContent = '⚠'
      errBtn.setAttribute('data-ws-action', 'retry-save')
      errBtn.addEventListener('click', () => {
        flushAutoSave()
      })
      actions.appendChild(errBtn)
    }
    actions.appendChild(btn)
    barEl.appendChild(actions)

    const dd = document.createElement('div')
    dd.className = 'ws-dropdown'
    dd.hidden = true
    barEl.appendChild(dd)

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
        item.className = 'ws-dd-item' + (name === activePreset ? ' active' : '')
        const labelEl = document.createElement('span')
        labelEl.className = 'ws-dd-label'
        labelEl.textContent = name
        item.appendChild(labelEl)
        if (name === activePreset) {
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
        const cfg = layout.toConfig()
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
        for (const s of layout.getAllStacks()) {
          if (s.getActiveContentItem()) {
            panelStack = s
            break
          }
        }
      } catch {}

      for (const def of PANEL_DEFS) {
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
                  layout.addComponentAtLocation(def.id, {}, def.title, [
                    { typeId: 3, index: undefined }
                  ])
                } catch {
                  layout.addComponent(def.id, {}, def.title)
                }
              } else if (panelStack) {
                panelStack.addComponent(def.id, {}, def.title)
              } else {
                layout.addComponent(def.id, {}, def.title)
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
      const ctxEl = barEl.closest('.app-header') || barEl.parentElement
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
  if (saveError) {
    const errBtn = document.createElement('button')
    errBtn.className = 'ws-save-error-btn'
    errBtn.title = '布局保存失败：' + saveError + '（点击重试）'
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
        if (!data.name || !data.config) {
          showToast('无效的预设文件')
          return
        }
        await call('PUT', '/api/workspace/preset', { name: data.name, config: data.config })
        userPresets[data.name] = { config: data.config }
        renderWorkspaceBar()
        if (onDone) onDone()
        showToast('已导入「' + data.name + '」')
      }
    } catch (e) {
      showToast('导入失败: ' + e.message)
    }
  })
  input.click()
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

function addWindowMenu() {
  const existing = document.getElementById('addWinMenu')
  if (existing) {
    existing.remove()
    return
  }

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
  try {
    stacks = layout.getAllStacks()
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

  for (const def of PANEL_DEFS) {
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
            layout.addComponentAtLocation(def.id, {}, def.title, [{ typeId: 3, index: undefined }])
          } catch {
            layout.addComponent(def.id, {}, def.title)
          }
        } else if (activeStack) {
          activeStack.addComponent(def.id, {}, def.title)
        } else {
          layout.addComponent(def.id, {}, def.title)
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

function openPresetManager() {
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

/**
 * matoga - 工作区：golden-layout 初始化与自动保存
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 workspace.js 按职责搬出，逻辑未改。
 */
import { GoldenLayout, LayoutConfig } from 'golden-layout'
import { sanitizeLayoutConfig } from '../layout-config.js'
import {
  collectComponentTypes,
  countComponentTypes,
  isConfigComplete,
  getDefaultConfig,
} from './layout-tree.js'
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
} from './preset-model.js'
import { S } from './state.js'
import { reconcileOrphanPanels, registerComponents } from './panels.js'
import { call } from './call.js'

export const GL_SETTINGS = {
  constrainDragToContainer: false,
  reorderEnabled: true,
  popoutWholeStack: false,
  closePopoutsOnUnload: true,
  responsiveMode: 'none',
  reorderOnTabMenuClick: true,
  popInOnClose: true,
}
export const GL_DIMENSIONS = {
  borderWidth: 10,
  borderGrabWidth: 30,
  headerHeight: 28,
  dragProxyWidth: 300,
  dragProxyHeight: 200,
}

export function sanitizeConfig(config) {
  let cfg = config
  if (!cfg || typeof cfg !== 'object') return getDefaultConfig()
  if (LayoutConfig.isResolved(cfg)) {
    try { cfg = LayoutConfig.fromResolved(cfg) } catch { return getDefaultConfig() }
  }
  const root = cfg.root || cfg
  if (!root || typeof root !== 'object') return getDefaultConfig()
  const cleaned = sanitizeLayoutConfig(root, S.allPanelIds)
  if (!cleaned) return getDefaultConfig()
  return cfg.root ? { ...cfg, root: cleaned } : { root: cleaned }
}

export function applyConfig(config) {
  if (Array.isArray(S.cloneObservers)) S.cloneObservers.forEach(o => o.disconnect())
  S.cloneObservers = []
  const cfg = sanitizeConfig(config)
  cfg.settings = GL_SETTINGS
  cfg.dimensions = GL_DIMENSIONS
  S.layout.loadLayout(cfg)
  reconcileOrphanPanels()
  const comps = new Set()
  collectComponentTypes(cfg.root, comps)
  document.dispatchEvent(new CustomEvent('workspace:activated', { detail: { components: [...comps] } }))
}

export function initGoldenLayout(savedConfig) {
  S.layout = new GoldenLayout(S.layoutRoot)
  S.layout.resizeWithContainerAutomatically = true
  registerComponents()
  try {
    applyConfig(savedConfig)
  } catch (e) {
    console.error('[workspace] load saved config failed, fallback to default S.layout', e)
    applyConfig(getDefaultConfig())
  }
  S.layout.on('stateChanged', onStateChanged)
  S.layout.on('initialised', () => { notifyResize() })
}

export function onStateChanged() {
  if (!S.glReady) return
  if (S.saveTimer) clearTimeout(S.saveTimer)
  S.saveTimer = setTimeout(() => {
    try {
      let cfg = S.layout.toConfig()
      if (LayoutConfig.isResolved(cfg)) cfg = LayoutConfig.fromResolved(cfg)
      if (isConfigComplete(cfg)) {
        window.api.setConfig({ currentLayout: cfg })
        if (!S.suppressAutoSave) autoSavePreset(cfg)
      }
    } catch {}
    notifyResize()
  }, 300)
}

export function autoSavePreset(cfg) {
  const name = S.activePreset
  if (!name) return
  setPreset(S.userPresets, name, cfg)
  call('PUT', '/api/workspace/preset', { name, config: cfg }).catch(() => {})
}

export function suppressAutoSaveBriefly() {
  if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null }
  S.suppressAutoSave = true
  setTimeout(() => { S.suppressAutoSave = false }, 400)
}

export function flushAutoSave() {
  if (!S.saveTimer) return
  clearTimeout(S.saveTimer)
  S.saveTimer = null
  try {
    let cfg = S.layout.toConfig()
    if (LayoutConfig.isResolved(cfg)) cfg = LayoutConfig.fromResolved(cfg)
    if (isConfigComplete(cfg)) {
      window.api.setConfig({ currentLayout: cfg })
      autoSavePreset(cfg)
    }
  } catch {}
}

export function notifyResize() {
  window.dispatchEvent(new Event('resize'))
  setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
}


export function sanitizeSavedConfig(config, presetName) {
  const fixed = sanitizeConfig(config)
  if (JSON.stringify(fixed) === JSON.stringify(config)) return config
  if (presetName) {
    S.userPresets[presetName] = S.userPresets[presetName] || {}
    S.userPresets[presetName].config = fixed
    S.userPresets[presetName].updatedAt = Date.now()
    call('PUT', '/api/workspace/preset', { name: presetName, config: fixed }).catch(() => {})
  }
  try { window.api.setConfig({ currentLayout: fixed }) } catch {}
  return fixed
}


/**
 * matoga - 工作区：布局预设管理
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 workspace.js 按职责搬出，逻辑未改。
 */
import { GoldenLayout, LayoutConfig } from 'golden-layout'
import { $, showToast } from '../core.js'
import { showPrompt, showConfirm } from './dialogs.js'
import { DEFAULT_PANEL_DEFS, comp, stack, col, row } from './panel-defs.js'
import { collectComponentTypes, countComponentTypes, isConfigComplete, getDefaultConfig } from './layout-tree.js'
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
  parsePresetImport
} from './preset-model.js'
import { S } from './state.js'
import { applyConfig, flushAutoSave, notifyResize, sanitizeSavedConfig, suppressAutoSaveBriefly } from './layout.js'
import { call, renderWorkspaceBarVia } from './call.js'

export async function loadPresets() {
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
  S.userPresets = (data && data.presets) || {}
  S.activePreset = (data && data.active) || '默认'
  if (!S.userPresets[S.activePreset]) S.activePreset = '默认'
  if (!Object.keys(S.userPresets).length) {
    const seed = getDefaultConfig()
    S.userPresets['默认'] = { config: seed }
    call('PUT', '/api/workspace/preset', { name: '默认', config: seed }).catch(() => {})
    call('PUT', '/api/workspace/active', { name: '默认' }).catch(() => {})
    return seed
  }
  const cfg = await window.api.getConfig()
  if (S.userPresets[S.activePreset] && S.userPresets[S.activePreset].config) {
    if (!isConfigComplete(S.userPresets[S.activePreset].config)) return null
    return sanitizeSavedConfig(S.userPresets[S.activePreset].config, S.activePreset)
  }
  if (cfg && cfg.currentLayout && S.activePreset === '默认') {
    if (!isConfigComplete(cfg.currentLayout)) return null
    return sanitizeSavedConfig(cfg.currentLayout, null)
  }
  return null
}

export async function saveCurrentAs() {
  const name = await showPrompt('工作区名称', '我的工作区')
  if (!name) return
  try {
    let cfg = S.layout.toConfig()
    if (LayoutConfig.isResolved(cfg)) cfg = LayoutConfig.fromResolved(cfg)
    if (!isConfigComplete(cfg)) {
      showToast('当前布局不完整，无法保存')
      return
    }
    await call('PUT', '/api/workspace/preset', { name, config: cfg })
    setPreset(S.userPresets, name, cfg)
    S.activePreset = name
    await call('PUT', '/api/workspace/active', { name })
    renderWorkspaceBarVia()
    showToast('已保存工作区「' + name + '」')
  } catch (e) {
    showToast('保存失败: ' + e.message)
  }
}

export async function saveCurrent() {
  try {
    let cfg = S.layout.toConfig()
    if (LayoutConfig.isResolved(cfg)) cfg = LayoutConfig.fromResolved(cfg)
    if (!isConfigComplete(cfg)) {
      showToast('当前布局不完整，无法保存')
      return
    }
    await call('PUT', '/api/workspace/preset', { name: S.activePreset, config: cfg })
    setPreset(S.userPresets, S.activePreset, cfg)
    renderWorkspaceBarVia()
    showToast('已保存当前工作区「' + S.activePreset + '」')
  } catch (e) {
    showToast('保存失败: ' + e.message)
  }
}

export async function deletePreset(name) {
  if (!(await showConfirm('删除工作区「' + name + '」？'))) return
  try {
    await call('DELETE', '/api/workspace/preset?name=' + encodeURIComponent(name))
    const wasActive = S.activePreset === name
    deletePresetEntry(S.userPresets, name)
    if (wasActive) {
      await activatePreset('默认')
    } else {
      renderWorkspaceBarVia()
    }
    showToast('已删除')
  } catch (e) {
    showToast('删除失败: ' + e.message)
  }
}

export async function activatePreset(name, force) {
  if (name === S.activePreset && !force) return
  flushAutoSave()
  S.activePreset = name
  let cfg = null
  if (S.userPresets[name] && S.userPresets[name].config) cfg = S.userPresets[name].config

  if (!cfg) {
    S.activePreset = '默认'
    cfg = getDefaultConfig()
  }
  suppressAutoSaveBriefly()
  try {
    applyConfig(cfg)
    await call('PUT', '/api/workspace/active', { name: S.activePreset })
    notifyResize()
  } catch (e) {
    console.error('[workspace] activate failed', e)
    try {
      applyConfig(getDefaultConfig())
    } catch (e2) {
      console.error('[workspace] activate fallback failed', e2)
    }
  }
  renderWorkspaceBarVia()
}

export async function resetCurrent() {
  if (S.userPresets[S.activePreset]) {
    if (!(await showConfirm('将工作区「' + S.activePreset + '」重置为默认布局？此操作不可撤销。'))) return
  }
  const cfg = getDefaultConfig()
  try {
    applyConfig(cfg)
    notifyResize()
  } catch (e) {
    console.error('[workspace] reset failed', e)
  }
  renderWorkspaceBarVia()
}

export function getPresetConfigOf(name) {
  return getPresetConfig(S.userPresets, name)
}

export async function renamePresetDialog(name, onDone) {
  const newName = await showPrompt('重命名工作区「' + name + '」', name)
  if (!newName || newName === name) return
  try {
    await call('PUT', '/api/workspace/rename', { oldName: name, newName })
    renamePresetEntry(S.userPresets, name, newName)
    if (S.activePreset === name) S.activePreset = newName
    renderWorkspaceBarVia()
    if (onDone) onDone()
    showToast('已重命名为「' + newName + '」')
  } catch (e) {
    showToast('重命名失败: ' + e.message)
  }
}

export async function duplicatePreset(name) {
  const cfg = getPresetConfigOf(name)
  if (!cfg) return
  const newName = await showPrompt('复制工作区「' + name + '」为新预设', name + ' 副本')
  if (!newName) return
  try {
    await call('PUT', '/api/workspace/preset', { name: newName, config: cfg })
    setPreset(S.userPresets, newName, cfg)
    renderWorkspaceBarVia()
    showToast('已复制为「' + newName + '」')
  } catch (e) {
    showToast('复制失败: ' + e.message)
  }
}

export function exportPreset(name) {
  const cfg = getPresetConfigOf(name)
  if (!cfg) return
  const blob = new Blob([buildPresetExport(name, cfg)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = presetExportFileName(name)
  a.click()
  URL.revokeObjectURL(a.href)
  showToast('已导出「' + name + '」')
}

export function exportAllPresets() {
  const blob = new Blob([buildAllPresetsExport(S.userPresets)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = ALL_PRESETS_FILE_NAME
  a.click()
  URL.revokeObjectURL(a.href)
  showToast('已导出全部预设')
}

export async function importPreset(onDone) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.addEventListener('change', async () => {
    const file = input.files[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = parsePresetImport(text)
      if (parsed.kind === 'invalid') {
        showToast(parsed.reason)
        return
      }
      if (parsed.kind === 'batch') {
        for (const [n, p] of parsed.entries) {
          await call('PUT', '/api/workspace/preset', { name: n, config: p.config })
          S.userPresets[n] = { config: p.config }
        }
        renderWorkspaceBarVia()
        if (onDone) onDone()
        showToast('已批量导入预设')
      } else {
        await call('PUT', '/api/workspace/preset', { name: parsed.name, config: parsed.config })
        S.userPresets[parsed.name] = { config: parsed.config }
        renderWorkspaceBarVia()
        if (onDone) onDone()
        showToast('已导入「' + parsed.name + '」')
      }
    } catch (e) {
      showToast('导入失败: ' + e.message)
    }
  })
  input.click()
}

export async function createNewPreset(onDone) {
  const templates = Object.keys(S.userPresets)
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
    if (choice && S.userPresets[choice] && S.userPresets[choice].config) {
      cfg = S.userPresets[choice].config
      nameHint = choice + ' 副本'
    }
  }
  const newName = await showPrompt('新工作区名称', nameHint)
  if (!newName) return
  try {
    await call('PUT', '/api/workspace/preset', { name: newName, config: cfg })
    setPreset(S.userPresets, newName, cfg)
    S.activePreset = newName
    await call('PUT', '/api/workspace/active', { name: newName })
    applyConfig(cfg)
    renderWorkspaceBarVia()
    if (onDone) onDone()
    showToast('已创建工作区「' + newName + '」')
  } catch (e) {
    showToast('创建失败: ' + e.message)
  }
}

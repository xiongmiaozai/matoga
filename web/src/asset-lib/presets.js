/**
 * matoga - 总资产库：presets
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，逻辑未改。
 */
import { state, IMG_EXTS, showToast } from '../core.js'
import { addNodeAt, addTextureAt, loadPreset, saveNodeProject, loadNodeProject, serializeGraphData, loadCanvasPresetGraph } from '../node-canvas.js'
import { t, onLocaleChange } from '../i18n.js'
import { uiPrompt, uiConfirm } from '../ui-dialog.js'
import { el, shade, loadList, saveList } from './dom.js'
import { S, BROWSE_CLICK_DELAY } from './store.js'
import { rebuild } from './filters.js'
import { persistFavorites, persistRecent } from './api.js'
import { sortItems } from './items.js'
import { collapsedSet, saveCollapsed } from './collapse.js'
import { makeCard } from './card.js'
import { PRESETS, presetName } from './helpers.js'

const CANVAS_PRESET_MAX_BYTES = 8 * 1024 * 1024  /* 后端 body 上限 12MB，留余量 */

export async function loadCanvasPresets() {
  try {
    const cfg = await window.api.getConfig()
    S.canvasPresets = (cfg && Array.isArray(cfg.canvasCustomPresets)) ? cfg.canvasCustomPresets : []
  } catch { S.canvasPresets = [] }
}

async function saveCanvasPresetAs() {
  let graph = null
  try { graph = serializeGraphData() } catch { graph = null }
  if (!graph || !Array.isArray(graph.nodes) || !graph.nodes.length) { showToast(t('asset.canvasPresetEmpty')); return }
  const name = await uiPrompt({ title: t('asset.canvasPresetSaveTitle'), label: t('asset.canvasPresetNamePrompt') })
  if (name === null) return
  const n = name.trim()
  if (!n) { showToast(t('asset.canvasPresetNameEmpty')); return }
  try {
    const cfg = await window.api.getConfig()
    const presets = (cfg && Array.isArray(cfg.canvasCustomPresets)) ? cfg.canvasCustomPresets : []
    presets.push({ id: 'cp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: n, graph, createdAt: Date.now() })
    if (JSON.stringify(presets).length > CANVAS_PRESET_MAX_BYTES) { showToast(t('asset.canvasPresetTooLarge')); return }
    await window.api.setConfig({ canvasCustomPresets: presets })
    S.canvasPresets = presets
    showToast(t('asset.canvasPresetSaved'))
    rebuild()
  } catch (e) {
    showToast(t('asset.canvasPresetSaveFail') + ': ' + (e.message || e))
  }
}

export async function deleteCanvasPreset(item) {
  if (!item.canvasPresetId) return
  if (!await uiConfirm({ title: t('asset.presetSection'), message: t('asset.canvasPresetDeleteConfirm', { name: item.name }), danger: true })) return
  try {
    const cfg = await window.api.getConfig()
    const presets = ((cfg && Array.isArray(cfg.canvasCustomPresets)) ? cfg.canvasCustomPresets : []).filter(p => p.id !== item.canvasPresetId)
    await window.api.setConfig({ canvasCustomPresets: presets })
    S.canvasPresets = presets
    S.favorites = S.favorites.filter(f => f.key !== item.key)
    S.recent = S.recent.filter(r => r.key !== item.key)
    persistFavorites()
    persistRecent()
    showToast(t('asset.canvasPresetDeleted'))
    rebuild()
  } catch (e) {
    showToast(t('asset.canvasPresetDeleteFail') + ': ' + (e.message || e))
  }
}

export function buildPresetSection() {
  const items = PRESETS.map(p => ({
    key: 'preset:' + p.id, name: presetName(p.id), color: p.color, type: 'preset', path: null, mtime: 0, role: 'preset',
    onAdd: () => loadPreset(p.id),
  }))
  for (const p of S.canvasPresets || []) {
    if (!p || !p.id || !p.graph) continue
    items.push({
      key: 'preset:cp:' + p.id, name: p.name, color: '#8ab4f8', type: 'preset', path: null,
      mtime: p.createdAt || 0, role: 'preset', canvasPresetId: p.id,
      onAdd: () => loadCanvasPresetGraph(p.graph),
    })
  }
  const sorted = sortItems(items)
  const sec = el('div', 'asset-lib-section')
  sec.dataset.cat = 'preset'
  if (collapsedSet.has('preset')) sec.classList.add('collapsed')
  const head = el('div', 'asset-lib-section-head',
    `<span class="caret">▾</span><span>${t('asset.presetSection')}</span><span class="cnt">${sorted.length}</span>`)
  head.addEventListener('click', () => {
    sec.classList.toggle('collapsed')
    if (sec.classList.contains('collapsed')) { collapsedSet.add('preset'); saveCollapsed(collapsedSet) }
    else { collapsedSet.delete('preset'); saveCollapsed(collapsedSet) }
  })
  sec.appendChild(head)

  const actions = el('div', 'asset-lib-sec-actions')
  const saveBtn = el('button', 'asset-lib-sec-btn', t('asset.canvasPresetSave'))
  saveBtn.title = t('asset.canvasPresetSaveTitle')
  saveBtn.addEventListener('click', (e) => { e.stopPropagation(); saveCanvasPresetAs() })
  actions.appendChild(saveBtn)
  sec.appendChild(actions)

  const grid = el('div', 'asset-lib-grid')
  if (S.viewMode === 'list') grid.classList.add('list-view')
  for (const it of sorted) grid.appendChild(makeCard(it))
  sec.appendChild(grid)
  return sec
}

/* ── 材质贴图节：聚合左右目录 + MC 材质包 + 官方包全部贴图，按文件夹/包类别分组 ── */


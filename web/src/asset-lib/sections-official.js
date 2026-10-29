/**
 * matoga - 总资产库：sections-official
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
import { openPackBrowser } from './pack-browser.js'
import { sortItems } from './items.js'
import { collapsedSet, saveCollapsed } from './collapse.js'
import { makeCard } from './card.js'
import { assetApiCall, persistFavorites, persistRecent } from './api.js'
import { rebuild } from './filters.js'
import { officialRawUrl, packApiFor, MC_OFFICIAL_API, packRawUrl } from './helpers.js'

export async function addPackTextureToCanvas(item, pack, tex) {
  try {
    const res = await fetch(packRawUrl(packApiFor(item.type), pack.name, tex.path))
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const blob = await res.blob()
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result)
      fr.onerror = () => reject(new Error('read blob failed'))
      fr.readAsDataURL(blob)
    })
    addTextureAt(dataUrl, tex.name)
    showToast(t('asset.toastTexAdded', { name: tex.name }))
  } catch (e) {
    showToast(t('asset.toastTexAddFail') + ': ' + e.message)
  }
}

export function officialBadge(p) {
  if (!p || !p.valid) return null
  if (p.formatRange) return p.formatRange
  if (p.format != null) return 'pack_format ' + p.format
  return null
}

export function officialSuggestName(p) {
  const range = (p && p.formatRange) || ''
  if (range) return range.replace(/\s*–\s*/g, '-').replace(/\s+-\s+/g, '-').trim()
  if (p && p.format != null) return 'pack_format-' + p.format
  return (p && p.name) || ''
}

export function buildOfficialSection() {
  const items = (S.officialEntries || []).map(p => {
    const it = {
      key: 'official:' + p.fullPath, name: p.name,
      thumb: p.firstTexture ? officialRawUrl(p.name, p.firstTexture) : null,
      type: 'official', path: p.fullPath, mtime: p.mtime || 0,
      badge: officialBadge(p), pack: p,
      onAdd: () => { if (p.fullPath) window.api.showInFolder(p.fullPath) },
    }
    it.onBrowse = () => openPackBrowser(it)
    return it
  })
  const sorted = sortItems(items)
  const sec = el('div', 'asset-lib-section')
  sec.dataset.cat = 'official'
  if (collapsedSet.has('official')) sec.classList.add('collapsed')
  const head = el('div', 'asset-lib-section-head',
    `<span class="caret">▾</span><span>${t('asset.officialSection')}</span><span class="cnt">${sorted.length}</span>`)
  head.addEventListener('click', () => {
    sec.classList.toggle('collapsed')
    if (sec.classList.contains('collapsed')) { collapsedSet.add('official'); saveCollapsed(collapsedSet) }
    else { collapsedSet.delete('official'); saveCollapsed(collapsedSet) }
  })
  sec.appendChild(head)

  const grid = el('div', 'asset-lib-grid')
  if (S.viewMode === 'list') grid.classList.add('list-view')
  if (S.officialEntries === null) {
    grid.appendChild(el('div', 'asset-lib-hint', t('asset.loading')))
  } else if (S.loadErrors.official) {
    grid.appendChild(el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg: S.loadErrors.official })))
  } else if (!sorted.length) {
    grid.appendChild(el('div', 'asset-lib-hint', t('asset.officialEmpty')))
  } else {
    for (const it of sorted) grid.appendChild(makeCard(it))
  }
  sec.appendChild(grid)
  return sec
}

export async function loadOfficial() {
  try {
    const data = await assetApiCall('GET', MC_OFFICIAL_API + '/list')
    S.officialEntries = (data && data.packs) || []
    S.loadErrors.official = null
  } catch (e) {
    S.loadErrors.official = e.message || '未知错误'
    if (S.officialEntries === null) S.officialEntries = []
  }
}

async function refreshOfficialQuiet() {
  await loadOfficial()
  rebuild()
}

export async function renameOfficialAsset(item, byVersion) {
  const p = item.pack || {}
  const def = byVersion ? (officialSuggestName(p) || item.name) : item.name
  const name = await uiPrompt({ title: t('asset.officialRenamePrompt'), label: t('asset.officialNamePrompt'), value: def })
  if (name === null) return
  const n = name.trim()
  if (!n || n === item.name) return
  const oldKey = item.key
  const oldPath = item.path
  try {
    const data = await assetApiCall('PUT', MC_OFFICIAL_API + '/rename', { from: item.name, to: n })
    const newKey = 'official:' + (data && data.to ? data.to : oldPath)
    const newBadge = byVersion ? (officialSuggestName(p) || item.badge) : item.badge
    S.favorites.forEach(f => { if (f.key === oldKey) { f.key = newKey; f.name = n; f.path = data && data.to || f.path; f.badge = newBadge } })
    S.recent.forEach(r => { if (r.key === oldKey) { r.key = newKey; r.name = n; r.path = data && data.to || r.path; r.badge = newBadge } })
    persistFavorites()
    persistRecent()
    showToast(t('asset.toastOfficialRenamed'))
    refreshOfficialQuiet()
  } catch (e) {
    showToast(t('asset.toastOfficialRenameFail') + ': ' + e.message)
  }
}

/* ── 包内容浏览（文件管理器式，在总资产库面板内切换视图） ──── */


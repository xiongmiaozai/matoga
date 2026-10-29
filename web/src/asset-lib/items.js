/**
 * matoga - 总资产库：items
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，逻辑未改。
 */
import { state, IMG_EXTS, showToast } from '../core.js'
import { addNodeAt, addTextureAt, loadPreset, saveNodeProject, loadNodeProject, serializeGraphData, loadCanvasPresetGraph } from '../node-canvas.js'
import { t, onLocaleChange } from '../i18n.js'
import { tryActivateModelViewport, viewMcModelAsset, viewImportedModelAsset } from './model-view.js'
import { S, BROWSE_CLICK_DELAY } from './store.js'
import { openPackBrowser } from './pack-browser.js'
import { addPackTextureToCanvas } from './sections-official.js'
import { persistFavorites, persistRecent } from './api.js'
import { rebuild } from './filters.js'
import { refreshDetailFav } from './detail.js'
import { isValidAssetKey, packApiFor, parsePackModelPath, parsePackTexPath, presetName } from './helpers.js'

export function sortItems(items) {
  const arr = items.slice()
  arr.sort((a, b) => {
    let cmp
    if (S.sortKey === 'mtime') cmp = (a.mtime || 0) - (b.mtime || 0)
    else cmp = String(a.name).localeCompare(String(b.name), 'zh')
    return S.sortDir === 'asc' ? cmp : -cmp
  })
  return arr
}

export function itemFromStored(s) {
  let onAdd, onBrowse, name = s.name
  let modelThumb = null
  if (s.type === 'preset') {
    const id = s.key.slice(8)
    if (id.startsWith('cp:')) {
      const cp = (S.canvasPresets || []).find(p => ('cp:' + p.id) === id)
      onAdd = cp ? () => loadCanvasPresetGraph(cp.graph) : () => showToast(t('asset.canvasPresetMissing'))
      name = cp ? cp.name : (s.name || name)
    } else {
      onAdd = () => loadPreset(id)
      name = presetName(id)
    }
  } else if (s.type === 'project') {
    const id = s.key.slice(8)
    onAdd = () => loadNodeProject(id)
  } else if (s.type === 'hdri') {
    onAdd = () => addNodeAt('hdr')
  } else if (s.type === 'official') {
    onAdd = () => { if (s.path) window.api.showInFolder(s.path) }
    onBrowse = () => openPackBrowser({ key: s.key, name: s.name, type: 'official', path: s.path, badge: s.badge })
  } else if (s.type === 'mc') {
    onAdd = () => { if (s.path) window.api.showInFolder(s.path) }
    onBrowse = () => openPackBrowser({ key: s.key, name: s.name, type: 'mc', path: s.path, badge: s.badge })
  } else if (s.type === 'craft') {
    onAdd = () => { if (s.path) window.api.showInFolder(s.path) }
    onBrowse = () => openPackBrowser({ key: s.key, name: s.name, type: 'craft', path: s.path, badge: s.badge })
  } else if (s.type === 'model') {
    const pm = parsePackModelPath(s.path)
    if (pm) {
      onAdd = () => viewMcModelAsset(pm.source, pm.packName, pm.rel, s.name)
      modelThumb = { kind: 'mc', api: packApiFor(pm.source), packName: pm.packName, rel: pm.rel, path: s.path, mtime: s.mtime || 0 }
    } else {
      onAdd = () => { if (s.path) window.api.showInFolder(s.path) }
    }
  } else {
    const pp = parsePackTexPath(s.path)
    if (pp) {
      /* zip 包内贴图（虚拟路径）：经包媒体 raw 接口读取后添加 */
      onAdd = () => addPackTextureToCanvas({ type: pp.source }, { name: pp.packName }, { path: pp.rel, name: s.name })
    } else {
      onAdd = () => addTextureAt(s.path, s.name)
    }
  }
  return { key: s.key, name, thumb: s.thumb, type: s.type, path: s.path, craftPath: s.craftPath, locatePath: s.locatePath, mtime: s.mtime || 0, role: s.role, color: s.color, badge: s.badge, modelThumb, onAdd, onBrowse }
}

function storeFromItem(it) {
  return { key: it.key, name: it.name, thumb: it.thumb, type: it.type, path: it.path, mtime: it.mtime || 0, role: it.role, color: it.color, badge: it.badge }
}

/* 虚拟路径（pack:/packmodel:）经包列表解析出真实文件路径：<包根>/<包名>/<包内相对路径> */
function virtualToRealPath(p) {
  const pp = parsePackTexPath(p) || parsePackModelPath(p)
  if (!pp) return null
  const entries = pp.source === 'mc' ? S.mcEntries : (pp.source === 'official' ? S.officialEntries : null)
  const pack = (entries || []).find(e => e && e.name === pp.packName && e.fullPath)
  return pack ? pack.fullPath.replace(/[\\/]+$/, '') + '/' + pp.rel : null
}

/* 条目定位路径（含制作包条目）：locatePath（服务端已解析）→ craftPath 副本 →
 * modelFile → 磁盘绝对路径 → 包内虚拟路径经包列表解析；均无则 null（虚拟资产不可定位） */
export function resolveLocatePath(item) {
  if (!item) return null
  if (item.locatePath) return item.locatePath
  if (item.craftPath) return item.craftPath
  if (item.modelFile) return item.modelFile
  const p = item.path
  if (typeof p !== 'string' || !p) return null
  if (p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)) return p
  return virtualToRealPath(p)
}

export function isFav(item) { return S.favorites.some(f => f.key === item.key) }

export function toggleFav(item) {
  if (!isValidAssetKey(item.key)) return
  if (isFav(item)) {
    S.favorites = S.favorites.filter(f => f.key !== item.key)
    showToast(t('asset.toastFavRemoved'))
  } else {
    S.favorites.unshift(storeFromItem(item))
    showToast(t('asset.toastFavAdded'))
  }
  persistFavorites()
  rebuild()
  refreshDetailFav()
}

export function pushRecent(item) {
  if (!isValidAssetKey(item.key)) return
  S.recent = S.recent.filter(r => r.key !== item.key)
  S.recent.unshift(storeFromItem(item))
  if (S.recent.length > MAX_RECENT) S.recent = S.recent.slice(0, MAX_RECENT)
  persistRecent()
  if (S.categoryFilter === 'recent') rebuild()
}



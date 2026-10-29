/**
 * matoga - 总资产库：detail
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，逻辑未改。
 */
import { fileUrl, formatSize, formatDate, escAttr, apiUrl, setTexDragData, contentKindOfPath } from '../utils.js'
import { t, onLocaleChange } from '../i18n.js'
import { ensureModelThumb, observeModelThumbs } from '../model-thumb.js'
import { el, shade, loadList, saveList } from './dom.js'
import { S, BROWSE_CLICK_DELAY } from './store.js'
import { assetApiCall } from './api.js'
import { isFav, pushRecent, resolveLocatePath, toggleFav } from './items.js'
import { copyText } from './ctx-menu.js'
import { deleteUserModel } from './sections-model.js'
import { addPackTextureToCanvas, renameOfficialAsset } from './sections-official.js'
import { isVirtualAssetPath, packApiFor, packRawUrl, parsePackModelPath, roleText, IMPORT_API } from './helpers.js'

function detailRow(label, value) {
  const row = el('div', 'asset-detail-row')
  row.appendChild(el('div', 'asset-detail-label', label))
  const val = el('div', 'asset-detail-value')
  val.textContent = value
  row.appendChild(val)
  return row
}

/* 模型详情元信息：MC .json 模型（parent / 贴图引用 / 元素数） */
function modelMetaRows(j) {
  if (!j || typeof j !== 'object') return []
  const rows = []
  if (typeof j.parent === 'string' && j.parent) rows.push([t('asset.detailModelParent'), j.parent])
  const texRefs = (j.textures && typeof j.textures === 'object') ? Object.entries(j.textures) : []
  if (texRefs.length) {
    const shown = texRefs.slice(0, 8).map(([k, v]) => k + ': ' + v).join(' · ')
    rows.push([t('asset.detailModelTexRefs'), shown + (texRefs.length > 8 ? ' …' : '')])
  }
  if (Array.isArray(j.elements)) rows.push([t('asset.detailModelElements'), String(j.elements.length)])
  return rows
}

/* 模型详情元信息：.bbmodel（格式 / 分辨率 / 元素与贴图数） */
function bbModelMetaRows(j) {
  if (!j || typeof j !== 'object') return []
  const rows = []
  const fmt = j.meta && (j.meta.model_format || j.meta.format)
  if (fmt) rows.push([t('asset.detailModelFormat'), fmt])
  if (typeof j.resolution === 'number') rows.push([t('asset.detailModelResolution'), String(j.resolution)])
  if (Array.isArray(j.elements)) rows.push([t('asset.detailModelElements'), String(j.elements.length)])
  if (Array.isArray(j.textures)) rows.push([t('asset.detailTextures'), String(j.textures.length)])
  return rows
}

async function fetchModelMetaRows(item) {
  const pm = parsePackModelPath(item.path)
  if (pm) {
    const res = await fetch(packRawUrl(packApiFor(pm.source), pm.packName, pm.rel) + '&any=1')
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return modelMetaRows(await res.json())
  }

  if (typeof item.path === 'string' && item.path.startsWith('im:')) {
    const data = await assetApiCall('GET', IMPORT_API + '/' + encodeURIComponent(item.path.slice(3)))
    return bbModelMetaRows(data && data.json)
  }
  return []
}

/* 卡片点击入口：模型详情需先拉取 JSON 元信息（parent / 贴图引用等），其余直接展示 */
export function openDetail(item) {
  if (item && item.type === 'model') showModelDetail(item)
  else showDetail(item)
}

async function showModelDetail(item) {
  if (!Array.isArray(item._metaRows)) {
    try { item._metaRows = await fetchModelMetaRows(item) }
    catch { item._metaRows = [] }
  }
  showDetail(item, item._metaRows)
  /* 详情大图：懒加载 3D 缩略图，就绪后刷新详情面板（stage 直接显示渲染结果） */
  if (item.modelThumb && !item.thumb) {
    ensureModelThumb(item)
      .then(url => { if (url && S.detailCurrent === item) showDetail(item, item._metaRows) })
      .catch(() => {})
  }
}

function showDetail(item, extraMetaRows) {
  // 原「资产详情」抽屉窗口已移除：详情在「节点预览」浮动窗中展示
  const typeKeys = { tex: 'asset.typeTex', model: 'asset.typeModel', hdri: 'asset.typeHdri', mc: 'asset.typeMc', official: 'asset.typeOfficial', preset: 'asset.typePreset', project: 'asset.typeProject', craft: 'asset.catCraft' }
  const virtual = isVirtualAssetPath(item)
  const locatePath = resolveLocatePath(item)
  const payload = {
    kind: 'asset',
    name: item.name,
    type: item.type,
    typeLabel: t(typeKeys[item.type] || item.type),
    roleLabel: item.role ? roleText(item.role) : (item.badge || null),
    color: item.color || null,
    color2: item.color ? shade(item.color, -30) : null,
    thumb: item.thumb || null,
    path: item.path || null,
    nodeCount: item.nodeCount ?? null,
    textureCount: item.textureCount ?? null,
    mtimeLabel: item.mtime ? formatDate(item.mtime) : '—',
    fav: isFav(item),
    onAdd: () => { pushRecent(item); item.onAdd() },
    onFav: () => { toggleFav(item) },
    /* 定位：优先 craftPath/locatePath，虚拟路径经包列表解析回退 */
    onLocate: locatePath ? () => window.api.showInFolder(locatePath) : null,
    onCopyPath: locatePath ? () => copyText(locatePath) : null,
    onCopyName: () => copyText(item.name),
    fetchInfo: (item.path && item.type !== 'preset' && !virtual)
      ? (cb) => {
          assetApiCall('GET', '/api/asset/info?path=' + encodeURIComponent(item.path))
            .then(info => {
              cb(info && info.exists
                ? { sizeLabel: formatSize(info.size), mtimeLabel: info.mtime ? formatDate(info.mtime) : null }
                : { exists: false })
            })
            .catch(() => cb(null))
        }
      : null,
  }
  if (Array.isArray(extraMetaRows) && extraMetaRows.length) {
    payload.metaRows = extraMetaRows
  }

  if (item.type === 'model' && item.modelDelete) {
    payload.onDelete = () => deleteUserModel(item)
  }
  if ((item.type === 'official' || item.type === 'mc') && item.pack) {
    const p = item.pack
    payload.metaRows = [
      [t('asset.detailMcVersion'), p.formatRange || (p.format != null ? 'pack_format ' + p.format : '—')],
      [t('asset.detailPackFormat'), p.formatLabel || (p.format != null ? String(p.format) : '—')],
      [t('asset.detailPackKind'), p.kind === 'zip' ? 'ZIP' : (p.kind === 'dir' ? t('asset.officialKindDir') : '—')],
      [t('asset.detailDescription'), p.description || '—'],
      (p.namespaces && p.namespaces.length) ? [t('asset.detailNamespaces'), p.namespaces.join(', ')] : null,
      [t('asset.detailPackTexCount'), String(p.textureCount ?? 0)],
      p.valid ? null : [t('asset.detailAnalyze'), p.error || '—'],
    ].filter(Boolean)
    if (item.type === 'official') payload.onRename = () => renameOfficialAsset(item, false)
    const texApi = packApiFor(item.type)
    payload.fetchTextures = (params, cb) => {
      const q = new URLSearchParams()
      if (params && params.dir) q.set('dir', params.dir)
      if (params && params.offset != null) q.set('offset', String(params.offset))
      if (params && params.limit != null) q.set('limit', String(params.limit))
      const qs = q.toString()
      assetApiCall('GET', texApi + '/' + encodeURIComponent(p.name) + '/textures' + (qs ? '?' + qs : ''))
        .then(d => {
          const files = (d && d.files) || []
          files.forEach(f => { f.rawUrl = packRawUrl(texApi, p.name, f.path) })
          cb({
            dir: (d && d.dir) || null,
            parent: (d && d.parent) || null,
            categories: (d && d.categories) || [],
            dirs: (d && d.dirs) || [],
            breadcrumbs: (d && d.breadcrumbs) || [{ name: 'root', dir: null }],
            files,
            filesTotal: (d && d.filesTotal) || 0,
            total: (d && d.total) || 0,
            offset: (d && d.offset) || 0,
          })
        })
        .catch(e => cb({ error: e.message }))
    }
    payload.onTextureAdd = (tex) => { pushRecent(item); addPackTextureToCanvas(item, p, tex) }
  }
  document.dispatchEvent(new CustomEvent('nodepreview:show-asset', { detail: payload }))
  S.detailCurrent = item
}

export function refreshDetailFav() {
  if (!S.detailCurrent) return
  openDetail(S.detailCurrent)
}

export function hideDetail() {
  document.dispatchEvent(new CustomEvent('nodepreview:hide-asset'))
  S.detailCurrent = null
}


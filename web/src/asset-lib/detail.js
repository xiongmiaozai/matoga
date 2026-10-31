/**
 * matoga - MC 模型：AssetDetail
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：资产详情面板与元信息（模型元信息/详情浮窗/收藏刷新）
 */

import { t } from '../i18n.js'
import { ensureModelThumb } from '../model-thumb.js'
import { formatDate, formatSize } from '../utils.js'

/* 主文件函数（注入） */
let _parsePackModelPath = (...a) => undefined
let _packRawUrl = (...a) => undefined
let _packApiFor = (...a) => undefined
let _assetApiCall = (...a) => undefined
let _isVirtualAssetPath = (...a) => undefined
let _resolveLocatePath = (...a) => undefined
let _roleText = (...a) => undefined
let _shade = (...a) => undefined
let _isFav = (...a) => undefined
let _pushRecent = (...a) => undefined
let _toggleFav = (...a) => undefined
let _copyText = (...a) => undefined
let _deleteUserModel = (...a) => undefined
let _renameOfficialAsset = (...a) => undefined
let _addPackTextureToCanvas = (...a) => undefined

/* 模块状态：只读用 getter；可写用 get/set 成对（§2.2） */
let _get_IMPORT_API = () => undefined
let _get_detailCurrent = () => undefined
let _set_detailCurrent = () => {}

export function setHooks(h) {
  if (h.parsePackModelPath) _parsePackModelPath = h.parsePackModelPath
  if (h.packRawUrl) _packRawUrl = h.packRawUrl
  if (h.packApiFor) _packApiFor = h.packApiFor
  if (h.assetApiCall) _assetApiCall = h.assetApiCall
  if (h.isVirtualAssetPath) _isVirtualAssetPath = h.isVirtualAssetPath
  if (h.resolveLocatePath) _resolveLocatePath = h.resolveLocatePath
  if (h.roleText) _roleText = h.roleText
  if (h.shade) _shade = h.shade
  if (h.isFav) _isFav = h.isFav
  if (h.pushRecent) _pushRecent = h.pushRecent
  if (h.toggleFav) _toggleFav = h.toggleFav
  if (h.copyText) _copyText = h.copyText
  if (h.deleteUserModel) _deleteUserModel = h.deleteUserModel
  if (h.renameOfficialAsset) _renameOfficialAsset = h.renameOfficialAsset
  if (h.addPackTextureToCanvas) _addPackTextureToCanvas = h.addPackTextureToCanvas
  if (h.get_IMPORT_API) _get_IMPORT_API = h.get_IMPORT_API
  if (h.get_detailCurrent) _get_detailCurrent = h.get_detailCurrent
  if (h.set_detailCurrent) _set_detailCurrent = h.set_detailCurrent
}

export function modelMetaRows(j) {
  if (!j || typeof j !== 'object') return []
  const rows = []
  if (typeof j.parent === 'string' && j.parent) rows.push([t('asset.detailModelParent'), j.parent])
  const texRefs = j.textures && typeof j.textures === 'object' ? Object.entries(j.textures) : []
  if (texRefs.length) {
    const shown = texRefs
      .slice(0, 8)
      .map(([k, v]) => k + ': ' + v)
      .join(' · ')
    rows.push([t('asset.detailModelTexRefs'), shown + (texRefs.length > 8 ? ' …' : '')])
  }
  if (Array.isArray(j.elements)) rows.push([t('asset.detailModelElements'), String(j.elements.length)])
  return rows
}

export function bbModelMetaRows(j) {
  if (!j || typeof j !== 'object') return []
  const rows = []
  const fmt = j.meta && (j.meta.model_format || j.meta.format)
  if (fmt) rows.push([t('asset.detailModelFormat'), fmt])
  if (typeof j.resolution === 'number') rows.push([t('asset.detailModelResolution'), String(j.resolution)])
  if (Array.isArray(j.elements)) rows.push([t('asset.detailModelElements'), String(j.elements.length)])
  if (Array.isArray(j.textures)) rows.push([t('asset.detailTextures'), String(j.textures.length)])
  return rows
}

export async function fetchModelMetaRows(item) {
  const pm = _parsePackModelPath(item.path)
  if (pm) {
    const res = await fetch(_packRawUrl(_packApiFor(pm.source), pm.packName, pm.rel) + '&any=1')
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return modelMetaRows(await res.json())
  }

  if (typeof item.path === 'string' && item.path.startsWith('im:')) {
    const data = await _assetApiCall('GET', _get_IMPORT_API() + '/' + encodeURIComponent(item.path.slice(3)))
    return bbModelMetaRows(data && data.json)
  }
  return []
}

export function openDetail(item) {
  if (item && item.type === 'model') showModelDetail(item)
  else showDetail(item)
}

export async function showModelDetail(item) {
  if (!Array.isArray(item._metaRows)) {
    try {
      item._metaRows = await fetchModelMetaRows(item)
    } catch {
      item._metaRows = []
    }
  }
  showDetail(item, item._metaRows)
  /* 详情大图：懒加载 3D 缩略图，就绪后刷新详情面板（stage 直接显示渲染结果） */
  if (item.modelThumb && !item.thumb) {
    ensureModelThumb(item)
      .then(url => {
        if (url && _get_detailCurrent() === item) showDetail(item, item._metaRows)
      })
      .catch(() => {})
  }
}

export function showDetail(item, extraMetaRows) {
  // 原「资产详情」抽屉窗口已移除：详情在「节点预览」浮动窗中展示
  const typeKeys = {
    tex: 'asset.typeTex',
    model: 'asset.typeModel',
    hdri: 'asset.typeHdri',
    mc: 'asset.typeMc',
    official: 'asset.typeOfficial',
    preset: 'asset.typePreset',
    project: 'asset.typeProject',
    craft: 'asset.catCraft'
  }
  const virtual = _isVirtualAssetPath(item)
  const locatePath = _resolveLocatePath(item)
  const payload = {
    kind: 'asset',
    name: item.name,
    type: item.type,
    typeLabel: t(typeKeys[item.type] || item.type),
    roleLabel: item.role ? _roleText(item.role) : item.badge || null,
    color: item.color || null,
    color2: item.color ? _shade(item.color, -30) : null,
    thumb: item.thumb || null,
    path: item.path || null,
    nodeCount: item.nodeCount ?? null,
    textureCount: item.textureCount ?? null,
    mtimeLabel: item.mtime ? formatDate(item.mtime) : '—',
    fav: _isFav(item),
    onAdd: () => {
      _pushRecent(item)
      item.onAdd()
    },
    onFav: () => {
      _toggleFav(item)
    },
    /* 定位：优先 craftPath/locatePath，虚拟路径经包列表解析回退 */
    onLocate: locatePath ? () => window.api.showInFolder(locatePath) : null,
    onCopyPath: locatePath ? () => _copyText(locatePath) : null,
    onCopyName: () => _copyText(item.name),
    fetchInfo:
      item.path && item.type !== 'preset' && !virtual
        ? cb => {
            _assetApiCall('GET', '/api/asset/info?path=' + encodeURIComponent(item.path))
              .then(info => {
                cb(
                  info && info.exists
                    ? { sizeLabel: formatSize(info.size), mtimeLabel: info.mtime ? formatDate(info.mtime) : null }
                    : { exists: false }
                )
              })
              .catch(() => cb(null))
          }
        : null
  }
  if (Array.isArray(extraMetaRows) && extraMetaRows.length) {
    payload.metaRows = extraMetaRows
  }

  if (item.type === 'model' && item.modelDelete) {
    payload.onDelete = () => _deleteUserModel(item)
  }
  if ((item.type === 'official' || item.type === 'mc') && item.pack) {
    const p = item.pack
    payload.metaRows = [
      [t('asset.detailMcVersion'), p.formatRange || (p.format != null ? 'pack_format ' + p.format : '—')],
      [t('asset.detailPackFormat'), p.formatLabel || (p.format != null ? String(p.format) : '—')],
      [t('asset.detailPackKind'), p.kind === 'zip' ? 'ZIP' : p.kind === 'dir' ? t('asset.officialKindDir') : '—'],
      [t('asset.detailDescription'), p.description || '—'],
      p.namespaces && p.namespaces.length ? [t('asset.detailNamespaces'), p.namespaces.join(', ')] : null,
      [t('asset.detailPackTexCount'), String(p.textureCount ?? 0)],
      p.valid ? null : [t('asset.detailAnalyze'), p.error || '—']
    ].filter(Boolean)
    if (item.type === 'official') payload.onRename = () => _renameOfficialAsset(item, false)
    const texApi = _packApiFor(item.type)
    payload.fetchTextures = (params, cb) => {
      const q = new URLSearchParams()
      if (params && params.dir) q.set('dir', params.dir)
      if (params && params.offset != null) q.set('offset', String(params.offset))
      if (params && params.limit != null) q.set('limit', String(params.limit))
      const qs = q.toString()
      _assetApiCall('GET', texApi + '/' + encodeURIComponent(p.name) + '/textures' + (qs ? '?' + qs : ''))
        .then(d => {
          const files = (d && d.files) || []
          files.forEach(f => {
            f.rawUrl = _packRawUrl(texApi, p.name, f.path)
          })
          cb({
            dir: (d && d.dir) || null,
            parent: (d && d.parent) || null,
            categories: (d && d.categories) || [],
            dirs: (d && d.dirs) || [],
            breadcrumbs: (d && d.breadcrumbs) || [{ name: 'root', dir: null }],
            files,
            filesTotal: (d && d.filesTotal) || 0,
            total: (d && d.total) || 0,
            offset: (d && d.offset) || 0
          })
        })
        .catch(e => cb({ error: e.message }))
    }
    payload.onTextureAdd = tex => {
      _pushRecent(item)
      _addPackTextureToCanvas(item, p, tex)
    }
  }
  document.dispatchEvent(new CustomEvent('nodepreview:show-asset', { detail: payload }))
  _set_detailCurrent(item)
}

export function refreshDetailFav() {
  if (!_get_detailCurrent()) return
  openDetail(_get_detailCurrent())
}

export function hideDetail() {
  document.dispatchEvent(new CustomEvent('nodepreview:hide-asset'))
  _set_detailCurrent(null)
}

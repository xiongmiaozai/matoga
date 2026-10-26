/**
 * matoga - 总资产库：api
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，逻辑未改。
 */
import { fileUrl, formatSize, formatDate, escAttr, apiUrl, setTexDragData, contentKindOfPath } from '../utils.js'
import { el, shade, loadList, saveList } from './dom.js'
import { S, BROWSE_CLICK_DELAY } from './store.js'
import { rebuild } from './filters.js'

export async function assetApiCall(method, path, body) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const j = await res.json()
  if (!j || !j.ok) throw new Error((j && j.msg) || 'bad response')
  return j.data
}

export async function loadAssetStore() {
  try {
    const data = await assetApiCall('GET', '/api/asset')
    if (Array.isArray(data.favorites)) {
      S.favorites = data.favorites
      saveList('matoga:assetFav', S.favorites)
    }
    if (Array.isArray(data.recent)) {
      S.recent = data.recent
      saveList('matoga:assetRecent', S.recent)
    }
    S.serverSynced = true
  } catch {
    S.serverSynced = false
  }
  rebuild()
}

export function persistFavorites() {
  saveList('matoga:assetFav', S.favorites)
  if (S.serverSynced) assetApiCall('PUT', '/api/asset/favorites', { items: S.favorites }).catch(() => {})
}

export function persistRecent() {
  saveList('matoga:assetRecent', S.recent)
  if (S.serverSynced) assetApiCall('PUT', '/api/asset/recent', { items: S.recent }).catch(() => {})
}


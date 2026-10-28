/**
 * matoga - 总资产库：包内浏览（目录导航）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 pack-browser.js 按职责搬出，逻辑未改。
 */
import { S, BROWSE_CLICK_DELAY } from '../store.js'
import { rebuild } from '../filters.js'
import { renderBrowse } from '../pack-browser.js'

export function browseTo(dir) {
  if (!S.browse) return
  S.browse.dir = dir
  S.browse.filter = ''
  S.browse.data = null
  renderBrowse()
}

export function browseUp() {
  if (!S.browse || !S.browse.dir) return
  const idx = S.browse.dir.lastIndexOf('/')
  S.browse.dir = idx >= 0 ? S.browse.dir.slice(0, idx) : null
  S.browse.filter = ''
  S.browse.data = null
  renderBrowse()
}

export function exitBrowse() {
  S.browse = null
  S.browseSeq++
  const search = document.getElementById('assetLibSearch')
  if (search) search.disabled = false
  const toolbar = document.getElementById('assetLibToolbar')
  if (toolbar) toolbar.classList.remove('pb-off')
  rebuild()
}

export function browseCrumbs() {
  const crumbs = [{ name: S.browse.item.name, dir: null }]
  if (S.browse.dir) {
    const segs = S.browse.dir.split('/')
    segs.forEach((s, i) => crumbs.push({ name: s, dir: segs.slice(0, i + 1).join('/') }))
  }
  return crumbs
}


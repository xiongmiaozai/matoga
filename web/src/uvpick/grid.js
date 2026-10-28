/**
 * matoga - UV 贴图库选择器：网格渲染与筛选
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-tex-picker.js 按职责搬出，逻辑未改。
 */
import { apiUrl, setTexDragData, parseTexGroup } from '../utils.js'
import { t, onLocaleChange } from '../i18n.js'
import { S } from './state.js'
import { BADGE_ROLES, PAGE_SIZE } from './consts.js'
import { loadPacks, rebuildPackSelect } from './packs.js'

export function applyFilter() {
  const pack = S.packs[S.packIdx]
  const q = S.searchText.trim().toLowerCase()
  S.filtered = pack ? pack.materials.filter(m => !q || String(m.name).toLowerCase().includes(q) || String(m.key).toLowerCase().includes(q)) : []
  S.shown = 0
  renderGrid()
}

/* 材质组 → resolve 值（主图 url + 配套法线/高光 url，空则空串） */
export function materialPickValue(m) {
  return {
    name: m.name,
    url: m.main.url,
    normal: (m.normal && m.normal.url) || '',
    specular: (m.specular && m.specular.url) || '',
  }
}

export function renderGrid() {
  if (!S.gridEl) return
  if (S.shown === 0) S.gridEl.innerHTML = ''
  const slice = S.filtered.slice(S.shown, S.shown + PAGE_SIZE)
  for (const m of slice) {
    const cell = document.createElement('button')
    cell.className = 'uvp-cell'
    cell.title = m.main.path
    cell.draggable = true
    const img = document.createElement('img')
    img.alt = ''
    img.loading = 'lazy'
    img.draggable = false
    img.src = m.main.url
    cell.appendChild(img)
    /* 角标：标识材质球配套的 PBR 贴图（N=法线 S=高光 H=高度 E=自发光） */
    const badges = BADGE_ROLES.filter(([r]) => m[r]).map(([, b]) => {
      const span = document.createElement('span')
      span.className = 'uvp-badge ' + b
      span.textContent = b.toUpperCase()
      return span
    })
    if (badges.length) {
      const wrap = document.createElement('span')
      wrap.className = 'uvp-badges'
      for (const b of badges) wrap.appendChild(b)
      cell.appendChild(wrap)
    }
    const name = document.createElement('span')
    name.className = 'uvp-name'
    name.textContent = m.name
    cell.appendChild(name)
    /* 拖拽到 UV 编辑器画布 = 直接替换贴图（与点击选择等价，带 PBR 配套） */
    cell.addEventListener('dragstart', (e) => {
      const v = materialPickValue(m)
      if (setTexDragData(e.dataTransfer, { name: v.name, url: v.url, path: m.main.path, normal: v.normal, specular: v.specular })) {
        e.dataTransfer.effectAllowed = 'copy'
      } else {
        e.preventDefault()
      }
    })
    cell.addEventListener('click', () => {
      if (S.resolve) {
        try { S.resolve(materialPickValue(m)) } catch {}
        S.resolve = null
      }
      S.win.close()
    })
    S.gridEl.appendChild(cell)
  }
  S.shown += slice.length
  if (S.moreBtn) S.moreBtn.style.display = S.shown < S.filtered.length ? '' : 'none'
  if (S.emptyEl) {
    S.emptyEl.style.display = S.filtered.length ? 'none' : ''
    S.emptyEl.textContent = S.loadError === 'empty' ? t('uv.pickerEmpty') : t('uv.pickerNoMatch')
  }
  if (S.statusEl) S.statusEl.textContent = S.filtered.length
    ? t('uv.pickerCount', { n: S.shown + '/' + S.filtered.length })
    : (S.loadError === 'empty' ? t('uv.pickerEmpty') : t('uv.pickerNoMatch'))
}


export async function refreshView() {
  await loadPacks()
  rebuildPackSelect()
  applyFilter()
}

/* ── 浮窗构建（幂等单例） ─────────────────────────────────── */


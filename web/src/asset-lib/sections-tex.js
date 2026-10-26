/**
 * matoga - 总资产库：sections-tex
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，逻辑未改。
 */
import { state, IMG_EXTS, showToast } from '../core.js'
import { addNodeAt, addTextureAt, loadPreset, saveNodeProject, loadNodeProject, serializeGraphData, loadCanvasPresetGraph } from '../node-canvas.js'
import { t, onLocaleChange } from '../i18n.js'
import { ensureModelThumb, observeModelThumbs } from '../model-thumb.js'
import { el, shade, loadList, saveList } from './dom.js'
import { S, BROWSE_CLICK_DELAY } from './store.js'
import { addPackTextureToCanvas } from './sections-official.js'
import { collapsedSet, saveCollapsed, saveTexCollapsed, texCollapsedSet } from './collapse.js'
import { sortItems } from './items.js'
import { makeCard } from './card.js'
import { applyFilter } from './filters.js'

function collectTexGroups() {
  const groups = []
  const byKey = new Map()
  const seen = new Set()
  const addGroup = (key, label) => {
    let g = byKey.get(key)
    if (!g) { g = { key, label, items: [] }; byKey.set(key, g); groups.push(g) }
    return g
  }

  /* 左右已选对比目录：按相对父目录分组（根级文件归目录名组） */
  for (const side of ['left', 'right']) {
    const root = side === 'left' ? state.leftPath : state.rightPath
    const entries = side === 'left' ? state.leftEntries : state.rightEntries
    if (!entries) continue
    const rootName = root ? String(root).replace(/\/+$/, '').split('/').pop() : ''
    for (const e of entries) {
      if (!isImg(e) || seen.has(e.fullPath)) continue
      seen.add(e.fullPath)
      let rel = e.name
      if (root && e.fullPath && e.fullPath.startsWith(root + '/')) rel = e.fullPath.slice(root.length + 1)
      const si = rel.lastIndexOf('/')
      const dirRel = si >= 0 ? rel.slice(0, si) : ''
      const gk = 'dir:' + (root ? root + '/' + dirRel : (dirRel || 'root'))
      const label = root ? (dirRel ? rootName + ' · ' + dirRel : rootName) : (dirRel || t('asset.texRootDir'))
      addGroup(gk, label).items.push({
        key: 'tex:' + e.fullPath, name: e.name, thumb: thumbUrl(e.fullPath),
        type: 'tex', path: e.fullPath, mtime: e.mtime || 0, role: classifyByRole(e.name),
        onAdd: () => addTextureAt(e.fullPath, e.name),
      })
    }
  }

  /* MC 材质包 + 官方包（/api/asset/tex）：每包按 textures/ 第一级类别分组；
     dir 包有磁盘绝对路径（可直接引用），zip 包走包媒体 raw 接口 */
  for (const p of S.texPacks || []) {
    for (const g of p.groups || []) {
      const gk = 'pack:' + p.source + ':' + p.name + '/' + g.key
      const label = g.key ? p.name + ' · ' + g.key : p.name
      const grp = addGroup(gk, label)
      for (const f of g.files || []) {
        /* 防御：仅图片扩展名（png/jpg 等）才作为贴图展示，mcmeta/json 排除 */
        if (!IMG_EXTS.has((f.name.split('.').pop() || '').toLowerCase())) continue
        if (p.kind === 'dir' && p.root) {
          const fp = p.root + '/' + f.path
          if (seen.has(fp)) continue
          seen.add(fp)
          grp.items.push({
            key: 'tex:' + fp, name: f.name, thumb: thumbUrl(fp),
            type: 'tex', path: fp, mtime: f.mtime || 0, role: classifyByRole(f.name),
            onAdd: () => addTextureAt(fp, f.name),
          })
        } else {
          const packPath = 'pack:' + p.source + ':' + p.name + '/' + f.path
          grp.items.push({
            key: 'tex:' + packPath, name: f.name, thumb: packTexThumbUrl(p.source, p.name, f.path),
            type: 'tex', path: packPath, mtime: 0, role: classifyByRole(f.name),
            onAdd: () => addPackTextureToCanvas({ type: p.source }, { name: p.name }, { path: f.path, name: f.name }),
          })
        }
      }
    }
  }

  const dirGroups = groups.filter(g => g.key.startsWith('dir:')).sort((a, b) => a.label.localeCompare(b.label, 'zh'))
  const packGroups = groups.filter(g => !g.key.startsWith('dir:'))
  return [...dirGroups, ...packGroups]
}

export function buildAssetGroup(g, collapsedSet, saveFn) {
  const grp = el('div', 'asset-lib-group')
  grp.dataset.group = g.key
  if (collapsedSet.has(g.key)) grp.classList.add('collapsed')
  const head = el('div', 'asset-lib-group-head',
    `<span class="caret">▾</span><span class="gl" title="${escAttr(g.label)}">${escAttr(g.label)}</span><span class="cnt">${g.items.length}</span>`)
  if (typeof g.openDir === 'function') {
    const locBtn = el('button', 'asset-lib-group-btn')
    locBtn.type = 'button'
    locBtn.title = t('asset.openLocalDir')
    locBtn.innerHTML = '<svg class="ico ico-sm"><use href="#i-folder"/></svg>'
    locBtn.addEventListener('click', (e) => { e.stopPropagation(); g.openDir() })
    head.appendChild(locBtn)
  }
  head.addEventListener('click', () => {
    grp.classList.toggle('collapsed')
    if (grp.classList.contains('collapsed')) { collapsedSet.add(g.key); saveFn(collapsedSet) }
    else { collapsedSet.delete(g.key); saveFn(collapsedSet) }
  })
  grp.appendChild(head)

  const grid = el('div', 'asset-lib-grid')
  if (S.viewMode === 'list') grid.classList.add('list-view')
  const sorted = sortItems(g.items)
  const shown = sorted.slice(0, TEX_GROUP_PAGE)
  for (const it of shown) grid.appendChild(makeCard(it))
  if (sorted.length > shown.length) {
    const more = el('button', 'asset-lib-more', t('asset.texShowMore', { n: String(sorted.length - shown.length) }))
    more.addEventListener('click', () => {
      more.remove()
      for (const it of sorted.slice(TEX_GROUP_PAGE)) grid.appendChild(makeCard(it))
      observeModelThumbs(grid)
      applyFilter()
    })
    grid.appendChild(more)
  }
  grp.appendChild(grid)
  return grp
}

function buildTexGroup(g) {
  return buildAssetGroup(g, texCollapsedSet, saveTexCollapsed)
}

export function buildTexSection() {
  const groups = collectTexGroups()
  const total = groups.reduce((s, g) => s + g.items.length, 0)
  const loading = S.texPacks === null

  const sec = el('div', 'asset-lib-section')
  sec.dataset.cat = 'tex'
  if (collapsedSet.has('tex')) sec.classList.add('collapsed')
  const head = el('div', 'asset-lib-section-head',
    `<span class="caret">▾</span><span>${t('asset.texSection')}</span><span class="cnt">${total}</span>`)
  head.addEventListener('click', () => {
    sec.classList.toggle('collapsed')
    if (sec.classList.contains('collapsed')) { collapsedSet.add('tex'); saveCollapsed(collapsedSet) }
    else { collapsedSet.delete('tex'); saveCollapsed(collapsedSet) }
  })
  sec.appendChild(head)

  if (!total && loading) {
    const grid = el('div', 'asset-lib-grid')
    grid.appendChild(el('div', 'asset-lib-hint', t('asset.loading')))
    sec.appendChild(grid)
    return sec
  }
  if (!total && S.loadErrors.tex) {
    const grid = el('div', 'asset-lib-grid')
    grid.appendChild(el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg: S.loadErrors.tex })))
    sec.appendChild(grid)
    return sec
  }
  if (!total) return null

  const wrap = el('div', 'asset-lib-groups')
  for (const g of groups) wrap.appendChild(buildTexGroup(g))
  if (S.loadErrors.tex) wrap.appendChild(el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg: S.loadErrors.tex })))
  sec.appendChild(wrap)
  return sec
}

/* ── 模型节：MC 材质包/官方包内 assets/<ns>/models/*.json，按来源/包类别/名称前缀分组 ── */

/* 在系统文件管理器中打开某类模型的专属本地目录（imported / custom） */

/**
 * matoga - MC 模型：RenderTableRows
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：结果表格行与缩略图单元格渲染
 */

import { t } from '../i18n.js'
import { $, state, KIND_TEXT, ROLES, ROLE_LABEL } from '../core.js'
import {
  isImageFile,
  escAttr,
  leftRoles,
  rightRoles,
  folderOf,
  formatSize,
  formatDate,
  hasAny,
  mainEntryOf,
  subKind
} from '../utils.js'
import { isModelEntry, escHtml } from '../model-diff.js'
import { zhOfKey } from '../rnd/search.js'

/* 主文件函数（注入） */
let _selectGroup = (...a) => undefined
let _renderSidebar = (...a) => undefined

export function setHooks(h) {
  if (h.selectGroup) _selectGroup = h.selectGroup
  if (h.renderSidebar) _renderSidebar = h.renderSidebar
}

export function statusBadge(kind) {
  const icons = { have: 'i-check', diff: 'i-alert', partial: 'i-minus', miss: 'i-x', extra: 'i-plus' }
  const labels = {
    have: t('status.haveShort'),
    diff: t('status.diffShort'),
    partial: t('status.partialShort'),
    miss: t('status.missShort'),
    extra: t('status.extraShort')
  }
  return `<span class="status-badge status-${kind}"><svg class="ico"><use href="#${icons[kind]}"/></svg>${labels[kind]}</span>`
}

export function renderThumbPair(le, re) {
  const isImgE = e => e && !e.isDirectory && isImageFile(e.name)
  if (!isImgE(le) && !isImgE(re)) return '<span class="cell-empty">—</span>'
  const lt = isImgE(le)
    ? `<img class="thumb thumb-left" data-thumb="${escAttr(le.fullPath)}" />`
    : '<span class="thumb-ph thumb-left-ph">L</span>'
  const rt = isImgE(re)
    ? `<img class="thumb thumb-right" data-thumb="${escAttr(re.fullPath)}" />`
    : '<span class="thumb-ph thumb-right-ph">R</span>'
  return `<div class="thumb-pair">${lt}${rt}</div>`
}

export function modelThumbSpec(entry, root, texRoot) {
  if (!entry || !isModelEntry(entry)) return null
  return {
    kind: 'mc',
    fileRoot: root,
    texRoot: texRoot || undefined,
    rel: entry.name,
    path: 'cmp:' + (texRoot || root) + '/' + entry.name,
    mtime: entry.mtime || 0
  }
}

export function renderModelThumbCell(entry, root, side, texRoot) {
  if (!modelThumbSpec(entry, root, texRoot))
    return `<span class="thumb-ph thumb-${side}-ph">${side === 'left' ? 'L' : 'R'}</span>`
  return `<div class="ac-thumb thumb-model thumb-${side}" data-mroot="${escAttr(root)}"${texRoot ? ` data-mtexroot="${escAttr(texRoot)}"` : ''} data-mrel="${escAttr(entry.name)}" data-mtime="${entry.mtime || 0}"></div>`
}

export function renderModelThumbPair(le, re, leftRoot, rightRoot, rightFallback, rightTexRoot) {
  const hasL = isModelEntry(le),
    hasR = isModelEntry(re)
  if (!hasL && !hasR) return '<span class="cell-empty">—</span>'
  const lt = hasL ? renderModelThumbCell(le, leftRoot, 'left') : '<span class="thumb-ph thumb-left-ph">L</span>'
  const rt = hasR
    ? renderModelThumbCell(re, rightRoot, 'right', rightTexRoot)
    : '<span class="thumb-ph thumb-right-ph">R</span>'
  return `<div class="thumb-pair${rightFallback ? ' thumb-pair-fallback' : ''}">${lt}${rt}</div>`
}

export function appendGroupRows(frag, g) {
  const tr = document.createElement('tr')
  tr.className = 'row-' + g.kind
  if (state.selected && state.selected.key === g.key) tr.classList.add('row-selected')

  const roleCount = g.isMaterial ? leftRoles(g).length + rightRoles(g).length : 0
  const expandable = g.isMaterial && roleCount > 1
  const expanded = state.expandedKeys.has(g.key)

  let mainLeft, mainRight
  if (g.isMaterial) {
    mainLeft = g.left && g.left.main
    mainRight = g.right && g.right.main
  } else {
    mainLeft = g.left && (g.left.file || g.left.dir)
    mainRight = g.right && (g.right.file || g.right.dir)
  }

  const previewCell = g.isModel
    ? renderModelThumbPair(mainLeft, mainRight, state.leftPath, state.rightPath)
    : renderThumbPair(mainLeft, mainRight)
  const arrow = expandable ? `<span class="expand-arrow">${expanded ? '▾' : '▸'}</span>` : ''
  const folder = folderOf(g)
  const displayName =
    state.viewMode === 'byFolder' && folder !== t('render.rootFolder') ? g.key.slice(folder.length + 1) : g.key
  const zhName = zhOfKey(g.key)
  const zhHtml = zhName
    ? `<span class="cell-zh" style="margin-left:6px;color:var(--text-muted,#888);font-size:.85em">${escHtml(zhName)}</span>`
    : ''
  const nameHtml = `${arrow}<span class="cell-name" title="${escAttr(g.key)}">${escHtml(displayName || g.key)}</span>${zhHtml}`
  const typeHtml = g.isMaterial
    ? `<span class="type-mat"><svg class="ico"><use href="#i-layers"/></svg>${t('type.material')}</span>`
    : g.isModel
      ? `<span class="type-model"><svg class="ico"><use href="#i-cube"/></svg>${t('type.model')}</span>`
      : g.isDir
        ? `<span class="type-dir"><svg class="ico"><use href="#i-folder"/></svg>${t('type.folder')}</span>`
        : `<span class="type-file"><svg class="ico"><use href="#i-image"/></svg>${t('type.file')}</span>`
  const me = mainLeft || mainRight
  const sizeHtml =
    g.kind === 'diff' && mainLeft && mainRight && mainLeft.size !== mainRight.size
      ? `<span class="size-diff" title="${t('common.left')} ${formatSize(mainLeft.size)} / ${t('common.right')} ${formatSize(mainRight.size)}">${formatSize(mainLeft.size)} ≠ ${formatSize(mainRight.size)}</span>`
      : formatSize(me ? me.size : 0)
  const mtimeHtml = formatDate(me ? me.mtime : 0)
  const leftCell = hasAny(g.left) ? '<span class="cell-yes">✓</span>' : '<span class="cell-empty">—</span>'
  const rightCell = hasAny(g.right) ? '<span class="cell-yes">✓</span>' : '<span class="cell-empty">—</span>'

  const similarMark = g.similar ? `<span class="similar-mark" title="${escAttr(t('status.similar'))}">≈</span>` : ''
  tr.innerHTML = `<td>${statusBadge(g.kind)}${similarMark}</td><td class="preview-cell">${previewCell}</td><td>${nameHtml}</td><td>${typeHtml}</td><td>${sizeHtml}</td><td>${mtimeHtml}</td><td>${leftCell}</td><td>${rightCell}</td>`
  if (g.isModel) {
    tr.querySelectorAll('.ac-thumb[data-mrel]').forEach(th => {
      th._modelThumbItem = {
        modelThumb: modelThumbSpec(
          { name: th.dataset.mrel, mtime: +th.dataset.mtime || 0 },
          th.dataset.mroot,
          th.dataset.mtexroot || undefined
        )
      }
    })
  }
  tr._group = g

  tr.title = me
    ? `${g.key}\n${KIND_TEXT[g.kind] || g.kind} · ${formatSize(me.size)} · ${formatDate(me.mtime)}`
    : g.key + (KIND_TEXT[g.kind] ? '\n' + KIND_TEXT[g.kind] : '')
  tr.addEventListener('click', () => _selectGroup(g))
  tr.addEventListener('dblclick', ev => {
    const e = mainEntryOf(g)
    if (!e) return
    if (ev.metaKey || ev.ctrlKey) window.api.showInFolder(e.fullPath)
    else window.api.openPath(e.fullPath)
  })
  frag.appendChild(tr)

  if (g.isMaterial && expanded) {
    appendSubRows(frag, g)
  }
}

export function appendSubRows(frag, g) {
  for (const role of ROLES) {
    const le = g.left && g.left[role],
      re = g.right && g.right[role]
    if (!le && !re) continue
    const sub = document.createElement('tr')
    const sk = subKind(le, re)
    sub.className = 'sub-row row-' + sk
    const subName = `<span class="sub-name">${ROLE_LABEL[role]}</span>`
    const se = le || re
    sub.innerHTML = `<td>${statusBadge(sk)}</td><td class="preview-cell">${renderThumbPair(le, re)}</td><td>${subName}</td><td></td><td>${formatSize(se.size)}</td><td>${formatDate(se.mtime)}</td><td>${le ? '<span class="cell-yes">✓</span>' : '<span class="cell-empty">—</span>'}</td><td>${re ? '<span class="cell-yes">✓</span>' : '<span class="cell-no">✗</span>'}</td>`
    sub.addEventListener('click', () => {
      state.selected = g
      _renderSidebar()
    })
    frag.appendChild(sub)
  }
}

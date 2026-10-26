/**
 * matoga - 材质 3D 视口：model-cards
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */
import {
  state, $, ROLE_LABEL, KIND_TEXT, STATUS_ORDER,
  leftBtn, rightBtn, onlyMissingChk, summaryEl, resultBody,
  leftPathEl, rightPathEl
} from '../core.js'
import {
  formatSize, formatDate, isImageFile, fileUrl, escAttr,
  folderOf, mainEntryOf, hasAny, leftRoles, rightRoles, subKind,
  openPreview, relPath, joinPath, modelTypeOf, modelBaseNameOf,
  groupTypeOf, groupContentKind, groupTagOf
} from '../utils.js'
import { parseModelText, buildModelSummary, diffLines, escHtml, isModelEntry } from '../model-diff.js'
import { viewMcModelPairInViewport, viewMcModelTexCompareInViewport, isViewportVisible, resolveModelTexList, textureAssetPath } from '../mc-model-viewer.js'
import { loadModelTexEffectPreview, renderSidebar } from '../render.js'

export function modelThumbSpec(entry, root) {
  if (!entry || !isModelEntry(entry)) return null
  return {
    kind: 'mc',
    fileRoot: root,
    rel: entry.name,
    path: 'cmp:' + root + '/' + entry.name,
    mtime: entry.mtime || 0,
    noCache: true,
  }
}

export function renderModelThumbCell(entry, root, side) {
  if (!modelThumbSpec(entry, root)) return `<span class="thumb-ph thumb-${side}-ph">${side === 'left' ? 'L' : 'R'}</span>`
  return `<div class="ac-thumb thumb-model thumb-${side}" data-mroot="${escAttr(root)}" data-mrel="${escAttr(entry.name)}" data-mtime="${entry.mtime || 0}"></div>`
}

export function renderModelThumbPair(le, re, leftRoot, rightRoot, rightFallback) {
  const hasL = isModelEntry(le), hasR = isModelEntry(re)
  if (!hasL && !hasR) return '<span class="cell-empty">—</span>'
  const lt = hasL ? renderModelThumbCell(le, leftRoot, 'left') : '<span class="thumb-ph thumb-left-ph">L</span>'
  const rt = hasR ? renderModelThumbCell(re, rightRoot, 'right') : '<span class="thumb-ph thumb-right-ph">R</span>'
  return `<div class="thumb-pair${rightFallback ? ' thumb-pair-fallback' : ''}">${lt}${rt}</div>`
}


export function modelTexRoleThumbs(grp, role) {
  const lEntry = grp && grp.left && grp.left[role]
  const rReal = grp && grp.right && grp.right[role]
  const rEntry = rReal || lEntry
  if (!lEntry && !rEntry) return ''
  const thumbL = lEntry ? `<img class="thumb thumb-left" src="${escAttr(fileUrl(lEntry.fullPath))}" alt="" />` : '<span class="thumb-ph thumb-left-ph">L</span>'
  const thumbR = rEntry ? `<img class="thumb thumb-right" src="${escAttr(fileUrl(rEntry.fullPath))}" alt="" />` : '<span class="thumb-ph thumb-right-ph">R</span>'
  return `<div class="model-tex-thumbs${!rReal && lEntry ? ' model-tex-role-fallback' : ''}">${thumbL}${thumbR}</div>`
}

export async function loadModelCardTexs(card, g) {
  const le = g.left && g.left.file, re = g.right && g.right.file
  const leftList = le && isModelEntry(le) ? await resolveModelTexList({ fileRoot: state.leftPath, rel: le.name }).catch(() => null) : null
  const hasRightModel = re && isModelEntry(re)
  let rightList = hasRightModel ? await resolveModelTexList({ fileRoot: state.rightPath, rel: re.name }).catch(() => null) : null


  if (!card.isConnected) return
  const groupMap = new Map()
  for (const grp of state.result) groupMap.set(grp.key, grp)
  const texMap = new Map()
  for (const tx of leftList || []) {
    const ap = textureAssetPath(tx.name)
    if (!ap) continue
    if (!texMap.has(ap)) texMap.set(ap, { name: tx.name, leftUrl: tx.url, rightUrl: null })
    else texMap.get(ap).leftUrl = tx.url
  }
  for (const tx of rightList || []) {
    const ap = textureAssetPath(tx.name)
    if (!ap) continue
    if (!texMap.has(ap)) texMap.set(ap, { name: tx.name, leftUrl: null, rightUrl: tx.url })
    else texMap.get(ap).rightUrl = tx.url
  }
  const texsEl = card.querySelector('.model-card-texs')
  if (!texsEl) return
  if (texMap.size === 0) {
    texsEl.innerHTML = `<span class="model-texs-none">${t('render.modelTexNone')}</span>`
    return
  }
  const frag = document.createDocumentFragment()
  for (const [ap, info] of texMap) {
    const dot = ap && ap.lastIndexOf('.')
    const key = dot >= 0 ? ap.slice(0, dot) : ap
    const grp = groupMap.get(key)
    const kind = grp ? grp.kind : 'miss'
    const texEl = document.createElement('div')
    const rMain = grp && grp.right && grp.right.main
    let rightUrl = rMain ? fileUrl(rMain.fullPath) : info.leftUrl
    let texFallback = !rMain && !!info.leftUrl
    texEl.className = 'model-tex-item row-' + kind + (texFallback ? ' model-tex-fallback' : '')
    const thumbL = info.leftUrl ? `<img class="thumb thumb-left" src="${escAttr(info.leftUrl)}" alt="" />` : '<span class="thumb-ph thumb-left-ph">L</span>'
    const thumbR = rightUrl ? `<img class="thumb thumb-right" src="${escAttr(rightUrl)}" alt="" />` : '<span class="thumb-ph thumb-right-ph">R</span>'
    const texName = (info.name || ap).replace(/^minecraft:/, '')
    let matHtml = ''
    if (grp) {
      const nHtml = modelTexRoleThumbs(grp, 'normal')
      const sHtml = modelTexRoleThumbs(grp, 'specular')
      if (nHtml || sHtml) {
        matHtml = '<div class="model-tex-mat">'
        if (nHtml) matHtml += `<div class="model-tex-role"><span class="role-tag role-normal">N</span>${nHtml}</div>`
        if (sHtml) matHtml += `<div class="model-tex-role"><span class="role-tag role-specular">S</span>${sHtml}</div>`
        matHtml += '</div>'
      }
    }
    texEl.innerHTML = `<div class="model-tex-thumbs">${thumbL}${thumbR}</div>${matHtml}<span class="model-tex-name" title="${escAttr(ap || info.name)}">${escHtml(texName)}</span>`
    texEl.title = `${texName} · ${KIND_TEXT[kind] || kind}`
    if (grp) texEl.addEventListener('click', (e) => {
      e.stopPropagation()
      state.selected = g
      const cards = document.querySelectorAll('.model-card.selected')
      cards.forEach(c => { if (c._group !== g) c.classList.remove('selected') })
      const cardEl = texEl.closest('.model-card')
      if (cardEl) cardEl.classList.add('selected')
      const texsHost = texEl.parentElement
      if (texsHost) texsHost.querySelectorAll('.model-tex-item.tex-active').forEach(el => el.classList.remove('tex-active'))
      texEl.classList.add('tex-active')
      loadModelTexEffectPreview(g, info.leftUrl, rightUrl)
    })
    frag.appendChild(texEl)
  }
  texsEl.innerHTML = ''
  texsEl.appendChild(frag)
  texsEl.querySelectorAll('img[src]').forEach(img => {
    img.addEventListener('click', (e) => { e.stopPropagation(); openPreview(img.src, img.dataset.name || '') })
  })
}

export function appendModelCard(container, g) {
  const mainLeft = g.left && (g.left.file || g.left.dir)
  const mainRight = g.right && (g.right.file || g.right.dir)
  const me = mainLeft || mainRight
  const card = document.createElement('div')
  card.className = 'model-card row-' + g.kind
  if (state.selected && state.selected.key === g.key) card.classList.add('selected')
  const useLeftForRight = !mainRight && !!mainLeft
  const previewHtml = renderModelThumbPair(mainLeft, mainRight || mainLeft, state.leftPath, mainRight ? state.rightPath : state.leftPath, useLeftForRight)
  const shortName = g.key.replace(/^assets\/[^/]+\/models\//, '').replace(/^assets\/[^/]+\/items\//, '').replace(/\.json$/, '')
  card.innerHTML = `<div class="model-card-head">${statusBadge(g.kind)}<span class="model-card-name" title="${escAttr(g.key)}">${escHtml(shortName)}</span></div><div class="model-card-preview">${previewHtml}</div><div class="model-card-texs"><span class="model-texs-loading">${t('render.modelTexLoading')}</span></div>`
  card.querySelectorAll('.ac-thumb[data-mrel]').forEach(th => {
    th._modelThumbItem = { modelThumb: modelThumbSpec({ name: th.dataset.mrel, mtime: +th.dataset.mtime || 0 }, th.dataset.mroot) }
  })
  card._group = g
  card.addEventListener('click', () => {
    state.selected = g
    const body = $('modelGridBody')
    if (body) body.querySelectorAll('.model-card.selected').forEach(c => c.classList.remove('selected'))
    card.classList.add('selected')
    renderSidebar()
  })
  card.addEventListener('dblclick', (ev) => {
    const e = mainEntryOf(g)
    if (!e) return
    if (ev.metaKey || ev.ctrlKey) window.api.showInFolder(e.fullPath)
    else window.api.openPath(e.fullPath)
  })
  container.appendChild(card)
  loadModelCardTexs(card, g)
}


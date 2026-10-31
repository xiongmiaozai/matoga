/**
 * matoga - MC 模型：RenderModelDiff
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：模型 JSON 文本差异与贴图引用检测
 */

import { fileUrl, joinPath, escAttr } from '../utils.js'
import { $, state } from '../core.js'
import { parseModelText, buildModelSummary, escHtml, diffLines, checkTexRefs } from '../model-diff.js'
import { t } from '../i18n.js'
import { handleAction } from '../actions.js'
import { modelBaseNameOf } from '../model-group-dims.js'

/* 模块状态：只读用 getter；可写用 get/set 成对（§2.2） */
let _get_MAX_PARENT_DEPTH = () => undefined
let _get_MD_MAX_LINES = () => undefined
let _get_vanillaTexSet = () => undefined
let _set_vanillaTexSet = () => {}
let _get_vanillaTexLoading = () => undefined
let _set_vanillaTexLoading = () => {}

export function setHooks(h) {
  if (h.get_MAX_PARENT_DEPTH) _get_MAX_PARENT_DEPTH = h.get_MAX_PARENT_DEPTH
  if (h.get_MD_MAX_LINES) _get_MD_MAX_LINES = h.get_MD_MAX_LINES
  if (h.get_vanillaTexSet) _get_vanillaTexSet = h.get_vanillaTexSet
  if (h.set_vanillaTexSet) _set_vanillaTexSet = h.set_vanillaTexSet
  if (h.get_vanillaTexLoading) _get_vanillaTexLoading = h.get_vanillaTexLoading
  if (h.set_vanillaTexLoading) _set_vanillaTexLoading = h.set_vanillaTexLoading
}

export async function fetchModelText(entry) {
  if (!entry) return undefined
  try {
    const res = await fetch(fileUrl(entry.fullPath))
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  }
}

export function getVanillaTexSet() {
  if (_get_vanillaTexSet()) return Promise.resolve(_get_vanillaTexSet())
  if (_get_vanillaTexLoading()) return _get_vanillaTexLoading()
  const p = fetch('/api/mc-official/tex-index')
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      _set_vanillaTexSet(d && Array.isArray(d.paths) ? new Set(d.paths) : new Set())
      _set_vanillaTexLoading(null)
      return _get_vanillaTexSet()
    })
    .catch(() => {
      _set_vanillaTexSet(new Set())
      _set_vanillaTexLoading(null)
      return _get_vanillaTexSet()
    })
  _set_vanillaTexLoading(p)
  return p
}

export function parentModelRel(parent) {
  if (typeof parent !== 'string' || !parent) return null
  let ns = 'minecraft',
    rest = parent
  const ci = parent.indexOf(':')
  if (ci >= 0) {
    ns = parent.slice(0, ci)
    rest = parent.slice(ci + 1)
  }
  if (!rest) return null
  return `assets/${ns}/models/${rest}.json`
}

export async function resolveModelTexturesDeep(text, fileRoot) {
  const { obj } = parseModelText(text)
  if (!obj || typeof obj !== 'object') return null
  const merged = {}
  let cur = obj
  const seen = new Set()
  for (let d = 0; d < _get_MAX_PARENT_DEPTH() && cur; d++) {
    if (cur.textures && typeof cur.textures === 'object') {
      for (const [k, v] of Object.entries(cur.textures)) {
        if (!(k in merged)) merged[k] = v
      }
    }
    const parent = typeof cur.parent === 'string' ? cur.parent : null
    if (!parent || seen.has(parent)) break
    seen.add(parent)
    const rel = parentModelRel(parent)
    if (!rel) break
    let pText
    try {
      const res = await fetch(fileUrl(joinPath(fileRoot, rel)))
      if (!res.ok) break
      pText = await res.text()
    } catch {
      break
    }
    cur = parseModelText(pText).obj
  }
  return { textures: merged }
}

export function modelSumLine(text) {
  if (text === undefined) return t('preview.noSide')
  if (text === '') return t('preview.modelLoadFail')
  const { ok, obj } = parseModelText(text)
  if (!ok) return t('preview.modelNoParse')
  const s = buildModelSummary(obj)
  if (!s) return t('preview.modelNoParse')
  if (s.itemDef) return `${t('preview.modelItemDef')} · ${s.itemRef}`
  return `${t('preview.modelParent')} ${s.parent || '—'} · ${t('preview.modelElements', { n: s.elements })} · ${t('preview.modelTexRefs', { n: s.textures })}`
}

export function mdRow(l, r, cls) {
  return `<div class="md-cell ${l ? cls : 'md-gap'}">${l ? escHtml(l) : ''}</div><div class="md-cell ${r ? cls : 'md-gap'}">${r ? escHtml(r) : ''}</div>`
}

export function renderModelDiffGrid(grid, lt, rt, g) {
  const a = typeof lt === 'string' && lt ? parseModelText(lt).pretty.split('\n') : []
  const b = typeof rt === 'string' && rt ? parseModelText(rt).pretty.split('\n') : []
  const truncated = a.length > _get_MD_MAX_LINES() || b.length > _get_MD_MAX_LINES()
  const as = a.slice(0, _get_MD_MAX_LINES()),
    bs = b.slice(0, _get_MD_MAX_LINES())
  const showCopy = g && g.isModel && state.rightPath && g.left && (g.left.file || g.left.dir)
  const copyBtn = showCopy
    ? `<button class="md-head-btn" data-act="copy-model-right" title="${escAttr(t('detail.copyModel'))}"><svg class="ico ico-sm"><use href="#i-clipboard"/></svg><span>${escHtml(t('detail.copyModel'))}</span></button>`
    : ''
  const importBtn =
    g && g.isModel && state.rightPath
      ? `<button class="md-head-btn" data-act="upload-model-right" title="${escAttr(t('detail.uploadModel'))}"><svg class="ico ico-sm"><use href="#i-plus"/></svg><span>${escHtml(t('detail.uploadModel'))}</span></button>`
      : ''
  let html = `<div class="md-cell md-head">${t('common.left')}</div><div class="md-cell md-head md-head-right"><span>${t('common.right')}</span>${copyBtn}${importBtn}</div>`
  if (!as.length && !bs.length) {
    html += `<div class="md-cell md-empty">${t('render.noData')}</div><div class="md-cell md-empty"></div>`
  } else {
    const ops = diffLines(as, bs)
    if (ops) {
      for (const op of ops) {
        if (op.type === 'same') html += mdRow(op.text, op.text, 'md-same')
        else if (op.type === 'del') html += mdRow(op.text, '', 'md-del')
        else html += mdRow('', op.text, 'md-add')
      }
    } else {
      const rows = Math.max(as.length, bs.length)
      for (let i = 0; i < rows; i++) html += mdRow(as[i] || '', bs[i] || '', 'md-same')
    }
  }
  if (truncated)
    html += `<div class="md-cell md-trunc">${t('preview.modelTruncated', { n: _get_MD_MAX_LINES() })}</div><div class="md-cell md-trunc"></div>`
  grid.innerHTML = html
  const importBtnEl = grid.querySelector('.md-head-right [data-act="upload-model-right"]')
  if (importBtnEl)
    importBtnEl.addEventListener('click', ev => {
      ev.stopPropagation()
      handleAction('upload-model-right', g)
    })
  const copyBtnEl = grid.querySelector('.md-head-right [data-act="copy-model-right"]')
  if (copyBtnEl)
    copyBtnEl.addEventListener('click', ev => {
      ev.stopPropagation()
      handleAction('copy-model-right', g)
    })
}

export async function loadModelDiffView(g, panel) {
  const grid = panel.querySelector('.md-grid')
  const sumEl = panel.querySelector('.pv-model-sum')
  if (!grid || !sumEl) return
  const le = g.left && g.left.file,
    re = g.right && g.right.file
  const [lt, rt] = await Promise.all([fetchModelText(le), fetchModelText(re)])
  if (state.selected !== g) return
  const modelName = modelBaseNameOf(g) || '—'
  sumEl.innerHTML =
    `<div class="pv-model-sum-row pv-model-name-row"><span class="pv-model-tag">${t('preview.modelName')}</span><span class="pv-model-name">${escHtml(modelName)}</span></div>` +
    `<div class="pv-model-sum-row"><span class="pv-model-tag">${t('common.left')}</span><span>${escHtml(modelSumLine(lt))}</span></div>` +
    `<div class="pv-model-sum-row"><span class="pv-model-tag">${t('common.right')}</span><span>${escHtml(modelSumLine(rt))}</span></div>`
  renderModelDiffGrid(grid, lt, rt, g)

  const refEl = panel.querySelector('.pv-tex-refs')
  if (refEl) {
    const leftPaths = new Set(state.leftEntries.filter(e => !e.isDirectory).map(e => e.name))
    const rightPaths = new Set(state.rightEntries.filter(e => !e.isDirectory).map(e => e.name))
    const vanillaSet = await getVanillaTexSet()
    if (state.selected !== g) return
    const leftObj = await resolveModelTexturesDeep(lt, state.leftPath)
    if (state.selected !== g) return
    const rightObj = await resolveModelTexturesDeep(rt, state.rightPath)
    if (state.selected !== g) return
    const leftRefs = leftObj ? checkTexRefs(leftObj, leftPaths, vanillaSet) : []
    const rightRefs = rightObj ? checkTexRefs(rightObj, rightPaths, vanillaSet) : []
    const renderRefList = (refs, tag) => {
      if (!refs.length) return ''
      const items = refs
        .map(r => {
          const cls = r.exists ? 'tex-ref-ok' : r.vanilla ? 'tex-ref-vanilla' : 'tex-ref-miss'
          const badge = r.vanilla ? `<span class="tex-ref-badge">${t('preview.texRefVanilla')}</span>` : ''
          const ico = r.exists
            ? `<svg class="ico ico-sm"><use href="#i-check"/></svg>`
            : r.vanilla
              ? ''
              : `<svg class="ico ico-sm"><use href="#i-x"/></svg>`
          return `<div class="tex-ref-item ${cls}">${ico}${badge}<span class="tex-ref-path">${escHtml(r.ref)}</span></div>`
        })
        .join('')
      return `<div class="tex-ref-group"><span class="pv-model-tag">${tag}</span>${items}</div>`
    }
    const allRefs = renderRefList(leftRefs, t('common.left')) + renderRefList(rightRefs, t('common.right'))
    refEl.innerHTML = allRefs
    refEl.style.display = allRefs ? '' : 'none'
  }
}

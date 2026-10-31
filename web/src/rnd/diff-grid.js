/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 render.js L1255-L1352 原样搬出（正文逐字未改）。
 * 段外本地符号经 setHooks 注入：MD_MAX_LINES, mdRow, fetchModelText, getVanillaTexSet, resolveModelTexturesDeep
 */

import { state } from '../core.js'
import { handleAction } from '../actions.js'
import { parseModelText, diffLines, checkTexRefs } from '../model-diff.js'
import { modelBaseNameOf } from '../model-group-dims.js'
import { t } from '../i18n.js'

/* 以下变量由主模块经 setHooks 注入。正文按裸标识符引用，故模块级声明。 */
let MD_MAX_LINES
let mdRow
let fetchModelText
let getVanillaTexSet
let resolveModelTexturesDeep
export function setHooks(h) {
  MD_MAX_LINES = h.MD_MAX_LINES
  mdRow = h.mdRow
  fetchModelText = h.fetchModelText
  getVanillaTexSet = h.getVanillaTexSet
  resolveModelTexturesDeep = h.resolveModelTexturesDeep
}

export function renderModelDiffGrid(grid, lt, rt, g) {
  const a = typeof lt === 'string' && lt ? parseModelText(lt).pretty.split('\n') : []
  const b = typeof rt === 'string' && rt ? parseModelText(rt).pretty.split('\n') : []
  const truncated = a.length > MD_MAX_LINES || b.length > MD_MAX_LINES
  const as = a.slice(0, MD_MAX_LINES),
    bs = b.slice(0, MD_MAX_LINES)
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
    html += `<div class="md-cell md-trunc">${t('preview.modelTruncated', { n: MD_MAX_LINES })}</div><div class="md-cell md-trunc"></div>`
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

/* 确保 3D 视口就绪。autoSwitch=true 时（用户主动操作）才切到预览面板 3D tab；
   自动选中模型时不切 tab，保留用户当前的 2D/3D 选择，避免 2D 内容被切走。 */

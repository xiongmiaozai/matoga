/**
 * matoga - 材质 3D 视口：model-preview
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
import { initMaterial3D, updateMaterial3D, clearCustomModel } from '../material3d.js'
import { parseModelText, buildModelSummary, diffLines, escHtml, isModelEntry } from '../model-diff.js'
import { viewMcModelPairInViewport, viewMcModelTexCompareInViewport, isViewportVisible, resolveModelTexList, textureAssetPath } from '../mc-model-viewer.js'
import { t } from '../i18n.js'

/* 3D 视口未激活时自动切到预览面板 3D tab（等价用户点击）；返回视口是否就绪 */
export function tryActivateCompareModelViewport() {
  if (isViewportVisible()) return true
  const pvBtn = document.querySelector('.pv-tabs button[data-pv-tab="3d"]')
  if (pvBtn) { pvBtn.click(); return true }
  return false
}

/* 选中模型行：左右模型并排送入 3D 视口对比展示；右侧缺失时回退用左侧模型。
   2D tab 仍保留 JSON 文本差异 */
export async function loadModelPreview(g) {
  if (state.selected !== g) return
  const mySeq = ++state.modelLoadSeq
  const le = g.left && g.left.file, re = g.right && g.right.file
  const left = le && isModelEntry(le) ? { fileRoot: state.leftPath, rel: le.name } : null
  const right = re && isModelEntry(re) ? { fileRoot: state.rightPath, rel: re.name } : null
  if (!left && !right) return
  if (!tryActivateCompareModelViewport()) return
  try {
    await viewMcModelPairInViewport({ left, right, rightRoot: state.rightPath, isStale: () => state.modelLoadSeq !== mySeq })
    if (state.selected !== g) clearCustomModel()
  } catch {}
}

/* 点击模型卡片下方的贴图条目：3D 视口贴图效果对比。
   左=左模型+左贴图，右=右模型+右贴图（模型或贴图缺失均回退左侧），展示替换后模型的贴图渲染效果 */
export async function loadModelTexEffectPreview(g, leftTexUrl, rightTexUrl) {
  const mySeq = ++state.modelLoadSeq
  const le = g.left && g.left.file, re = g.right && g.right.file
  const left = le && isModelEntry(le) ? { fileRoot: state.leftPath, rel: le.name } : null
  const right = re && isModelEntry(re) ? { fileRoot: state.rightPath, rel: re.name } : null
  if (!left && !right) return
  if (!tryActivateCompareModelViewport()) return
  try { await viewMcModelTexCompareInViewport({ left, right, rightRoot: state.rightPath, leftTexUrl, rightTexUrl, isStale: () => state.modelLoadSeq !== mySeq }) } catch {}
}

/* 列出左右模型各自引用的材质贴图（名称 + 缩略图），与 3D 预览 / JSON 差异同区展示。
   贴图直接用 raw URL 加载（MC 贴图通常很小）；异步填充，不参与 renderSidebar 的 img 循环 */
export async function loadModelTexList(g) {
  if (state.selected !== g) return
  const le = g.left && g.left.file, re = g.right && g.right.file
  const [lt, rt] = await Promise.all([
    le && isModelEntry(le) ? resolveModelTexList({ fileRoot: state.leftPath, rel: le.name }).catch(() => null) : Promise.resolve(null),
    re && isModelEntry(re) ? resolveModelTexList({ fileRoot: state.rightPath, rel: re.name }).catch(() => null) : Promise.resolve(null),
  ])
  if (state.selected !== g) return
  const el = $('previewPanel').querySelector('.pv-model-texs')
  if (!el) return
  el.innerHTML = renderModelTexListHtml(lt, rt)
  el.querySelectorAll('img').forEach(img => {
    img.addEventListener('click', () => openPreview(img.src, img.dataset.name || ''))
  })
}

export function renderModelTexListHtml(lt, rt) {
  const col = (list, side) => {
    const tag = `<span class="pv-tex-tag pv-tex-tag-${side}">${side === 'left' ? t('common.left') : t('common.right')}</span>`
    if (!list || !list.length) return `<div class="pv-tex-col">${tag}<span class="pv-empty">${t('preview.noSide')}</span></div>`
    const items = list.map(tx =>
      `<div class="pv-tex-item">` +
      `<img class="thumb thumb-${side}" src="${escAttr(tx.url)}" data-name="${escAttr(tx.name)}" alt="" />` +
      `<span class="pv-tex-name" title="${escAttr(tx.name)}">${escHtml(tx.name)}</span>` +
      `</div>`
    ).join('')
    return `<div class="pv-tex-col">${tag}${items}</div>`
  }
  return col(lt, 'left') + col(rt, 'right')
}


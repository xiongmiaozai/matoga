/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import {
  state,
  $,
  ROLES,
  ROLE_LABEL,
  KIND_TEXT,
  STATUS_ORDER,
  leftBtn,
  rightBtn,
  onlyMissingChk,

  resultBody,
  leftPathEl,
  rightPathEl
} from './core.js'
import {
  formatSize,
  formatDate,
  isImageFile,
  fileUrl,
  escAttr,
  folderOf,
  mainEntryOf,
  hasAny,
  leftRoles,
  rightRoles,
  subKind,
  openPreview,
  relPath,
  joinPath,
  modelTypeOf,
  modelNsOf,
  modelFormatOf,
  modelTexBucketOf,
  modelAnimatedOf,
  modelCustomGroupOf,
  modelNameBucketOf,
  modelPrefixBucketOf,
  groupTypeOf,
  groupContentKind,
  groupTagOf,
  contentKindOfPath
} from './utils.js'
import { sortResult } from './compare.js'

import {
  replaceWithExternalFile,
  deleteTexture,
  handleAction,
  showPixelDiff,
  copySingleToRight,
  addTextureToRight,
  createBlankTextureToRight,
  createBlankTextureSetToRight,
  saveOptions
} from './actions.js'
import { initMaterial3D, updateMaterial3D, clearCustomModel, setModelEmptyHint } from './material3d.js'
import { enhancePreview } from './preview2d.js'
import { observeThumbs } from './thumb-loader.js'
import { observeModelThumbs } from './model-thumb.js'
import { parseModelText, buildModelSummary, diffLines, escHtml, isModelEntry, checkTexRefs } from './model-diff.js'
import { modelBaseNameOf } from './model-group-dims.js'
import {
  viewMcModelPairInViewport,

  isViewportVisible,
  resolveModelTexList,
  textureAssetPath
} from './mc-model-viewer.js'
import { t, onLocaleChange } from './i18n.js'
import { loadZhNames, zhOfTexPath, zhOfTexName } from './zh-names.js'
import { filterByResultSearch } from './result-search.js'
import { renderMaterialPreviewHtml, bindPreviewImages, pvCell, bindEmptyCellActions } from './rnd/preview.js'
import { fetchModelText, getVanillaTexSet, parentModelRel, resolveModelTexturesDeep, modelSumLine, mdRow, renderModelDiffGrid, loadModelDiffView, setHooks as setRenderModelDiffHooks } from './rnd/model-diff.js'
import { zhOfKey, applyResultSearch, bindResultSearch, setHooks as setRenderSearchHooks } from './rnd/search.js'
import { applyCategoryFilter, buildCatRow, renderCategoryBar, setHooks as setRenderCategoryBarHooks } from './rnd/category-bar.js'
import { statusBadge, renderThumbPair, modelThumbSpec, renderModelThumbCell, renderModelThumbPair, appendGroupRows, appendSubRows, setHooks as setRenderTableRowsHooks } from './rnd/table-rows.js'
import { renderModelTypeResult, renderPreviewModel, loadModelTexComparePanel, buildTexCompareRow, loadModelTex2dPreview, setHooks as setRenderModelTypeResultHooks } from './rnd/model-type-result.js'
/* 门面 re-export（§2.3） */
export { renderModelTypeResult, renderPreviewModel, loadModelTexComparePanel, buildTexCompareRow, loadModelTex2dPreview } from './rnd/model-type-result.js'
/* 门面 re-export（§2.3） */
export { statusBadge, renderThumbPair, modelThumbSpec, renderModelThumbCell, renderModelThumbPair, appendGroupRows, appendSubRows } from './rnd/table-rows.js'
/* 门面 re-export（§2.3） */
export { applyCategoryFilter, buildCatRow, renderCategoryBar } from './rnd/category-bar.js'
/* 门面 re-export（§2.3） */
export { zhOfKey, applyResultSearch, bindResultSearch } from './rnd/search.js'
/* 门面 re-export（§2.3） */
export { fetchModelText, getVanillaTexSet, parentModelRel, resolveModelTexturesDeep, modelSumLine, mdRow, renderModelDiffGrid, loadModelDiffView } from './rnd/model-diff.js'
/* 门面 re-export（§2.3） */
export { renderMaterialPreviewHtml, bindPreviewImages, pvCell, bindEmptyCellActions } from './rnd/preview.js'
loadZhNames().catch(() => {})

const _searchFieldCache = new Map()
const _rowMap = new Map()
let _filteredCache = null
let _renderedCount = 0
let _lastBaseSet = []
let _modelMetaLoading = false

/* 懒加载模型元数据（ns/format/texRefs/animated），供贴图数/动画分组维度使用 */

function _showMoreHandler() {
  state.renderLimit += 200
  if (state.viewMode !== 'byFolder' && _filteredCache) {
    const moreRow = resultBody.querySelector('.show-more-row')
    if (moreRow) moreRow.remove()
    const frag = document.createDocumentFragment()
    const start = _renderedCount
    let added = 0
    let truncated = false
    for (let i = start; i < _filteredCache.length; i++) {
      if (added >= 200) {
        truncated = true
        break
      }
      appendGroupRows(frag, _filteredCache[i])
      added++
    }
    _renderedCount += added
    for (const r of frag.children) if (r._group) _rowMap.set(r._group.key, r)
    resultBody.appendChild(frag)
    if (truncated) {
      const newMoreRow = document.createElement('tr')
      newMoreRow.className = 'show-more-row'
      newMoreRow.innerHTML = `<td colspan="8" style="text-align:center;padding:8px;"><button class="btn btn-ghost btn-sm">${t('render.showMore', { rendered: _renderedCount, total: _filteredCache.length })}</button></td>`
      newMoreRow.querySelector('button').addEventListener('click', _showMoreHandler)
      resultBody.appendChild(newMoreRow)
    }
    observeThumbs(resultBody)
    observeModelThumbs(resultBody)
  } else {
    renderResult()
  }
}

onLocaleChange(() => {
  leftPathEl.textContent = state.leftPath || t('common.empty')
  rightPathEl.textContent = state.rightPath || t('common.empty')
  renderCategoryBar(_lastBaseSet)
})

export function setLoading(side, on) {
  const path = side === 'left' ? leftPathEl : rightPathEl
  const btn = side === 'left' ? leftBtn : rightBtn
  if (on) path.textContent = t('render.loading')
  else path.textContent = (side === 'left' ? state.leftPath : state.rightPath) || t('common.empty')
  btn.disabled = on
}

export function applyEntries(side, folderPath, entries) {
  if (side === 'left') {
    state.leftPath = folderPath
    state.leftEntries = entries
    leftPathEl.textContent = folderPath
  } else {
    state.rightPath = folderPath
    state.rightEntries = entries
    rightPathEl.textContent = folderPath
  }
}

/* 模型行预览列：左右各一个 3D 缩略图占位（.ac-thumb + _modelThumbItem，observeModelThumbs 懒加载）。
   noCache 跳过后端缓存（对比场景为任意文件夹，缓存 key 含绝对路径，仅前端离屏渲染 + 内存去重） */
export function renderResult() {
  renderModelTypeResult()
  const result = state.result
  const onlyDiff = onlyMissingChk.checked
  let filtered = onlyDiff ? result.filter(g => g.kind !== 'have') : result.slice()
  filtered = filtered.filter(g => !state.hiddenKeys.has(g.key))
  renderCategoryBar(filtered)
  filtered = applyCategoryFilter(filtered)
  filtered = applyResultSearch(filtered)
  sortResult(filtered)


  if (filtered.length === 0) {
    let msg
    if (!state.leftPath || !state.rightPath) msg = t('render.dragHint')
    else if (result.length === 0) msg = t('render.bothEmpty')
    else if (state.resultSearchTerm && state.resultSearchTerm.trim()) {
      const baseFiltered = applyCategoryFilter(
        (onlyDiff ? result.filter(g => g.kind !== 'have') : result).filter(g => !state.hiddenKeys.has(g.key))
      )
      msg = baseFiltered.length ? t('categoryFilter.noMatch', { q: state.resultSearchTerm.trim() }) : t('render.noData')
    } else if (onlyDiff) msg = t('render.allConsistent')
    else msg = t('render.noData')
    resultBody.innerHTML = `<tr class="empty-row"><td colspan="8">${msg}</td></tr>`
    return
  }

  const frag = document.createDocumentFragment()
  const limit = state.renderLimit
  let rendered = 0
  let truncated = false

  if (state.viewMode === 'byFolder') {
    const folderMap = new Map()
    for (const g of filtered) {
      const f = folderOf(g)
      if (!folderMap.has(f)) folderMap.set(f, [])
      folderMap.get(f).push(g)
    }
    const folders = [...folderMap.keys()]
    const _sKey = state.sortKey,
      _sDir = state.sortDir === 'asc' ? 1 : -1
    if (_sKey === 'name' || !_sKey) {
      folders.sort((a, b) => a.localeCompare(b, 'zh') * _sDir)
    } else {
      const fk = new Map()
      for (const f of folders) {
        const items = folderMap.get(f)
        let v
        if (_sKey === 'status') {
          v = Infinity
          for (const g of items) {
            const s = STATUS_ORDER[g.kind]
            if (s < v) v = s
          }
        } else if (_sKey === 'size') {
          v = 0
          for (const g of items) {
            const s = mainEntryOf(g)?.size || 0
            if (s > v) v = s
          }
        } else if (_sKey === 'mtime') {
          v = 0
          for (const g of items) {
            const s = mainEntryOf(g)?.mtime || 0
            if (s > v) v = s
          }
        } else if (_sKey === 'left') {
          v = 1
          for (const g of items)
            if (hasAny(g.left)) {
              v = 0
              break
            }
        } else if (_sKey === 'right') {
          v = 1
          for (const g of items)
            if (hasAny(g.right)) {
              v = 0
              break
            }
        } else v = 0
        fk.set(f, v)
      }
      folders.sort((a, b) => {
        let v = fk.get(a) - fk.get(b)
        if (v === 0) v = a.localeCompare(b, 'zh')
        return v * _sDir
      })
    }
    for (const f of folders) {
      if (rendered >= limit) {
        truncated = true
        break
      }
      const items = folderMap.get(f)
      const collapsed = state.collapsedFolders.has(f)
      const fc = { have: 0, diff: 0, partial: 0, miss: 0, extra: 0 }
      for (const g of items) fc[g.kind]++
      const sp = []
      if (fc.have) sp.push(`<span class="fc fc-have">✓${fc.have}</span>`)
      if (fc.diff) sp.push(`<span class="fc fc-diff">≈${fc.diff}</span>`)
      if (fc.partial) sp.push(`<span class="fc fc-partial">◐${fc.partial}</span>`)
      if (fc.miss) sp.push(`<span class="fc fc-miss">✗${fc.miss}</span>`)
      if (fc.extra) sp.push(`<span class="fc fc-extra">＋${fc.extra}</span>`)
      const ftr = document.createElement('tr')
      ftr.className = 'folder-group-row'
      ftr.innerHTML = `<td colspan="8"><span class="folder-arrow">${collapsed ? '▸' : '▾'}</span><span class="folder-ico">📁</span><span class="folder-name">${f}</span><span class="folder-count">${t('render.folderCount', { n: items.length })}</span><span class="folder-summary">${sp.join(' ')}</span></td>`
      ftr.addEventListener('click', () => {
        const wasCollapsed = state.collapsedFolders.has(f)
        if (wasCollapsed) state.collapsedFolders.delete(f)
        else state.collapsedFolders.add(f)
        const arrow = ftr.querySelector('.folder-arrow')
        if (wasCollapsed) {
          const subFrag = document.createDocumentFragment()
          for (const g of items) appendGroupRows(subFrag, g)
          ftr.after(subFrag)
          for (const r of subFrag.children) if (r._group) _rowMap.set(r._group.key, r)
          observeThumbs(resultBody)
          observeModelThumbs(resultBody)
          if (arrow) arrow.textContent = '▾'
        } else {
          let next = ftr.nextSibling
          while (next && !next.classList.contains('folder-group-row') && !next.classList.contains('show-more-row')) {
            const rm = next
            next = next.nextSibling
            rm.remove()
          }
          if (arrow) arrow.textContent = '▸'
        }
      })
      frag.appendChild(ftr)
      if (collapsed) continue
      for (const g of items) {
        if (rendered >= limit) {
          truncated = true
          break
        }
        appendGroupRows(frag, g)
        rendered++
      }
    }
  } else {
    for (const g of filtered) {
      if (rendered >= limit) {
        truncated = true
        break
      }
      appendGroupRows(frag, g)
      rendered++
    }
  }

  if (truncated) {
    const moreRow = document.createElement('tr')
    moreRow.className = 'show-more-row'
    moreRow.innerHTML = `<td colspan="8" style="text-align:center;padding:8px;"><button class="btn btn-ghost btn-sm">${t('render.showMore', { rendered, total: filtered.length })}</button></td>`
    moreRow.querySelector('button').addEventListener('click', _showMoreHandler)
    frag.appendChild(moreRow)
  }

  resultBody.innerHTML = ''
  resultBody.appendChild(frag)
  _rowMap.clear()
  for (const r of resultBody.children) if (r._group) _rowMap.set(r._group.key, r)
  _filteredCache = filtered
  _renderedCount = rendered
  observeThumbs(resultBody)
  observeModelThumbs(resultBody)
}

export function selectGroup(g, toggle = true) {
  state.selected = g
  const prevRow = resultBody.querySelector('tr.row-selected:not(.sub-row)')
  if (prevRow && prevRow._group !== g) prevRow.classList.remove('row-selected')
  let curRow = _rowMap.get(g.key) || null
  if (curRow) curRow.classList.add('row-selected')
  if (toggle && g.isMaterial && curRow) {
    const arrow = curRow.querySelector('.expand-arrow')
    if (state.expandedKeys.has(g.key)) {
      state.expandedKeys.delete(g.key)
      let next = curRow.nextSibling
      while (next && next.classList && next.classList.contains('sub-row')) {
        const rm = next
        next = next.nextSibling
        rm.remove()
      }
      if (arrow) arrow.textContent = '▸'
    } else {
      state.expandedKeys.add(g.key)
      const frag = document.createDocumentFragment()
      appendSubRows(frag, g)
      curRow.after(frag)
      observeThumbs(resultBody)
      if (arrow) arrow.textContent = '▾'
    }
  } else if (toggle && g.isMaterial && !curRow) {
    if (state.expandedKeys.has(g.key)) state.expandedKeys.delete(g.key)
    else state.expandedKeys.add(g.key)
    renderResult()
  }
  renderSidebar()
}

const MD_MAX_LINES = 600

/* 原版贴图路径集合（official-packs 全量贴图，懒加载缓存）：用于判定模型贴图引用是否由原版提供，避免误报缺失 */
let vanillaTexSet = null
let vanillaTexLoading = null
/* 沿 parent 继承链递归合并 textures（子覆盖父），供侧栏贴图引用检测使用，
   与 mc-model-viewer resolveMcModelRaw 的 parent 解析对齐，避免漏报 potted_* 等继承贴图 */
const MAX_PARENT_DEPTH = 8
/* 确保 3D 视口就绪。autoSwitch=true 时（用户主动操作）才切到预览面板 3D tab；
   自动选中模型时不切 tab，保留用户当前的 2D/3D 选择，避免 2D 内容被切走。 */
function tryActivateCompareModelViewport(autoSwitch = false) {
  if (isViewportVisible()) return true
  if (autoSwitch) {
    const pvBtn = document.querySelector('.pv-tabs button[data-pv-tab="3d"]')
    if (pvBtn) {
      pvBtn.click()
      return true
    }
  }
  return true
}

/* 选中模型行：左右模型并排送入 3D 视口对比展示；右侧缺失时回退用左侧模型。
   2D tab 仍保留 JSON 文本差异 */
async function loadModelPreview(g) {
  if (state.selected !== g) return
  const mySeq = ++state.modelLoadSeq
  const le = g.left && g.left.file,
    re = g.right && g.right.file
  const left = le && isModelEntry(le) ? { fileRoot: state.leftPath, rel: le.name } : null
  const right = re && isModelEntry(re) ? { fileRoot: state.rightPath, rel: re.name } : null
  if (!left && !right) {
    setModelEmptyHint(t('m3d.modelNotFound'))
    clearCustomModel()
    return
  }
  if (!tryActivateCompareModelViewport(true)) return
  try {
    const res = await viewMcModelPairInViewport({
      left,
      right,
      rightRoot: state.rightPath,
      isStale: () => state.modelLoadSeq !== mySeq
    })
    if (state.selected !== g || (res && res.shown === false)) clearCustomModel()
  } catch {
    setModelEmptyHint(t('m3d.modelLoadFailed'))
    clearCustomModel()
  }
}

/* 点击模型卡片下方的贴图条目：3D 视口贴图效果对比。
   左=左模型+左贴图，右=右模型+右贴图（模型或贴图缺失均回退左侧），展示替换后模型的贴图渲染效果 */
export function renderSidebar() {
  const g = state.selected
  const panel = $('previewPanel')

  const mat3dContainer = $('material3dContainer')

  if (mat3dContainer) initMaterial3D(mat3dContainer)

  if (!g) {
    panel.innerHTML = `<div class="pv-hint">${t('preview.hint')}</div>`

    updateMaterial3D(null)
    clearCustomModel()
    setModelEmptyHint('')
    return
  }

  updateMaterial3D(g.isMaterial ? g : null)
  if (!g.isModel) {
    clearCustomModel()
    setModelEmptyHint('')
  }

  let html = ''
  const diffPairs = []
  if (g.isMaterial) {
    const hasMain = (g.left && g.left.main) || (g.right && g.right.main)
    for (const role of ROLES) {
      const le = g.left && g.left[role],
        re = g.right && g.right[role]
      if (!le && !re) {
        if ((role === 'normal' || role === 'specular') && hasMain && state.rightPath)
          html += `<div class="pv-row pv-row-empty" data-role="${role}"><span class="pv-role">${ROLE_LABEL[role]}</span>${pvCell(null, t('common.left'))}${pvCell(null, t('common.right'))}</div>`
        continue
      }
      html += `<div class="pv-row" data-role="${role}"><span class="pv-role">${ROLE_LABEL[role]}</span>${pvCell(le, t('common.left'))}${pvCell(re, t('common.right'))}</div>`
      if (le && re && !le.isDirectory && !re.isDirectory && isImageFile(le.name) && isImageFile(re.name))
        diffPairs.push([le, re, ROLE_LABEL[role]])
    }
  } else if (g.isDir) {
    html = `<div class="pv-hint">${t('preview.folder')}</div>`
  } else if (g.isModel) {
    const tab = state.modelPreviewTab === 'tex2d' ? 'tex2d' : 'model'
    html =
      `<div class="pv-model">` +
      `<div class="pv-model-tabs">` +
      `<button class="pv-model-tab${tab === 'model' ? ' on' : ''}" data-pv-mtab="model">${t('render.previewTabModel')}</button>` +
      `<button class="pv-model-tab${tab === 'tex2d' ? ' on' : ''}" data-pv-mtab="tex2d">${t('render.previewTabTex2d')}</button>` +
      `</div>` +
      `<div class="pv-model-sum">${t('toast.computing')}</div>` +
      `<div class="pv-model-preview"${tab === 'model' ? '' : ' style="display:none"'}></div>` +
      `<div class="pv-model-texs mc-tex-wrap"${tab === 'tex2d' ? '' : ' style="display:none"'}>${t('toast.computing')}</div>` +
      `<div class="md-grid"><div class="md-cell md-load">${t('toast.computing')}</div><div class="md-cell md-load">${t('toast.computing')}</div></div>` +
      `<div class="pv-tex-refs" style="display:none"></div>` +
      `</div>`
  } else {
    const le = g.left && (g.left.file || g.left.dir),
      re = g.right && (g.right.file || g.right.dir)
    html = `<div class="pv-row" data-role="file"><span class="pv-role">${t('preview.file')}</span>${pvCell(le, t('common.left'))}${pvCell(re, t('common.right'))}</div>`
    if (le && re && !le.isDirectory && !re.isDirectory && isImageFile(le.name) && isImageFile(re.name))
      diffPairs.push([le, re, t('preview.file')])
  }
  if (diffPairs.length) {
    html += `<div class="pv-diff-btn-bar"><button class="btn btn-ghost btn-sm" id="pixelDiffBtn">${t('preview.pixelDiff')}</button></div>`
  }
  panel.querySelectorAll('.pv-row').forEach(row => {
    if (row._splitCleanup) row._splitCleanup()
  })
  panel.innerHTML = html
  panel.querySelectorAll('img').forEach(img => {
    const cell = img.parentElement
    cell.classList.add('pv-loading')
    img.addEventListener('click', () => openPreview(img.src, img.dataset.name || ''))
    img.addEventListener('load', () => {
      cell.classList.remove('pv-loading')
      const sl = cell.querySelector('.pv-size')
      if (sl && img.naturalWidth) sl.textContent = `${img.naturalWidth}×${img.naturalHeight}`
    })
    img.addEventListener('error', () => {
      cell.classList.remove('pv-loading')
      cell.classList.add('pv-error')
    })
    const btn = document.createElement('button')
    btn.className = 'pv-replace-btn'
    btn.textContent = t('preview.replace')
    btn.title = t('preview.replaceTitle')
    btn.addEventListener('click', e => {
      e.stopPropagation()
      replaceWithExternalFile(img.dataset.path)
    })
    cell.appendChild(btn)
    const delBtn = document.createElement('button')
    delBtn.className = 'pv-delete-btn'
    delBtn.textContent = t('preview.delete')
    delBtn.title = t('preview.deleteTitle')
    delBtn.addEventListener('click', e => {
      e.stopPropagation()
      deleteTexture(img.dataset.path)
    })
    cell.appendChild(delBtn)
  })
  bindEmptyCellActions(panel, g)

  const diffBtn = $('pixelDiffBtn')
  if (diffBtn) diffBtn.addEventListener('click', () => showPixelDiff(diffPairs, panel))
  if (g.isModel) {
    loadModelDiffView(g, panel)
    clearCustomModel()
    loadModelPreview(g)
    const tab = state.modelPreviewTab === 'tex2d' ? 'tex2d' : 'model'
    if (tab === 'model') {
      const pv = panel.querySelector('.pv-model-preview')
      if (pv) renderPreviewModel(pv, g)
    } else {
      loadModelTex2dPreview(panel.querySelector('.pv-model-texs'), g)
    }
    panel.querySelectorAll('[data-pv-mtab]').forEach(b =>
      b.addEventListener('click', () => {
        state.modelPreviewTab = b.dataset.pvMtab
        renderSidebar()
      })
    )
  }

  enhancePreview()
}

export function updateSortIndicators() {
  document.querySelectorAll('.result-table th[data-key]').forEach(th => {
    th.classList.remove('asc', 'desc')
    if (th.dataset.key === state.sortKey) {
      th.classList.add(state.sortDir === 'asc' ? 'asc' : 'desc')
    }
  })
}

export function initViewTabs() {
  document.querySelectorAll('input[name="viewMode"]').forEach(r => {
    r.checked = r.value === state.viewMode
  })
}



/* RenderModelDiff 依赖注入 */
setRenderModelDiffHooks({
  get_MAX_PARENT_DEPTH: () => MAX_PARENT_DEPTH,
  get_MD_MAX_LINES: () => MD_MAX_LINES,
  get_vanillaTexSet: () => vanillaTexSet,
  set_vanillaTexSet: v => { vanillaTexSet = v },
  get_vanillaTexLoading: () => vanillaTexLoading,
  set_vanillaTexLoading: v => { vanillaTexLoading = v }
})

/* RenderSearch 依赖注入 */
setRenderSearchHooks({
  renderResult: renderResult,
  get__searchFieldCache: () => _searchFieldCache
})

/* RenderCategoryBar 依赖注入 */
setRenderCategoryBarHooks({
  renderResult: renderResult,
  get__lastBaseSet: () => _lastBaseSet,
  set__lastBaseSet: v => { _lastBaseSet = v }
})

/* RenderTableRows 依赖注入 */
setRenderTableRowsHooks({
  selectGroup: selectGroup,
  renderSidebar: renderSidebar
})

/* RenderModelTypeResult 依赖注入 */
setRenderModelTypeResultHooks({
  selectGroup: selectGroup,
  renderSidebar: renderSidebar
})
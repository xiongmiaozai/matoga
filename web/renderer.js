/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { state, $, showToast } from './src/core.js'
import { closePreview, mainEntryOf, getIgnorePatterns, fileUrl } from './src/utils.js'
import { compare, sortResult } from './src/compare.js'
import { renderResult, renderSidebar, updateSortIndicators, selectGroup, initViewTabs } from './src/render.js'
import {
  loadFromPath,
  loadFolder,
  updateCompareButton,
  saveOptions,
  undo,
  updateUndoBtn,
  swapFolders,
  exportResult,
  exportHtml,
  batchCopyToSide,
  reloadAndCompare,
  handleAction,
  setGroupTag,
  clearGroupTag
} from './src/actions.js'
import {
  setGeometry,
  setMetalness,
  setRoughness,
  setNormalScale,
  setEmissiveIntensity,
  setMaterialFormat,
  setFormatDetectCallback,
  setHeightDetectCallback,
  setSourceSide,
  setParallaxScale,
  setParallaxSteps,
  setParallaxMode,
  setParallaxAdaptive,
  setParallaxEnabled,
  setParallaxShadow,
  setLightPreset,
  getCustomLightConfig,
  applyCustomLightConfigExport,
  setEnvIntensity,
  setExposure,
  toggleGround,
  loadHDREnv,
  clearHDREnv,
  getCurrentLightPreset,
  getCurrentEnvMode,
  setEnvModeExport,
  setHdrRotation,
  setHdrUsage,

  setSkyTurbidity,
  setSkyRayleigh,
  setSkyMieCoefficient,
  setSkyMieDirectionalG,
  setSkySunElevation,
  setSkySunAzimuth,
  setSkyTint,
  setAutoRotate,
  setWireframe,
  screenshot,
  toggleFullscreen,
  initMaterial3D,
  updateMaterial3D,
  clearMaterial3D,
  setOpacityMode,
  setOpacity,
  setTransmission,
  setIOR,
  setClearcoat,
  setTextureFilter,
  setMipmapsEnabled,
  setAnisotropyLevel
} from './src/material3d.js'
import { initWorkspace } from './src/workspace.js'
import { initSettings } from './src/settings.js'
import { applyThumbPerf } from './src/model-thumb.js'
import { initThemes } from './src/theme/registry.js'
import { initPreview2D } from './src/preview2d.js'
import {
  initHdrPreset,
  refreshHdrPreset,
  clearHdrPresetSelection,
  filterHdrPresets,
  openHdrPreview,
  initHdrDragDrop,
  disposeHdrPreview
} from './src/hdri-preset.js'
import { t, initI18n } from './src/i18n.js'
import { initPreviewPanel } from './src/preview-panel.js'
import { initNodeCanvas, refreshNodePreview } from './src/node-canvas.js'
import { initPanelLoader } from './src/panel-loader.js'
import { initPackPickers } from './src/pack-picker.js'
import { initAssetLibrary } from './src/asset-library.js'
import { uiPrompt } from './src/ui-dialog.js'
import { initHeader } from './src/header.js'

import {
  leftBtn,
  rightBtn,
  exportBtn,
  exportHtmlBtn,
  clearMemBtn,
  batchRightBtn,
  batchLeftBtn,
  undoBtn,
  compareBtn2,
  swapBtn2,
  recursiveChk,
  onlyMissingChk,
  hashChk,
  ignoreChk,
  ignoreInput,
  resultBody,
  leftPathEl,
  rightPathEl
} from './src/core.js'


leftBtn.addEventListener('click', () => loadFolder('left'))
rightBtn.addEventListener('click', () => loadFolder('right'))

document.addEventListener('workspace:activated', e => {
  const comps = new Set((e.detail && e.detail.components) || [])
  const hasNode = comps.has('nodeCanvas')
  const hasCompare = comps.has('compare')
  if (hasNode === hasCompare) return
  if (hasNode) {
    clearMaterial3D()
    refreshNodePreview()
  } else {
    renderSidebar()
  }
})

exportBtn.addEventListener('click', exportResult)

onlyMissingChk.addEventListener('change', () => {
  saveOptions()
  renderResult()
})
hashChk.addEventListener('change', () => {
  saveOptions()
  if (state.leftPath && state.rightPath) compare()
})

document.querySelectorAll('input[name="viewMode"]').forEach(r => {
  r.addEventListener('change', () => {
    state.viewMode = r.value
    state.collapsedFolders.clear()
    saveOptions()
    renderResult()
  })
})

recursiveChk.addEventListener('change', async () => {
  saveOptions()
  if (state.leftPath) await loadFromPath('left', state.leftPath)
  if (state.rightPath) await loadFromPath('right', state.rightPath)
  if (state.leftPath && state.rightPath) compare()
})

document.querySelectorAll('.result-table th[data-key]').forEach(th => {
  th.classList.add('sortable')
  th.addEventListener('click', () => {
    const key = th.dataset.key
    if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'
    else {
      state.sortKey = key
      state.sortDir = 'asc'
    }
    state.renderLimit = 200
    saveOptions()
    updateSortIndicators()
    renderResult()
  })
})
updateSortIndicators()

;[
  ['left', leftPathEl],
  ['right', rightPathEl]
].forEach(([side, box]) => {
  box.addEventListener('dragover', e => {
    e.preventDefault()
    box.classList.add('drag-over')
  })
  box.addEventListener('dragleave', () => box.classList.remove('drag-over'))
  box.addEventListener('drop', async e => {
    e.preventDefault()
    box.classList.remove('drag-over')
    const dt = e.dataTransfer
    if ((!dt || !dt.files || !dt.files.length) && (!dt || !dt.items || !dt.items.length)) return
    let p = null
    if (window.matogaUpload) {
      p = await window.matogaUpload.dropToTemp(dt)
    } else {
      try {
        p = window.api.getPathForFile(dt.files[0])
      } catch {
        p = dt.files[0].path
      }
    }
    if (!p) {
      showToast(t('toast.cannotGetPath'))
      return
    }
    await loadFromPath(side, p)
  })
})

$('previewModal').addEventListener('click', closePreview)
$('previewClose').addEventListener('click', e => {
  e.stopPropagation()
  closePreview()
})

ignoreChk.addEventListener('change', () => {
  saveOptions()
  if (state.leftPath) loadFromPath('left', state.leftPath)
  if (state.rightPath) loadFromPath('right', state.rightPath)
})
let _ignoreTimer = null
ignoreInput.addEventListener('input', () => {
  clearTimeout(_ignoreTimer)
  _ignoreTimer = setTimeout(() => {
    saveOptions()
    if (state.leftPath) loadFromPath('left', state.leftPath)
    if (state.rightPath) loadFromPath('right', state.rightPath)
  }, 400)
})

exportHtmlBtn.addEventListener('click', exportHtml)
clearMemBtn.addEventListener('click', async () => {
  await window.api.clearConfig()
  showToast(t('toast.clearedMem'))
})

batchRightBtn.addEventListener('click', () => batchCopyToSide('right'))
batchLeftBtn.addEventListener('click', () => batchCopyToSide('left'))
undoBtn.addEventListener('click', () => {
  undo().catch(err => showToast(t('toast.undoError', { msg: err.message })))
})

if (compareBtn2) compareBtn2.addEventListener('click', compare)
if (swapBtn2) swapBtn2.addEventListener('click', swapFolders)

;(() => {
  const table = $('resultTable')
  if (!table) return
  const ths = table.querySelectorAll('thead th')
  const COL_MIN = 40,
    COL_MAX = 600
  const colKey = th => th.dataset.key || (th.className.match(/col-(\w+)/) || [])[1] || th.cellIndex
  const saveWidths = async () => {
    const widths = {}
    ths.forEach(th => {
      const k = colKey(th)
      if (k) widths[k] = th.offsetWidth
    })
    await window.api.setConfig({ tableColWidths: widths })
  }
  ths.forEach((th, i) => {
    if (i === ths.length - 1) return
    const handle = document.createElement('div')
    handle.className = 'col-resize-handle'
    th.appendChild(handle)
    handle.addEventListener('mousedown', e => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX,
        startW = th.offsetWidth
      handle.classList.add('dragging')
      table.classList.add('resizing')
      const onMove = ev => {
        th.style.width = Math.max(COL_MIN, Math.min(COL_MAX, startW + ev.clientX - startX)) + 'px'
      }
      const onUp = () => {
        handle.classList.remove('dragging')
        table.classList.remove('resizing')
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        saveWidths()
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })
    handle.addEventListener('dblclick', () => {
      const ci = i + 1
      const prevW = th.style.width
      th.style.width = 'auto'
      void table.offsetWidth
      const naturalW = th.offsetWidth
      th.style.width = Math.max(COL_MIN, Math.min(COL_MAX, naturalW)) + 'px'
      saveWidths()
    })
  })
  window.api.getConfig().then(cfg => {
    if (!cfg.tableColWidths) return
    ths.forEach(th => {
      const k = colKey(th)
      if (k && cfg.tableColWidths[k]) th.style.width = cfg.tableColWidths[k] + 'px'
    })
  })
})()

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closePreview()
    return
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault()
    undo().catch(err => showToast(t('toast.undoError', { msg: err.message })))
    return
  }
  const tag = e.target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  const modal = $('previewModal')
  if (modal.classList.contains('show')) return
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
    e.preventDefault()
    const g = state.selected
    if (!g) {
      showToast(t('toast.noSelection'))
      return
    }
    if (e.shiftKey) {
      navigator.clipboard
        .writeText(g.key)
        .then(() => showToast(t('toast.copiedName')))
        .catch(() => showToast(t('toast.copyFail')))
      return
    }
    const side = g.left ? 'left' : 'right'
    state.copySource = { key: g.key, side }
    showToast(t('toast.copySourceSet', { name: g.key, dest: t('common.' + (side === 'left' ? 'right' : 'left')) }))
    return
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
    e.preventDefault()
    const src = state.copySource
    if (!src) {
      showToast(t('toast.noCopySource'))
      return
    }
    const fresh = state.result.find(r => r.key === src.key)
    if (!fresh) {
      showToast(t('toast.noCopySource'))
      return
    }
    const destSide = src.side === 'left' ? 'right' : 'left'
    handleAction(destSide === 'right' ? 'copy-to-right' : 'copy-to-left', fresh)
    return
  }
  if (
    e.key === 'ArrowDown' ||
    e.key === 'ArrowUp' ||
    e.key === 'PageDown' ||
    e.key === 'PageUp' ||
    e.key === 'Home' ||
    e.key === 'End'
  ) {
    e.preventDefault()
    const rows = [...resultBody.querySelectorAll('tr:not(.folder-group-row):not(.sub-row):not(.empty-row)')]
    if (!rows.length) return
    let idx = rows.findIndex(r => r.classList.contains('row-selected'))
    if (idx < 0) idx = 0
    if (e.key === 'Home') idx = 0
    else if (e.key === 'End') idx = rows.length - 1
    else if (e.key === 'ArrowDown') idx = Math.min(idx + 1, rows.length - 1)
    else if (e.key === 'ArrowUp') idx = Math.max(idx - 1, 0)
    else if (e.key === 'PageDown') idx = Math.min(idx + 10, rows.length - 1)
    else if (e.key === 'PageUp') idx = Math.max(idx - 10, 0)
    const g = rows[idx]._group
    if (g) selectGroup(g, false)
    rows[idx].scrollIntoView({ block: 'nearest' })
  } else if (e.key === 'Enter') {
    const sel = state.selected
    if (sel) {
      const ent = mainEntryOf(sel)
      if (ent) window.api.openPath(ent.fullPath)
    }
  }
})

function initCtxMenu() {
  const menu = $('ctxMenu')
  const tbody = $('resultBody')
  if (!menu || !tbody) return
  tbody.addEventListener('contextmenu', ev => {
    const tr = ev.target.closest('tr')
    if (!tr || !tr._group) return
    ev.preventDefault()
    const g = tr._group
    state.selected = g
    selectGroup(g)
    menu.style.display = 'block'
    const mx = Math.min(ev.clientX, window.innerWidth - 180)
    const my = Math.min(ev.clientY, window.innerHeight - 260)
    menu.style.left = mx + 'px'
    menu.style.top = my + 'px'
    menu.querySelectorAll('.ctx-item').forEach(item => {
      const act = item.dataset.act
      const pickEntry = side => {
        const s = g[side]
        if (!s) return null
        return s.main || s.file || s.dir || s.normal || s.specular || null
      }
      let enabled = true
      if (act === 'open-left' || act === 'loc-left') enabled = !!pickEntry('left')
      else if (act === 'open-right' || act === 'loc-right') enabled = !!pickEntry('right')
      else if (act === 'copy-to-right') enabled = !!(g.left && state.rightPath)
      else if (act === 'copy-to-left') enabled = !!(g.right && state.leftPath)
      else if (act === 'copy-source') enabled = !!(g.left || g.right)
      else if (act === 'paste-source') enabled = !!state.copySource
      else if (act === 'hide') enabled = !state.hiddenKeys.has(g.key)
      else if (act === 'unhide') enabled = state.hiddenKeys.has(g.key)
      else if (act === 'set-tag') enabled = true
      else if (act === 'clear-tag') enabled = !!state.customTags[g.key]
      item.classList.toggle('disabled', !enabled)
      item.onclick = enabled
        ? () => {
            if (act === 'hide') {
              state.hiddenKeys.add(g.key)
              saveOptions()
              renderResult()
            } else if (act === 'unhide') {
              state.hiddenKeys.delete(g.key)
              saveOptions()
              renderResult()
            } else if (act === 'set-tag') {
              uiPrompt({
                title: t('ctx.setTag'),
                label: t('ctx.setTagLabel'),
                value: state.customTags[g.key] || '',
                placeholder: t('ctx.setTagPh'),
                okText: t('common.confirm'),
                cancelText: t('common.cancel')
              }).then(tag => {
                if (tag != null && tag.trim()) setGroupTag(g, tag.trim())
              })
            } else if (act === 'clear-tag') {
              clearGroupTag(g)
            } else if (act === 'copy-source') {
              const side = g.left ? 'left' : 'right'
              state.copySource = { key: g.key, side }
              showToast(
                t('toast.copySourceSet', { name: g.key, dest: t('common.' + (side === 'left' ? 'right' : 'left')) })
              )
            } else if (act === 'paste-source') {
              const src = state.copySource
              if (!src) {
                showToast(t('toast.noCopySource'))
                return
              }
              const fresh = state.result.find(r => r.key === src.key)
              if (!fresh) {
                showToast(t('toast.noCopySource'))
                return
              }
              const destSide = src.side === 'left' ? 'right' : 'left'
              handleAction(destSide === 'right' ? 'copy-to-right' : 'copy-to-left', fresh)
            } else {
              handleAction(act, g)
            }
            menu.style.display = 'none'
          }
        : null
    })
  })
  document.addEventListener('click', () => {
    menu.style.display = 'none'
  })
  document.addEventListener('contextmenu', ev => {
    if (!ev.target.closest('tr')) menu.style.display = 'none'
  })
}

;(async function init() {
  const step = async (name, fn) => {
    try {
      return await fn()
    } catch (e) {
      console.error('[init]', name, e)
    }
  }

  window.matogaActions = {
    exportResult,
    exportHtml,
    swapFolders,
    clearMem: async () => {
      await window.api.clearConfig()
      showToast(t('toast.clearedMem'))
    },
    setViewMode: mode => {
      const r = document.querySelector(`input[name="viewMode"][value="${mode}"]`)
      if (r) ((r.checked = true), r.dispatchEvent(new Event('change')))
    },
    toggleLeft: () => $('collapseLeftBtn')?.click(),
    toggleRight: () => $('collapseRightBtn')?.click(),
    wsManage: () => document.querySelector('.hw-more')?.click(),
    showShortcuts: () => showToast(t('menu.shortcutsHint', { dflt: 'Ctrl+1 表格 · Ctrl+2 模型 · Alt+R 节点关系' }))
  }

  await step('initI18n', initI18n)
  await step('initThemes', () => initThemes())
  await step('initPanelLoader', initPanelLoader)
  await step('initSettings', () => initSettings())
  await step('initHeader', () => initHeader())
  await step('initWorkspace', initWorkspace)
  await step('initPreview2D', () => initPreview2D())
  await step('initPreviewPanel', () => initPreviewPanel())
  await step('initNodeCanvas', () => initNodeCanvas())

  await step('initAssetLibrary', () => initAssetLibrary())
  await step('initPackPickers', () => initPackPickers())

  await step('initViewTabs', () => initViewTabs())
  await step('initCtxMenu', () => initCtxMenu())

  const cfg = (await step('getConfig', () => window.api.getConfig())) || {}

  applyThumbPerf(cfg)

  if (cfg.recursive) recursiveChk.checked = true
  if (cfg.hash) hashChk.checked = true
  if (cfg.onlyMissing) onlyMissingChk.checked = true
  if (cfg.ignoreSys !== undefined) ignoreChk.checked = cfg.ignoreSys
  if (cfg.ignoreCustom) ignoreInput.value = cfg.ignoreCustom
  if (cfg.viewMode) {
    state.viewMode = cfg.viewMode
    const r = document.querySelector(`input[name="viewMode"][value="${cfg.viewMode}"]`)
    if (r) r.checked = true
  }
  if (cfg.sortKey) state.sortKey = cfg.sortKey
  if (cfg.sortDir) state.sortDir = cfg.sortDir

  if (Array.isArray(cfg.hiddenKeys)) state.hiddenKeys = new Set(cfg.hiddenKeys)
  if (cfg.categoryFilter && typeof cfg.categoryFilter === 'object')
    state.categoryFilter = { ...state.categoryFilter, ...cfg.categoryFilter }
  if (typeof cfg.resultSearchTerm === 'string') state.resultSearchTerm = cfg.resultSearchTerm
  if (cfg.customTags && typeof cfg.customTags === 'object') state.customTags = cfg.customTags
  if (typeof cfg.modelGroupBy === 'string') state.modelGroupBy = cfg.modelGroupBy
  if (Array.isArray(cfg.modelGroupRules)) state.modelGroupRules = cfg.modelGroupRules
  updateSortIndicators()

  const tasks = []
  if (cfg.leftPath) tasks.push(loadFromPath('left', cfg.leftPath).catch(() => {}))
  if (cfg.rightPath) tasks.push(loadFromPath('right', cfg.rightPath).catch(() => {}))
  await Promise.all(tasks)
  if (state.leftPath && state.rightPath) compare().then(() => refreshNodePreview())
  updateUndoBtn()
})()

/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { state, $, showToast } from './src/core.js'
import { closePreview, mainEntryOf, getIgnorePatterns, fileUrl } from './src/utils.js'
import { compare, sortResult } from './src/compare.js'
import { renderResult, renderSidebar, updateSortIndicators } from './src/render.js'
import {
  loadFromPath, loadFolder, updateCompareButton, saveOptions,
  undo, updateUndoBtn, swapFolders, exportResult, exportHtml,
  batchCopyToSide, reloadAndCompare
} from './src/actions.js'
import {
  setGeometry, setMetalness, setRoughness, setNormalScale, setEmissiveIntensity,
  setMaterialFormat, setFormatDetectCallback, setHeightDetectCallback, setSourceSide,
  setParallaxScale, setParallaxSteps, setLightPreset, setEnvIntensity, setExposure,
  toggleGround, loadHDREnv, clearHDREnv, setAutoRotate, setWireframe, screenshot, toggleFullscreen,
  setOpacityMode, setOpacity, setTransmission, setIOR, setClearcoat
} from './src/material3d.js'
import { initLayout } from './src/layout.js'
import { initSettings, applyTheme } from './src/settings.js'
import { initPreview2D } from './src/preview2d.js'

import {
  leftBtn, rightBtn, compareBtn, exportBtn, exportHtmlBtn, swapBtn,
  clearMemBtn, batchRightBtn, batchLeftBtn, undoBtn,
  recursiveChk, onlyMissingChk, hashChk, ignoreChk, ignoreInput,
  searchInput, resultBody, leftCard, rightCard
} from './src/core.js'

leftBtn.addEventListener('click', () => loadFolder('left'))
rightBtn.addEventListener('click', () => loadFolder('right'))
compareBtn.addEventListener('click', compare)
exportBtn.addEventListener('click', exportResult)
swapBtn.addEventListener('click', swapFolders)
onlyMissingChk.addEventListener('change', () => { saveOptions(); renderResult() })
hashChk.addEventListener('change', () => { saveOptions(); if (state.leftPath && state.rightPath) compare() })

let _searchTimer = null
searchInput.addEventListener('input', () => {
  state.searchText = searchInput.value
  state.renderLimit = 200
  clearTimeout(_searchTimer)
  _searchTimer = setTimeout(renderResult, 150)
})

document.querySelectorAll('input[name="viewMode"]').forEach(r => {
  r.addEventListener('change', () => { state.viewMode = r.value; state.collapsedFolders.clear(); saveOptions(); renderResult() })
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
    else { state.sortKey = key; state.sortDir = 'asc' }
    state.renderLimit = 200
    saveOptions()
    updateSortIndicators()
    renderResult()
  })
})
updateSortIndicators()

;[['left', leftCard], ['right', rightCard]].forEach(([side, card]) => {
  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over') })
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'))
  card.addEventListener('drop', async (e) => {
    e.preventDefault()
    card.classList.remove('drag-over')
    const files = e.dataTransfer && e.dataTransfer.files
    if (!files || !files.length) return
    let p
    try { p = window.api.getPathForFile(files[0]) } catch { p = files[0].path }
    if (!p) { showToast('无法获取拖入路径'); return }
    await loadFromPath(side, p)
  })
})

$('previewModal').addEventListener('click', closePreview)
$('previewClose').addEventListener('click', (e) => { e.stopPropagation(); closePreview() })

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    state.statusFilter = btn.dataset.filter
    state.renderLimit = 200
    saveOptions()
    renderResult()
  })
})

ignoreChk.addEventListener('change', () => { saveOptions(); if (state.leftPath) loadFromPath('left', state.leftPath); if (state.rightPath) loadFromPath('right', state.rightPath) })
let _ignoreTimer = null
ignoreInput.addEventListener('input', () => {
  clearTimeout(_ignoreTimer)
  _ignoreTimer = setTimeout(() => { saveOptions(); if (state.leftPath) loadFromPath('left', state.leftPath); if (state.rightPath) loadFromPath('right', state.rightPath) }, 400)
})

exportHtmlBtn.addEventListener('click', exportHtml)
clearMemBtn.addEventListener('click', async () => {
  await window.api.clearConfig()
  showToast('已清除记忆')
})

batchRightBtn.addEventListener('click', () => batchCopyToSide('right'))
batchLeftBtn.addEventListener('click', () => batchCopyToSide('left'))
undoBtn.addEventListener('click', () => { undo().catch(err => showToast('撤回出错：' + err.message)) })

function bindSegment(segId, attr, fn) {
  const seg = $(segId)
  if (!seg) return
  seg.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      fn(btn.dataset[attr])
    })
  })
}

bindSegment('m3dGeoSeg', 'geo', setGeometry)
bindSegment('m3dSrcSeg', 'src', setSourceSide)
bindSegment('m3dLightSeg', 'light', setLightPreset)
bindSegment('m3dOpacityModeSeg', 'mode', setOpacityMode)

$('m3dMetalness').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setMetalness(v); $('m3dMetalnessVal').textContent = v.toFixed(2) })
$('m3dRoughness').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setRoughness(v); $('m3dRoughnessVal').textContent = v.toFixed(2) })
$('m3dNormal').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setNormalScale(v); $('m3dNormalVal').textContent = v.toFixed(2) })
$('m3dEmissive').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setEmissiveIntensity(v); $('m3dEmissiveVal').textContent = v.toFixed(1) })
$('m3dOpacity').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setOpacity(v); $('m3dOpacityVal').textContent = v.toFixed(2) })
$('m3dTransmission').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setTransmission(v); $('m3dTransmissionVal').textContent = v.toFixed(2) })
$('m3dIOR').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setIOR(v); $('m3dIORVal').textContent = v.toFixed(2) })
$('m3dClearcoat').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setClearcoat(v); $('m3dClearcoatVal').textContent = v.toFixed(2) })
$('m3dParallax').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setParallaxScale(v); $('m3dParallaxVal').textContent = v.toFixed(2) })
$('m3dParallaxSteps').addEventListener('input', (e) => { const v = parseInt(e.target.value); setParallaxSteps(v); $('m3dParallaxStepsVal').textContent = v })

$('m3dEnvIntensity').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setEnvIntensity(v); $('m3dEnvIntensityVal').textContent = v.toFixed(2) })
$('m3dExposure').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setExposure(v); $('m3dExposureVal').textContent = v.toFixed(2) })
$('m3dGround').addEventListener('change', (e) => toggleGround(e.target.checked))
$('m3dAutoRotate').addEventListener('change', (e) => setAutoRotate(e.target.checked))
$('m3dWireframe').addEventListener('change', (e) => setWireframe(e.target.checked))
$('m3dShotBtn').addEventListener('click', screenshot)
$('m3dFullscreenBtn').addEventListener('click', toggleFullscreen)

;(() => {
  const handle = $('m3dResizer'), container = $('material3dContainer')
  if (!handle || !container) return
  let startY = 0, startH = 0
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault()
    startY = e.clientY
    startH = container.offsetHeight
    handle.classList.add('dragging')
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev) => {
      const h = Math.max(180, Math.min(760, startH + (ev.clientY - startY)))
      container.style.height = h + 'px'
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      handle.classList.remove('dragging')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.api.setConfig({ m3dHeight: container.offsetHeight })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
})()

$('m3dHdrBtn').addEventListener('click', async () => {
  const filePath = await window.api.selectHDRFile()
  if (filePath) loadHDREnv(fileUrl(filePath))
})
$('m3dHdrClearBtn').addEventListener('click', () => {
  clearHDREnv()
  const seg = $('m3dLightSeg')
  if (seg) seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.light === 'studio'))
})

$('m3dFormat').addEventListener('change', (e) => { setMaterialFormat(e.target.value); $('m3dFormatDetected').textContent = '' })
setFormatDetectCallback((fmt) => { $('m3dFormatDetected').textContent = fmt === 'labpbr' ? '→ labPBR' : '→ 旧版PBR' })
setHeightDetectCallback((status) => { const el = $('m3dHeightStatus'); if (!el) return; el.classList.remove('has-height', 'no-height'); if (status === 'alpha') { el.textContent = '视差: ✓ 高度图A通道'; el.classList.add('has-height') } else if (status === 'normal') { el.textContent = '视差: 从法线RGB推算（_n.A为法线强度）'; el.classList.add('has-height') } else { el.textContent = '视差: 仅法线'; el.classList.add('no-height') } })

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePreview(); return }
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); searchInput.focus(); return }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo().catch(err => showToast('撤回出错：' + err.message)); return }
  const tag = e.target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  const modal = $('previewModal')
  if (modal.classList.contains('show')) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const rows = [...resultBody.querySelectorAll('tr:not(.folder-group-row):not(.sub-row):not(.empty-row)')]
    if (!rows.length) return
    let idx = rows.findIndex(r => r.classList.contains('row-selected'))
    if (e.key === 'ArrowDown') idx = idx < 0 ? 0 : Math.min(idx + 1, rows.length - 1)
    else idx = idx < 0 ? 0 : Math.max(idx - 1, 0)
    rows[idx].click()
    rows[idx].scrollIntoView({ block: 'nearest' })
  } else if (e.key === 'Enter') {
    const sel = state.selected
    if (sel) { const ent = mainEntryOf(sel); if (ent) window.api.openPath(ent.fullPath) }
  }
})

;(async function init() {
  initSettings()
  initPreview2D()
  await initLayout()

  const cfg = await window.api.getConfig()
  if (cfg.theme === 'dark') applyTheme('dark')
  if (cfg.m3dHeight) { const c = $('material3dContainer'); if (c) c.style.height = cfg.m3dHeight + 'px' }

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
  if (cfg.statusFilter) {
    state.statusFilter = cfg.statusFilter
    document.querySelectorAll('.filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === cfg.statusFilter)
    })
  }
  updateSortIndicators()

  const tasks = []
  if (cfg.leftPath) tasks.push(loadFromPath('left', cfg.leftPath).catch(() => {}))
  if (cfg.rightPath) tasks.push(loadFromPath('right', cfg.rightPath).catch(() => {}))
  await Promise.all(tasks)
  if (state.leftPath && state.rightPath) compare()
  updateUndoBtn()
})()
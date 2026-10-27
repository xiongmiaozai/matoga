/**
 * matoga - 主题编辑器面板
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { t } from '../../i18n.js'
import { showToast } from '../../core.js'
import { initThemes, applyTheme, getRegistry, getActiveId, resolveTokens } from '../../theme/registry.js'

const COLOR_TOKENS = [
  '--bg',
  '--panel-bg',
  '--panel-2',
  '--panel-3',
  '--border',
  '--border-soft',
  '--text',
  '--text-muted',
  '--text-dim',
  '--primary',
  '--primary-hover',
  '--primary-soft',
  '--accent',
  '--accent-hover',
  '--accent-soft',
  '--danger',
  '--danger-soft',
  '--warn',
  '--warn-soft',
  '--partial',
  '--partial-soft',
  '--extra',
  '--extra-soft',
  '--mc-grass',
  '--mc-grass-dark',
  '--mc-stone',
  '--mc-stone-dark',
  '--mc-dirt',
  '--mc-dirt-dark',
  '--mc-diamond',
  '--mc-diamond-dark',
  '--mc-dark',
  '--mc-darker',
  '--mc-border-light',
  '--mc-border-dark'
]
const SIZE_TOKENS = [
  '--radius-sm',
  '--radius-md',
  '--radius',
  '--radius-lg',
  '--radius-xl',
  '--fs-xs',
  '--fs-sm',
  '--fs-md',
  '--fs-base',
  '--fs-lg',
  '--fs-xl',
  '--fs-2xl'
]
const OTHER_TOKENS = ['--ease']

let editing = null
let draftTokens = {}
let draftName = ''
let draftMode = 'light'
let draftBase = 'light'

function isColorVal(v) {
  return typeof v === 'string' && (v.startsWith('#') || v.startsWith('rgb'))
}

function hexify(v) {
  if (!v || typeof v !== 'string') return '#000000'
  if (v.startsWith('#')) return v.length === 7 || v.length === 4 ? v : '#000000'
  return '#000000'
}

function renderGrid() {
  const grid = document.getElementById('themeGrid')
  if (!grid) return
  const reg = getRegistry()
  const active = getActiveId()
  grid.innerHTML = ''
  for (const def of reg.values()) {
    const card = document.createElement('button')
    card.className = 'theme-card' + (def.id === active ? ' active' : '')
    card.dataset.id = def.id
    const swatches = ['--primary', '--accent', '--bg', '--panel-bg']
    const tokens = resolveTokens(def)
    const sw = swatches.map(k => `<span class="theme-sw" style="background:${tokens[k] || '#888'}"></span>`).join('')
    card.innerHTML = `<span class="theme-card-name">${escapeHtml(def.name)}</span><span class="theme-card-sw">${sw}</span>${def.builtin ? '' : '<span class="theme-card-tag">自定义</span>'}`
    card.addEventListener('click', () => {
      applyTheme(def.id)
      renderGrid()
      if (!def.builtin) startEdit(def)
      else stopEdit()
    })
    grid.appendChild(card)
  }
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )
}

function startEdit(def) {
  editing = def
  draftName = def.name
  draftMode = def.mode || 'light'
  draftBase = def.base || 'light'
  draftTokens = { ...(def.tokens || {}) }
  showForm()
}

function startNew() {
  const cur = getRegistry().get(getActiveId()) || { id: 'light', name: '浅色', mode: 'light', tokens: {} }
  editing = null
  draftName = (cur.name || '主题') + ' 副本'
  draftMode = cur.mode || 'light'
  draftBase = cur.builtin ? cur.id : cur.base || 'light'
  draftTokens = { ...(cur.tokens || {}) }
  showForm()
  applyDraft()
}

function stopEdit() {
  editing = null
  const form = document.getElementById('themeEditForm')
  if (form) form.style.display = 'none'
}

function showForm() {
  const form = document.getElementById('themeEditForm')
  if (!form) return
  form.style.display = ''
  const nameInput = document.getElementById('themeNameInput')
  if (nameInput) nameInput.value = draftName
  const modeChk = document.getElementById('themeModeChk')
  if (modeChk) modeChk.checked = draftMode === 'dark'
  renderTokenList('themeColorList', COLOR_TOKENS)
  renderTokenList('themeSizeList', SIZE_TOKENS)
  renderTokenList('themeOtherList', OTHER_TOKENS)
}

function currentResolved() {
  const base = getRegistry().get(draftBase)
  const baseTokens = base ? resolveTokens(base) : {}
  return { ...baseTokens, ...draftTokens }
}

function renderTokenList(containerId, keys) {
  const el = document.getElementById(containerId)
  if (!el) return
  const resolved = currentResolved()
  el.innerHTML = ''
  for (const k of keys) {
    const val = draftTokens[k] !== undefined ? draftTokens[k] : resolved[k] || ''
    const row = document.createElement('div')
    row.className = 'theme-token-row'
    const label = document.createElement('span')
    label.className = 'theme-token-label'
    label.textContent = k
    row.appendChild(label)
    if (isColorVal(val)) {
      const color = document.createElement('input')
      color.type = 'color'
      color.value = hexify(val)
      color.className = 'theme-token-color'
      color.addEventListener('input', () => {
        draftTokens[k] = color.value
        applyDraft()
      })
      row.appendChild(color)
      const text = document.createElement('input')
      text.type = 'text'
      text.value = val
      text.className = 'input-text theme-token-text'
      text.addEventListener('change', () => {
        draftTokens[k] = text.value
        if (isColorVal(text.value)) color.value = hexify(text.value)
        applyDraft()
      })
      row.appendChild(text)
    } else {
      const text = document.createElement('input')
      text.type = 'text'
      text.value = val
      text.className = 'input-text theme-token-text'
      text.addEventListener('input', () => {
        draftTokens[k] = text.value
        applyDraft()
      })
      row.appendChild(text)
    }
    el.appendChild(row)
  }
}

function applyDraft() {
  const mode = draftMode === 'dark' ? 'dark' : 'light'
  const base = getRegistry().get(draftBase)
  const baseTokens = base ? resolveTokens(base) : {}
  const tokens = { ...baseTokens, ...draftTokens }
  document.documentElement.setAttribute('data-theme', mode)
  document.body.setAttribute('data-theme', mode)
  let el = document.getElementById('theme-vars')
  if (!el) {
    el = document.createElement('style')
    el.id = 'theme-vars'
    document.head.appendChild(el)
  }
  const keys = Object.keys(tokens)
  el.textContent = keys.length
    ? `:root[data-theme="${mode}"]{` + keys.map(k => k + ':' + tokens[k]).join(';') + '}'
    : ''
  const gl = document.querySelector('link[data-gl-theme]')
  if (gl) gl.href = '/vendor/golden-layout-css/themes/goldenlayout-' + mode + '-theme.css'

  const f = document.getElementById('nodeFrame')
  if (f && f.contentWindow) {
    try {
      f.contentWindow.postMessage({ type: 'matoga-theme', mode, tokens }, '*')
    } catch {}
  }
}

function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .trim()
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'theme-' + Date.now().toString(36)
  )
}

async function saveDraft() {
  const name = (document.getElementById('themeNameInput') || {}).value || draftName
  draftName = name
  const modeChk = document.getElementById('themeModeChk')
  draftMode = modeChk && modeChk.checked ? 'dark' : 'light'
  const id = editing ? editing.id : slugify(name)
  const def = { name, base: draftBase, mode: draftMode, tokens: draftTokens }
  try {
    const rec = await window.api.saveTheme(id, def)
    await initThemes()
    applyTheme(rec.id)
    editing = getRegistry().get(rec.id)
    renderGrid()
    showToast(t('theme.saved'))
  } catch (e) {
    showToast(t('theme.saveFail', { msg: e.message }))
  }
}

async function deleteCurrent() {
  if (!editing) return
  try {
    await window.api.deleteTheme(editing.id)
    editing = null
    await initThemes()
    applyTheme('light')
    stopEdit()
    renderGrid()
    showToast(t('theme.deleted'))
  } catch (e) {
    showToast(t('theme.deleteFail', { msg: e.message }))
  }
}

function exportCurrent() {
  const def = editing
    ? { ...editing, tokens: draftTokens }
    : { name: draftName, base: draftBase, mode: draftMode, tokens: draftTokens }
  const blob = new Blob([JSON.stringify(def, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = (slugify(def.name) || 'theme') + '.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

async function importFile(file) {
  try {
    const text = await file.text()
    const def = JSON.parse(text)
    const rec = await window.api.importTheme(def)
    await initThemes()
    applyTheme(rec.id)
    renderGrid()
    showToast(t('theme.imported'))
  } catch (e) {
    showToast(t('theme.importFail', { msg: e.message }))
  }
}

export async function init() {
  await initThemes()
  renderGrid()
  const newBtn = document.getElementById('themeNewBtn')
  if (newBtn) newBtn.addEventListener('click', startNew)
  const importBtn = document.getElementById('themeImportBtn')
  const importFileInput = document.getElementById('themeImportFile')
  if (importBtn && importFileInput) {
    importBtn.addEventListener('click', () => importFileInput.click())
    importFileInput.addEventListener('change', () => {
      const f = importFileInput.files && importFileInput.files[0]
      if (f) importFile(f)
      importFileInput.value = ''
    })
  }
  const saveBtn = document.getElementById('themeSaveBtn')
  if (saveBtn) saveBtn.addEventListener('click', saveDraft)
  const delBtn = document.getElementById('themeDeleteBtn')
  if (delBtn) delBtn.addEventListener('click', deleteCurrent)
  const expBtn = document.getElementById('themeExportBtn')
  if (expBtn) expBtn.addEventListener('click', exportCurrent)
  const nameInput = document.getElementById('themeNameInput')
  if (nameInput)
    nameInput.addEventListener('input', () => {
      draftName = nameInput.value
    })
  const modeChk = document.getElementById('themeModeChk')
  if (modeChk)
    modeChk.addEventListener('change', () => {
      draftMode = modeChk.checked ? 'dark' : 'light'
      applyDraft()
    })
}

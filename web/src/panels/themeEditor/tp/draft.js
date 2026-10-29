/**
 * matoga - 主题编辑器面板：草稿编辑与保存
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 panel.js 按职责搬出，逻辑未改。
 */
import { t } from '../../../i18n.js'
import { showToast } from '../../../core.js'
import { initThemes, applyTheme, getRegistry, getActiveId, resolveTokens } from '../../../theme/registry.js'
import { S } from './state.js'
import { renderGrid, renderTokenList } from './grid.js'
import { COLOR_TOKENS, OTHER_TOKENS, SIZE_TOKENS } from './tokens.js'
import { slugify } from './helpers.js'

export function startEdit(def) {
  S.editing = def
  S.draftName = def.name
  S.draftMode = def.mode || 'light'
  S.draftBase = def.base || 'light'
  S.draftTokens = { ...(def.tokens || {}) }
  showForm()
}

export function startNew() {
  const cur = getRegistry().get(getActiveId()) || { id: 'light', name: '浅色', mode: 'light', tokens: {} }
  S.editing = null
  S.draftName = (cur.name || '主题') + ' 副本'
  S.draftMode = cur.mode || 'light'
  S.draftBase = cur.builtin ? cur.id : cur.base || 'light'
  S.draftTokens = { ...(cur.tokens || {}) }
  showForm()
  applyDraft()
}

export function stopEdit() {
  S.editing = null
  const form = document.getElementById('themeEditForm')
  if (form) form.style.display = 'none'
}

export function showForm() {
  const form = document.getElementById('themeEditForm')
  if (!form) return
  form.style.display = ''
  const nameInput = document.getElementById('themeNameInput')
  if (nameInput) nameInput.value = S.draftName
  const modeChk = document.getElementById('themeModeChk')
  if (modeChk) modeChk.checked = S.draftMode === 'dark'
  renderTokenList('themeColorList', COLOR_TOKENS)
  renderTokenList('themeSizeList', SIZE_TOKENS)
  renderTokenList('themeOtherList', OTHER_TOKENS)
}

export function currentResolved() {
  const base = getRegistry().get(S.draftBase)
  const baseTokens = base ? resolveTokens(base) : {}
  return { ...baseTokens, ...S.draftTokens }
}


export function applyDraft() {
  const mode = S.draftMode === 'dark' ? 'dark' : 'light'
  const base = getRegistry().get(S.draftBase)
  const baseTokens = base ? resolveTokens(base) : {}
  const tokens = { ...baseTokens, ...S.draftTokens }
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


export async function saveDraft() {
  const name = (document.getElementById('themeNameInput') || {}).value || S.draftName
  S.draftName = name
  const modeChk = document.getElementById('themeModeChk')
  S.draftMode = modeChk && modeChk.checked ? 'dark' : 'light'
  const id = S.editing ? S.editing.id : slugify(name)
  const def = { name, base: S.draftBase, mode: S.draftMode, tokens: S.draftTokens }
  try {
    const rec = await window.api.saveTheme(id, def)
    await initThemes()
    applyTheme(rec.id)
    S.editing = getRegistry().get(rec.id)
    renderGrid()
    showToast(t('theme.saved'))
  } catch (e) {
    showToast(t('theme.saveFail', { msg: e.message }))
  }
}

export async function deleteCurrent() {
  if (!S.editing) return
  try {
    await window.api.deleteTheme(S.editing.id)
    S.editing = null
    await initThemes()
    applyTheme('light')
    stopEdit()
    renderGrid()
    showToast(t('theme.deleted'))
  } catch (e) {
    showToast(t('theme.deleteFail', { msg: e.message }))
  }
}

export function exportCurrent() {
  const def = S.editing
    ? { ...S.editing, tokens: S.draftTokens }
    : { name: S.draftName, base: S.draftBase, mode: S.draftMode, tokens: S.draftTokens }
  const blob = new Blob([JSON.stringify(def, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = (slugify(def.name) || 'theme') + '.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export async function importFile(file) {
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


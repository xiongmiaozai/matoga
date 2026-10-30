/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { $, showToast } from './core.js'
import { refreshHdrPreset } from './hdri-preset.js'
import { t, setLocale, getLocale, onLocaleChange } from './i18n.js'
import * as themeRegistry from './theme/registry.js'
import { applyThumbPerf } from './model-thumb.js'

export function applyTheme(theme) {
  themeRegistry.applyTheme(theme)
}

export function toggleTheme() {
  themeRegistry.toggleTheme()
}

export function initSettings() {
  const drawer = $('settingsDrawer')
  const btn = $('settingsBtn')
  const close = $('settingsClose')
  if (btn) btn.addEventListener('click', () => drawer.classList.add('open'))
  if (close) close.addEventListener('click', () => drawer.classList.remove('open'))

  if (drawer) {
    drawer.querySelectorAll('[data-settings-close]').forEach(el => {
      el.addEventListener('click', () => drawer.classList.remove('open'))
    })
    drawer.querySelectorAll('.settings-nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const tab = item.dataset.settingsTab
        drawer.querySelectorAll('.settings-nav-item').forEach(n => n.classList.toggle('active', n === item))
        drawer.querySelectorAll('.settings-tab-pane').forEach(p => {
          p.classList.toggle('active', p.dataset.settingsPane === tab)
        })
      })
    })
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) drawer.classList.remove('open')
    })
  }

  const chk = $('settingThemeChk')
  if (chk) chk.addEventListener('change', () => applyTheme(chk.checked ? 'dark' : 'light'))

  const toggle = $('themeToggle')
  if (toggle) toggle.addEventListener('click', toggleTheme)

  initThemeSelect()

  initLanguageSettings()
  initPathSettings()
  initCacheSettings()
}

function initThemeSelect() {
  const sel = $('themeSelect')
  if (!sel) return
  const reg = themeRegistry.getRegistry()
  const active = themeRegistry.getActiveId()
  sel.innerHTML = ''
  const groups = { 内置: [], 自定义: [] }
  for (const def of reg.values()) (def.builtin ? groups['内置'] : groups['自定义']).push(def)
  for (const [label, defs] of Object.entries(groups)) {
    if (!defs.length) continue
    const og = document.createElement('optgroup')
    og.label = label
    for (const def of defs) {
      const opt = document.createElement('option')
      opt.value = def.id
      opt.textContent = def.name
      if (def.id === active) opt.selected = true
      og.appendChild(opt)
    }
    sel.appendChild(og)
  }
  sel.addEventListener('change', () => themeRegistry.applyTheme(sel.value))
}

function initLanguageSettings() {
  const langBtn = $('langBtn')
  if (langBtn)
    langBtn.addEventListener('click', () => {
      setLocale(getLocale() === 'zh' ? 'en' : 'zh')
      window.api.setConfig({ locale: getLocale() })
    })

  const langSeg = $('langSeg')
  if (langSeg) {
    langSeg.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        const lang = b.dataset.lang
        setLocale(lang)
        window.api.setConfig({ locale: lang })
        langSeg.querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.lang === lang))
      })
    })
    onLocaleChange(() => {
      langSeg.querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.lang === getLocale()))
    })
  }
}

function initPathSettings() {
  const items = [
    {
      inputId: 'hdriPresetPathInput',
      pickId: 'hdriPresetPickBtn',
      openId: 'hdriPresetOpenBtn',
      cfgKey: 'hdriPresetPath'
    },
    { inputId: 'mcPacksPathInput', pickId: 'mcPacksPickBtn', openId: 'mcPacksOpenBtn', cfgKey: 'mcPacksPath' },
    {
      inputId: 'officialPacksPathInput',
      pickId: 'officialPacksPickBtn',
      openId: 'officialPacksOpenBtn',
      cfgKey: 'officialPacksPath'
    },
    {
      inputId: 'craftPacksPathInput',
      pickId: 'craftPacksPickBtn',
      openId: 'craftPacksOpenBtn',
      cfgKey: 'craftPacksPath'
    },
    {
      inputId: 'importedModelsPathInput',
      pickId: 'importedModelsPickBtn',
      openId: 'importedModelsOpenBtn',
      cfgKey: 'importedModelsPath'
    },
    {
      inputId: 'nodeProjectsPathInput',
      pickId: 'nodeProjectsPickBtn',
      openId: 'nodeProjectsOpenBtn',
      cfgKey: 'nodeProjectsPath'
    }
  ]
  const savePath = (it, v) => {
    window.api.setConfig({ [it.cfgKey]: v })
    window.api.createFolder(v).catch(() => {})
    if (it.cfgKey === 'hdriPresetPath') refreshHdrPreset()
  }
  window.api.getConfig().then(cfg => {
    items.forEach(it => {
      const input = $(it.inputId)
      if (input && cfg[it.cfgKey]) input.value = cfg[it.cfgKey]
    })
  })
  items.forEach(it => {
    const input = $(it.inputId)
    const pickBtn = $(it.pickId)
    const openBtn = $(it.openId)
    if (pickBtn)
      pickBtn.addEventListener('click', async () => {
        const p = await window.api.pickFolder()
        if (!p) return
        if (input) input.value = p
        savePath(it, p)
        showToast(t('toast.savedPath'))
      })
    if (input)
      input.addEventListener('change', () => {
        const v = input.value.trim()
        if (!v) return
        savePath(it, v)
      })
    if (openBtn)
      openBtn.addEventListener('click', async () => {
        const v = input && input.value.trim()
        if (!v) {
          showToast(t('toast.selectPathFirst'))
          return
        }
        const err = await window.api.openPath(v)
        if (err) showToast(t('toast.openFail', { msg: err }))
      })
  })
}
function formatBytes(n) {
  if (!n || n <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0,
    v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return v.toFixed(v < 10 ? 1 : 0) + ' ' + u[i]
}

function renderCacheRow(key, info) {
  const name = t('cache.' + key)
  const row = document.createElement('div')
  row.className = 'cache-row'
  const isMem = info.kind === 'mem'
  const count = isMem ? info.size : info.files

  row.innerHTML = ''
  const nameEl = document.createElement('span')
  nameEl.className = 'cache-row-name'
  nameEl.textContent = name
  const metaEl = document.createElement('span')
  metaEl.className = 'cache-row-meta'
  metaEl.innerHTML = isMem
    ? '<b>' + count + '</b> ' + t('settings.cacheInMem')
    : '<b>' + count + '</b> · ' + formatBytes(info.bytes)
  const btn = document.createElement('button')
  btn.className = 'btn btn-ghost btn-sm'
  btn.textContent = t('settings.cacheClear')
  btn.disabled = !count
  btn.addEventListener('click', async () => {
    if (!confirm(t('settings.cacheConfirm', { name }))) return
    try {
      await window.api.clearCache(key)
      showToast(t('settings.cacheCleared', { name }))
      await refreshCacheStats()
    } catch (e) {
      showToast(t('settings.cacheCleared', { name }) + ' — ' + e.message)
    }
  })
  row.appendChild(nameEl)
  row.appendChild(metaEl)
  row.appendChild(btn)
  return row
}

async function refreshCacheStats() {
  const list = document.getElementById('cacheList')
  if (!list) return
  let stats
  try {
    stats = await window.api.cacheStats()
  } catch {
    return
  }
  list.innerHTML = ''
  for (const [key, info] of Object.entries(stats)) {
    list.appendChild(renderCacheRow(key, info))
  }
}

function initCacheSettings() {
  const refreshBtn = document.getElementById('cacheRefreshBtn')
  const allBtn = document.getElementById('cacheClearAllBtn')
  const orphansBtn = document.getElementById('cacheHdriOrphansBtn')
  if (refreshBtn) refreshBtn.addEventListener('click', () => refreshCacheStats())
  if (allBtn)
    allBtn.addEventListener('click', async () => {
      if (!confirm(t('settings.cacheConfirmAll'))) return
      try {
        await window.api.clearAllCache()
        showToast(t('settings.cacheAllCleared'))
        await refreshCacheStats()
      } catch (e) {
        showToast(t('settings.cacheAllCleared') + ' — ' + e.message)
      }
    })
  if (orphansBtn)
    orphansBtn.addEventListener('click', async () => {
      try {
        const r = await window.api.cleanupHdriOrphans()
        showToast(t('settings.cacheOrphansCleared', { n: (r && r.removed) || 0 }))
        await refreshCacheStats()
      } catch (e) {
        showToast(e.message)
      }
    })
  refreshCacheStats()
  initPerfSettings()
}

function initPerfSettings() {
  const ranges = [
    { id: 'perfRenderRange', valId: 'perfRenderVal', cfgKey: 'thumbRenderConcurrency', def: 6 },
    { id: 'perfInflightRange', valId: 'perfInflightVal', cfgKey: 'thumbMaxInflight', def: 16 },
    { id: 'perfMarginRange', valId: 'perfMarginVal', cfgKey: 'thumbObserverMargin', def: 400 }
  ]
  window.api.getConfig().then(cfg => {
    for (const r of ranges) {
      const input = $(r.id)
      const val = $(r.valId)
      if (!input) continue
      const v = cfg[r.cfgKey] != null ? cfg[r.cfgKey] : r.def
      input.value = v
      if (val) val.textContent = v
    }
  })
  for (const r of ranges) {
    const input = $(r.id)
    const val = $(r.valId)
    if (!input) continue
    input.addEventListener('input', () => {
      const v = Number(input.value)
      if (val) val.textContent = v
      const patch = { [r.cfgKey]: v }
      window.api.setConfig(patch)
      applyThumbPerf(patch)
    })
  }
}

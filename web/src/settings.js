/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { $, showToast } from './core.js'
import { refreshHdrPreset } from './hdri-preset.js'
import { t, setLocale, getLocale, onLocaleChange, applyI18n } from './i18n.js'

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  document.body.setAttribute('data-theme', theme)
  const toggle = $('themeToggle')
  if (toggle) toggle.innerHTML = theme === 'dark' ? '<svg class="ico"><use href="#i-sun"/></svg>' : '<svg class="ico"><use href="#i-moon"/></svg>'
  const chk = $('settingThemeChk')
  if (chk) chk.checked = theme === 'dark'
  window.api.setConfig({ theme })
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme')
  applyTheme(current === 'dark' ? 'light' : 'dark')
}

export function initSettings() {
  const drawer = $('settingsDrawer')
  const btn = $('settingsBtn')
  const close = $('settingsClose')
  if (btn) btn.addEventListener('click', () => drawer.classList.add('open'))
  if (close) close.addEventListener('click', () => drawer.classList.remove('open'))

  const chk = $('settingThemeChk')
  if (chk) chk.addEventListener('change', () => applyTheme(chk.checked ? 'dark' : 'light'))

  const toggle = $('themeToggle')
  if (toggle) toggle.addEventListener('click', toggleTheme)


  initLanguageSettings()
  initPathSettings()
}

function initLanguageSettings() {
  const langBtn = $('langBtn')
  if (langBtn) langBtn.addEventListener('click', () => {
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
    { inputId: 'hdriPresetPathInput', pickId: 'hdriPresetPickBtn', openId: 'hdriPresetOpenBtn', cfgKey: 'hdriPresetPath' },
    { inputId: 'mcPacksPathInput', pickId: 'mcPacksPickBtn', openId: 'mcPacksOpenBtn', cfgKey: 'mcPacksPath' },
    { inputId: 'officialPacksPathInput', pickId: 'officialPacksPickBtn', openId: 'officialPacksOpenBtn', cfgKey: 'officialPacksPath' }
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
    if (pickBtn) pickBtn.addEventListener('click', async () => {
      const p = await window.api.pickFolder()
      if (!p) return
      if (input) input.value = p
      savePath(it, p)
      showToast(t('toast.savedPath'))
    })
    if (input) input.addEventListener('change', () => {
      const v = input.value.trim()
      if (!v) return
      savePath(it, v)
    })
    if (openBtn) openBtn.addEventListener('click', async () => {
      const v = input && input.value.trim()
      if (!v) { showToast(t('toast.selectPathFirst')); return }
      const err = await window.api.openPath(v)
      if (err) showToast(t('toast.openFail', { msg: err }))
    })
  })
}
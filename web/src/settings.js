/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { $, showToast } from './core.js'
import { refreshHdrPreset } from './hdri-preset.js'
import { t, setLocale, getLocale, onLocaleChange, applyI18n } from './i18n.js'

let themeChangeCallbacks = []

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  document.body.setAttribute('data-theme', theme)
  const toggle = $('themeToggle')
  if (toggle) toggle.innerHTML = theme === 'dark' ? '<svg class="ico"><use href="#i-sun"/></svg>' : '<svg class="ico"><use href="#i-moon"/></svg>'
  const chk = $('settingThemeChk')
  if (chk) chk.checked = theme === 'dark'
  window.api.setConfig({ theme })
  themeChangeCallbacks.forEach(cb => cb(theme))
}

export function onThemeChange(cb) { themeChangeCallbacks.push(cb) }

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
    { inputId: 'hdriPresetPathInput', pickId: 'hdriPresetPickBtn', createId: 'hdriPresetCreateBtn', openId: 'hdriPresetOpenBtn', cfgKey: 'hdriPresetPath' },
    { inputId: 'mcPacksPathInput', pickId: 'mcPacksPickBtn', createId: 'mcPacksCreateBtn', openId: 'mcPacksOpenBtn', cfgKey: 'mcPacksPath' }
  ]
  window.api.getConfig().then(cfg => {
    items.forEach(it => {
      const input = $(it.inputId)
      if (input && cfg[it.cfgKey]) input.value = cfg[it.cfgKey]
    })
  })
  items.forEach(it => {
    const input = $(it.inputId)
    const pickBtn = $(it.pickId)
    const createBtn = $(it.createId)
    const openBtn = $(it.openId)
    const notifyChange = () => { if (it.cfgKey === 'hdriPresetPath') refreshHdrPreset() }
    if (createBtn) createBtn.addEventListener('click', async () => {
      const v = input && input.value.trim()
      if (!v) { showToast(t('toast.inputPathFirst')); return }
      const res = await window.api.createFolder(v)
      if (res && res.success) {
        window.api.setConfig({ [it.cfgKey]: v })
        showToast(t('toast.createdFolder'))
        notifyChange()
      } else {
        showToast(t('toast.createFail', { msg: (res && res.error) ? res.error : t('toast.unknownError') }))
      }
    })
    if (pickBtn) pickBtn.addEventListener('click', async () => {
      const p = await window.api.pickFolder()
      if (!p) return
      if (input) input.value = p
      window.api.setConfig({ [it.cfgKey]: p })
      showToast(t('toast.savedPath'))
      notifyChange()
    })
    if (input) input.addEventListener('change', () => {
      window.api.setConfig({ [it.cfgKey]: input.value.trim() })
      notifyChange()
    })
    if (openBtn) openBtn.addEventListener('click', () => {
      const v = input && input.value.trim()
      if (!v) { showToast(t('toast.selectPathFirst')); return }
      window.api.openPath(v)
    })
  })
}
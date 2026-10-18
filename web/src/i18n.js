/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import zh from './locales/zh.js'
import en from './locales/en.js'

const messages = { zh, en }

let currentLocale = 'zh'

const listeners = new Set()

function interpolate(str, params) {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : `{${k}}`))
}

export function t(key, params) {
  const dict = messages[currentLocale] || messages.zh
  let val = dict[key]
  if (val === undefined) val = messages.zh[key]
  if (val === undefined) return key
  return interpolate(val, params)
}

export function getLocale() {
  return currentLocale
}

export function setLocale(locale) {
  if (!messages[locale] || locale === currentLocale) return
  currentLocale = locale
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  applyI18n(document)
  listeners.forEach((fn) => { try { fn(locale) } catch (e) { console.error(e) } })
}

export function onLocaleChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function applyI18n(root) {
  const scope = root || document
  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n
    const text = t(key)
    if (el.children.length === 0) el.textContent = text
    else {
      const first = el.firstChild
      if (first && first.nodeType === Node.TEXT_NODE) first.textContent = text
      else el.textContent = text
    }
  })
  scope.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle) })
  scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder) })
  scope.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml) })
}

export async function initI18n() {
  let saved = 'zh'
  try {
    const cfg = await window.api.getConfig()
    if (cfg.locale) saved = cfg.locale
  } catch (e) { /* ignore */ }
  currentLocale = messages[saved] ? saved : 'zh'
  document.documentElement.lang = currentLocale === 'zh' ? 'zh-CN' : 'en'
  applyI18n(document)
}
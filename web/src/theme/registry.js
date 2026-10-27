/**
 * matoga - 主题注册/加载/联动
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 启动时从 /api/themes 拉取内置+用户主题，applyTheme 注入 CSS 变量并联动
 * golden-layout 与节点画布 iframe。自定义主题 tokens 覆盖基线主题。
 */

let registry = new Map()
let activeId = 'light'
let sysUnwatch = null
let _initialized = false

export async function initThemes() {
  if (_initialized) return
  try {
    const data = await window.api.listThemes()
    const all = [...(data && data.builtin ? data.builtin : []), ...(data && data.custom ? data.custom : [])]
    registry.clear()
    for (const t of all) registry.set(t.id, t)
  } catch (e) {
    console.error('[theme] init failed', e)
  }
  let cfg = {}
  try {
    cfg = await window.api.getConfig()
  } catch {}
  activeId = registry.has(cfg.theme) ? cfg.theme : 'light'
  applyTheme(activeId)
  if (cfg.themeMode === 'auto') watchSystem()
  _initialized = true
}

export function resolveTokens(def) {
  if (!def) return {}
  const base = def.base && registry.has(def.base) ? registry.get(def.base) : null
  const baseTokens = base ? resolveTokens(base) : {}
  return { ...baseTokens, ...(def.tokens || {}) }
}

export function applyTheme(id) {
  const def = registry.get(id)
  if (!def) return false
  activeId = id
  const mode = def.mode === 'dark' ? 'dark' : 'light'
  const tokens = resolveTokens(def)
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
  syncGoldenLayout(mode)
  syncMcThemeLink(def)
  syncNodeFrame(mode, tokens, isMcTheme(def))
  updateToggleUI(def)
  window.api.setConfig({ theme: id })
  return true
}

function syncGoldenLayout(mode) {
  const link = document.querySelector('link[data-gl-theme]')
  if (!link) return
  link.href = '/vendor/golden-layout-css/themes/goldenlayout-' + mode + '-theme.css'
}

function syncMcThemeLink(def) {
  // mc-theme.css 始终加载（提供组件样式），自定义主题通过 :root[data-theme] 高优先级变量覆盖
  void def
}

function isMcTheme(def) {
  if (!def) return false
  if (def.id === 'mc' || def.id === 'mc-dark') return true
  let cur = def
  while (cur && cur.base) {
    if (cur.base === 'mc' || cur.base === 'mc-dark') return true
    cur = registry.get(cur.base)
  }
  return false
}

function syncNodeFrame(mode, tokens, isMc) {
  const f = document.getElementById('nodeFrame')
  if (f && f.contentWindow) {
    try {
      f.contentWindow.postMessage({ type: 'matoga-theme', mode, tokens, isMc }, '*')
    } catch {}
  }
}

function updateToggleUI(def) {
  const toggle = document.getElementById('themeToggle')
  if (toggle)
    toggle.innerHTML =
      def.mode === 'dark'
        ? '<svg class="ico"><use href="#i-sun"/></svg>'
        : '<svg class="ico"><use href="#i-moon"/></svg>'
  const chk = document.getElementById('settingThemeChk')
  if (chk) chk.checked = def.mode === 'dark'
}

export function toggleTheme() {
  const cur = registry.get(activeId)
  const next = cur && cur.mode === 'dark' ? 'light' : 'dark'
  applyTheme(next)
}

export function getRegistry() {
  return registry
}
export function getActiveId() {
  return activeId
}
export function getTheme(id) {
  return registry.get(id) || null
}

export function watchSystem() {
  if (sysUnwatch) return
  if (!window.matchMedia) return
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    if (activeId === 'light' || activeId === 'dark') {
      applyTheme(mq.matches ? 'dark' : 'light')
    }
  }
  mq.addEventListener('change', apply)
  sysUnwatch = () => mq.removeEventListener('change', apply)
  apply()
}

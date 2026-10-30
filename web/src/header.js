/**
 * matoga - 标题栏多模块控制器
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 模块：A 品牌 · B 菜单 · C 工作区 · D 搜索 · E 工具窗口 · F 快捷入口 · H 状态
 * （G 语言/主题/设置仍由 settings.js 绑定，本文件只处理新增交互）
 */

import { $, showToast } from './core.js'
import { t, onLocaleChange } from './i18n.js'
import { responsive } from './responsive.js'


/* ═══════════════════════════════════════════════════
 * B 菜单栏
 * ═══════════════════════════════════════════════════ */

const MENU_DEFS = {

  help: () => [
    { action: 'about', label: t('menu.about') },
    { action: 'shortcuts', label: t('menu.shortcuts') },
    { sep: true },
    { action: 'github', label: 'GitHub' }
  ]
}

function initMenu() {
  const menu = $('headerMenu')
  const dd = $('menuDropdown')
  if (!menu || !dd) return

  let current = null

  function open(name, anchorEl) {
    const items = (MENU_DEFS[name] || (() => []))()
    dd.innerHTML = ''
    for (const it of items) {
      if (it.sep) {
        const s = document.createElement('div')
        s.className = 'dd-sep'
        dd.appendChild(s)
        continue
      }
      const row = document.createElement('div')
      row.className = 'dd-item'
      row.dataset.action = it.action
      const label = document.createElement('span')
      label.textContent = it.label
      row.appendChild(label)
      if (it.kbd) {
        const k = document.createElement('span')
        k.className = 'dd-kbd'
        k.textContent = it.kbd
        row.appendChild(k)
      }
      row.addEventListener('click', e => {
        e.stopPropagation()
        close()
        handleMenuAction(it.action)
      })
      dd.appendChild(row)
    }
    const rect = anchorEl.getBoundingClientRect()
    const headerRect = menu.parentElement.getBoundingClientRect()
    dd.style.left = rect.left - headerRect.left + 'px'
    dd.hidden = false
    current = name
    anchorEl.classList.add('open')
  }
  function close() {
    dd.hidden = true
    menu.querySelectorAll('.menu-item').forEach(el => el.classList.remove('open'))
    current = null
  }

  menu.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation()
      const action = item.dataset.action
      if (action) {
        close()
        handleMenuAction(action)
        return
      }
      const name = item.dataset.menu
      if (current === name) {
        close()
      } else {
        close()
        open(name, item)
      }
    })
  })
  document.addEventListener('click', close)
  onLocaleChange(() => {
    if (current) close()
  })
}

function handleMenuAction(action) {
  const A = window.matogaActions || {}
  switch (action) {

    case 'about':
      showToast('matoga v3.1 · 材质贴图对比工具')
      break
    case 'shortcuts':
      A.showShortcuts?.()
      break
    case 'github':
      window.open('https://github.com/xiongmiaozai/matoga', '_blank')
      break
    case 'openSettings': {
      const drawer = $('settingsDrawer')
      if (drawer) drawer.classList.add('open')
      break
    }
  }
}

/* ═══════════════════════════════════════════════════


 * H 状态指示
 * ═══════════════════════════════════════════════════ */

function initStatus() {
  const dot = $('statusDot')
  if (!dot) return
  let ok = false
  async function ping() {
    try {
      const res = await fetch('/api/health', { method: 'GET' })
      ok = res.ok
    } catch {
      ok = false
    }
    dot.classList.toggle('err', !ok)
    dot.classList.toggle('warn', false)
    dot.title = ok ? t('header.statusOk') : t('header.statusErr')
  }
  ping()
  setInterval(ping, 30000)
}

/* ═══════════════════════════════════════════════════
 * 入口
 * ═══════════════════════════════════════════════════ */

export function initHeader() {
  initMenu()
  initStatus()
  initResponsiveHeader()
}

function initResponsiveHeader() {
  responsive.applyBodyClasses()
  responsive.onChange((type) => {
    if (type === 'breakpoint-change' || type === 'orientation-change') {
      responsive.applyBodyClasses()
      adaptHeaderToBreakpoint()
    }
  })
}

function adaptHeaderToBreakpoint() {
  const bp = responsive.breakpoint
  const header = document.querySelector('.app-header')
  if (!header) return
  const menu = $('headerMenu')
  const status = $('headerStatus')
  const workspace = $('headerWorkspace')
  if (bp === 'xs') {
    if (menu) menu.classList.add('compact')
    if (status) status.style.display = 'none'
    if (workspace) workspace.classList.add('compact')
  } else if (bp === 'sm') {
    if (menu) menu.classList.add('compact')
    if (status) status.style.display = ''
    if (workspace) workspace.classList.add('compact')
  } else {
    if (menu) menu.classList.remove('compact')
    if (status) status.style.display = ''
    if (workspace) workspace.classList.remove('compact')
  }
}

/**
 * matoga - 面板加载器
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从后端 /api/panels 获取面板清单，逐个动态加载：
 *   1. 注入专属 CSS（<link>）
 *   2. fetch HTML 片段并挂载到 manifest.mount 指定的宿主
 *   3. 动态 import() 面板 JS 并调用其 init()
 * 必须在 workspace.extractPanels() 之前完成，以保证面板 DOM 就位。
 */

import { applyI18n } from './i18n.js'

let _manifests = null


export async function loadPanelManifests() {
  if (_manifests) return _manifests
  try {
    const r = await fetch('/api/panels')
    const j = await r.json()
    _manifests = (j && Array.isArray(j.panels)) ? j.panels : []
  } catch (e) {
    console.error('[panel-loader] fetch manifests failed', e)
    _manifests = []
  }
  return _manifests
}

function resolveMount(mount) {
  if (!mount || mount === 'body') return document.body
  if (mount === 'head') return document.head
  return document.querySelector(mount) || document.body
}

export async function loadPanel(p) {
  try {
    if (p.cssUrl) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = p.cssUrl
      link.dataset.panelId = p.id
      document.head.appendChild(link)
    }

    if (p.htmlUrl && !(window.__panelsInjected && window.__panelsInjected.has(p.id))) {
      const r = await fetch(p.htmlUrl)
      if (!r.ok) throw new Error('面板 ' + p.id + ' HTML 加载失败: ' + r.status)
      const html = await r.text()
      const tpl = document.createElement('template')
      tpl.innerHTML = html.trim()
      const mount = resolveMount(p.mount)
      const useHost = !p.mount || p.mount === 'body' || p.mount === 'head'
      if (useHost) {
        const host = document.createElement('div')
        host.className = 'panel-host'
        host.dataset.panelId = p.id
        host.appendChild(tpl.content.cloneNode(true))
        mount.appendChild(host)
        applyI18n(host)
      } else {
        const frag = tpl.content.cloneNode(true)
        mount.appendChild(frag)
        applyI18n(mount)
      }
    }

    if (p.dynamic && p.jsUrl) {
      const mod = await import(p.jsUrl)
      if (mod && typeof mod.init === 'function') await mod.init()

    }
    return true
  } catch (e) {
    console.error('[panel-loader] load failed', p.id, e)
    return false
  }
}

export async function initPanelLoader() {
  const panels = await loadPanelManifests()
  const byId = new Map(panels.map(p => [p.id, p]))
  const loadedSet = new Set()

  async function loadWithDeps(p) {
    if (loadedSet.has(p.id)) return
    loadedSet.add(p.id)
    for (const depId of (p.deps || [])) {
      const dep = byId.get(depId)
      if (dep) await loadWithDeps(dep)
    }
    await loadPanel(p)
  }

  for (const p of panels) await loadWithDeps(p)
  return panels
}

export function getPanelDefs() {
  return (_manifests || []).map(p => ({ id: p.id, title: p.title, icon: p.icon }))
}
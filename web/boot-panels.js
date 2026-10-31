/**
 * matoga - 首页引导：面板预注入 + 加载 renderer
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 index.html 的内联 <script type="module"> 抽出，逻辑未改。
 * 抽成外链 module 而非经典 script：原代码用了顶层 await 与 import。
 */

// 提前注入面板 DOM：core.js 在模块加载时同步 getElementById 抓取面板内元素，
// 必须在 import renderer.js（及其依赖 core.js）之前完成注入，否则引用为 null。
window.__panelsInjected = new Set()
try {
  const r = await fetch('/api/panels')
  const { panels } = await r.json()
  for (const p of panels) {
    if (!p.htmlUrl) continue
    const hr = await fetch(p.htmlUrl)
    const html = await hr.text()
    const tpl = document.createElement('template')
    tpl.innerHTML = html.trim()
    const sel = p.mount
    const mount =
      !sel || sel === 'body'
        ? document.body
        : sel === 'head'
          ? document.head
          : document.querySelector(sel) || document.body
    const useHost = !sel || sel === 'body' || sel === 'head'
    if (useHost) {
      const host = document.createElement('div')
      host.className = 'panel-host'
      host.dataset.panelId = p.id
      host.appendChild(tpl.content.cloneNode(true))
      mount.appendChild(host)
    } else {
      mount.appendChild(tpl.content.cloneNode(true))
    }
    window.__panelsInjected.add(p.id)
  }
} catch (e) {
  console.error('[pre-inject] failed', e)
}
await import('/renderer.js')

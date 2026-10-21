/**
 * matoga - Promise 化对话框（prompt / confirm 替代）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 原生 window.prompt/confirm 在 Electron 渲染进程中被禁用（返回 undefined
 * 且不显示任何界面），导致「保存工程」等操作点击无反应。本模块以内联样式
 * 模态框实现等价交互，浏览器与 Electron 行为一致：
 *   uiPrompt({title,label,value,placeholder,okText,cancelText}) → Promise<string|null>
 *   uiConfirm({title,message,okText,cancelText,danger})         → Promise<boolean>
 * Enter=确定，Esc/点击遮罩=取消；支持并发叠加（后开在上层）。
 */

const Z_BASE = 90000
let openCount = 0

function _backdrop(z) {
  const el = document.createElement('div')
  el.className = 'ui-dialog-backdrop'
  el.style.cssText = `position:fixed;inset:0;z-index:${z};background:rgba(0,0,0,.45);` +
    'display:flex;align-items:center;justify-content:center;font-family:inherit;'
  return el
}

function _card(title) {
  const card = document.createElement('div')
  card.className = 'ui-dialog'
  card.style.cssText = 'width:min(400px,calc(100vw - 48px));border-radius:10px;' +
    'background:var(--bg2,#1c1f26);color:var(--text,#e8e8e8);border:1px solid var(--border,#333);' +
    'box-shadow:0 12px 40px rgba(0,0,0,.5);padding:14px 16px;box-sizing:border-box;'
  const h = document.createElement('div')
  h.style.cssText = 'font-size:12px;font-weight:600;letter-spacing:.5px;opacity:.9;margin-bottom:10px;'
  h.textContent = title || ''
  card.appendChild(h)
  return { card, head: h }
}

function _buttons(okText, cancelText, danger) {
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px;'
  const mk = (text, primary) => {
    const b = document.createElement('button')
    b.textContent = text
    b.style.cssText = 'padding:5px 16px;border-radius:6px;font-size:12px;cursor:pointer;border:1px solid var(--border,#333);' +
      (primary
        ? (danger
          ? 'background:#c0392b;border-color:#c0392b;color:#fff;'
          : 'background:var(--primary,#2b6cff);border-color:var(--primary,#2b6cff);color:#fff;')
        : 'background:var(--bg,#12141a);color:var(--text,#e8e8e8);')
    return b
  }
  const cancel = mk(cancelText, false)
  const ok = mk(okText, true)
  row.appendChild(cancel)
  row.appendChild(ok)
  return { row, ok, cancel }
}

export function uiPrompt(opts = {}) {
  return new Promise(resolve => {
    const z = Z_BASE + (openCount++) * 10
    const backdrop = _backdrop(z)
    const { card } = _card(opts.title)
    const label = document.createElement('div')
    label.style.cssText = 'font-size:11px;opacity:.75;margin-bottom:6px;'
    label.textContent = opts.label || ''
    if (opts.label) card.appendChild(label)
    const input = document.createElement('input')
    input.type = 'text'
    input.value = opts.value ?? ''
    input.placeholder = opts.placeholder || ''
    input.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 10px;font-size:12px;border-radius:6px;' +
      'border:1px solid var(--border,#333);background:var(--bg,#12141a);color:var(--text,#e8e8e8);outline:none;'
    input.addEventListener('keydown', e => {
      e.stopPropagation()
      if (e.key === 'Enter') finish(input.value)
      else if (e.key === 'Escape') finish(null)
    })
    card.appendChild(input)
    const { row, ok, cancel } = _buttons(opts.okText || '确定', opts.cancelText || '取消', false)
    card.appendChild(row)
    backdrop.appendChild(card)
    let done = false
    function finish(v) {
      if (done) return
      done = true
      openCount--
      document.removeEventListener('keydown', escHandler, true)
      backdrop.remove()
      resolve(v)
    }
    const escHandler = e => { if (e.key === 'Escape') finish(null) }
    document.addEventListener('keydown', escHandler, true)
    ok.addEventListener('click', () => finish(input.value))
    cancel.addEventListener('click', () => finish(null))
    backdrop.addEventListener('pointerdown', e => { if (e.target === backdrop) finish(null) })
    document.body.appendChild(backdrop)
    input.focus()
    input.select()
  })
}

export function uiConfirm(opts = {}) {
  return new Promise(resolve => {
    const z = Z_BASE + (openCount++) * 10
    const backdrop = _backdrop(z)
    const { card } = _card(opts.title)
    const msg = document.createElement('div')
    msg.style.cssText = 'font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;'
    msg.textContent = opts.message || ''
    card.appendChild(msg)
    const { row, ok, cancel } = _buttons(opts.okText || '确定', opts.cancelText || '取消', !!opts.danger)
    card.appendChild(row)
    backdrop.appendChild(card)
    let done = false
    function finish(v) {
      if (done) return
      done = true
      openCount--
      document.removeEventListener('keydown', escHandler, true)
      backdrop.remove()
      resolve(v)
    }
    const escHandler = e => { if (e.key === 'Escape') finish(false) }
    document.addEventListener('keydown', escHandler, true)
    ok.addEventListener('click', () => finish(true))
    cancel.addEventListener('click', () => finish(false))
    backdrop.addEventListener('pointerdown', e => { if (e.target === backdrop) finish(false) })
    document.body.appendChild(backdrop)
    ok.focus()
  })
}
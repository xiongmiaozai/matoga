/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 workspace.js L20-L128 原样搬出（正文逐字未改）。
 */

export function showPrompt(message, defaultValue) {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.className = 'ws-dialog-overlay'
    const dlg = document.createElement('div')
    dlg.className = 'ws-dialog'
    const msg = document.createElement('div')
    msg.className = 'ws-dialog-msg'
    msg.textContent = message
    dlg.appendChild(msg)
    const input = document.createElement('input')
    input.className = 'ws-dialog-input'
    input.value = defaultValue || ''
    dlg.appendChild(input)
    const btns = document.createElement('div')
    btns.className = 'ws-dialog-btns'
    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'ws-dialog-btn'
    cancelBtn.textContent = '取消'
    const okBtn = document.createElement('button')
    okBtn.className = 'ws-dialog-btn primary'
    okBtn.textContent = '确定'
    btns.appendChild(cancelBtn)
    btns.appendChild(okBtn)
    dlg.appendChild(btns)
    overlay.appendChild(dlg)
    document.body.appendChild(overlay)
    input.focus()
    input.select()
    let done = false
    const finish = val => {
      if (done) return
      done = true
      overlay.remove()
      resolve(val)
    }
    okBtn.addEventListener('click', () => finish(input.value))
    cancelBtn.addEventListener('click', () => finish(null))
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        finish(input.value)
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        finish(null)
      }
    })
    overlay.addEventListener('click', e => {
      if (e.target === overlay) finish(null)
    })
  })
}

export function showConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.className = 'ws-dialog-overlay'
    const dlg = document.createElement('div')
    dlg.className = 'ws-dialog'
    const msg = document.createElement('div')
    msg.className = 'ws-dialog-msg'
    msg.textContent = message
    dlg.appendChild(msg)
    const btns = document.createElement('div')
    btns.className = 'ws-dialog-btns'
    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'ws-dialog-btn'
    cancelBtn.textContent = '取消'
    const okBtn = document.createElement('button')
    okBtn.className = 'ws-dialog-btn primary'
    okBtn.textContent = '确定'
    btns.appendChild(cancelBtn)
    btns.appendChild(okBtn)
    dlg.appendChild(btns)
    overlay.appendChild(dlg)
    document.body.appendChild(overlay)
    okBtn.focus()
    let done = false
    const finish = val => {
      if (done) return
      done = true
      overlay.remove()
      resolve(val)
    }
    okBtn.addEventListener('click', () => finish(true))
    cancelBtn.addEventListener('click', () => finish(false))
    overlay.addEventListener('click', e => {
      if (e.target === overlay) finish(false)
    })
    document.addEventListener('keydown', function onKey(e) {
      if (done) {
        document.removeEventListener('keydown', onKey)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        document.removeEventListener('keydown', onKey)
        finish(false)
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        document.removeEventListener('keydown', onKey)
        finish(true)
      }
    })
  })
}

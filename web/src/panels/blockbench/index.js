/**
 * matoga - Blockbench 面板（模块化）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 由 panel-loader 动态加载。export init() 供加载器调用。
 */

import { createFloatingWindow } from '../../floating-window.js'
import { showToast } from '../../core.js'

let _fw = null
let _iframe = null
let _initialized = false

export function init() {
  return initBlockbenchPanel()
}

export function initBlockbenchPanel() {
  if (_initialized) return _fw
  _initialized = true

  const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 800
  _fw = createFloatingWindow({
    id: 'blockbench',
    title: 'Blockbench',
    icon: 'i-cube',
    x: Math.max(16, Math.round(vw * 0.08)),
    y: 72,
    w: Math.min(1024, vw - 32),
    h: Math.min(680, vh - 110),
  })

  _iframe = document.createElement('iframe')
  _iframe.id = 'blockbenchFrameFW'
  _iframe.src = '/blockbench/'
  _iframe.style.cssText = 'width:100%;height:100%;border:0;display:block'
  _iframe.allow = 'clipboard-read; clipboard-write'
  _fw.body.appendChild(_iframe)

  _fw.addToolButton({ icon: 'i-download', title: '推送当前预览贴图到 Blockbench', onClick: pushCurrentTexture })

  document.addEventListener('click', (e) => {
    const launch = e.target.closest && e.target.closest('#bbLaunchBtn, .bb-launch-btn')
    if (launch) { e.preventDefault(); _fw.toggle() }
    const push = e.target.closest && e.target.closest('#bbPushTex')
    if (push) { e.preventDefault(); pushCurrentTexture() }
  })

  return _fw
}

export function toggleBlockbench() {
  if (_fw) _fw.toggle()
}

/* 在 Blockbench 窗口中打开模型（bbmodel / MC .json 模型）：确保窗口已创建并可见后投递给 iframe */
let _pendingModel = null
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'matoga-bridge-ready' && _pendingModel) {
    if (Date.now() > _pendingModel.expires) { _pendingModel = null; return }
    const d = _pendingModel.data
    _pendingModel = null
    postToFrame({ type: 'matoga-open-model', data: d })
  }
})
export function openModelInBlockbench(data) {
  initBlockbenchPanel()
  if (_fw && !_fw.isOpen()) _fw.open()
  /* iframe 首次加载中时 Blockbench 可能未就绪：暂存，等 bridge ready 信号后补投（10s 内有效） */
  _pendingModel = { data, expires: Date.now() + 10000 }
  postToFrame({ type: 'matoga-open-model', data })
}

function getActiveIframe() {
  const panelFrame = document.getElementById('blockbenchFrame')
  if (panelFrame && panelFrame.offsetParent !== null) return panelFrame
  if (_iframe && _fw && _fw.isOpen()) return _iframe
  return panelFrame || _iframe
}
function postToFrame(msg) {
  try { const f = getActiveIframe(); if (f && f.contentWindow) f.contentWindow.postMessage(msg, '*') } catch {}
}

function imgToDataUrl(img) {
  return new Promise((resolve, reject) => {
    if (img.src && img.src.startsWith('data:')) return resolve(img.src)
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => {
      const c = document.createElement('canvas')
      c.width = im.naturalWidth || im.width
      c.height = im.naturalHeight || im.height
      c.getContext('2d').drawImage(im, 0, 0)
      try { resolve(c.toDataURL('image/png')) } catch (e) { reject(e) }
    }
    im.onerror = reject
    im.src = img.src
  })
}

async function pushCurrentTexture() {
  const img = document.querySelector('#previewPanelWrap img, .preview-img, #previewImg, #previewArea img')
  if (!img || !img.src) { showToast('没有可推送的预览贴图'); return }
  try {
    const dataUrl = await imgToDataUrl(img)
    const name = ((img.alt || (img.dataset && img.dataset.name) || 'texture')).replace(/\.[^.]+$/, '')
    const r = await fetch('/api/blockbench/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, dataUrl }),
    })
    const j = await r.json()
    if (j && j.ok) {
      showToast('已推送至 Blockbench')

      postToFrame({ type: 'matoga-texture', name, dataUrl })
    } else {
      showToast('推送失败: ' + (j && j.msg))
    }
  } catch (e) { showToast('推送失败: ' + e.message) }
}
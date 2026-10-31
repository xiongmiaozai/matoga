/**
 * matoga - UV 编辑器：画布绘制
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js L1129-L1340 原样搬出（正文逐字未改）。
 * 绘制需要 ctx / canvas / state 等闭包状态，经 setHooks 注入（只读）。
 */

import { animFrameIndexAt } from '../mc-model-viewer.js'

/* 闭包状态（只读，getter 转发）与闭包内函数（直接注入） */
let _get_ctx = () => null
let _get_canvas = () => null
let _get_canvasWrap = () => null
let _get_state = () => ({})
let _visible = () => true
let _t = k => k
let _loadTexImage = () => null
let _loadTexAnimInfo = () => {}
let _updateStatus = () => {}

export function setHooks(h) {
  if (h.get_ctx) _get_ctx = h.get_ctx
  if (h.get_canvas) _get_canvas = h.get_canvas
  if (h.get_canvasWrap) _get_canvasWrap = h.get_canvasWrap
  if (h.get_state) _get_state = h.get_state
  if (h.visible) _visible = h.visible
  if (h.t) _t = h.t
  if (h.loadTexImage) _loadTexImage = h.loadTexImage
  if (h.loadTexAnimInfo) _loadTexAnimInfo = h.loadTexAnimInfo
  if (h.updateStatus) _updateStatus = h.updateStatus
}

export function draw() {
  if (!_get_ctx() || !_get_canvas() || !_get_canvasWrap() || !_visible()) return
  const layout = _get_state().layout
  if (!layout) {
    showEmpty()
    return
  }

  const tex = layout.textures[_get_state().activeTex]
  if (!tex) {
    showEmpty()
    return
  }
  const removed = !tex.url
  const rec = removed ? null : _loadTexImage(tex.url)
  const img = rec && rec.ok ? rec.img : null
  const texW = img ? img.naturalWidth : layout.uvScale || 16
  const texH = img ? img.naturalHeight : layout.uvScale || 16
  _get_state().texW = texW
  _get_state().texH = texH
  _get_state().uvMaxW = animInfo ? animInfo.frameW : texW
  _get_state().uvMaxH = animInfo ? animInfo.frameH : texH
  /* 动画贴图：按播放时间计算当前帧（暂停时停在当前帧） */
  const animInfo = _loadTexAnimInfo(tex, texW, texH)
  const frameW = animInfo ? animInfo.frameW : texW
  const frameH = animInfo ? animInfo.frameH : texH
  let frameIndex = 0
  if (animInfo) {
    frameIndex = animFrameIndexAt(animInfo, _get_state().animTime)
  }

  const availW = Math.max(_get_canvasWrap().clientWidth - 16, 32)
  const availH = Math.max(_get_canvasWrap().clientHeight - 16, 32)
  let px
  if (_get_state().zoom === 'fit') {
    const f = Math.min(availW / frameW, availH / frameH)
    px = f >= 1 ? Math.max(1, Math.floor(f)) : f
  } else {
    px = _get_state().zoom
  }
  const W = Math.max(Math.round(frameW * px), 1)
  const H = Math.max(Math.round(frameH * px), 1)
  _get_state().px = px

  const dpr = window.devicePixelRatio || 1
  _get_canvas().style.display = ''
  emptyEl.style.display = 'none'
  _get_canvas().style.width = W + 'px'
  _get_canvas().style.height = H + 'px'
  _get_canvas().width = Math.round(W * dpr)
  _get_canvas().height = Math.round(H * dpr)
  _get_ctx().setTransform(dpr, 0, 0, dpr, 0, 0)
  _get_ctx().imageSmoothingEnabled = false

  /* 透明棋盘底 */
  drawCheckerboard(W, H, Math.max(4, Math.round(px * 2)))

  /* 贴图底图（缺失时红斜纹警示；动画贴图取当前帧源区域；已移除仅剩棋盘底） */
  if (img) {
    if (animInfo) _get_ctx().drawImage(img, 0, frameIndex * frameH, frameW, frameH, 0, 0, W, H)
    else _get_ctx().drawImage(img, 0, 0, W, H)
  } else if (!removed) {
    drawMissing(W, H)
  }

  /* uvScale 网格（格子足够大才画，避免过密） */
  const scale = layout.uvScale || 16
  const cell = W / scale
  if (_get_state().grid && cell >= 5) {
    _get_ctx().strokeStyle = 'rgba(128,128,140,.28)'
    _get_ctx().lineWidth = 1
    _get_ctx().beginPath()
    for (let i = 1; i < scale; i++) {
      const p = Math.round(i * cell) + 0.5
      _get_ctx().moveTo(p, 0)
      _get_ctx().lineTo(p, H)
      _get_ctx().moveTo(0, p)
      _get_ctx().lineTo(W, p)
    }
    _get_ctx().stroke()
  }

  /* 面采样矩形（每元素一色；编辑选中面蓝框高亮） */
  _get_state().rects = []
  layout.elements.forEach((el, elIdx) => {
    for (const key in el.faces) {
      const face = el.faces[key]
      if (!face || face.tex !== _get_state().activeTex) continue
      const x = Math.min(face.uv[0], face.uv[2]) * px
      const y = Math.min(face.uv[1], face.uv[3]) * px
      const w = Math.abs(face.uv[2] - face.uv[0]) * px
      const h = Math.abs(face.uv[3] - face.uv[1]) * px
      const hovered = _get_state().hover && _get_state().hover.el === el && _get_state().hover.key === key
      const isSel =
        _get_state().edit &&
        _get_state().selected &&
        _get_state().selected.el === el &&
        _get_state().selected.key === key
      const hue = (elIdx * 47 + 20) % 360
      _get_ctx().fillStyle = `hsla(${hue}, 68%, 62%, ${hovered || isSel ? 0.34 : 0.14})`
      _get_ctx().lineWidth = isSel ? 3 : hovered ? 2.5 : 1.5
      _get_ctx().strokeStyle = isSel ? '#4c8dff' : `hsla(${hue}, 75%, ${hovered ? 70 : 60}%, .95)`
      _get_ctx().fillRect(x, y, w, h)
      _get_ctx().strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
      _get_state().rects.push({ x, y, w, h, el, face, key, elIdx })
      /* 标签（矩形足够大时） */
      const label = `E${elIdx} ${key}` + (face.rotation ? ` ${face.rotation}°` : '') + (face.mirror ? ' ⇄' : '')
      const fs = Math.min(Math.max(9, Math.round(px * 1.4)), 14)
      if (w > 34 && h > fs + 4) {
        _get_ctx().font = `${fs}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
        const tw = _get_ctx().measureText(label).width
        if (tw + 6 < w) {
          _get_ctx().fillStyle = hovered || isSel ? `hsla(${hue}, 80%, 30%, .92)` : `hsla(${hue}, 70%, 22%, .85)`
          _get_ctx().fillRect(x + 1, y + 1, tw + 6, fs + 4)
          _get_ctx().fillStyle = hovered || isSel ? '#fff' : 'rgba(255,255,255,.92)'
          _get_ctx().fillText(label, x + 4, y + fs + 1)
        }
      }
    }
  })

  /* 选中面 8 向缩放手柄（编辑模式） */
  _get_state().handles = []
  if (_get_state().edit && _get_state().selected) {
    const rc = selectedRect()
    if (rc) {
      const defs = [
        ['nw', rc.x, rc.y],
        ['n', rc.x + rc.w / 2, rc.y],
        ['ne', rc.x + rc.w, rc.y],
        ['e', rc.x + rc.w, rc.y + rc.h / 2],
        ['se', rc.x + rc.w, rc.y + rc.h],
        ['s', rc.x + rc.w / 2, rc.y + rc.h],
        ['sw', rc.x, rc.y + rc.h],
        ['w', rc.x, rc.y + rc.h / 2]
      ]
      for (const [mode, hx, hy] of defs) {
        _get_ctx().fillStyle = '#ffffff'
        _get_ctx().strokeStyle = '#1c1c22'
        _get_ctx().lineWidth = 1
        _get_ctx().fillRect(hx - HANDLE_DRAW, hy - HANDLE_DRAW, HANDLE_DRAW * 2, HANDLE_DRAW * 2)
        _get_ctx().strokeRect(hx - HANDLE_DRAW + 0.5, hy - HANDLE_DRAW + 0.5, HANDLE_DRAW * 2 - 1, HANDLE_DRAW * 2 - 1)
        _get_state().handles.push({ x: hx, y: hy, mode })
      }
    }
  }

  /* 播放按钮显隐：仅动画贴图显示 */
  if (playBtn) playBtn.style.display = animInfo ? '' : 'none'

  _updateStatus()

  /* 动画播放 rAF 调度 */
  if (animRafId) {
    cancelAnimationFrame(animRafId)
    animRafId = 0
  }
  if (animInfo && _get_state().animPlaying && _visible()) {
    animRafId = requestAnimationFrame(ts => {
      animRafId = 0
      if (_get_state().animLastTs) _get_state().animTime += (ts - _get_state().animLastTs) / 1000
      _get_state().animLastTs = ts
      draw()
    })
  } else {
    _get_state().animLastTs = 0
  }
}

export function drawCheckerboard(W, H, size) {
  const s = Math.max(4, size)
  _get_ctx().fillStyle = '#3a3a44'
  _get_ctx().fillRect(0, 0, W, H)
  _get_ctx().fillStyle = '#2e2e36'
  for (let y = 0; y < H; y += s) {
    for (let x = ((y / s) % 2) * s; x < W; x += s * 2) {
      _get_ctx().fillRect(x, y, Math.min(s, W - x), Math.min(s, H - y))
    }
  }
}

export function drawMissing(W, H) {
  _get_ctx().fillStyle = 'rgba(120,32,32,.25)'
  _get_ctx().fillRect(0, 0, W, H)
  _get_ctx().strokeStyle = 'rgba(230,74,74,.5)'
  _get_ctx().lineWidth = 2
  _get_ctx().beginPath()
  const step = Math.max(12, W / 8)
  for (let p = -H; p < W; p += step) {
    _get_ctx().moveTo(p, 0)
    _get_ctx().lineTo(p + H, H)
  }
  _get_ctx().stroke()
}

export function showEmpty() {
  if (!_get_canvas() || !emptyEl) return
  _get_canvas().style.display = 'none'
  emptyEl.style.display = ''
  emptyEl.innerHTML = ''
  const title = document.createElement('div')
  title.className = 'uvv-empty-title'
  title.textContent = _t('uv.empty')
  const hint = document.createElement('div')
  hint.className = 'uvv-empty-hint'
  hint.textContent = _t('uv.emptyHint')
  emptyEl.appendChild(title)
  emptyEl.appendChild(hint)
  if (statusEl) statusEl.textContent = ''
}

export function fmtUvNum(v) {
  const n = +v
  return Number.isFinite(n) && !Number.isInteger(n) ? Math.round(n * 100) / 100 : n
}

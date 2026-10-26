/**
 * matoga - UV 编辑器绘制（棋盘底 / 贴图底图 / uvScale 网格 / 面矩形 / 8 向手柄）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出，逻辑未改。
 */

import { HANDLE_DRAW } from './consts.js'
import { drawCheckerboard, drawMissing } from './draw-helpers.js'
import { loadTexImage, loadTexAnimInfo } from './tex-cache.js'

/**
 * 创建画笔。
 * @param {object} o
 * @param {Function} o.getEls       返回 { ctx, canvas, canvasWrap, emptyEl, statusEl }
 * @param {object}   o.state        uv 编辑器 state
 * @param {Function} o.visible      是否可见
 * @param {Function} o.requestDraw  节流重绘
 * @param {Function} o.selectedRect 选中面矩形（编辑手柄用）
 * @param {Function} o.updateStatus 刷新状态栏
 * @param {Function} o.t            i18n
 * @returns {{ draw: Function, showEmpty: Function }}
 */
export function createPainter(o) {
  const { getEls, state, visible, requestDraw, selectedRect, updateStatus, t } = o

  function showEmpty() {
    const { canvas, emptyEl, statusEl } = getEls()
    if (!canvas || !emptyEl) return
    canvas.style.display = 'none'
    emptyEl.style.display = ''
    emptyEl.innerHTML = ''
    const title = document.createElement('div')
    title.className = 'uvv-empty-title'
    title.textContent = t('uv.empty')
    const hint = document.createElement('div')
    hint.className = 'uvv-empty-hint'
    hint.textContent = t('uv.emptyHint')
    emptyEl.appendChild(title)
    emptyEl.appendChild(hint)
    if (statusEl) statusEl.textContent = ''
  }

  function draw() {
    const { ctx, canvas, canvasWrap, emptyEl } = getEls()
    if (!ctx || !canvas || !canvasWrap || !visible()) return
    const layout = state.layout
    if (!layout) { showEmpty(); return }

    const tex = layout.textures[state.activeTex]
    if (!tex) { showEmpty(); return }
    const removed = !tex.url
    const rec = removed ? null : loadTexImage(tex.url, requestDraw)
    const img = rec && rec.ok ? rec.img : null
    const texW = img ? img.naturalWidth : (layout.uvScale || 16)
    const texH = img ? img.naturalHeight : (layout.uvScale || 16)
    /* 动画贴图仅显示首帧（帧 0 顶部区域）：面 UV 坐标即帧内像素坐标 */
    const animInfo = loadTexAnimInfo(tex, texW, texH, requestDraw)
    const frameW = animInfo ? animInfo.frameW : texW
    const frameH = animInfo ? animInfo.frameH : texH

    const availW = Math.max(canvasWrap.clientWidth - 16, 32)
    const availH = Math.max(canvasWrap.clientHeight - 16, 32)
    let px
    if (state.zoom === 'fit') {
      const f = Math.min(availW / frameW, availH / frameH)
      px = f >= 1 ? Math.max(1, Math.floor(f)) : f
    } else {
      px = state.zoom
    }
    const W = Math.max(Math.round(frameW * px), 1)
    const H = Math.max(Math.round(frameH * px), 1)
    state.px = px

    const dpr = window.devicePixelRatio || 1
    canvas.style.display = ''
    emptyEl.style.display = 'none'
    canvas.style.width = W + 'px'
    canvas.style.height = H + 'px'
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = false

    /* 透明棋盘底 */
    drawCheckerboard(ctx, W, H, Math.max(4, Math.round(px * 2)))

    /* 贴图底图（缺失时红斜纹警示；动画贴图取首帧源区域；已移除仅剩棋盘底） */
    if (img) {
      if (animInfo) ctx.drawImage(img, 0, 0, frameW, frameH, 0, 0, W, H)
      else ctx.drawImage(img, 0, 0, W, H)
    } else if (!removed) {
      drawMissing(ctx, W, H)
    }

    /* uvScale 网格（格子足够大才画，避免过密） */
    const scale = layout.uvScale || 16
    const cell = W / scale
    if (state.grid && cell >= 5) {
      ctx.strokeStyle = 'rgba(128,128,140,.28)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 1; i < scale; i++) {
        const p = Math.round(i * cell) + .5
        ctx.moveTo(p, 0); ctx.lineTo(p, H)
        ctx.moveTo(0, p); ctx.lineTo(W, p)
      }
      ctx.stroke()
    }

    /* 面采样矩形（每元素一色；编辑选中面蓝框高亮） */
    state.rects = []
    layout.elements.forEach((el, elIdx) => {
      for (const key in el.faces) {
        const face = el.faces[key]
        if (!face || face.tex !== state.activeTex) continue
        const x = Math.min(face.uv[0], face.uv[2]) * px
        const y = Math.min(face.uv[1], face.uv[3]) * px
        const w = Math.abs(face.uv[2] - face.uv[0]) * px
        const h = Math.abs(face.uv[3] - face.uv[1]) * px
        const hovered = state.hover && state.hover.el === el && state.hover.key === key
        const isSel = state.edit && state.selected && state.selected.el === el && state.selected.key === key
        const hue = (elIdx * 47 + 20) % 360
        ctx.fillStyle = `hsla(${hue}, 68%, 62%, ${(hovered || isSel) ? .34 : .14})`
        ctx.lineWidth = isSel ? 3 : (hovered ? 2.5 : 1.5)
        ctx.strokeStyle = isSel ? '#4c8dff' : `hsla(${hue}, 75%, ${hovered ? 70 : 60}%, .95)`
        ctx.fillRect(x, y, w, h)
        ctx.strokeRect(x + .5, y + .5, w - 1, h - 1)
        state.rects.push({ x, y, w, h, el, face, key, elIdx })
        /* 标签（矩形足够大时） */
        const label = `E${elIdx} ${key}` + (face.rotation ? ` ${face.rotation}°` : '') + (face.mirror ? ' ⇄' : '')
        const fs = Math.min(Math.max(9, Math.round(px * 1.4)), 14)
        if (w > 34 && h > fs + 4) {
          ctx.font = `${fs}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
          const tw = ctx.measureText(label).width
          if (tw + 6 < w) {
            ctx.fillStyle = (hovered || isSel) ? `hsla(${hue}, 80%, 30%, .92)` : `hsla(${hue}, 70%, 22%, .85)`
            ctx.fillRect(x + 1, y + 1, tw + 6, fs + 4)
            ctx.fillStyle = (hovered || isSel) ? '#fff' : 'rgba(255,255,255,.92)'
            ctx.fillText(label, x + 4, y + fs + 1)
          }
        }
      }
    })

    /* 选中面 8 向缩放手柄（编辑模式） */
    state.handles = []
    if (state.edit && state.selected) {
      const rc = selectedRect()
      if (rc) {
        const defs = [
          ['nw', rc.x, rc.y], ['n', rc.x + rc.w / 2, rc.y], ['ne', rc.x + rc.w, rc.y],
          ['e', rc.x + rc.w, rc.y + rc.h / 2], ['se', rc.x + rc.w, rc.y + rc.h],
          ['s', rc.x + rc.w / 2, rc.y + rc.h], ['sw', rc.x, rc.y + rc.h], ['w', rc.x, rc.y + rc.h / 2],
        ]
        for (const [mode, hx, hy] of defs) {
          ctx.fillStyle = '#ffffff'
          ctx.strokeStyle = '#1c1c22'
          ctx.lineWidth = 1
          ctx.fillRect(hx - HANDLE_DRAW, hy - HANDLE_DRAW, HANDLE_DRAW * 2, HANDLE_DRAW * 2)
          ctx.strokeRect(hx - HANDLE_DRAW + .5, hy - HANDLE_DRAW + .5, HANDLE_DRAW * 2 - 1, HANDLE_DRAW * 2 - 1)
          state.handles.push({ x: hx, y: hy, mode })
        }
      }
    }

    updateStatus()
  }

  return { draw, showEmpty }
}

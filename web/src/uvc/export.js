/**
 * matoga - UV 编辑器：导出
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出（正文逐字未改）。
 * 依赖的闭包状态经 setHooks 注入（只读）。
 */

/* 闭包状态（只读，getter 转发） */
let _get_state = () => ({})
let _t = k => k
let _get_hooks = () => ({})

export function setHooks(h) {
  if (h.get_state) _get_state = h.get_state
  if (h.t) _t = h.t
  if (h.get_hooks) _get_hooks = h.get_hooks
}

export function exportModel() {
  let r = null
  try {
    r = typeof _get_hooks().exportJson === 'function' ? _get_hooks().exportJson() : null
  } catch {}
  if (!r || !r.json) return
  try {
    const blob = new Blob([JSON.stringify(r.json, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = r.filename || 'model.json'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url)
      } catch {}
    }, 4000)
  } catch (e) {
    console.error('[uv-editor] export', e)
  }
}

export function exportUvTemplate() {
  const layout = _get_state().layout
  if (!layout) return
  const tex = layout.textures[_get_state().activeTex]
  if (!tex) return
  const rec = imgCache.get(tex.url)
  const W = rec && rec.ok && rec.img ? rec.img.naturalWidth : layout.uvScale || 16
  const H = rec && rec.ok && rec.img ? rec.img.naturalHeight : layout.uvScale || 16
  try {
    const off = document.createElement('canvas')
    off.width = W
    off.height = H
    const c = off.getContext('2d')
    if (!c) return
    c.clearRect(0, 0, W, H)
    /* uvScale 网格（淡线） */
    const scale = layout.uvScale || 16
    const cell = W / scale
    if (cell >= 1) {
      c.strokeStyle = 'rgba(128,128,140,.35)'
      c.lineWidth = 1
      c.beginPath()
      for (let i = 1; i < scale; i++) {
        const p = Math.round(i * cell) + 0.5
        c.moveTo(p, 0)
        c.lineTo(p, H)
        c.moveTo(0, p)
        c.lineTo(W, p)
      }
      c.stroke()
    }
    /* 面矩形（每元素一色） */
    layout.elements.forEach((el, elIdx) => {
      for (const key in el.faces) {
        const face = el.faces[key]
        if (!face || face.tex !== _get_state().activeTex) continue
        const x = Math.min(face.uv[0], face.uv[2])
        const y = Math.min(face.uv[1], face.uv[3])
        const w = Math.abs(face.uv[2] - face.uv[0])
        const h = Math.abs(face.uv[3] - face.uv[1])
        const hue = (elIdx * 47 + 20) % 360
        c.fillStyle = `hsla(${hue}, 68%, 62%, .25)`
        c.fillRect(x, y, w, h)
        c.strokeStyle = `hsla(${hue}, 75%, 75%, .95)`
        c.lineWidth = 1
        c.strokeRect(x + 0.5, y + 0.5, Math.max(w - 1, 0.5), Math.max(h - 1, 0.5))
        /* 标签（矩形足够大时） */
        const label = `E${elIdx} ${key}`
        if (w >= 12 && h >= 7) {
          c.font = '5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
          c.fillStyle = `hsla(${hue}, 80%, 85%, .95)`
          c.fillText(label, x + 1, y + 5)
        }
      }
    })
    if (typeof off.toBlob !== 'function') return
    off.toBlob(blob => {
      if (!blob) return
      try {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = String(tex.name || 'texture').replace(/[\/\\]/g, '_') + '_uv_template.png'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => {
          try {
            URL.revokeObjectURL(url)
          } catch {}
        }, 4000)
      } catch (e) {
        console.error('[uv-editor] template download', e)
      }
    }, 'image/png')
  } catch (e) {
    console.error('[uv-editor] template', e)
  }
}

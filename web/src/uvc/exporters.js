/**
 * matoga - UV 编辑器导出（模型 JSON / UV 线框模板 PNG）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出，逻辑未改。
 */

import { imgCache } from './tex-cache.js'

/** 触发浏览器下载（blob URL，4s 后回收） */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => { try { URL.revokeObjectURL(url) } catch {} }, 4000)
}

/**
 * 导出编辑后的模型 JSON（数据由宿主的 exportJson 钩子提供）。
 * @param {object} hooks { exportJson?: () => { json, filename } | null }
 */
export function exportModel(hooks) {
  let r = null
  try { r = (hooks && typeof hooks.exportJson === 'function') ? hooks.exportJson() : null } catch {}
  if (!r || !r.json) return
  try {
    const blob = new Blob([JSON.stringify(r.json, null, 2)], { type: 'application/json' })
    downloadBlob(blob, r.filename || 'model.json')
  } catch (e) { console.error('[uv-editor] export', e) }
}

/**
 * UV 线框模板导出（透明底 PNG，画师填色用）。
 * 与贴图同尺寸 1:1 输出：uvScale 网格 + 每元素面矩形（元素色描边 +
 * 低透明度填充 + 面标签），可直接垫在像素画软件的底图层。
 *
 * @param {object} layout  当前 layout
 * @param {number} activeTex 当前贴图槽位索引
 */
export function exportUvTemplate(layout, activeTex) {
  if (!layout) return
  const tex = layout.textures[activeTex]
  if (!tex) return
  const rec = imgCache.get(tex.url)
  const W = (rec && rec.ok && rec.img) ? rec.img.naturalWidth : (layout.uvScale || 16)
  const H = (rec && rec.ok && rec.img) ? rec.img.naturalHeight : (layout.uvScale || 16)
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
        const p = Math.round(i * cell) + .5
        c.moveTo(p, 0); c.lineTo(p, H)
        c.moveTo(0, p); c.lineTo(W, p)
      }
      c.stroke()
    }
    /* 面矩形（每元素一色） */
    layout.elements.forEach((el, elIdx) => {
      for (const key in el.faces) {
        const face = el.faces[key]
        if (!face || face.tex !== activeTex) continue
        const x = Math.min(face.uv[0], face.uv[2])
        const y = Math.min(face.uv[1], face.uv[3])
        const w = Math.abs(face.uv[2] - face.uv[0])
        const h = Math.abs(face.uv[3] - face.uv[1])
        const hue = (elIdx * 47 + 20) % 360
        c.fillStyle = `hsla(${hue}, 68%, 62%, .25)`
        c.fillRect(x, y, w, h)
        c.strokeStyle = `hsla(${hue}, 75%, 75%, .95)`
        c.lineWidth = 1
        c.strokeRect(x + .5, y + .5, Math.max(w - 1, 0.5), Math.max(h - 1, 0.5))
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
    off.toBlob((blob) => {
      if (!blob) return
      try {
        downloadBlob(blob, String(tex.name || 'texture').replace(/[\/\\]/g, '_') + '_uv_template.png')
      } catch (e) { console.error('[uv-editor] template download', e) }
    }, 'image/png')
  } catch (e) { console.error('[uv-editor] template', e) }
}

/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { $ } from './core.js'

let channel = 'all'
let zoom = 100
let split = false
let filter2d = 'smooth'

function applyFilter2d(img) {
  img.style.imageRendering = filter2d === 'pixel' ? 'pixelated' : 'auto'
}

function getOriginalSrc(img) {
  if (!img.dataset.origSrc) img.dataset.origSrc = img.src
  return img.dataset.origSrc
}

function applyChannel(img) {
  const orig = getOriginalSrc(img)
  if (channel === 'all') { if (img.src !== orig) img.src = orig; return }
  const tmp = new Image()
  tmp.onload = () => {
    const c = document.createElement('canvas')
    c.width = tmp.naturalWidth; c.height = tmp.naturalHeight
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(tmp, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    const ci = { r: 0, g: 1, b: 2, a: 3 }[channel]
    for (let i = 0; i < d.length; i += 4) {
      let v
      if (channel === 'a') v = d[i + 3]
      else v = d[i + ci]
      d[i] = (channel === 'r' || channel === 'a') ? v : 0
      d[i + 1] = (channel === 'g' || channel === 'a') ? v : 0
      d[i + 2] = (channel === 'b' || channel === 'a') ? v : 0
      d[i + 3] = 255
    }
    ctx.putImageData(new ImageData(d, c.width, c.height), 0, 0)
    img.src = c.toDataURL()
  }
  tmp.src = orig
}

function applyZoom(img) {
  img.style.maxWidth = zoom + '%'
  img.style.maxHeight = zoom + '%'
  const cell = img.closest('.pv-cell')
  if (cell) cell.style.overflow = zoom > 100 ? 'auto' : 'hidden'
}

function applySplitToRow(row) {
  const cells = row.querySelectorAll('.pv-cell')
  if (cells.length < 2) return
  const leftImg = cells[0].querySelector('img')
  const rightImg = cells[1].querySelector('img')
  if (!leftImg || !rightImg) return
  if (split) {
    if (row.dataset.splitApplied) return
    row.dataset.splitApplied = '1'
    row.style.gridTemplateColumns = '1fr'
    row.style.position = 'relative'
    row.style.aspectRatio = '1'
    cells[0].style.position = 'absolute'
    cells[0].style.inset = '0'
    cells[1].style.position = 'absolute'
    cells[1].style.inset = '0'
    cells[1].style.clipPath = 'inset(0 0 0 50%)'
    const handle = document.createElement('div')
    handle.className = 'pv-split-handle'
    handle.style.left = '50%'
    row.appendChild(handle)
    let dragging = false
    const onMove = (e) => {
      if (!dragging) return
      const rect = row.getBoundingClientRect()
      const x = Math.max(0, Math.min(rect.width, (e.clientX - rect.left)))
      const pct = (x / rect.width * 100)
      cells[1].style.clipPath = `inset(0 0 0 ${pct}%)`
      handle.style.left = pct + '%'
    }
    const onUp = () => { dragging = false; document.body.style.userSelect = '' }
    handle.addEventListener('mousedown', () => { dragging = true; document.body.style.userSelect = 'none' })
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    row._splitCleanup = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  } else {
    if (!row.dataset.splitApplied) return
    delete row.dataset.splitApplied
    if (row._splitCleanup) { row._splitCleanup(); row._splitCleanup = null }
    row.style.gridTemplateColumns = ''
    row.style.position = ''
    row.style.aspectRatio = ''
    cells[0].style.position = ''; cells[0].style.inset = ''
    cells[1].style.position = ''; cells[1].style.inset = ''; cells[1].style.clipPath = ''
    const h = row.querySelector('.pv-split-handle')
    if (h) h.remove()
  }
}

export function enhancePreview() {
  const panel = $('previewPanel')
  if (!panel) return
  panel.querySelectorAll('.pv-cell img').forEach(img => {
    applyChannel(img)
    applyZoom(img)
    applyFilter2d(img)
  })
  panel.querySelectorAll('.pv-row').forEach(applySplitToRow)
}

export function initPreview2D() {
  const seg = $('pvChannelSeg')
  if (seg) seg.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(x => x.classList.remove('active'))
      b.classList.add('active')
      channel = b.dataset.ch
      enhancePreview()
    })
  })
  const z = $('pvZoom')
  if (z) z.addEventListener('input', () => {
    zoom = parseInt(z.value)
    const v = $('pvZoomVal'); if (v) v.textContent = zoom + '%'
    enhancePreview()
  })
  const s = $('pvSplit')
  if (s) s.addEventListener('change', () => { split = s.checked; enhancePreview() })
  const pf = $('pvFilterSeg')
  if (pf) pf.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      pf.querySelectorAll('button').forEach(x => x.classList.remove('active'))
      b.classList.add('active')
      filter2d = b.dataset.pvf
      enhancePreview()
    })
  })
}
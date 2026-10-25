/**
 * matoga - node canvas viewport
 * Copyright (c) 2026 芝世 (xiongmiaozai). MIT
 *
 * Pan/zoom viewport, screen-to-world mapping, and the minimap navigator.
 *
 * The minimap needs each node's accent colour, which lives in NODE_DEFS in the
 * editor. Instead of importing the whole editor (circular), the editor injects
 * a colour resolver via `setNodeColorResolver`.
 */

import { state } from './state.js'

const $ = (s) => document.querySelector(s)

const canvasWrap = $('#canvas-wrap')
const world = $('#world')
const gridBg = $('#grid-bg')

let _nodeColorResolver = () => '#888'

/** Inject how to read a node's accent colour (called once by the editor). */
export function setNodeColorResolver(fn) {
  if (typeof fn === 'function') _nodeColorResolver = fn
}

export function applyViewport() {
  const { x, y, zoom } = state.viewport
  world.style.transform = `translate(${x}px,${y}px) scale(${zoom})`
  // 网格（点阵）随缩放平移
  const g = 24 * zoom, G = 120 * zoom
  gridBg.style.backgroundSize = `${g}px ${g}px, ${G}px ${G}px`
  gridBg.style.backgroundPosition = `${x}px ${y}px, ${x}px ${y}px`
  const pct = Math.round(zoom * 100) + '%'
  $('#zoom-label').textContent = pct
  $('#stat-zoom').textContent = pct
  updateMinimap()
}

export function screenToWorld(sx, sy) {
  const r = canvasWrap.getBoundingClientRect()
  const { x, y, zoom } = state.viewport
  return { x: (sx - r.left - x) / zoom, y: (sy - r.top - y) / zoom }
}

export function setZoom(z, cx, cy) {
  z = Math.max(0.2, Math.min(3, z))
  const r = canvasWrap.getBoundingClientRect()
  cx = (cx ?? r.left + r.width / 2) - r.left
  cy = (cy ?? r.top + r.height / 2) - r.top
  const { x, y, zoom } = state.viewport
  const wx = (cx - x) / zoom, wy = (cy - y) / zoom
  state.viewport.zoom = z
  state.viewport.x = cx - wx * z
  state.viewport.y = cy - wy * z
  applyViewport()
}

/* ── minimap navigation ────────────────────────────────────────── */
let _minimapEl = null, _minimapCanvas = null, _minimapVp = null, _minimapEmpty = null
let _minimapMap = null // {scale, offX, offY} world -> minimap mapping

function _buildMinimap() {
  if (_minimapEl) return
  _minimapEl = document.createElement('div')
  _minimapEl.className = 'nc-minimap'
  _minimapCanvas = document.createElement('canvas')
  _minimapCanvas.className = 'nc-minimap-canvas'
  _minimapVp = document.createElement('div')
  _minimapVp.className = 'nc-minimap-vp'
  _minimapEmpty = document.createElement('div')
  _minimapEmpty.className = 'nc-minimap-empty'
  _minimapEmpty.textContent = '小地图'
  _minimapEl.appendChild(_minimapCanvas)
  _minimapEl.appendChild(_minimapVp)
  _minimapEl.appendChild(_minimapEmpty)
  canvasWrap.appendChild(_minimapEl)

  let dragging = false
  const moveTo = (e) => {
    if (!_minimapMap) return
    const cr = _minimapCanvas.getBoundingClientRect()
    const mx = e.clientX - cr.left
    const wy = e.clientY - cr.top
    const { scale, offX, offY } = _minimapMap
    const wx = (mx - offX) / scale
    const wy2 = (wy - offY) / scale
    const wrapR = canvasWrap.getBoundingClientRect()
    const { zoom } = state.viewport
    state.viewport.x = wrapR.width / 2 - wx * zoom
    state.viewport.y = wrapR.height / 2 - wy2 * zoom
    applyViewport()
  }
  _minimapEl.addEventListener('pointerdown', (e) => {
    dragging = true
    try { _minimapEl.setPointerCapture(e.pointerId) } catch (_) {}
    moveTo(e)
    e.stopPropagation()
  })
  _minimapEl.addEventListener('pointermove', (e) => { if (dragging) { moveTo(e); e.stopPropagation() } })
  _minimapEl.addEventListener('pointerup', (e) => { dragging = false; try { _minimapEl.releasePointerCapture(e.pointerId) } catch (_) {} })
  _minimapEl.addEventListener('pointercancel', () => { dragging = false })
}

export function updateMinimap() {
  if (!_minimapEl) _buildMinimap()
  const W = 160, H = 110
  const dpr = window.devicePixelRatio || 1
  if (_minimapCanvas.width !== W * dpr) { _minimapCanvas.width = W * dpr; _minimapCanvas.height = H * dpr }
  const ctx = _minimapCanvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)

  const nodes = [...state.nodes.values()]
  if (nodes.length === 0) {
    if (_minimapEmpty) _minimapEmpty.style.display = 'flex'
    if (_minimapVp) _minimapVp.style.display = 'none'
    return
  }
  if (_minimapEmpty) _minimapEmpty.style.display = 'none'
  if (_minimapVp) _minimapVp.style.display = 'block'

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    if (n.x < minX) minX = n.x
    if (n.y < minY) minY = n.y
    const w = 160, h = 60
    if (n.x + w > maxX) maxX = n.x + w
    if (n.y + h > maxY) maxY = n.y + h
  }
  const pad = 40
  minX -= pad; minY -= pad; maxX += pad; maxY += pad
  const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY)
  const scale = Math.min(W / bw, H / bh)
  const offX = (W - bw * scale) / 2 - minX * scale
  const offY = (H - bh * scale) / 2 - minY * scale
  _minimapMap = { scale, offX, offY }

  for (const n of nodes) {
    const color = _nodeColorResolver(n)
    ctx.fillStyle = color
    const x = n.x * scale + offX
    const y = n.y * scale + offY
    ctx.fillRect(x, y, Math.max(2, 160 * scale), Math.max(1.5, 60 * scale))
  }

  // viewport rectangle
  const wrapR = canvasWrap.getBoundingClientRect()
  const { x: vpX, y: vpY, zoom } = state.viewport
  const fN = (v) => v * scale
  const fx = vpX * scale + offX
  const fy = vpY * scale + offY
  const fw = (wrapR.width / zoom) * scale
  const fh = (wrapR.height / zoom) * scale
  if (_minimapVp) {
    _minimapVp.style.left = fx + 'px'
    _minimapVp.style.top = fy + 'px'
    _minimapVp.style.width = fw + 'px'
    _minimapVp.style.height = fh + 'px'
  }
}

export { canvasWrap, world, gridBg }

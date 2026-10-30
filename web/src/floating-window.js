/**
 * matoga - 页面内浮动窗口（可自由拖拽摆放）
 * 带标题栏的独立小窗：按住标题栏拖到任意位置、右下角缩放、
 * 点击置顶、双击标题栏最大化/还原、关闭后可由外部按钮重新打开，
 * 几何位置经 localStorage 记忆。
 */

import { responsive } from './responsive.js'

let _zTop = 420
const _windows = new Map()   // id -> win api

const MIN_W = 240
const MIN_H = 160

function storage(){ return (typeof localStorage !== 'undefined') ? localStorage : null }
function loadGeom(id, fallback){
  const s = storage()
  if(!s) return null
  try{
    const raw = s.getItem('matoga.fw.' + id)
    if(!raw) return null
    const g = JSON.parse(raw)
    if(typeof g.x !== 'number' || typeof g.y !== 'number') return null
    return {
      x: g.x, y: g.y,
      w: Math.max(MIN_W, g.w || fallback.w),
      h: Math.max(MIN_H, g.h || fallback.h),
      open: g.open !== false,
      maximized: !!g.maximized,
    }
  }catch(e){ return null }
}
function saveGeom(id, patch){
  const s = storage()
  if(!s) return
  try{
    const cur = _windows.get(id)
    if(!cur) return
    const geom = { ...cur._geom, ...patch }
    cur._geom = geom
    s.setItem('matoga.fw.' + id, JSON.stringify(geom))
  }catch(e){}
}

function clampToViewport(x, y, w, h){
  const vw = window.innerWidth || 1280
  const vh = window.innerHeight || 800
  const x2 = Math.min(Math.max(8, x), Math.max(8, vw - Math.min(w, vw) - 8))
  const y2 = Math.min(Math.max(8, y), Math.max(8, vh - 80))
  return { x: x2, y: y2 }
}

export function createFloatingWindow(opts){
  const { id, title, icon, x, y, w, h, open: openDefault = true } = opts
  if(_windows.has(id)) return _windows.get(id)

  const win = document.createElement('div')
  win.className = 'fw-win'
  win.dataset.fwId = id

  const saved = loadGeom(id, { x, y, w, h })
  const base = saved || { x, y, w, h, open: openDefault, maximized: false }
  const geom = {
    x: base.x, y: base.y,
    w: Math.max(MIN_W, base.w), h: Math.max(MIN_H, base.h),
    open: base.open, maximized: !!base.maximized,
    restore: null,   // 最大化前的几何
  }

  /* ── 标题栏 ── */
  const bar = document.createElement('div')
  bar.className = 'fw-titlebar'
  const titleEl = document.createElement('div')
  titleEl.className = 'fw-title'
  if(icon){
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'ico ico-sm')
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    use.setAttribute('href', '#' + icon)
    svg.appendChild(use)
    titleEl.appendChild(svg)
  }
  const label = document.createElement('span')
  label.textContent = title
  titleEl.appendChild(label)
  bar.appendChild(titleEl)

  const tools = document.createElement('div')
  tools.className = 'fw-tools'
  const closeBtn = document.createElement('button')
  closeBtn.className = 'fw-btn fw-close'
  closeBtn.title = '✕'
  closeBtn.innerHTML = '<svg class="ico ico-sm"><use href="#i-x"/></svg>'
  tools.appendChild(closeBtn)
  bar.appendChild(tools)
  win.appendChild(bar)

  function addToolButton({ icon, title, onClick }){
    const btn = document.createElement('button')
    btn.className = 'fw-btn'
    btn.title = title || ''
    btn.innerHTML = `<svg class="ico ico-sm"><use href="#${icon}"/></svg>`
    btn.addEventListener('click', (e) => { e.stopPropagation(); if(onClick) onClick() })
    tools.insertBefore(btn, closeBtn)
    return btn
  }

  /* ── 内容区 ── */
  const body = document.createElement('div')
  body.className = 'fw-body'
  win.appendChild(body)

  /* ── 缩放手柄 ── */
  const resize = document.createElement('div')
  resize.className = 'fw-resize'
  win.appendChild(resize)

  /* ── API ── */
  const api = {
    id, win, body, bar,
    _geom: geom,
    addToolButton,
    isOpen(){ return win.style.display !== 'none' },
    open(){
      win.style.display = ''
      if(!geom.open) saveGeom(id, { open: true })
      geom.open = true
      focus()
      if(api.onToggle) api.onToggle(true)
      notifyToggle(true)
    },
    close(){
      win.style.display = 'none'
      saveGeom(id, { open: false })
      geom.open = false
      if(api.onToggle) api.onToggle(false)
      notifyToggle(false)
    },
    toggle(){ api.isOpen() ? api.close() : api.open() },
    setTitle(text){ label.textContent = text },
    isMaximized(){ return !!geom.maximized },
    toggleMaximize(){ geom.maximized ? restoreSize() : maximize() },
    onToggle: null,
  }
  _windows.set(id, api)

  /* ── 几何应用 ── */
  function applyGeom(){
    const p = clampToViewport(geom.x, geom.y, geom.w, geom.h)
    geom.x = p.x; geom.y = p.y
    win.style.left = p.x + 'px'
    win.style.top = p.y + 'px'
    win.style.width = geom.w + 'px'
    win.style.height = geom.h + 'px'
  }
  function maximize(){
    geom.restore = { x: geom.x, y: geom.y, w: geom.w, h: geom.h }
    geom.maximized = true
    win.classList.add('maximized')
    win.style.left = '0px'
    win.style.top = '0px'
    win.style.width = '100vw'
    win.style.height = 'calc(100vh - 0px)'
    saveGeom(id, { maximized: true })
  }
  function restoreSize(){
    const r = geom.restore || { x: geom.x, y: geom.y, w: geom.w, h: geom.h }
    geom.maximized = false
    win.classList.remove('maximized')
    geom.x = r.x; geom.y = r.y; geom.w = r.w; geom.h = r.h
    applyGeom()
    saveGeom(id, { maximized: false })
  }

  applyGeom()
  if(geom.maximized) maximize()
  if(!geom.open) win.style.display = 'none'

  function focus(){
    _zTop += 1
    win.style.zIndex = _zTop
  }
  function notifyToggle(open){
    try{
      document.dispatchEvent(new CustomEvent('fw:toggle', { detail: { id, open } }))
    }catch(e){}
  }
  win.addEventListener('pointerdown', focus)
  focus()

  /* ── 拖拽移动（标题栏，可摆到任意位置）── */
  bar.addEventListener('pointerdown', (e) => {
    if(e.target.closest('button')) return
    if(geom.maximized) return
    const sx = e.clientX, sy = e.clientY
    const ox = geom.x, oy = geom.y
    bar.setPointerCapture && bar.setPointerCapture(e.pointerId)
    bar.classList.add('dragging')
    const onMove = (ev) => {
      geom.x = ox + (ev.clientX - sx)
      geom.y = oy + (ev.clientY - sy)
      const p = clampToViewport(geom.x, geom.y, geom.w, geom.h)
      geom.x = p.x; geom.y = p.y
      win.style.left = p.x + 'px'
      win.style.top = p.y + 'px'
    }
    const onUp = () => {
      bar.classList.remove('dragging')
      bar.removeEventListener('pointermove', onMove)
      bar.removeEventListener('pointerup', onUp)
      bar.removeEventListener('pointercancel', onUp)
      saveGeom(id, { x: geom.x, y: geom.y })
    }
    bar.addEventListener('pointermove', onMove)
    bar.addEventListener('pointerup', onUp)
    bar.addEventListener('pointercancel', onUp)
  })

  /* ── 双击标题栏 → 最大化/还原 ── */
  bar.addEventListener('dblclick', (e) => {
    if(e.target.closest('button')) return
    api.toggleMaximize()
  })

  /* ── 右下角缩放 ── */
  resize.addEventListener('pointerdown', (e) => {
    if(geom.maximized) return
    e.stopPropagation()
    const sx = e.clientX, sy = e.clientY
    const ow = geom.w, oh = geom.h
    resize.setPointerCapture && resize.setPointerCapture(e.pointerId)
    const onMove = (ev) => {
      geom.w = Math.max(MIN_W, ow + (ev.clientX - sx))
      geom.h = Math.max(MIN_H, oh + (ev.clientY - sy))
      win.style.width = geom.w + 'px'
      win.style.height = geom.h + 'px'
    }
    const onUp = () => {
      resize.removeEventListener('pointermove', onMove)
      resize.removeEventListener('pointerup', onUp)
      resize.removeEventListener('pointercancel', onUp)
      saveGeom(id, { w: geom.w, h: geom.h })
    }
    resize.addEventListener('pointermove', onMove)
    resize.addEventListener('pointerup', onUp)
    resize.addEventListener('pointercancel', onUp)
  })

  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); api.close() })

  /* ── 窗口尺寸变化时把窗口拉回视口 ── */
  window.addEventListener('resize', () => {
    if(!api.isOpen()) return
    if(!geom.maximized) applyGeom()
  })

  /* ── 自适应：断点变化时调整浮动窗口 ── */
  responsive.onChange((type, detail) => {
    if (type !== 'breakpoint-change') return
    const bp = responsive.breakpoint
    if (bp === 'xs' || bp === 'sm') {
      if (api.isOpen() && !geom.maximized) {
        maximize()
      }
    } else if (detail.from === 'xs' || detail.from === 'sm') {
      if (geom.maximized && geom.restore) {
        restoreSize()
      }
    }
    if (!geom.maximized) applyGeom()
  })

  document.body.appendChild(win)
  return api
}

export function toggleWindow(id){
  const w = _windows.get(id)
  if(w) w.toggle()
}
export function getWindow(id){ return _windows.get(id) }
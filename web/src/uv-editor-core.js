/**
 * matoga - UV 编辑器内核（可实例化）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-view.js 抽出的画布/编辑内核，供两个宿主复用：
 *  - uv-view.js 浮动窗口（3D 视口联动，数据源 = 视口当前模型）
 *  - panels/uvEditor 工作区面板（支持离线打开 im/cm/bb 模型编辑并保存）
 *
 * createUvEditor(opts) 工厂：
 *  - opts.container  DOM 挂载点（内核创建 .uvv-wrap 结构追加其中）
 *  - opts.visible()  是否可见（不可见时跳过绘制；浮窗 = isOpen()，面板 = isConnected）
 *  - opts.getLayout() 数据源：返回 layout | null（layout 结构见 mc-model-viewer buildMcLayout）
 *  - opts.hooks      编辑联动钩子（全部可选，缺省仅写回 layout 数据）：
 *      onFaceUv(el, key, uv) / onFaceRotation(el, key, rotation)   写回 3D 活跃模型
 *      onTexture(texIndex, dataUrl, layout) → Promise              自定义贴图替换
 *      highlightFace(el, key, on) → boolean                        UV ↔ 3D 高亮联动
 *      exportJson() → { json, filename } | null                    导出当前模型
 *  - opts.onDirty(dirty)  编辑脏状态变化（undo/redo 栈非空 → true；保存后 markClean()）
 *  - opts.autoRefreshOnModelShown  监听 'mcmodel:shown' 自动刷新（默认 true）
 *
 * 功能（继承自原浮窗实现）：
 *  - 贴图大图（像素风放大）为底 + 每元素每面 UV 采样矩形（面名 / 旋转 / 镜像）
 *  - 多贴图切换 / 适配-固定倍率缩放 / uvScale 网格 / 悬停高亮
 *  - 编辑模式：拖拽移动 / 8 向手柄缩放（整数像素吸附，Alt=0.25 微调）/ 旋转 / 镜像 / 数值精调
 *  - Ctrl+Z 撤销 / Ctrl+Shift+Z 重做 / 会话基线重置
 *  - 自定义贴图：上传或拖入图片替换（dataURL）
 *  - 导出编辑后的模型 JSON / UV 线框模板 PNG（透明底，画师填色用）
 */

import { t, onLocaleChange } from './i18n.js'
import { parseAnimMeta, defaultFaceUv } from './mc-model-viewer.js'
import { getTexDragData } from './utils.js'

const ZOOM_STEPS = ['fit', 1, 2, 4, 8, 16]
const IMG_CACHE_MAX = 48
const UNDO_MAX = 120
const HANDLE_HIT = 6      /* 手柄命中半径（CSS px） */
const HANDLE_DRAW = 5     /* 手柄半边长（CSS px） */

const HANDLE_CURSOR = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
}

/* 贴图 / 动画元数据缓存（跨实例共享，key 均为 URL） */
const imgCache = new Map()   /* url → { img, ok, done } */
const animCache = new Map()  /* mcmetaUrl → { meta, anim, parsedFor, failed } */

export function createUvEditor(opts) {
  const container = opts && opts.container
  if (!container || typeof container.appendChild !== 'function') {
    throw new Error('createUvEditor: container required')
  }
  const visible = (opts && typeof opts.visible === 'function') ? opts.visible : () => container.isConnected
  const getLayout = (opts && typeof opts.getLayout === 'function') ? opts.getLayout : () => null
  const hooks = (opts && opts.hooks) || {}
  const onDirty = (opts && typeof opts.onDirty === 'function') ? opts.onDirty : null

  let canvas = null
  let ctx = null
  let canvasWrap = null
  let chipsEl = null
  let zoomSeg = null
  let gridBtn = null
  let editBtn = null
  let uploadBtn = null
  let exportBtn = null
  let templateBtn = null
  let fileInput = null
  let editBar = null
  let uvInputs = []
  let rotBtn = null
  let mirrorBtn = null
  let remakeBtn = null
  let undoBtn = null
  let redoBtn = null
  let resetBtn = null
  let libraryBtn = null
  let statusEl = null
  let emptyEl = null
  let resizeObserver = null
  let drawPending = false

  const state = {
    layout: null,
    activeTex: 0,
    zoom: 'fit',
    grid: true,
    hover: null,       /* { el, face, key } 悬停面（el 为 layout element） */
    rects: [],         /* 最近一次绘制的面矩形（hover / 命中检测用） */
    px: 1,             /* 最近一次绘制的像素倍率（拖拽换算用） */
    /* ── 编辑态 ── */
    edit: false,
    selected: null,    /* { el, face, key, elIdx } 选中面 */
    drag: null,        /* { mode, rc, sx, sy, orig, moved } */
    handles: [],       /* 选中面 8 向手柄命中区 */
    undoStack: [],     /* [{ layEl, key, uv, rotation }] */
    redoStack: [],     /* 撤销的逆栈（新编辑时分叉清空） */
    snapshot: null,    /* 会话基线（模型加载时快照，重置用） */
    customTex: new Set(),   /* 已被自定义贴图替换的贴图索引 */
    inputOrig: null,   /* 数值输入 focus 时的旧值（undo 用） */
    notice: null,      /* 状态栏置顶提示（如 sprite 不支持编辑） */
  }

  let hlFace = null    /* 当前 3D 高亮面 { el, key }（原始 element 引用） */

  /* ── DOM 构建（结构顺序与原浮窗一致：toolbar / canvasWrap / status / 隐藏 fileInput） ── */

  const wrap = document.createElement('div')
  wrap.className = 'uvv-wrap'

  const toolbar = document.createElement('div')
  toolbar.className = 'uvv-toolbar'

  chipsEl = document.createElement('div')
  chipsEl.className = 'uvv-tex-chips'
  toolbar.appendChild(chipsEl)

  zoomSeg = document.createElement('div')
  zoomSeg.className = 'm3d-segment uvv-zoom-seg'
  ZOOM_STEPS.forEach(z => {
    const btn = document.createElement('button')
    btn.dataset.zoom = String(z)
    btn.textContent = z === 'fit' ? t('uv.fit') : z + 'x'
    if (z === 'fit') btn.classList.add('active')
    btn.addEventListener('click', () => {
      state.zoom = z === 'fit' ? 'fit' : +z
      zoomSeg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn))
      draw()
    })
    zoomSeg.appendChild(btn)
  })
  toolbar.appendChild(zoomSeg)

  gridBtn = document.createElement('button')
  gridBtn.className = 'uvv-grid-btn active'
  gridBtn.title = t('uv.grid')
  gridBtn.textContent = t('uv.grid')
  gridBtn.addEventListener('click', () => {
    state.grid = !state.grid
    gridBtn.classList.toggle('active', state.grid)
    draw()
  })
  toolbar.appendChild(gridBtn)

  editBtn = document.createElement('button')
  editBtn.className = 'uvv-grid-btn uvv-edit-btn'
  editBtn.title = t('uv.editTitle')
  editBtn.textContent = t('uv.edit')
  editBtn.addEventListener('click', () => setEdit(!state.edit))
  toolbar.appendChild(editBtn)

  uploadBtn = document.createElement('button')
  uploadBtn.className = 'uvv-grid-btn'
  uploadBtn.title = t('uv.uploadTitle')
  uploadBtn.textContent = t('uv.upload')
  uploadBtn.addEventListener('click', () => { if (fileInput) fileInput.click() })
  toolbar.appendChild(uploadBtn)

  libraryBtn = document.createElement('button')
  libraryBtn.className = 'uvv-grid-btn uvv-library-btn'
  libraryBtn.title = t('uv.libraryTitle')
  libraryBtn.textContent = t('uv.library')
  libraryBtn.addEventListener('click', pickLibraryTexture)
  toolbar.appendChild(libraryBtn)

  exportBtn = document.createElement('button')
  exportBtn.className = 'uvv-grid-btn'
  exportBtn.title = t('uv.exportTitle')
  exportBtn.textContent = t('uv.export')
  exportBtn.addEventListener('click', exportModel)
  toolbar.appendChild(exportBtn)

  templateBtn = document.createElement('button')
  templateBtn.className = 'uvv-grid-btn'
  templateBtn.title = t('uv.templateTitle')
  templateBtn.textContent = t('uv.template')
  templateBtn.addEventListener('click', exportUvTemplate)
  toolbar.appendChild(templateBtn)

  /* 编辑工具条（编辑模式显示；放 toolbar 内随 flex-wrap 换行，不动外层结构） */
  editBar = document.createElement('div')
  editBar.className = 'uvv-edit-bar'
  const uvLabel = document.createElement('span')
  uvLabel.className = 'uvv-edit-label'
  uvLabel.textContent = t('uv.uvLabel')
  editBar.appendChild(uvLabel)
  uvInputs = [0, 1, 2, 3].map(() => {
    const inp = document.createElement('input')
    inp.type = 'number'
    inp.className = 'uvv-uv-input'
    inp.step = '1'
    inp.disabled = true
    inp.addEventListener('focus', () => {
      const f = selectedFace()
      state.inputOrig = f ? [...f.uv] : null
    })
    inp.addEventListener('change', () => { applyUvInput() })
    editBar.appendChild(inp)
    return inp
  })
  rotBtn = document.createElement('button')
  rotBtn.className = 'uvv-grid-btn'
  rotBtn.title = t('uv.rotateTitle')
  rotBtn.textContent = t('uv.rotate')
  rotBtn.addEventListener('click', rotateSelected)
  editBar.appendChild(rotBtn)
  mirrorBtn = document.createElement('button')
  mirrorBtn.className = 'uvv-grid-btn'
  mirrorBtn.title = t('uv.mirrorTitle')
  mirrorBtn.textContent = t('uv.mirror')
  mirrorBtn.addEventListener('click', mirrorSelected)
  editBar.appendChild(mirrorBtn)
  remakeBtn = document.createElement('button')
  remakeBtn.className = 'uvv-grid-btn'
  remakeBtn.title = t('uv.remakeTitle')
  remakeBtn.textContent = t('uv.remake')
  remakeBtn.addEventListener('click', remakeSelected)
  editBar.appendChild(remakeBtn)
  undoBtn = document.createElement('button')
  undoBtn.className = 'uvv-grid-btn'
  undoBtn.title = t('uv.undoTitle') + ' (Ctrl+Z)'
  undoBtn.textContent = t('uv.undo')
  undoBtn.addEventListener('click', undoEdit)
  editBar.appendChild(undoBtn)
  redoBtn = document.createElement('button')
  redoBtn.className = 'uvv-grid-btn'
  redoBtn.title = t('uv.redoTitle') + ' (Ctrl+Shift+Z / Ctrl+Y)'
  redoBtn.textContent = t('uv.redo')
  redoBtn.disabled = true
  redoBtn.addEventListener('click', redoEdit)
  editBar.appendChild(redoBtn)
  resetBtn = document.createElement('button')
  resetBtn.className = 'uvv-grid-btn'
  resetBtn.title = t('uv.resetTitle')
  resetBtn.textContent = t('uv.reset')
  resetBtn.addEventListener('click', resetEdits)
  editBar.appendChild(resetBtn)
  const hint = document.createElement('span')
  hint.className = 'uvv-edit-hint'
  hint.textContent = t('uv.editHint')
  editBar.appendChild(hint)
  toolbar.appendChild(editBar)

  wrap.appendChild(toolbar)

  /* 画布区 */
  canvasWrap = document.createElement('div')
  canvasWrap.className = 'uvv-canvas-wrap'
  canvas = document.createElement('canvas')
  canvas.className = 'uvv-canvas'
  canvasWrap.appendChild(canvas)

  /* 自定义贴图上传（隐藏 input 挂 wrap 尾部，保持 canvasWrap 子结构不变；拖放目标为画布区） */
  fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.multiple = true
  fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif'
  fileInput.style.display = 'none'
  fileInput.addEventListener('change', () => {
    handleTextureFiles(fileInput.files)
    try { fileInput.value = '' } catch {}
  })

  canvasWrap.addEventListener('dragover', (e) => {
    if (!state.layout) return
    e.preventDefault()
    canvasWrap.classList.add('uvv-drop-active')
  })
  canvasWrap.addEventListener('dragleave', () => canvasWrap.classList.remove('uvv-drop-active'))
  canvasWrap.addEventListener('drop', (e) => {
    e.preventDefault()
    canvasWrap.classList.remove('uvv-drop-active')
    /* 资产库贴图卡片拖入：raw URL 直接替换当前贴图槽位（材质球带 normal/specular → PBR 预览） */
    const tex = getTexDragData(e.dataTransfer)
    if (tex) {
      if (state.layout && isUsableTexUrl(tex.url)) {
        const extra = (tex.normal || tex.specular) ? { normal: tex.normal || '', specular: tex.specular || '' } : undefined
        applyCustomTexture(tex.url, tex.name || null, null, extra)
      }
      return
    }
    const files = e.dataTransfer && e.dataTransfer.files
    handleTextureFiles(files)
  })

  emptyEl = document.createElement('div')
  emptyEl.className = 'uvv-empty'
  canvasWrap.appendChild(emptyEl)
  wrap.appendChild(canvasWrap)

  /* 状态栏 */
  statusEl = document.createElement('div')
  statusEl.className = 'uvv-status'
  wrap.appendChild(statusEl)
  wrap.appendChild(fileInput)   /* 隐藏上传 input（尾部，不占结构索引） */

  container.appendChild(wrap)
  ctx = canvas.getContext('2d')

  canvas.addEventListener('mousemove', (e) => {
    if (state.drag) return
    const r = canvas.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const hit = hitRect(mx, my)
    const same = hit && state.hover
      ? (hit.el === state.hover.el && hit.key === state.hover.key)
      : (!hit && !state.hover)
    if (!same) {
      state.hover = hit ? { el: hit.el, face: hit.face, key: hit.key } : null
      updateStatus()
      updateActiveHighlight()
      draw()
    }
    if (state.edit) {
      const h = state.selected ? hitHandle(mx, my) : null
      canvas.style.cursor = h ? HANDLE_CURSOR[h.mode] : (hit ? 'move' : 'crosshair')
    }
  })
  canvas.addEventListener('mouseleave', () => {
    if (state.hover) { state.hover = null; updateStatus(); updateActiveHighlight(); draw() }
  })

  /* 编辑拖拽（pointer events 支持触控笔/触摸） */
  canvas.addEventListener('pointerdown', (e) => {
    if (!state.edit || state.drag || !state.layout) return
    const r = canvas.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const h = state.selected ? hitHandle(mx, my) : null
    if (h) { startDrag(e, h.mode, mx, my); return }
    const rc = hitRect(mx, my)
    if (rc) {
      selectFace(rc)
      startDrag(e, 'move', mx, my)
    } else if (state.selected) {
      clearSelection()
    }
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!state.drag) return
    const r = canvas.getBoundingClientRect()
    onDragMove(e.clientX - r.left, e.clientY - r.top, e.altKey)
  })
  const endDrag = (e) => {
    const d = state.drag
    if (!d) return
    state.drag = null
    try { canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId) } catch {}
    if (d.moved) pushUndo({ layEl: d.rc.el, key: d.rc.key, uv: [...d.orig], rotation: d.rc.face.rotation })
    updateStatus()
    draw()
  }
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)

  /* Ctrl+Z 撤销 / Ctrl+Shift+Z 或 Ctrl+Y 重做（输入框聚焦时放行浏览器原生行为） */
  const onKeyDown = (e) => {
    if (!visible() || !state.edit) return
    if (!(e.ctrlKey || e.metaKey)) return
    const k = e.key
    const isUndo = (k === 'z' || k === 'Z') && !e.shiftKey
    const isRedo = (k === 'y' || k === 'Y') || ((k === 'z' || k === 'Z') && e.shiftKey)
    if (!isUndo && !isRedo) return
    const tag = e.target && e.target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    e.preventDefault()
    if (isUndo) undoEdit()
    else redoEdit()
  }
  window.addEventListener('keydown', onKeyDown)

  const onModelShown = () => { if (visible()) refresh() }
  if (!opts || opts.autoRefreshOnModelShown !== false) {
    window.addEventListener('mcmodel:shown', onModelShown)
  }

  const offLocaleChange = onLocaleChange(() => {
    gridBtn.title = t('uv.grid')
    gridBtn.textContent = t('uv.grid')
    editBtn.title = t('uv.editTitle')
    editBtn.textContent = t('uv.edit')
    uploadBtn.title = t('uv.uploadTitle')
    uploadBtn.textContent = t('uv.upload')
    libraryBtn.title = t('uv.libraryTitle')
    libraryBtn.textContent = t('uv.library')
    exportBtn.title = t('uv.exportTitle')
    exportBtn.textContent = t('uv.export')
    templateBtn.title = t('uv.templateTitle')
    templateBtn.textContent = t('uv.template')
    rotBtn.textContent = t('uv.rotate')
    mirrorBtn.textContent = t('uv.mirror')
    remakeBtn.textContent = t('uv.remake')
    undoBtn.textContent = t('uv.undo')
    redoBtn.textContent = t('uv.redo')
    resetBtn.textContent = t('uv.reset')
    refresh()
  })

  resizeObserver = new ResizeObserver(() => draw())
  resizeObserver.observe(canvasWrap)

  /* ── 数据刷新 ─────────────────────────────────── */

  function refresh() {
    clearHighlight3d()
    const layout = getLayout()
    state.layout = layout && Array.isArray(layout.textures) && layout.textures.length ? layout : null
    state.activeTex = 0
    state.hover = null
    state.rects = []
    state.selected = null
    state.drag = null
    state.snapshot = snapshotLayout(state.layout)
    state.undoStack.length = 0
    state.redoStack.length = 0
    state.customTex.clear()
    state.notice = null
    syncUndoButtons()
    notifyDirty()
    if (state.layout) {
      for (const tex of state.layout.textures) { if (tex.url) loadTexImage(tex.url) }
    }
    if (!state.layout && state.edit) setEdit(false)
    rebuildChips()
    syncEditInputs()
    draw()
  }

  function rebuildChips() {
    if (!chipsEl) return
    chipsEl.innerHTML = ''
    const layout = state.layout
    if (!layout) return
    layout.textures.forEach((tex, i) => {
      const removed = !tex.url
      const chip = document.createElement('button')
      chip.className = 'uvv-chip' + (i === state.activeTex ? ' active' : '')
      chip.textContent = (tex.name || ('#' + i)) + (removed ? ' ⊘' : (state.customTex.has(i) ? ' ✎' : ''))
      chip.title = (tex.name || '') + ' · ' + t(removed ? 'uv.removed' : 'uv.chipRemoveHint')
      chip.addEventListener('click', () => {
        state.activeTex = i
        state.hover = null
        state.selected = null
        syncEditInputs()
        chipsEl.querySelectorAll('button').forEach(b => b.classList.remove('active'))
        chip.classList.add('active')
        draw()
      })
      chip.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        removeTexture(i)
      })
      chipsEl.appendChild(chip)
    })
  }

  /* ── 贴图加载（Image 缓存）────────────────────────── */

  function loadTexImage(url) {
    let rec = imgCache.get(url)
    if (rec) return rec
    if (imgCache.size > IMG_CACHE_MAX) imgCache.clear()
    rec = { img: null, ok: false, done: false }
    imgCache.set(url, rec)
    const img = new Image()
    img.onload = () => { rec.img = img; rec.ok = true; rec.done = true; requestDraw() }
    img.onerror = () => { rec.img = null; rec.ok = false; rec.done = true; requestDraw() }
    img.src = url
    return rec
  }

  function requestDraw() {
    if (drawPending || !visible()) return
    drawPending = true
    requestAnimationFrame(() => { drawPending = false; draw() })
  }

  /* ── 动画贴图元数据（.png.mcmeta）──────────────────────
     UV 编辑器为静态分析工具：动画贴图固定显示首帧（帧 0 顶部区域），
     面矩形 UV 坐标即帧内像素坐标；缓存 null = 非动画或仍在加载。
     mcmeta 原始 JSON 只请求一次；解析在贴图真实尺寸就绪后重试
     （首次调用时贴图可能未加载，临时尺寸会误判单帧 → 贴图 onload
     后以 naturalWidth/Height 重新解析出帧区域）。 */

  function tryParseAnim(entry, texW, texH) {
    if (!entry || !entry.meta || entry.anim || entry.failed) return
    const w = +texW || 0, h = +texH || 0
    if (w <= 0 || h <= 0) return
    const sizeKey = w + 'x' + h
    if (entry.parsedFor === sizeKey) return   /* 同尺寸已解析（null 不重试） */
    entry.parsedFor = sizeKey
    const anim = parseAnimMeta(entry.meta, w, h)
    if (anim) {
      entry.anim = { frameW: anim.frameW, frameH: anim.frameH, frames: anim.frameCount }
      requestDraw()
    }
  }

  function loadTexAnimInfo(tex, texW, texH) {
    const url = (tex && typeof tex.mcmetaUrl === 'string') ? tex.mcmetaUrl : null
    if (!url) return null
    if (!animCache.has(url)) {
      animCache.set(url, { meta: null, anim: null, parsedFor: null, failed: false })
      fetch(url)
        .then(res => (res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status))))
        .then(meta => {
          const entry = animCache.get(url)
          if (!entry || typeof meta !== 'object' || !meta) return
          entry.meta = meta
          tryParseAnim(entry, texW, texH)
        })
        .catch(() => {
          const entry = animCache.get(url)
          if (entry) entry.failed = true
        })
    }
    const entry = animCache.get(url)
    tryParseAnim(entry, texW, texH)
    return entry ? entry.anim : null
  }

  /* ── 编辑：值应用（layout face + 原始 element 写回 → 联动钩子） ────────── */

  function applyFaceUvValues(layEl, key, uv) {
    const face = layEl && layEl.faces ? layEl.faces[key] : null
    if (!face || !Array.isArray(uv) || uv.length !== 4 || !uv.every(n => Number.isFinite(+n))) return false
    face.uv = [+uv[0], +uv[1], +uv[2], +uv[3]]
    face.mirror = face.uv[2] < face.uv[0]
    if (layEl.el && typeof hooks.onFaceUv === 'function') {
      try { hooks.onFaceUv(layEl.el, key, face.uv) } catch {}
    }
    return true
  }

  function applyFaceRotationValue(layEl, key, rotation) {
    const face = layEl && layEl.faces ? layEl.faces[key] : null
    if (!face) return false
    face.rotation = Number.isFinite(+rotation) ? (((Math.round(+rotation / 90) * 90) % 360) + 360) % 360 : 0
    if (layEl.el && typeof hooks.onFaceRotation === 'function') {
      try { hooks.onFaceRotation(layEl.el, key, face.rotation) } catch {}
    }
    return true
  }

  function selectedFace() {
    return state.selected ? state.selected.face : null
  }

  function selectedRect() {
    if (!state.selected) return null
    return state.rects.find(rc => rc.el === state.selected.el && rc.key === state.selected.key) || null
  }

  function selectFace(rc) {
    if (state.selected && state.selected.el === rc.el && state.selected.key === rc.key) return
    state.selected = { el: rc.el, face: rc.face, key: rc.key, elIdx: rc.elIdx }
    syncEditInputs()
    updateActiveHighlight()
    draw()
  }

  function clearSelection() {
    if (!state.selected) return
    state.selected = null
    syncEditInputs()
    updateActiveHighlight()
    draw()
  }

  function setEdit(on) {
    if (on && state.layout && state.layout.sprite) {
      state.notice = t('uv.spriteNoEdit')
      updateStatus()
      return
    }
    state.notice = null
    state.edit = !!(on && state.layout)
    state.selected = null
    state.drag = null
    if (editBtn) editBtn.classList.toggle('active', state.edit)
    if (editBar) editBar.classList.toggle('show', state.edit)
    if (canvas) canvas.style.cursor = state.edit ? 'crosshair' : ''
    syncEditInputs()
    updateActiveHighlight()
    draw()
  }

  /* 编辑数值输入框同步（选中面 → 当前 UV + 撤销/重做按钮态） */
  function syncEditInputs() {
    const f = selectedFace()
    uvInputs.forEach((inp, i) => {
      inp.disabled = !f
      if (f && Array.isArray(f.uv)) inp.value = String(fmtUvNum(f.uv[i]))
    })
    syncUndoButtons()
  }

  function applyUvInput() {
    const f = selectedFace()
    if (!f || !state.selected) { state.inputOrig = null; return }
    const uv = uvInputs.map(inp => +inp.value)
    const scale = (state.layout && state.layout.uvScale) || 16
    if (!uv.every(n => Number.isFinite(n))) { syncEditInputs(); return }
    const cuv = uv.map(v => Math.min(Math.max(Math.round(v * 4) / 4, 0), scale))
    if (cuv.every((v, i) => v === f.uv[i])) { state.inputOrig = null; return }
    const orig = (state.inputOrig && state.inputOrig.length === 4) ? [...state.inputOrig] : [...f.uv]
    pushUndo({ layEl: state.selected.el, key: state.selected.key, uv: orig, rotation: f.rotation })
    state.inputOrig = null
    applyFaceUvValues(state.selected.el, state.selected.key, cuv)
    syncEditInputs()
    draw()
  }

  function rotateSelected() {
    const f = selectedFace()
    if (!f || !state.selected) return
    pushUndo({ layEl: state.selected.el, key: state.selected.key, uv: [...f.uv], rotation: f.rotation })
    applyFaceRotationValue(state.selected.el, state.selected.key, ((f.rotation || 0) + 90) % 360)
    updateStatus()
    draw()
  }

  function mirrorSelected() {
    const f = selectedFace()
    if (!f || !state.selected) return
    pushUndo({ layEl: state.selected.el, key: state.selected.key, uv: [...f.uv], rotation: f.rotation })
    applyFaceUvValues(state.selected.el, state.selected.key, [f.uv[2], f.uv[1], f.uv[0], f.uv[3]])
    updateStatus()
    draw()
  }

  /* ── 撤销 / 重做 / 重制 / 重置 ─────────────────────────── */

  /* 取 layout 面当前值（撤销/重做互推时保存“另一侧”状态用） */
  function faceEntryOf(layEl, key) {
    const f = (layEl && layEl.faces) ? layEl.faces[key] : null
    if (!f) return null
    return { layEl, key, uv: Array.isArray(f.uv) ? [...f.uv] : null, rotation: f.rotation || 0 }
  }

  function applyHistoryEntry(entry) {
    if (Array.isArray(entry.uv)) applyFaceUvValues(entry.layEl, entry.key, entry.uv)
    if (entry.rotation != null) applyFaceRotationValue(entry.layEl, entry.key, entry.rotation)
  }

  function pushUndo(entry) {
    state.undoStack.push(entry)
    state.redoStack.length = 0   /* 新编辑 → 重做历史分叉失效 */
    if (state.undoStack.length > UNDO_MAX) state.undoStack.shift()
    syncUndoButtons()
    notifyDirty()
  }

  function undoEdit() {
    const entry = state.undoStack.pop()
    if (!entry) return
    const cur = faceEntryOf(entry.layEl, entry.key)
    applyHistoryEntry(entry)
    if (cur && cur.uv) state.redoStack.push(cur)
    syncEditInputs()
    updateStatus()
    draw()
    notifyDirty()
  }

  function redoEdit() {
    const entry = state.redoStack.pop()
    if (!entry) return
    const cur = faceEntryOf(entry.layEl, entry.key)
    applyHistoryEntry(entry)
    if (cur && cur.uv) state.undoStack.push(cur)   /* 直接入栈（不经 pushUndo，避免清空 redo） */
    syncEditInputs()
    updateStatus()
    draw()
    notifyDirty()
  }

  /* 撤销/重做按钮禁用态同步 */
  function syncUndoButtons() {
    if (undoBtn) undoBtn.disabled = state.undoStack.length === 0
    if (redoBtn) redoBtn.disabled = state.redoStack.length === 0
  }

  /* 重制：按元素尺寸（vanilla 规则）重算选中面默认 UV；无元素引用时回退全幅 */
  function remakeSelected() {
    const f = selectedFace()
    if (!f || !state.selected) return
    const layEl = state.selected.el
    const scale = (state.layout && state.layout.uvScale) || 16
    const el = layEl.el
    let def = null
    if (typeof defaultFaceUv === 'function' && el && Array.isArray(el.from) && Array.isArray(el.to)) {
      def = defaultFaceUv(state.selected.key, el.from, el.to, scale)
    }
    if (!def) def = [0, 0, scale, scale]
    pushUndo({ layEl, key: state.selected.key, uv: [...f.uv], rotation: f.rotation })
    applyFaceUvValues(layEl, state.selected.key, def)
    syncEditInputs()
    updateStatus()
    draw()
  }

  function snapshotLayout(layout) {
    if (!layout || !Array.isArray(layout.elements)) return null
    return layout.elements.map(el => {
      const faces = {}
      for (const key in (el.faces || {})) {
        const f = el.faces[key]
        if (f && Array.isArray(f.uv)) faces[key] = { uv: [...f.uv], rotation: f.rotation || 0 }
      }
      return { faces }
    })
  }

  function resetEdits() {
    const layout = state.layout
    if (!layout || !state.snapshot) return
    try {
      if (typeof confirm === 'function' && !confirm(t('uv.resetConfirm'))) return
    } catch {}
    layout.elements.forEach((el, i) => {
      const snapEl = state.snapshot[i]
      if (!snapEl) return
      for (const key in snapEl.faces) {
        const sf = snapEl.faces[key]
        applyFaceUvValues(el, key, sf.uv)
        applyFaceRotationValue(el, key, sf.rotation)
      }
    })
    state.undoStack.length = 0
    state.redoStack.length = 0
    syncUndoButtons()
    syncEditInputs()
    updateStatus()
    draw()
    notifyDirty()
  }

  /* ── 拖拽编辑（移动 / 手柄缩放）────────────────────── */

  function startDrag(e, mode, mx, my) {
    const rc = selectedRect() || hitRect(mx, my)
    if (!rc) return
    state.drag = { mode, rc, sx: mx, sy: my, orig: [...rc.face.uv], moved: false }
    try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId) } catch {}
  }

  function onDragMove(mx, my, altKey) {
    const d = state.drag
    if (!d) return
    const px = state.px || 1
    const scale = (state.layout && state.layout.uvScale) || 16
    const step = altKey ? 0.25 : 1
    const snap = v => Math.round(v / step) * step
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
    let uv
    if (d.mode === 'move') {
      let dx = snap((mx - d.sx) / px)
      let dy = snap((my - d.sy) / px)
      const [u1, v1, u2, v2] = d.orig
      dx = clamp(dx, -Math.min(u1, u2), scale - Math.max(u1, u2))
      dy = clamp(dy, -Math.min(v1, v2), scale - Math.max(v1, v2))
      uv = [u1 + dx, v1 + dy, u2 + dx, v2 + dy]
    } else {
      const [u1, v1, u2, v2] = d.orig
      let minX = Math.min(u1, u2), maxX = Math.max(u1, u2)
      let minY = Math.min(v1, v2), maxY = Math.max(v1, v2)
      const U = clamp(snap(mx / px), 0, scale)
      const V = clamp(snap(my / px), 0, scale)
      const m = d.mode
      if (m.includes('w')) minX = clamp(Math.min(maxX - 1, U), 0, scale)
      if (m.includes('e')) maxX = clamp(Math.max(minX + 1, U), 0, scale)
      if (m.includes('n')) minY = clamp(Math.min(maxY - 1, V), 0, scale)
      if (m.includes('s')) maxY = clamp(Math.max(minY + 1, V), 0, scale)
      uv = [
        u1 <= u2 ? minX : maxX,
        v1 <= v2 ? minY : maxY,
        u1 <= u2 ? maxX : minX,
        v1 <= v2 ? maxY : minY,
      ]
    }
    const before = d.rc.face.uv
    if (uv.every((v, i) => v === before[i])) return
    d.moved = true
    applyFaceUvValues(d.rc.el, d.rc.key, uv)
    syncEditInputs()
    updateStatus()
    requestDraw()
  }

  function hitRect(mx, my) {
    return state.rects.findLast(rc => mx >= rc.x && mx <= rc.x + rc.w && my >= rc.y && my <= rc.y + rc.h)
  }

  function hitHandle(mx, my) {
    for (const h of state.handles) {
      if (Math.abs(mx - h.x) <= HANDLE_HIT && Math.abs(my - h.y) <= HANDLE_HIT) return h
    }
    return null
  }

  /* ── 自定义贴图（上传 / 拖放 → dataURL 替换 + 换图钩子） ──────────
     多文件：从当前选中贴图槽位起按顺序替换（画师一次导出多张贴图逐槽位对应）；
     超出贴图槽数的文件忽略——新增空槽位无意义（无 face 引用的贴图不会显示） */

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('read fail'))
        reader.readAsDataURL(file)
      } catch (e) { reject(e) }
    })
  }

  async function handleTextureFiles(files) {
    const list = Array.from(files || []).filter(f => f && /^image\//.test(String(f.type || '')))
    if (!list.length || !state.layout) return
    const start = state.activeTex
    let replaced = 0
    for (let i = 0; i < list.length; i++) {
      const texIndex = start + i
      if (texIndex >= state.layout.textures.length) break
      try {
        const dataUrl = await readAsDataURL(list[i])
        applyCustomTexture(dataUrl, list[i].name, texIndex)
        replaced++
      } catch {}
    }
    if (replaced > 1) flashNotice(t('uv.replacedN', { n: replaced }))
  }

  function applyCustomTexture(dataUrl, filename, texIndex, extra) {
    const layout = state.layout
    if (!layout || !isUsableTexUrl(dataUrl)) return
    const i = (texIndex != null && Number.isFinite(+texIndex)) ? +texIndex : state.activeTex
    const tex = layout.textures[i]
    if (!tex) return
    tex.url = dataUrl
    tex.mcmetaUrl = null   /* 自定义贴图无动画元数据 */
    if (filename) tex.name = String(filename).replace(/\.[^.]+$/, '')
    state.customTex.add(i)
    rebuildChips()
    loadTexImage(dataUrl)   /* 预载 → onload 后重绘 */
    if (typeof hooks.onTexture === 'function') {
      try { Promise.resolve(hooks.onTexture(i, dataUrl, layout, extra)).catch(() => {}) } catch {}
    }
    updateStatus()
    draw()
    notifyDirty()
  }

  /* 可用作贴图的 URL：dataURL / http(s) / 站内相对路径（/api/...） */
  function isUsableTexUrl(url) {
    return typeof url === 'string' && (url.startsWith('data:') || /^https?:\/\//i.test(url) || url.startsWith('/'))
  }

  /* 移除材质：清空贴图槽位引用（face.tex 索引保持不变，不删除槽位本身）；
     UV 画布仅剩棋盘底 + 面矩形，3D 视口面变纯色（onTexture 空串 → 宿主清除材质）；
     重新上传 / 拖入 / 贴图库选择即可恢复 */
  function removeTexture(texIndex) {
    const layout = state.layout
    if (!layout) return
    const i = (texIndex != null && Number.isFinite(+texIndex)) ? +texIndex : state.activeTex
    const tex = layout.textures[i]
    if (!tex || !tex.url) return
    tex.url = ''
    tex.mcmetaUrl = null
    state.customTex.add(i)
    rebuildChips()
    updateStatus()
    draw()
    notifyDirty()
    if (typeof hooks.onTexture === 'function') {
      try { Promise.resolve(hooks.onTexture(i, '', layout)).catch(() => {}) } catch {}
    }
  }

  /* 贴图库选择：hooks.pickTexture 可覆盖（返回 Promise<{name,url,normal,specular}|null>）；
     默认动态加载 uv-tex-picker 浮窗（总资产库材质球 → raw URL）。
     返回材质组：主图写入 UV 槽位，normal/specular 透传宿主做 3D 视口 PBR 预览 */
  async function pickLibraryTexture() {
    if (!state.layout) return
    let picked = null
    try {
      if (typeof hooks.pickTexture === 'function') {
        picked = await hooks.pickTexture()
      } else {
        const m = await import('./uv-tex-picker.js')
        picked = await m.openTexPicker()
      }
    } catch (e) { console.error('[uv-editor] tex-picker', e) }
    if (picked && isUsableTexUrl(picked.url)) {
      const extra = { normal: picked.normal || '', specular: picked.specular || '' }
      applyCustomTexture(picked.url, picked.name || null, null, extra)
    }
  }

  /* 状态栏短暂提示（3s 后自动让位给常规状态文本） */
  function flashNotice(msg) {
    state.notice = msg
    updateStatus()
    setTimeout(() => {
      if (state.notice === msg) { state.notice = null; updateStatus() }
    }, 3000)
  }

  /* ── 导出编辑后的模型 JSON（经 exportJson 钩子） ─────────────────────────── */

  function exportModel() {
    let r = null
    try { r = (typeof hooks.exportJson === 'function') ? hooks.exportJson() : null } catch {}
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
      setTimeout(() => { try { URL.revokeObjectURL(url) } catch {} }, 4000)
    } catch (e) { console.error('[uv-editor] export', e) }
  }

  /* ── UV 线框模板导出（透明底 PNG，画师填色用） ───────────────────
     与贴图同尺寸 1:1 输出：uvScale 网格 + 每元素面矩形（元素色描边 +
     低透明度填充 + 面标签），可直接垫在像素画软件的底图层。 */

  function exportUvTemplate() {
    const layout = state.layout
    if (!layout) return
    const tex = layout.textures[state.activeTex]
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
          if (!face || face.tex !== state.activeTex) continue
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
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = String(tex.name || 'texture').replace(/[\/\\]/g, '_') + '_uv_template.png'
          document.body.appendChild(a)
          a.click()
          a.remove()
          setTimeout(() => { try { URL.revokeObjectURL(url) } catch {} }, 4000)
        } catch (e) { console.error('[uv-editor] template download', e) }
      }, 'image/png')
    } catch (e) { console.error('[uv-editor] template', e) }
  }

  /* ── UV ↔ 3D 高亮联动（highlightFace 钩子） ─────────────────────────── */

  function clearHighlight3d() {
    if (!hlFace) return
    if (typeof hooks.highlightFace === 'function') {
      try { hooks.highlightFace(hlFace.el, hlFace.key, false) } catch {}
    }
    hlFace = null
  }

  function updateActiveHighlight() {
    const tgt = state.hover || state.selected
    const elRef = (tgt && tgt.el && tgt.el.el) ? tgt.el.el : null
    const key = tgt ? tgt.key : null
    if (hlFace && elRef && hlFace.el === elRef && hlFace.key === key) return
    clearHighlight3d()
    if (elRef && typeof hooks.highlightFace === 'function') {
      try {
        if (hooks.highlightFace(elRef, key, true)) hlFace = { el: elRef, key }
      } catch {}
    }
  }

  /* ── 绘制 ─────────────────────────────────── */

  function draw() {
    if (!ctx || !canvas || !canvasWrap || !visible()) return
    const layout = state.layout
    if (!layout) { showEmpty(); return }

    const tex = layout.textures[state.activeTex]
    if (!tex) { showEmpty(); return }
    const removed = !tex.url
    const rec = removed ? null : loadTexImage(tex.url)
    const img = rec && rec.ok ? rec.img : null
    const texW = img ? img.naturalWidth : (layout.uvScale || 16)
    const texH = img ? img.naturalHeight : (layout.uvScale || 16)
    /* 动画贴图仅显示首帧（帧 0 顶部区域）：面 UV 坐标即帧内像素坐标 */
    const animInfo = loadTexAnimInfo(tex, texW, texH)
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
    drawCheckerboard(W, H, Math.max(4, Math.round(px * 2)))

    /* 贴图底图（缺失时红斜纹警示；动画贴图取首帧源区域；已移除仅剩棋盘底） */
    if (img) {
      if (animInfo) ctx.drawImage(img, 0, 0, frameW, frameH, 0, 0, W, H)
      else ctx.drawImage(img, 0, 0, W, H)
    } else if (!removed) {
      drawMissing(W, H)
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

  function drawCheckerboard(W, H, size) {
    const s = Math.max(4, size)
    ctx.fillStyle = '#3a3a44'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#2e2e36'
    for (let y = 0; y < H; y += s) {
      for (let x = ((y / s) % 2) * s; x < W; x += s * 2) {
        ctx.fillRect(x, y, Math.min(s, W - x), Math.min(s, H - y))
      }
    }
  }

  function drawMissing(W, H) {
    ctx.fillStyle = 'rgba(120,32,32,.25)'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = 'rgba(230,74,74,.5)'
    ctx.lineWidth = 2
    ctx.beginPath()
    const step = Math.max(12, W / 8)
    for (let p = -H; p < W; p += step) {
      ctx.moveTo(p, 0); ctx.lineTo(p + H, H)
    }
    ctx.stroke()
  }

  function showEmpty() {
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

  function fmtUvNum(v) {
    const n = +v
    return Number.isFinite(n) && !Number.isInteger(n) ? Math.round(n * 100) / 100 : n
  }

  function updateStatus() {
    if (!statusEl) return
    const layout = state.layout
    if (!layout) { statusEl.textContent = state.notice || ''; return }
    const tex = layout.textures[state.activeTex]
    if (!tex) { statusEl.textContent = state.notice || ''; return }
    if (state.notice) { statusEl.textContent = state.notice; return }
    let faceCount = 0
    layout.elements.forEach(el => {
      for (const key in el.faces) if (el.faces[key].tex === state.activeTex) faceCount++
    })
    const rec = imgCache.get(tex.url)
    const failed = rec && rec.done && !rec.ok
    const sizeStr = rec && rec.ok && rec.img ? `${rec.img.naturalWidth}×${rec.img.naturalHeight}` : ''
    const animInfo = sizeStr ? loadTexAnimInfo(tex, rec.img.naturalWidth, rec.img.naturalHeight) : null
    const animStr = animInfo ? ` · ${t('uv.animFrames', { n: animInfo.frames })}` : ''
    const removedStr = !tex.url ? ` · ${t('uv.removed')}` : ''
    const customStr = (!tex.url || !state.customTex.has(state.activeTex)) ? '' : ` · ${t('uv.custom')}`
    let text = (tex.name || '') + (sizeStr ? ` · ${sizeStr}` : '') + animStr + customStr + removedStr + (failed ? ` · ${t('uv.missing')}` : '') + ` · ${t('uv.faces', { n: faceCount })}`
    if (state.drag && state.drag.moved) {
      const f = state.drag.rc.face
      text += '  ·  ' + `${t('uv.el')} ${state.drag.rc.elIdx} ${state.drag.rc.key} · uv [${f.uv.map(fmtUvNum).join(', ')}]`
    } else if (state.hover) {
      const f = state.hover.face
      const parts = [`${t('uv.el')} ${layout.elements.indexOf(state.hover.el)}`, state.hover.key]
      if (f.rotation) parts.push(`${t('uv.rot')} ${f.rotation}°`)
      if (f.mirror) parts.push(t('uv.mirror'))
      text += '  ·  ' + parts.join(' · ')
    } else if (state.edit && state.selected) {
      const f = state.selected.face
      text += '  ·  ' + `${t('uv.el')} ${state.selected.elIdx} ${state.selected.key} · uv [${f.uv.map(fmtUvNum).join(', ')}]`
    }
    statusEl.textContent = text
  }

  /* ── 脏状态 ─────────────────────────────────── */

  function notifyDirty() {
    if (onDirty) { try { onDirty(isDirty()) } catch {} }
  }

  function isDirty() {
    return state.undoStack.length > 0 || state.redoStack.length > 0 || state.customTex.size > 0
  }

  /* 保存成功后调用：清空撤销/重做与换图标记（贴图替换已持久化） */
  function markClean() {
    state.undoStack.length = 0
    state.redoStack.length = 0
    state.customTex.clear()
    state.snapshot = snapshotLayout(state.layout)
    syncUndoButtons()
    notifyDirty()
  }

  /* ── 启动 / 销毁 ─────────────────────────────────── */

  refresh()

  function destroy() {
    try { if (resizeObserver) resizeObserver.disconnect() } catch {}
    try { window.removeEventListener('keydown', onKeyDown) } catch {}
    try { window.removeEventListener('mcmodel:shown', onModelShown) } catch {}
    try { if (typeof offLocaleChange === 'function') offLocaleChange() } catch {}
    clearHighlight3d()
    try { if (wrap.parentNode) wrap.parentNode.removeChild(wrap) } catch {}
  }

  return {
    refresh,
    setEdit,
    isDirty,
    markClean,
    notifyDirty,
    destroy,
    get ui() { return { wrap, toolbar, canvasWrap, canvas, chipsEl, editBar, libraryBtn, exportBtn, templateBtn, statusEl } },
    get layout() { return state.layout },
  }
}
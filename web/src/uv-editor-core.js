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
import { parseAnimMeta, animFrameIndexAt, defaultFaceUv } from './mc-model-viewer.js'
import { getTexDragData } from './utils.js'
import { readAsDataURL, isUsableTexUrl } from './uvc/tex-utils.js'
import {
  draw,
  drawCheckerboard,
  drawMissing,
  showEmpty,
  fmtUvNum,
  setHooks as setUvRenderHooks
} from './uvc/render.js'
import { exportUvTemplate, exportModel, setHooks as setUvExportHooks } from './uvc/export.js'
import { startDrag, onDragMove, hitRect, hitHandle, setHooks as setUvDragHooks } from './uvc/drag.js'
import { updateStatus, setHooks as setUvStatusHooks } from './uvc/status.js'
import { applyCustomTexture, removeTexture, pickLibraryTexture, setHooks as setUvTexOpsHooks } from './uvc/texture-ops.js'

const ZOOM_STEPS = ['fit', 1, 2, 4, 8, 16]
const IMG_CACHE_MAX = 48
const ANIM_CACHE_MAX = 32
const UNDO_MAX = 120
const HANDLE_HIT = 6 /* 手柄命中半径（CSS px） */
const HANDLE_DRAW = 5 /* 手柄半边长（CSS px） */

const HANDLE_CURSOR = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize'
}

/* 贴图 / 动画元数据缓存（跨实例共享，key 均为 URL） */
const imgCache = new Map() /* url → { img, ok, done } */
const animCache = new Map() /* mcmetaUrl → { meta, anim, parsedFor, failed } */

export function createUvEditor(opts) {
  const container = opts && opts.container
  if (!container || typeof container.appendChild !== 'function') {
    throw new Error('createUvEditor: container required')
  }
  const visible = opts && typeof opts.visible === 'function' ? opts.visible : () => container.isConnected
  const getLayout = opts && typeof opts.getLayout === 'function' ? opts.getLayout : () => null
  const getLayoutPair = opts && typeof opts.getLayoutPair === 'function' ? opts.getLayoutPair : null
  const hooks = (opts && opts.hooks) || {}
  const onDirty = opts && typeof opts.onDirty === 'function' ? opts.onDirty : null

  let activeSide = 'left' /* 左右对比时当前编辑侧 */

  let canvas = null
  let ctx = null
  let canvasWrap = null
  let chipsEl = null
  let sideSeg = null
  let sideBtns = null
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
  let playBtn = null
  let statusEl = null
  let emptyEl = null
  let resizeObserver = null
  let drawPending = false
  let animRafId = 0

  const state = {
    layout: null,
    activeTex: 0,
    zoom: 'fit',
    grid: true,
    hover: null /* { el, face, key } 悬停面（el 为 layout element） */,
    rects: [] /* 最近一次绘制的面矩形（hover / 命中检测用） */,
    px: 1 /* 最近一次绘制的像素倍率（拖拽换算用） */,
    /* ── 编辑态 ── */
    edit: false,
    selected: null /* { el, face, key, elIdx } 选中面 */,
    drag: null /* { mode, rc, sx, sy, orig, moved } */,
    handles: [] /* 选中面 8 向手柄命中区 */,
    undoStack: [] /* [{ layEl, key, uv, rotation }] */,
    redoStack: [] /* 撤销的逆栈（新编辑时分叉清空） */,
    snapshot: null /* 会话基线（模型加载时快照，重置用） */,
    customTex: new Set() /* 已被自定义贴图替换的贴图索引 */,
    inputOrig: null /* 数值输入 focus 时的旧值（undo 用） */,
    notice: null /* 状态栏置顶提示（如 sprite 不支持编辑） */,
    /* ── 动画播放 ── */
    animPlaying: true,
    animTime: 0 /* 累计播放时间（秒） */,
    animLastTs: 0 /* 上一帧 rAF 时间戳 */,
    /* ── 当前贴图尺寸（UV clamp 边界用，draw 中更新） ── */
    texW: 16,
    texH: 16,
    uvMaxW: 16 /* UV 坐标水平上限（动画=帧宽，否则=贴图宽） */,
    uvMaxH: 16 /* UV 坐标垂直上限（动画=帧高，否则=贴图高） */
  }

  let hlFace = null /* 当前 3D 高亮面 { el, key }（原始 element 引用） */

  /* ── DOM 构建（结构顺序与原浮窗一致：toolbar / canvasWrap / status / 隐藏 fileInput） ── */

  const wrap = document.createElement('div')
  wrap.className = 'uvv-wrap'

  const toolbar = document.createElement('div')
  toolbar.className = 'uvv-toolbar'

  /* 左右侧切换（仅左右对比模式显示；单模型隐藏） */
  sideSeg = document.createElement('div')
  sideSeg.className = 'm3d-segment uvv-side-seg'
  sideSeg.style.display = 'none'
  sideBtns = {}
  ;['left', 'right'].forEach(side => {
    const btn = document.createElement('button')
    btn.dataset.side = side
    btn.textContent = t(side === 'left' ? 'uv.sideLeft' : 'uv.sideRight')
    btn.addEventListener('click', () => {
      if (activeSide === side) return
      activeSide = side
      sideBtns.left.classList.toggle('active', side === 'left')
      sideBtns.right.classList.toggle('active', side === 'right')
      refresh()
    })
    sideSeg.appendChild(btn)
    sideBtns[side] = btn
  })

  chipsEl = document.createElement('div')
  chipsEl.className = 'uvv-tex-chips'
  toolbar.appendChild(chipsEl)

  zoomSeg = document.createElement('select')
  zoomSeg.className = 'uvv-zoom-sel'
  ZOOM_STEPS.forEach(z => {
    const opt = document.createElement('option')
    opt.value = String(z)
    opt.textContent = z === 'fit' ? t('uv.fit') : z + 'x'
    zoomSeg.appendChild(opt)
  })
  zoomSeg.addEventListener('change', () => {
    const v = zoomSeg.value
    state.zoom = v === 'fit' ? 'fit' : +v
    draw()
  })
  toolbar.appendChild(zoomSeg)

  function mkIconBtn(iconId, title, handler, extraClass) {
    const btn = document.createElement('button')
    btn.className = 'uvv-icon-btn' + (extraClass ? ' ' + extraClass : '')
    btn.title = title
    btn.innerHTML = '<svg class="ico ico-sm"><use href="#' + iconId + '"/></svg>'
    if (handler) btn.addEventListener('click', handler)
    return btn
  }

  gridBtn = mkIconBtn(
    'i-grid',
    t('uv.grid'),
    () => {
      state.grid = !state.grid
      gridBtn.classList.toggle('active', state.grid)
      draw()
    },
    'active'
  )
  toolbar.appendChild(gridBtn)

  playBtn = mkIconBtn('i-play', t('uv.play'), () => {
    state.animPlaying = !state.animPlaying
    state.animTime = 0
    state.animLastTs = 0
    playBtn.classList.toggle('active', state.animPlaying)
    draw()
  })
  playBtn.style.display = 'none'
  toolbar.appendChild(playBtn)

  editBtn = mkIconBtn('i-sliders', t('uv.editTitle'), () => setEdit(!state.edit), 'uvv-edit-btn')
  toolbar.appendChild(editBtn)

  uploadBtn = mkIconBtn('i-image', t('uv.uploadTitle'), () => {
    if (fileInput) fileInput.click()
  })
  toolbar.appendChild(uploadBtn)

  libraryBtn = mkIconBtn('i-palette', t('uv.libraryTitle'), pickLibraryTexture)
  toolbar.appendChild(libraryBtn)

  exportBtn = mkIconBtn('i-download', t('uv.exportTitle'), exportModel)
  toolbar.appendChild(exportBtn)

  templateBtn = mkIconBtn('i-file', t('uv.templateTitle'), exportUvTemplate)
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
    inp.addEventListener('change', () => {
      applyUvInput()
    })
    editBar.appendChild(inp)
    return inp
  })
  rotBtn = mkIconBtn('i-swap', t('uv.rotateTitle'), rotateSelected)
  editBar.appendChild(rotBtn)
  mirrorBtn = mkIconBtn('i-compare', t('uv.mirrorTitle'), mirrorSelected)
  editBar.appendChild(mirrorBtn)
  remakeBtn = mkIconBtn('i-refresh', t('uv.remakeTitle'), remakeSelected)
  editBar.appendChild(remakeBtn)
  undoBtn = mkIconBtn('i-undo', t('uv.undoTitle') + ' (Ctrl+Z)', undoEdit)
  editBar.appendChild(undoBtn)
  redoBtn = mkIconBtn('i-undo', t('uv.redoTitle') + ' (Ctrl+Shift+Z / Ctrl+Y)', redoEdit, 'uvv-flip-x')
  redoBtn.disabled = true
  editBar.appendChild(redoBtn)
  resetBtn = mkIconBtn('i-trash', t('uv.resetTitle'), resetEdits)
  editBar.appendChild(resetBtn)
  const hint = document.createElement('span')
  hint.className = 'uvv-edit-hint'
  hint.textContent = t('uv.editHint')
  editBar.appendChild(hint)
  toolbar.appendChild(editBar)
  toolbar.appendChild(sideSeg)

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
    try {
      fileInput.value = ''
    } catch {}
  })

  canvasWrap.addEventListener('dragover', e => {
    if (!state.layout) return
    e.preventDefault()
    canvasWrap.classList.add('uvv-drop-active')
  })
  canvasWrap.addEventListener('dragleave', () => canvasWrap.classList.remove('uvv-drop-active'))
  canvasWrap.addEventListener('drop', e => {
    e.preventDefault()
    canvasWrap.classList.remove('uvv-drop-active')
    /* 资产库贴图卡片拖入：raw URL 直接替换当前贴图槽位（材质球带 normal/specular → PBR 预览） */
    const tex = getTexDragData(e.dataTransfer)
    if (tex) {
      if (state.layout && isUsableTexUrl(tex.url)) {
        const extra =
          tex.normal || tex.specular ? { normal: tex.normal || '', specular: tex.specular || '' } : undefined
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
  wrap.appendChild(fileInput) /* 隐藏上传 input（尾部，不占结构索引） */

  container.appendChild(wrap)
  ctx = canvas.getContext('2d')

  canvas.addEventListener('mousemove', e => {
    if (state.drag) return
    const r = canvas.getBoundingClientRect()
    const mx = e.clientX - r.left,
      my = e.clientY - r.top
    const hit = hitRect(mx, my)
    const same = hit && state.hover ? hit.el === state.hover.el && hit.key === state.hover.key : !hit && !state.hover
    if (!same) {
      state.hover = hit ? { el: hit.el, face: hit.face, key: hit.key } : null
      updateStatus()
      updateActiveHighlight()
      draw()
    }
    if (state.edit) {
      const h = state.selected ? hitHandle(mx, my) : null
      canvas.style.cursor = h ? HANDLE_CURSOR[h.mode] : hit ? 'move' : 'crosshair'
    }
  })
  canvas.addEventListener('mouseleave', () => {
    if (state.hover) {
      state.hover = null
      updateStatus()
      updateActiveHighlight()
      draw()
    }
  })

  /* 编辑拖拽（pointer events 支持触控笔/触摸） */
  canvas.addEventListener('pointerdown', e => {
    if (!state.edit || state.drag || !state.layout) return
    const r = canvas.getBoundingClientRect()
    const mx = e.clientX - r.left,
      my = e.clientY - r.top
    const h = state.selected ? hitHandle(mx, my) : null
    if (h) {
      startDrag(e, h.mode, mx, my)
      return
    }
    const rc = hitRect(mx, my)
    if (rc) {
      selectFace(rc)
      startDrag(e, 'move', mx, my)
    } else if (state.selected) {
      clearSelection()
    }
  })
  canvas.addEventListener('pointermove', e => {
    if (!state.drag) return
    const r = canvas.getBoundingClientRect()
    onDragMove(e.clientX - r.left, e.clientY - r.top, e.altKey)
  })
  const endDrag = e => {
    const d = state.drag
    if (!d) return
    state.drag = null
    try {
      canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId)
    } catch {}
    if (d.moved) pushUndo({ layEl: d.rc.el, key: d.rc.key, uv: [...d.orig], rotation: d.rc.face.rotation })
    updateStatus()
    draw()
  }
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)

  /* Ctrl+Z 撤销 / Ctrl+Shift+Z 或 Ctrl+Y 重做（输入框聚焦时放行浏览器原生行为） */
  const onKeyDown = e => {
    if (!visible() || !state.edit) return
    if (!(e.ctrlKey || e.metaKey)) return
    const k = e.key
    const isUndo = (k === 'z' || k === 'Z') && !e.shiftKey
    const isRedo = k === 'y' || k === 'Y' || ((k === 'z' || k === 'Z') && e.shiftKey)
    if (!isUndo && !isRedo) return
    const tag = e.target && e.target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    e.preventDefault()
    if (isUndo) undoEdit()
    else redoEdit()
  }
  window.addEventListener('keydown', onKeyDown)

  const onModelShown = () => {
    if (visible()) refresh()
  }
  if (!opts || opts.autoRefreshOnModelShown !== false) {
    window.addEventListener('mcmodel:shown', onModelShown)
  }

  const offLocaleChange = onLocaleChange(() => {
    gridBtn.title = t('uv.grid')
    playBtn.title = state.animPlaying ? t('uv.pause') : t('uv.play')
    editBtn.title = t('uv.editTitle')
    uploadBtn.title = t('uv.uploadTitle')
    libraryBtn.title = t('uv.libraryTitle')
    exportBtn.title = t('uv.exportTitle')
    templateBtn.title = t('uv.templateTitle')
    rotBtn.title = t('uv.rotateTitle')
    mirrorBtn.title = t('uv.mirrorTitle')
    remakeBtn.title = t('uv.remakeTitle')
    undoBtn.title = t('uv.undoTitle') + ' (Ctrl+Z)'
    redoBtn.title = t('uv.redoTitle') + ' (Ctrl+Shift+Z / Ctrl+Y)'
    resetBtn.title = t('uv.resetTitle')
    refresh()
  })

  resizeObserver = new ResizeObserver(() => draw())
  resizeObserver.observe(canvasWrap)

  /* ── 数据刷新 ─────────────────────────────────── */

  function refresh() {
    clearHighlight3d()
    const pair = getLayoutPair ? getLayoutPair() : null
    let layout
    if (pair && (pair.left || pair.right)) {
      layout = pair[activeSide] || pair.left || pair.right
      const hasL = !!pair.left,
        hasR = !!pair.right
      sideSeg.style.display = ''
      sideBtns.left.style.display = hasL ? '' : 'none'
      sideBtns.right.style.display = hasR ? '' : 'none'
      if (!hasL && activeSide === 'left') activeSide = 'right'
      if (!hasR && activeSide === 'right') activeSide = 'left'
      sideBtns.left.classList.toggle('active', activeSide === 'left')
      sideBtns.right.classList.toggle('active', activeSide === 'right')
    } else {
      sideSeg.style.display = 'none'
      layout = getLayout()
    }
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
    state.animTime = 0
    state.animLastTs = 0
    syncUndoButtons()
    notifyDirty()
    if (state.layout) {
      for (const tex of state.layout.textures) {
        if (tex.url) loadTexImage(tex.url)
      }
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
      chip.textContent = (tex.name || '#' + i) + (removed ? ' ⊘' : state.customTex.has(i) ? ' ✎' : '')
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
      chip.addEventListener('contextmenu', e => {
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
    img.onload = () => {
      rec.img = img
      rec.ok = true
      rec.done = true
      requestDraw()
    }
    img.onerror = () => {
      rec.img = null
      rec.ok = false
      rec.done = true
      requestDraw()
    }
    img.src = url
    return rec
  }

  function requestDraw() {
    if (drawPending || !visible()) return
    drawPending = true
    requestAnimationFrame(() => {
      drawPending = false
      draw()
    })
  }

  /* ── 动画贴图元数据（.png.mcmeta）──────────────────────
     UV 编辑器为静态分析工具：动画贴图固定显示首帧（帧 0 顶部区域），
     面矩形 UV 坐标即帧内像素坐标；缓存 null = 非动画或仍在加载。
     mcmeta 原始 JSON 只请求一次；解析在贴图真实尺寸就绪后重试
     （首次调用时贴图可能未加载，临时尺寸会误判单帧 → 贴图 onload
     后以 naturalWidth/Height 重新解析出帧区域）。 */

  function tryParseAnim(entry, texW, texH) {
    if (!entry || !entry.meta || entry.anim || entry.failed) return
    const w = +texW || 0,
      h = +texH || 0
    if (w <= 0 || h <= 0) return
    const sizeKey = w + 'x' + h
    if (entry.parsedFor === sizeKey) return /* 同尺寸已解析（null 不重试） */
    entry.parsedFor = sizeKey
    const anim = parseAnimMeta(entry.meta, w, h)
    if (anim) {
      entry.anim = { frameW: anim.frameW, frameH: anim.frameH, frames: anim.frameCount }
      requestDraw()
    }
  }

  function loadTexAnimInfo(tex, texW, texH) {
    const url = tex && typeof tex.mcmetaUrl === 'string' ? tex.mcmetaUrl : null
    if (!url) return null
    if (!animCache.has(url)) {
      if (animCache.size > ANIM_CACHE_MAX) animCache.clear()
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

    if (layEl.el && typeof hooks.onFaceUv === 'function') {
      try {
        hooks.onFaceUv(layEl.el, key, face.uv)
      } catch {}
    }
    return true
  }

  function applyFaceRotationValue(layEl, key, rotation) {
    const face = layEl && layEl.faces ? layEl.faces[key] : null
    if (!face) return false
    face.rotation = Number.isFinite(+rotation) ? (((Math.round(+rotation / 90) * 90) % 360) + 360) % 360 : 0
    if (layEl.el && typeof hooks.onFaceRotation === 'function') {
      try {
        hooks.onFaceRotation(layEl.el, key, face.rotation)
      } catch {}
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
    if (!f || !state.selected) {
      state.inputOrig = null
      return
    }
    const uv = uvInputs.map(inp => +inp.value)
    const maxW = state.uvMaxW || 16
    const maxH = state.uvMaxH || 16
    if (!uv.every(n => Number.isFinite(n))) {
      syncEditInputs()
      return
    }
    const cuv = [
      Math.min(Math.max(Math.round(uv[0] * 4) / 4, 0), maxW),
      Math.min(Math.max(Math.round(uv[1] * 4) / 4, 0), maxH),
      Math.min(Math.max(Math.round(uv[2] * 4) / 4, 0), maxW),
      Math.min(Math.max(Math.round(uv[3] * 4) / 4, 0), maxH)
    ]
    if (cuv.every((v, i) => v === f.uv[i])) {
      state.inputOrig = null
      return
    }
    const orig = state.inputOrig && state.inputOrig.length === 4 ? [...state.inputOrig] : [...f.uv]
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
    const f = layEl && layEl.faces ? layEl.faces[key] : null
    if (!f) return null
    return { layEl, key, uv: Array.isArray(f.uv) ? [...f.uv] : null, rotation: f.rotation || 0 }
  }

  function applyHistoryEntry(entry) {
    if (Array.isArray(entry.uv)) applyFaceUvValues(entry.layEl, entry.key, entry.uv)
    if (entry.rotation != null) applyFaceRotationValue(entry.layEl, entry.key, entry.rotation)
  }

  function pushUndo(entry) {
    state.undoStack.push(entry)
    state.redoStack.length = 0 /* 新编辑 → 重做历史分叉失效 */
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
    if (cur && cur.uv) state.undoStack.push(cur) /* 直接入栈（不经 pushUndo，避免清空 redo） */
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
      for (const key in el.faces || {}) {
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


  /* ── 自定义贴图（上传 / 拖放 → dataURL 替换 + 换图钩子） ──────────
     多文件：从当前选中贴图槽位起按顺序替换（画师一次导出多张贴图逐槽位对应）；
     超出贴图槽数的文件忽略——新增空槽位无意义（无 face 引用的贴图不会显示） */

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

  /* 移除材质：清空贴图槽位引用（face.tex 索引保持不变，不删除槽位本身）；
     UV 画布仅剩棋盘底 + 面矩形，3D 视口面变纯色（onTexture 空串 → 宿主清除材质）；
     重新上传 / 拖入 / 贴图库选择即可恢复 */
  /* 贴图库选择：hooks.pickTexture 可覆盖（返回 Promise<{name,url,normal,specular}|null>）；
     默认动态加载 uv-tex-picker 浮窗（总资产库材质球 → raw URL）。
     返回材质组：主图写入 UV 槽位，normal/specular 透传宿主做 3D 视口 PBR 预览 */
  /* 状态栏短暂提示（3s 后自动让位给常规状态文本） */
  function flashNotice(msg) {
    state.notice = msg
    updateStatus()
    setTimeout(() => {
      if (state.notice === msg) {
        state.notice = null
        updateStatus()
      }
    }, 3000)
  }

  /* ── 导出编辑后的模型 JSON（经 exportJson 钩子） ─────────────────────────── */

  /* ── UV 线框模板导出（透明底 PNG，画师填色用） ───────────────────
     与贴图同尺寸 1:1 输出：uvScale 网格 + 每元素面矩形（元素色描边 +
     低透明度填充 + 面标签），可直接垫在像素画软件的底图层。 */

  /* ── UV ↔ 3D 高亮联动（highlightFace 钩子） ─────────────────────────── */

  function clearHighlight3d() {
    if (!hlFace) return
    if (typeof hooks.highlightFace === 'function') {
      try {
        hooks.highlightFace(hlFace.el, hlFace.key, false)
      } catch {}
    }
    hlFace = null
  }

  function updateActiveHighlight() {
    const tgt = state.hover || state.selected
    const elRef = tgt && tgt.el && tgt.el.el ? tgt.el.el : null
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


  /* ── 脏状态 ─────────────────────────────────── */

  function notifyDirty() {
    if (onDirty) {
      try {
        onDirty(isDirty())
      } catch {}
    }
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
    try {
      if (animRafId) cancelAnimationFrame(animRafId)
      animRafId = 0
    } catch {}
    try {
      if (resizeObserver) resizeObserver.disconnect()
    } catch {}
    try {
      window.removeEventListener('keydown', onKeyDown)
    } catch {}
    try {
      window.removeEventListener('mcmodel:shown', onModelShown)
    } catch {}
    try {
      if (typeof offLocaleChange === 'function') offLocaleChange()
    } catch {}
    clearHighlight3d()
    try {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap)
    } catch {}
  }

  /* 导出模块的闭包状态注入 */
  setUvExportHooks({
    get_state: () => state,
    t: t,
    get_hooks: () => hooks
  })

  /* 状态刷新模块的闭包依赖注入 */
  setUvStatusHooks({
    get_state: () => state,
    get_statusEl: () => statusEl,
    t: t,
    rebuildChips: rebuildChips,
    draw: draw
  })

  /* 贴图槽位操作模块的依赖注入 */
  setUvTexOpsHooks({
    get_state: () => state,
    get_layout: () => layout,
    get_hooks: () => hooks,
    draw: draw,
    notifyDirty: notifyDirty,
    updateStatus: updateStatus
  })

  /* 绘制模块的闭包状态注入（只读，getter 转发） */
  setUvRenderHooks({
    get_ctx: () => ctx,
    get_canvas: () => canvas,
    get_canvasWrap: () => canvasWrap,
    get_state: () => state,
    visible: visible,
    t: t,
    loadTexImage: loadTexImage,
    loadTexAnimInfo: loadTexAnimInfo
  })

  return {
    refresh,
    setEdit,
    isDirty,
    markClean,
    notifyDirty,
    destroy,
    get ui() {
      return { wrap, toolbar, canvasWrap, canvas, chipsEl, editBar, libraryBtn, exportBtn, templateBtn, statusEl }
    },
    get layout() {
      return state.layout
    }
  }
}

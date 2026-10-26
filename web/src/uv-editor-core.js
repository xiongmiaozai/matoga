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

import { ZOOM_STEPS, IMG_CACHE_MAX, UNDO_MAX, HANDLE_HIT, HANDLE_DRAW, HANDLE_CURSOR } from './uvc/consts.js'
import { drawCheckerboard, drawMissing } from './uvc/draw-helpers.js'
import { fmtUvNum } from './uvc/utils.js'
import { imgCache, loadTexImage, loadTexAnimInfo } from './uvc/tex-cache.js'
import { applyFaceUvValues, applyFaceRotationValue, faceEntryOf, applyHistoryEntry, snapshotLayout } from './uvc/face-ops.js'
import { hitRect as hitRectIn, hitHandle as hitHandleIn, isUsableTexUrl } from './uvc/hit-test.js'
import { exportModel as exportModelImpl, exportUvTemplate as exportUvTemplateImpl } from './uvc/exporters.js'
import { buildStatusText } from './uvc/status.js'
import { buildUvUi } from './uvc/ui-build.js'
import { createPainter } from './uvc/painter.js'
import { createSelection } from './uvc/selection.js'
import { createHistory } from './uvc/history.js'
import { createDrag } from './uvc/drag.js'
import { createTextureIO } from './uvc/texture-io.js'


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

  const onModelShown = () => { if (visible()) refresh() }

  const ui = buildUvUi({
    t, state, container,
    autoRefreshOnModelShown: opts ? opts.autoRefreshOnModelShown : undefined,
    getTexDragData, isUsableTexUrl, onLocaleChange, refresh,
    draw: (...args) => draw(...args),
    setEdit: (...args) => setEdit(...args),
    selectedFace: (...args) => selectedFace(...args),
    applyUvInput: (...args) => applyUvInput(...args),
    rotateSelected: (...args) => rotateSelected(...args),
    mirrorSelected: (...args) => mirrorSelected(...args),
    remakeSelected: (...args) => remakeSelected(...args),
    undoEdit: (...args) => undoEdit(...args),
    redoEdit: (...args) => redoEdit(...args),
    resetEdits: (...args) => resetEdits(...args),
    pickLibraryTexture: (...args) => pickLibraryTexture(...args),
    exportModel: (...args) => exportModel(...args),
    exportUvTemplate: (...args) => exportUvTemplate(...args),
    handleTextureFiles: (...args) => handleTextureFiles(...args),
    applyCustomTexture: (...args) => applyCustomTexture(...args),
    hitRect: (...args) => hitRect(...args),
    hitHandle: (...args) => hitHandle(...args),
    startDrag: (...args) => startDrag(...args),
    onDragMove: (...args) => onDragMove(...args),
    selectFace: (...args) => selectFace(...args),
    clearSelection: (...args) => clearSelection(...args),
    pushUndo: (...args) => pushUndo(...args),
    updateStatus: (...args) => updateStatus(...args),
    updateActiveHighlight: (...args) => updateActiveHighlight(...args),
    visible: (...args) => visible(...args),
    onModelShown,
  })

  canvas = ui.canvas
  ctx = ui.getCtx()
  canvasWrap = ui.canvasWrap
  chipsEl = ui.chipsEl
  zoomSeg = ui.zoomSeg
  gridBtn = ui.gridBtn
  editBtn = ui.editBtn
  uploadBtn = ui.uploadBtn
  exportBtn = ui.exportBtn
  templateBtn = ui.templateBtn
  fileInput = ui.fileInput
  editBar = ui.editBar
  uvInputs = ui.uvInputs
  rotBtn = ui.rotBtn
  mirrorBtn = ui.mirrorBtn
  remakeBtn = ui.remakeBtn
  undoBtn = ui.undoBtn
  redoBtn = ui.redoBtn
  resetBtn = ui.resetBtn
  libraryBtn = ui.libraryBtn
  statusEl = ui.statusEl
  emptyEl = ui.emptyEl
  resizeObserver = ui.resizeObserver


  /* 重绘节流：不可见时跳过，同一帧内多次请求合并为一次 */
  function requestDraw() {
    if (drawPending || !visible()) return
    drawPending = true
    requestAnimationFrame(() => { drawPending = false; draw() })
  }

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
      for (const tex of state.layout.textures) { if (tex.url) loadTexImage(tex.url, requestDraw) }
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


  /* ── 编辑：值应用（layout face + 原始 element 写回 → 联动钩子） ────────── */

  let _selection = null
  function getSelection() {
    if (!_selection) {
      _selection = createSelection({
        state, hooks, t, pushUndo, syncUndoButtons,
        getEls: () => ({ canvas, editBtn, editBar, uvInputs }),
        updateActiveHighlight: (...a) => updateActiveHighlight(...a),
        draw: (...a) => draw(...a),
        updateStatus: (...a) => updateStatus(...a),
      })
    }
    return _selection
  }

  function selectedFace() { return getSelection().selectedFace() }
  function selectedRect() { return getSelection().selectedRect() }
  function selectFace(rc) { return getSelection().selectFace(rc) }
  function clearSelection() { return getSelection().clearSelection() }
  function setEdit(on) { return getSelection().setEdit(on) }
  function syncEditInputs() { return getSelection().syncEditInputs() }
  function applyUvInput() { return getSelection().applyUvInput() }
  function rotateSelected() { return getSelection().rotateSelected() }
  function mirrorSelected() { return getSelection().mirrorSelected() }

  /* ── 撤销 / 重做 / 重制 / 重置 ─────────────────────────── */

  let _history = null
  function getHistory() {
    if (!_history) {
      _history = createHistory({
        state, hooks, t, defaultFaceUv, notifyDirty,
        getEls: () => ({ undoBtn, redoBtn }),
        selectedFace: (...a) => selectedFace(...a),
        syncEditInputs: (...a) => syncEditInputs(...a),
        updateStatus: (...a) => updateStatus(...a),
        draw: (...a) => draw(...a),
      })
    }
    return _history
  }

  function pushUndo(entry) { return getHistory().pushUndo(entry) }
  function undoEdit() { return getHistory().undoEdit() }
  function redoEdit() { return getHistory().redoEdit() }
  function syncUndoButtons() { return getHistory().syncUndoButtons() }
  function remakeSelected() { return getHistory().remakeSelected() }
  function resetEdits() { return getHistory().resetEdits() }

  /* ── 拖拽编辑（移动 / 手柄缩放）────────────────────── */

  let _drag = null
  function getDrag() {
    if (!_drag) {
      _drag = createDrag({
        state, hooks,
        getCanvas: () => canvas,
        selectedRect: (...a) => selectedRect(...a),
        hitRect: (mx, my) => hitRect(mx, my),
        syncEditInputs: (...a) => syncEditInputs(...a),
        updateStatus: (...a) => updateStatus(...a),
        requestDraw: (...a) => requestDraw(...a),
      })
    }
    return _drag
  }

  function startDrag(e, mode, mx, my) { return getDrag().startDrag(e, mode, mx, my) }
  function onDragMove(mx, my, altKey) { return getDrag().onDragMove(mx, my, altKey) }

  function hitRect(mx, my) { return hitRectIn(state.rects, mx, my) }
  function hitHandle(mx, my) { return hitHandleIn(state.handles, mx, my) }

  /* ── 自定义贴图（上传 / 拖放 → dataURL 替换 + 换图钩子） ──────────
     多文件：从当前选中贴图槽位起按顺序替换（画师一次导出多张贴图逐槽位对应）；
     超出贴图槽数的文件忽略——新增空槽位无意义（无 face 引用的贴图不会显示） */

  /* ── 自定义贴图（上传 / 拖放 → dataURL 替换 + 换图钩子） ────────── */

  let _texIO = null
  function getTexIO() {
    if (!_texIO) {
      _texIO = createTextureIO({
        state, hooks, t, isUsableTexUrl, rebuildChips, requestDraw, notifyDirty, flashNotice,
        draw: (...a) => draw(...a),
        updateStatus: (...a) => updateStatus(...a),
      })
    }
    return _texIO
  }

  function handleTextureFiles(files) { return getTexIO().handleTextureFiles(files) }
  function applyCustomTexture(dataUrl, filename, texIndex) { return getTexIO().applyCustomTexture(dataUrl, filename, texIndex) }
  function removeTexture(texIndex) { return getTexIO().removeTexture(texIndex) }
  function pickLibraryTexture() { return getTexIO().pickLibraryTexture() }


  /* 状态栏短暂提示（3s 后自动让位给常规状态文本） */
  function flashNotice(msg) {
    state.notice = msg
    updateStatus()
    setTimeout(() => {
      if (state.notice === msg) { state.notice = null; updateStatus() }
    }, 3000)
  }

  function exportModel() { exportModelImpl(hooks) }
  function exportUvTemplate() { exportUvTemplateImpl(state.layout, state.activeTex) }

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

  let _painter = null
  function getPainter() {
    if (!_painter) {
      _painter = createPainter({
        getEls: () => ({ ctx, canvas, canvasWrap, emptyEl, statusEl }),
        state, visible, requestDraw, selectedRect, updateStatus, t,
      })
    }
    return _painter
  }

  function draw() { return getPainter().draw() }
  function showEmpty() { return getPainter().showEmpty() }
  function updateStatus() {
    if (!statusEl) return
    const layout = state.layout
    const tex = layout && layout.textures[state.activeTex]
    const rec = tex ? imgCache.get(tex.url) : null
    const animInfo = (rec && rec.ok && rec.img)
      ? loadTexAnimInfo(tex, rec.img.naturalWidth, rec.img.naturalHeight, requestDraw)
      : null
    statusEl.textContent = buildStatusText({
      t, layout, activeTex: state.activeTex, notice: state.notice,
      isCustom: state.customTex.has(state.activeTex),
      drag: state.drag, hover: state.hover, selected: state.selected, edit: state.edit,
      rec, animInfo,
    })
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

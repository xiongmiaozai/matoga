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
import { fmtUvNum, readAsDataURL } from './uvc/utils.js'
import { imgCache, loadTexImage, loadTexAnimInfo } from './uvc/tex-cache.js'
import { applyFaceUvValues, applyFaceRotationValue, faceEntryOf, applyHistoryEntry, snapshotLayout } from './uvc/face-ops.js'
import { hitRect as hitRectIn, hitHandle as hitHandleIn, isUsableTexUrl } from './uvc/hit-test.js'
import { exportModel as exportModelImpl, exportUvTemplate as exportUvTemplateImpl } from './uvc/exporters.js'
import { buildStatusText } from './uvc/status.js'
import { buildUvUi } from './uvc/ui-build.js'
import { createPainter } from './uvc/painter.js'
import { createSelection } from './uvc/selection.js'


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

  /* 取 layout 面当前值（撤销/重做互推时保存“另一侧”状态用） */
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
    applyHistoryEntry(entry, hooks)
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
    applyHistoryEntry(entry, hooks)
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
    applyFaceUvValues(layEl, state.selected.key, def, hooks)
    syncEditInputs()
    updateStatus()
    draw()
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
        applyFaceUvValues(el, key, sf.uv, hooks)
        applyFaceRotationValue(el, key, sf.rotation, hooks)
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
    applyFaceUvValues(d.rc.el, d.rc.key, uv, hooks)
    syncEditInputs()
    updateStatus()
    requestDraw()
  }

  function hitRect(mx, my) { return hitRectIn(state.rects, mx, my) }
  function hitHandle(mx, my) { return hitHandleIn(state.handles, mx, my) }

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

  function applyCustomTexture(dataUrl, filename, texIndex) {
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
    loadTexImage(dataUrl, requestDraw)   /* 预载 → onload 后重绘 */
    if (typeof hooks.onTexture === 'function') {
      try { Promise.resolve(hooks.onTexture(i, dataUrl, layout)).catch(() => {}) } catch {}
    }
    updateStatus()
    draw()
    notifyDirty()
  }

  /* 可用作贴图的 URL：dataURL / http(s) / 站内相对路径（/api/...） */
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

  /* 贴图库选择：hooks.pickTexture 可覆盖（返回 Promise<{name,url}|null>）；
     默认动态加载 uv-tex-picker 浮窗（总资产库贴图 → raw URL） */
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
      applyCustomTexture(picked.url, picked.name || null)
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

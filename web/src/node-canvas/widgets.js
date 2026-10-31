/**
 * matoga - 节点画布：控件（widgets）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 node-canvas.js 的「widgets」段原样搬出，逻辑未改。
 * 滑条/取色等 input 的高频求值合并到下一帧（rAF），拖动时每帧至多一次。
 *
 * 段内依赖 evaluate / _markDirty 属于主文件状态机，通过 setWidgetHooks 注入，
 * 避免子模块反向 import 主文件形成循环依赖。
 */

import { uiPrompt } from '../ui-dialog.js'
import { clamp } from './math.js'

/* 主文件注入的钩子：触发整图求值与脏标记 */
let _evaluate = () => {}
let _markDirty = () => {}
export function setWidgetHooks(hooks) {
  if (typeof hooks.evaluate === 'function') _evaluate = hooks.evaluate
  if (typeof hooks.markDirty === 'function') _markDirty = hooks.markDirty
}

/* 轻提示。主文件的 toast 是模块内私有函数，拆分后此处需要自带一份：
   只操作 #toast、定时器挂在本函数上，无跨模块状态，与主文件行为一致。 */
export function toast(msg) {
  const t = document.querySelector('#toast')
  if (!t) return
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(toast._timer)
  toast._timer = setTimeout(() => t.classList.remove('show'), 2000)
}

/* ── widgets ───────────────────────────────── */
/* 滑条/取色 input 高频触发的求值合并到下一帧（rAF）：拖动时每帧至多一次 evaluate，
   避免 input 事件栈内同步执行整图求值+纹理生成导致掉帧 */
export let _evalScheduled = false
export function _scheduleEval() {
  if (_evalScheduled) return
  _evalScheduled = true
  const tick = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : f => setTimeout(f, 0)
  tick(() => {
    _evalScheduled = false
    _evaluate()
    _markDirty()
  })
}
export function numWidget(node, key, min, max, step) {
  const box = document.createElement('div')
  box.className = 'w-num'
  const inp = document.createElement('input')
  inp.type = 'range'
  inp.min = min
  inp.max = max
  inp.step = step
  inp.value = node.props[key]
  const val = document.createElement('span')
  val.className = 'val'
  val.textContent = (+node.props[key]).toFixed(2)
  inp.addEventListener('input', () => {
    node.props[key] = +inp.value
    val.textContent = (+inp.value).toFixed(2)
    _scheduleEval()
  })
  // 双击可输入
  val.addEventListener('dblclick', async () => {
    const v = await uiPrompt({ title: '输入数值', label: node.props[key] + '', value: node.props[key] + '' })
    if (v !== null && !isNaN(+v)) {
      node.props[key] = clamp(+v, min, max)
      inp.value = node.props[key]
      val.textContent = (+node.props[key]).toFixed(2)
      _evaluate()
      _markDirty()
    }
  })
  box.appendChild(inp)
  box.appendChild(val)
  return box
}
export function colorWidget(node, key) {
  const box = document.createElement('div')
  box.className = 'w-color'
  const inp = document.createElement('input')
  inp.type = 'color'
  inp.value = node.props[key]
  const hex = document.createElement('span')
  hex.className = 'hex'
  hex.textContent = node.props[key]
  inp.addEventListener('input', () => {
    node.props[key] = inp.value
    hex.textContent = inp.value
    _scheduleEval()
  })
  box.appendChild(inp)
  box.appendChild(hex)
  return box
}
export function vecWidget(node, keys, min, max, step) {
  const box = document.createElement('div')
  keys.forEach(k => {
    const row = document.createElement('div')
    row.className = 'w-num'
    row.style.marginBottom = '4px'
    const lbl = document.createElement('span')
    lbl.className = 'w-label'
    lbl.style.margin = '0 6px 0 0'
    lbl.textContent = k + ':'
    lbl.style.textTransform = 'none'
    lbl.style.letterSpacing = '0'
    const inp = document.createElement('input')
    inp.type = 'range'
    inp.min = min
    inp.max = max
    inp.step = step
    inp.value = node.props[k]
    const val = document.createElement('span')
    val.className = 'val'
    val.textContent = (+node.props[k]).toFixed(2)
    inp.addEventListener('input', () => {
      node.props[k] = +inp.value
      val.textContent = (+inp.value).toFixed(2)
      _scheduleEval()
    })
    row.appendChild(lbl)
    row.appendChild(inp)
    row.appendChild(val)
    box.appendChild(row)
  })
  return box
}
export function textureWidget(node, key) {
  const box = document.createElement('div')
  box.className = 'w-tex'
  const thumb = document.createElement('div')
  thumb.className = 'thumb'
  const info = document.createElement('div')
  info.className = 'info'
  const fn = document.createElement('div')
  fn.className = 'fn'
  fn.textContent = '未选择'
  const btn = document.createElement('div')
  btn.className = 'btn'
  btn.textContent = '选择图片…'
  info.appendChild(fn)
  info.appendChild(btn)
  box.appendChild(thumb)
  box.appendChild(info)
  if (node.props[key]) {
    thumb.innerHTML = `<img src="${node.props[key]}" alt="">`
    fn.textContent = (node.props._name || node.props[key].split('/').pop()).slice(0, 20)
  }
  btn.addEventListener('click', () => {
    const f = document.createElement('input')
    f.type = 'file'
    f.accept = 'image/*'
    f.addEventListener('change', () => {
      const file = f.files[0]
      if (!file) return
      const r = new FileReader()
      r.onload = () => {
        node.props[key] = r.result
        node.props._name = file.name
        thumb.innerHTML = `<img src="${r.result}" alt="">`
        fn.textContent = file.name.slice(0, 20)
        _evaluate()
        _markDirty()
      }
      r.readAsDataURL(file)
    })
    f.click()
  })
  return box
}
export function rgbaMergeWidget(node) {
  const box = document.createElement('div')
  box.className = 'w-multi'
  const hint = document.createElement('div')
  hint.style.cssText = 'font-size:10px;color:var(--text-dim);margin-bottom:4px;line-height:1.4;'
  hint.textContent = '连线贴图 / 噪波 tex 输入时取图像通道，常量仅作未连线兜底'
  box.appendChild(hint)
  box.appendChild(_labeledRow('R 常量', numWidget(node, 'r', 0, 1, 0.01)))
  box.appendChild(_labeledRow('G 常量', numWidget(node, 'g', 0, 1, 0.01)))
  box.appendChild(_labeledRow('B 常量', numWidget(node, 'b', 0, 1, 0.01)))
  box.appendChild(_labeledRow('A 常量', numWidget(node, 'a', 0, 1, 0.01)))
  const sizeInp = document.createElement('input')
  sizeInp.type = 'number'
  sizeInp.className = 'w-text'
  sizeInp.min = 16
  sizeInp.step = 64
  sizeInp.placeholder = '自动/自定义'
  sizeInp.value = node.props.size ?? ''
  sizeInp.title = '留空=自动（取输入纹理尺寸）；可输入任意值，如 4096'
  sizeInp.addEventListener('change', () => {
    const raw = sizeInp.value.trim()
    if (raw === '') {
      node.props.size = null
    } else {
      const v = Math.max(16, Math.round(+raw))
      if (!isFinite(v)) {
        sizeInp.value = ''
        node.props.size = null
        return
      }
      node.props.size = v
      sizeInp.value = v
    }
    _evaluate()
    _markDirty()
  })
  box.appendChild(_labeledRow('尺寸', sizeInp))
  const actions = document.createElement('div')
  actions.className = 'w-tex'
  actions.style.marginTop = '4px'
  const info = document.createElement('div')
  info.className = 'info'
  const btn = document.createElement('div')
  btn.className = 'btn'
  btn.textContent = '保存 PNG'
  info.appendChild(btn)
  actions.appendChild(info)
  box.appendChild(actions)
  btn.addEventListener('click', () => {
    const url = node._rgbaUrl
    if (!url) {
      toast('RGBA 尚未合成（等待输入或常量求值）')
      return
    }
    const a = document.createElement('a')
    a.href = url
    a.download = 'matoga-rgba.png'
    a.click()
  })
  return box
}
export function rgbaSplitWidget(node) {
  const box = document.createElement('div')
  box.className = 'w-multi'
  const hint = document.createElement('div')
  hint.style.cssText = 'font-size:10px;color:var(--text-dim);margin-bottom:4px;line-height:1.4;'
  hint.textContent = '各通道输出为灰度图（通道值写入 RGB），可接回 RGBA 合并还原原图'
  box.appendChild(hint)
  const actions = document.createElement('div')
  actions.className = 'w-tex'
  actions.style.marginTop = '4px'
  const info = document.createElement('div')
  info.className = 'info'
  info.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;'
  ;['r', 'g', 'b', 'a'].forEach(ch => {
    const btn = document.createElement('div')
    btn.className = 'btn'
    btn.textContent = '存 ' + ch.toUpperCase()
    btn.addEventListener('click', () => {
      const url = node._rgbaParts && node._rgbaParts[ch]
      if (!url) {
        toast('通道尚未拆分（等待输入求值）')
        return
      }
      const a = document.createElement('a')
      a.href = url
      a.download = 'matoga-rgba-' + ch + '.png'
      a.click()
    })
    info.appendChild(btn)
  })
  actions.appendChild(info)
  box.appendChild(actions)
  return box
}
export function rgbAlphaSplitWidget(node) {
  const box = document.createElement('div')
  box.className = 'w-multi'
  const hint = document.createElement('div')
  hint.style.cssText = 'font-size:10px;color:var(--text-dim);margin-bottom:4px;line-height:1.4;'
  hint.textContent = 'rgb 输出不透明原图颜色（alpha=255），alpha 输出灰度遮罩；两路可接回 RGBA 合并的 rgb 常量与 a 通道'
  box.appendChild(hint)
  const actions = document.createElement('div')
  actions.className = 'w-tex'
  actions.style.marginTop = '4px'
  const info = document.createElement('div')
  info.className = 'info'
  info.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;'
  ;[
    ['rgb', 'RGB'],
    ['alpha', 'A']
  ].forEach(([key, label]) => {
    const btn = document.createElement('div')
    btn.className = 'btn'
    btn.textContent = '存 ' + label
    btn.addEventListener('click', () => {
      const url = node._rgbAlphaParts && node._rgbAlphaParts[key]
      if (!url) {
        toast('通道尚未拆分（等待输入求值）')
        return
      }
      const a = document.createElement('a')
      a.href = url
      a.download = 'matoga-rgbsplit-' + key + '.png'
      a.click()
    })
    info.appendChild(btn)
  })
  actions.appendChild(info)
  box.appendChild(actions)
  return box
}
export function selectWidget(node, key, options) {
  const box = document.createElement('div')
  const sel = document.createElement('select')
  sel.className = 'w-select'
  options.forEach(o => {
    const op = document.createElement('option')
    op.value = o
    op.textContent = o
    if (o === node.props[key]) op.selected = true
    sel.appendChild(op)
  })
  sel.addEventListener('change', () => {
    node.props[key] = sel.value
    _evaluate()
    _markDirty()
  })
  box.appendChild(sel)
  return box
}
export function previewWidget(node, key) {
  const box = document.createElement('div')
  box.className = 'w-preview'
  box.innerHTML = `<div class="pv-empty">无输入</div>`
  box.dataset.preview = key
  node._previewEl = box
  return box
}
export function _labeledRow(label, widgetEl) {
  const row = document.createElement('div')
  row.className = 'w-row'
  row.style.display = 'flex'
  row.style.alignItems = 'center'
  row.style.gap = '6px'
  row.style.marginBottom = '4px'
  const lbl = document.createElement('span')
  lbl.style.fontSize = '10px'
  lbl.style.color = 'var(--text-dim)'
  lbl.style.minWidth = '28px'
  lbl.style.textTransform = 'none'
  lbl.style.letterSpacing = '0'
  lbl.textContent = label
  row.appendChild(lbl)
  row.appendChild(widgetEl)
  widgetEl.style.flex = '1'
  return row
}
export function noiseWidget(node) {
  if (node.props.gain === undefined) node.props.gain = 0.5
  const box = document.createElement('div')
  box.className = 'w-multi'
  box.appendChild(_labeledRow('缩放', numWidget(node, 'scale', 0.1, 20, 0.1)))
  box.appendChild(_labeledRow('种子', numWidget(node, 'seed', 0, 100, 1)))
  box.appendChild(_labeledRow('层数', numWidget(node, 'octaves', 1, 8, 1)))
  box.appendChild(_labeledRow('增益', numWidget(node, 'gain', 0.4, 0.95, 0.05)))
  return box
}
export function voronoiWidget(node) {
  if (node.props.mode === undefined) node.props.mode = 'f1'
  if (node.props.jitter === undefined) node.props.jitter = 1
  if (node.props.smooth === undefined) node.props.smooth = 0.5
  const box = document.createElement('div')
  box.className = 'w-multi'
  box.appendChild(_labeledRow('缩放', numWidget(node, 'scale', 0.1, 20, 0.1)))
  box.appendChild(_labeledRow('种子', numWidget(node, 'seed', 0, 100, 1)))
  box.appendChild(_labeledRow('模式', selectWidget(node, 'mode', ['f1', 'f2', 'f2-f1', 'smooth'])))
  box.appendChild(_labeledRow('抖动', numWidget(node, 'jitter', 0, 1, 0.05)))
  box.appendChild(_labeledRow('平滑', numWidget(node, 'smooth', 0, 1, 0.05)))
  return box
}
export function whiteWidget(node) {
  const box = document.createElement('div')
  box.className = 'w-multi'
  box.appendChild(_labeledRow('密度', numWidget(node, 'scale', 1, 256, 1)))
  box.appendChild(_labeledRow('种子', numWidget(node, 'seed', 0, 100, 1)))
  return box
}
export function cellWidget(node) {
  const box = document.createElement('div')
  box.className = 'w-multi'
  box.appendChild(_labeledRow('缩放', numWidget(node, 'scale', 0.5, 32, 0.5)))
  box.appendChild(_labeledRow('种子', numWidget(node, 'seed', 0, 100, 1)))
  return box
}
export function pingpongWidget(node) {
  if (node.props.gain === undefined) node.props.gain = 0.5
  if (node.props.strength === undefined) node.props.strength = 2
  const box = document.createElement('div')
  box.className = 'w-multi'
  box.appendChild(_labeledRow('缩放', numWidget(node, 'scale', 0.1, 20, 0.1)))
  box.appendChild(_labeledRow('种子', numWidget(node, 'seed', 0, 100, 1)))
  box.appendChild(_labeledRow('层数', numWidget(node, 'octaves', 1, 8, 1)))
  box.appendChild(_labeledRow('增益', numWidget(node, 'gain', 0.4, 0.95, 0.05)))
  box.appendChild(_labeledRow('强度', numWidget(node, 'strength', 0.5, 8, 0.1)))
  return box
}
export function voronoiseWidget(node) {
  if (node.props.jitter === undefined) node.props.jitter = 1
  if (node.props.blend === undefined) node.props.blend = 0.5
  const box = document.createElement('div')
  box.className = 'w-multi'
  box.appendChild(_labeledRow('缩放', numWidget(node, 'scale', 0.1, 20, 0.1)))
  box.appendChild(_labeledRow('种子', numWidget(node, 'seed', 0, 100, 1)))
  box.appendChild(_labeledRow('抖动', numWidget(node, 'jitter', 0, 1, 0.05)))
  box.appendChild(_labeledRow('插值', numWidget(node, 'blend', 0, 1, 0.05)))
  return box
}
export function reactionWidget(node) {
  if (node.props.iterations === undefined) node.props.iterations = 120
  if (node.props.preset === undefined) node.props.preset = 'coral'
  const box = document.createElement('div')
  box.className = 'w-multi'
  const hint = document.createElement('div')
  hint.style.cssText = 'font-size:10px;color:var(--text-dim);margin-bottom:4px;line-height:1.4;'
  hint.textContent = 'Gray-Scott 反应扩散：迭代涌现斑纹（珊瑚/迷宫/孤子）'
  box.appendChild(hint)
  box.appendChild(_labeledRow('形态', selectWidget(node, 'preset', ['coral', 'maze', 'soliton', 'waves', 'worm'])))
  box.appendChild(_labeledRow('迭代', numWidget(node, 'iterations', 40, 300, 10)))
  box.appendChild(_labeledRow('种子', numWidget(node, 'seed', 0, 100, 1)))
  return box
}
export function lightningWidget(node) {
  if (node.props.branches === undefined) node.props.branches = 0.7
  if (node.props.detail === undefined) node.props.detail = 1
  if (node.props.glow === undefined) node.props.glow = 0.5
  const box = document.createElement('div')
  box.className = 'w-multi'
  box.appendChild(_labeledRow('种子', numWidget(node, 'seed', 0, 100, 1)))
  box.appendChild(_labeledRow('分叉', numWidget(node, 'branches', 0, 1, 0.05)))
  box.appendChild(_labeledRow('细节', numWidget(node, 'detail', 0.2, 2, 0.1)))
  box.appendChild(_labeledRow('辉光', numWidget(node, 'glow', 0, 1, 0.05)))
  return box
}
export function mandelWidget(node) {
  if (node.props.fractal === undefined) node.props.fractal = 'mandel'
  if (node.props.zoom === undefined) node.props.zoom = 1
  if (node.props.iterations === undefined) node.props.iterations = 96
  const box = document.createElement('div')
  box.className = 'w-multi'
  box.appendChild(_labeledRow('类型', selectWidget(node, 'fractal', ['mandel', 'julia'])))
  box.appendChild(_labeledRow('缩放', numWidget(node, 'zoom', 0.5, 64, 0.5)))
  box.appendChild(_labeledRow('迭代', numWidget(node, 'iterations', 32, 256, 8)))
  box.appendChild(_labeledRow('种子', numWidget(node, 'seed', 0, 100, 1)))
  return box
}
export function paletteWidget(node) {
  if (node.props.freq === undefined) node.props.freq = 1
  if (node.props.phase === undefined) node.props.phase = 0
  const box = document.createElement('div')
  box.className = 'w-multi'
  box.appendChild(
    _labeledRow('预设', selectWidget(node, 'preset', ['rainbow', 'ocean', 'sunset', 'ember', 'fire', 'verdant']))
  )
  box.appendChild(_labeledRow('频率', numWidget(node, 'freq', 0.5, 4, 0.1)))
  box.appendChild(_labeledRow('相位', numWidget(node, 'phase', 0, 1, 0.05)))
  return box
}
export function gradientWidget(node) {
  const box = document.createElement('div')
  box.className = 'w-multi'
  box.appendChild(_labeledRow('A', colorWidget(node, 'colorA')))
  box.appendChild(_labeledRow('B', colorWidget(node, 'colorB')))
  box.appendChild(_labeledRow('模式', selectWidget(node, 'mode', ['linear', 'smooth', 'ease'])))
  return box
}
export function warpWidget(node) {
  if (node.props.gain === undefined) node.props.gain = 0.5
  const box = document.createElement('div')
  box.className = 'w-multi'
  box.appendChild(_labeledRow('缩放', numWidget(node, 'scale', 0.1, 20, 0.1)))
  box.appendChild(_labeledRow('扭曲', numWidget(node, 'amount', 0, 3, 0.1)))
  box.appendChild(_labeledRow('种子', numWidget(node, 'seed', 0, 100, 1)))
  box.appendChild(_labeledRow('层数', numWidget(node, 'octaves', 1, 8, 1)))
  box.appendChild(_labeledRow('增益', numWidget(node, 'gain', 0.4, 0.95, 0.05)))
  return box
}

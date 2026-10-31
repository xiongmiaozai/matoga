/**
 * matoga - MC 模型：NodeCanvasLibrary
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：节点库面板（搜索/分组/拖拽/预览缩略图）
 */

import { _psBlendApply } from '../node-canvas/ps-blend.js'
import { clamp, num } from '../node-canvas/math.js'
import { _NOISE_PV_TYPES, _noisePreviewUrl } from '../node-canvas/noise.js'
import { NODE_DEFS } from '../node-canvas/node-defs.js'
import { zhOfTexName } from '../zh-names.js'

/* 主文件函数（注入） */
let _defaultProps = (...a) => undefined
let _escapeHtml = (...a) => undefined
let _screenToWorld = (...a) => undefined
let _createNode = (...a) => undefined

/* 模块状态：只读用 getter；可写用 get/set 成对（§2.2） */
let _get_LIB_GROUP_SHAPE = () => undefined
let _get_LIB_GLYPHS = () => undefined
let _get_LIB_GROUP_GLYPH = () => undefined
let _get_$ = () => undefined
let _get__libPvCache = () => undefined
let _get__LIB_PV_SIZE = () => undefined
let _get__BLEND_MODE_OF = () => undefined
let _get_libraryBody = () => undefined
let _get_nodesLayer = () => undefined
let _get_canvasWrap = () => undefined
let _get__libCollapsed = () => undefined
let _get__libSubCollapsed = () => undefined
let _get__libSearchInput = () => undefined
let _set__libSearchInput = () => {}
let _get__libDragType = () => undefined
let _set__libDragType = () => {}
let _get__ghostEl = () => undefined
let _set__ghostEl = () => {}
let _get__libDropEnabled = () => undefined
let _set__libDropEnabled = () => {}

export function setHooks(h) {
  if (h.defaultProps) _defaultProps = h.defaultProps
  if (h.escapeHtml) _escapeHtml = h.escapeHtml
  if (h.screenToWorld) _screenToWorld = h.screenToWorld
  if (h.createNode) _createNode = h.createNode
  if (h.get_LIB_GROUP_SHAPE) _get_LIB_GROUP_SHAPE = h.get_LIB_GROUP_SHAPE
  if (h.get_LIB_GLYPHS) _get_LIB_GLYPHS = h.get_LIB_GLYPHS
  if (h.get_LIB_GROUP_GLYPH) _get_LIB_GROUP_GLYPH = h.get_LIB_GROUP_GLYPH
  if (h.get_$) _get_$ = h.get_$
  if (h.get__libPvCache) _get__libPvCache = h.get__libPvCache
  if (h.get__LIB_PV_SIZE) _get__LIB_PV_SIZE = h.get__LIB_PV_SIZE
  if (h.get__BLEND_MODE_OF) _get__BLEND_MODE_OF = h.get__BLEND_MODE_OF
  if (h.get_libraryBody) _get_libraryBody = h.get_libraryBody
  if (h.get_nodesLayer) _get_nodesLayer = h.get_nodesLayer
  if (h.get_canvasWrap) _get_canvasWrap = h.get_canvasWrap
  if (h.get__libCollapsed) _get__libCollapsed = h.get__libCollapsed
  if (h.get__libSubCollapsed) _get__libSubCollapsed = h.get__libSubCollapsed
  if (h.get__libSearchInput) _get__libSearchInput = h.get__libSearchInput
  if (h.set__libSearchInput) _set__libSearchInput = h.set__libSearchInput
  if (h.get__libDragType) _get__libDragType = h.get__libDragType
  if (h.set__libDragType) _set__libDragType = h.set__libDragType
  if (h.get__ghostEl) _get__ghostEl = h.get__ghostEl
  if (h.set__ghostEl) _set__ghostEl = h.set__ghostEl
  if (h.get__libDropEnabled) _get__libDropEnabled = h.get__libDropEnabled
  if (h.set__libDropEnabled) _set__libDropEnabled = h.set__libDropEnabled
}

export function _libIconHTML(type, def) {
  const shape = _get_LIB_GROUP_SHAPE()[def.group] || 'square'
  const glyph = _get_LIB_GLYPHS()[type] || _get_LIB_GROUP_GLYPH()[def.group] || '◆'
  return `<span class="ic ic-${shape}" style="background:${def.color}">${glyph}</span>`
}

export function _blendPreviewUrl(mode) {
  const key = 'b:' + mode
  if (_get__libPvCache().has(key)) return _get__libPvCache().get(key)
  const S = _get__LIB_PV_SIZE()
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(S, S)
  const d = img.data
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const u = px / S,
        v = py / S
      const a = [u, 0.5, 1 - u]
      const b = [1 - v, v, 0.5]
      const o = _psBlendApply(mode, a, b, 1)
      const j = (py * S + px) * 4
      d[j] = clamp(o[0], 0, 1) * 255
      d[j + 1] = clamp(o[1], 0, 1) * 255
      d[j + 2] = clamp(o[2], 0, 1) * 255
      d[j + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  let url = null
  try {
    url = c.toDataURL('image/png')
  } catch (e) {
    url = null
  }
  _get__libPvCache().set(key, url)
  return url
}

export function _genLibPreview(type, def) {
  try {
    if (_NOISE_PV_TYPES.has(type)) {
      const url = _noisePreviewUrl({ type, props: _defaultProps(type) }, _get__LIB_PV_SIZE())
      if (url) return `<span class="pv pv-img" style="background-image:url('${url}')"></span>`
    } else if (type === 'gradient') {
      const p = _defaultProps(type)
      return `<span class="pv pv-grad" style="background:linear-gradient(135deg, ${p.colorA}, ${p.colorB})"></span>`
    } else if (type === 'color') {
      const p = _defaultProps(type)
      return `<span class="pv pv-color" style="background:${p.color}"></span>`
    } else if (type === 'colorMix') {
      return `<span class="pv pv-grad" style="background:linear-gradient(135deg, #7cbd56, #c084fc)"></span>`
    } else if (type === 'number') {
      return `<span class="pv pv-num"><i class="mark" style="left:50%"></i></span>`
    } else if (type === 'vector2') {
      return `<span class="pv pv-vec"><i class="dot" style="left:50%;top:50%"></i></span>`
    } else if (_get__BLEND_MODE_OF()[type]) {
      const url = _blendPreviewUrl(_get__BLEND_MODE_OF()[type])
      if (url) return `<span class="pv pv-img" style="background-image:url('${url}')"></span>`
    }
  } catch (e) {}
  return _libIconHTML(type, def)
}

export function _libPreviewHTML(type, def) {
  if (_get__libPvCache().has(type)) return _get__libPvCache().get(type)
  const html = _genLibPreview(type, def)
  _get__libPvCache().set(type, html)
  return html
}

export function buildLibrary() {
  const searchBox = document.createElement('div')
  searchBox.className = 'lib-search'
  searchBox.innerHTML = `<span class="lib-search-ico">⌕</span><input type="text" id="lib-search-input" placeholder="搜索节点…" autocomplete="off" spellcheck="false"><button class="lib-search-clear" id="lib-search-clear" title="清除" type="button">✕</button>`
  _get_libraryBody().appendChild(searchBox)
  _set__libSearchInput(searchBox.querySelector('input'))
  const clearBtn = searchBox.querySelector('#lib-search-clear')
  _get__libSearchInput().addEventListener('input', () => {
    clearBtn.hidden = !_get__libSearchInput().value
    filterLibrary(_get__libSearchInput().value)
  })
  clearBtn.addEventListener('click', () => {
    _get__libSearchInput().value = ''
    clearBtn.hidden = true
    filterLibrary('')
    _get__libSearchInput().focus()
  })
  filterLibrary('')
  _enableLibDrop()
}

export function _highlight(text, term) {
  if (!term) return _escapeHtml(text)
  const t = term.toLowerCase(),
    low = text.toLowerCase()
  const idx = low.indexOf(t)
  if (idx < 0) return _escapeHtml(text)
  return (
    _escapeHtml(text.slice(0, idx)) +
    '<mark>' +
    _escapeHtml(text.slice(idx, idx + t.length)) +
    '</mark>' +
    _escapeHtml(text.slice(idx + t.length))
  )
}

export function _updateGhost(e) {
  if (!_get__libDragType()) return
  const def = NODE_DEFS[_get__libDragType()]
  if (!def) return
  if (!_get__ghostEl()) {
    _set__ghostEl(document.createElement('div'))
    _get__ghostEl().className = 'node ghost'
    _get__ghostEl().innerHTML = `<div class="node-head"><span class="badge" style="background:${def.color}"></span><span class="title">${_escapeHtml(def.title)}</span></div>`
    _get_nodesLayer().appendChild(_get__ghostEl())
  }
  _get__ghostEl().style.setProperty('--node-color', def.color)
  const wp = _screenToWorld(e.clientX, e.clientY)
  _get__ghostEl().style.left = wp.x - 100 + 'px'
  _get__ghostEl().style.top = wp.y - 14 + 'px'
}

export function _clearGhost() {
  if (_get__ghostEl()) {
    _get__ghostEl().remove()
    _set__ghostEl(null)
  }
}

export function _libItemEl(k, d) {
  const it = document.createElement('div')
  it.className = 'lib-item'
  it.draggable = true
  it.dataset.type = k
  it.innerHTML = `${_libPreviewHTML(k, d)}<span class="nm">${d.title}</span><span class="ports">${d.inputs.length || '·'}→${d.outputs.length || '·'}</span>`
  it.addEventListener('click', () => {
    const r = _get_canvasWrap().getBoundingClientRect()
    const wp = _screenToWorld(r.left + r.width / 2, r.top + r.height / 2)
    _createNode(k, wp.x - 100, wp.y - 30)
  })
  it.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/node-type', k)
    e.dataTransfer.effectAllowed = 'copy'
    _set__libDragType(k)
    _get_canvasWrap().classList.add('lib-drop-target')
  })
  it.addEventListener('dragend', () => {
    _get_canvasWrap().classList.remove('lib-drop-target')
    _set__libDragType(null)
    _clearGhost()
  })
  return it
}

export function filterLibrary(term) {
  term = (term || '').trim().toLowerCase()
  const existing = _get_libraryBody().querySelectorAll('.lib-group')
  existing.forEach(el => el.remove())
  const groups = {}
  Object.entries(NODE_DEFS).forEach(([k, d]) => {
    if (d.hidden) return
    if (
      term &&
      !d.title.toLowerCase().includes(term) &&
      !k.toLowerCase().includes(term) &&
      !d.group.toLowerCase().includes(term) &&
      !(d.subgroup && d.subgroup.toLowerCase().includes(term)) &&
      !(zhOfTexName(d.title) || '').toLowerCase().includes(term)
    )
      return
    ;(groups[d.group] = groups[d.group] || []).push([k, d])
  })
  const wrap = document.createElement('div')
  wrap.className = 'lib-group'
  Object.entries(groups).forEach(([g, items]) => {
    const collapsed = _get__libCollapsed().has(g)
    const gh = document.createElement('div')
    gh.className = 'lib-group-head' + (collapsed ? ' collapsed' : '')
    gh.innerHTML = `<span class="lib-arrow">${collapsed ? '▸' : '▾'}</span><span class="lib-gname">${g}</span><span class="lib-count">${items.length}</span>`
    gh.addEventListener('click', () => {
      if (_get__libCollapsed().has(g)) _get__libCollapsed().delete(g)
      else _get__libCollapsed().add(g)
      filterLibrary(_get__libSearchInput() ? _get__libSearchInput().value : '')
    })
    wrap.appendChild(gh)
    const itemsWrap = document.createElement('div')
    itemsWrap.className = 'lib-group-items'
    if (collapsed) itemsWrap.style.display = 'none'
    const hasSub = items.some(([, d]) => d.subgroup)
    if (hasSub) {
      const subs = {}
      items.forEach(([k, d]) => {
        const sg = d.subgroup || '其他'
        ;(subs[sg] = subs[sg] || []).push([k, d])
      })
      Object.entries(subs).forEach(([sg, subItems]) => {
        const subKey = g + '>' + sg
        const subCollapsed = _get__libSubCollapsed().has(subKey)
        const sh = document.createElement('div')
        sh.className = 'lib-sub-head' + (subCollapsed ? ' collapsed' : '')
        sh.innerHTML = `<span class="lib-sub-arrow">${subCollapsed ? '▸' : '▾'}</span><span class="lib-sub-name">${sg}</span><span class="lib-sub-count">${subItems.length}</span>`
        sh.addEventListener('click', () => {
          if (_get__libSubCollapsed().has(subKey)) _get__libSubCollapsed().delete(subKey)
          else _get__libSubCollapsed().add(subKey)
          filterLibrary(_get__libSearchInput() ? _get__libSearchInput().value : '')
        })
        itemsWrap.appendChild(sh)
        const subWrap = document.createElement('div')
        subWrap.className = 'lib-sub-items'
        if (subCollapsed) subWrap.style.display = 'none'
        subItems.forEach(([k, d]) => {
          const it = _libItemEl(k, d)
          if (term && d.title.toLowerCase().includes(term)) {
            it.querySelector('.nm').innerHTML = _highlight(d.title, term)
          }
          subWrap.appendChild(it)
        })
        itemsWrap.appendChild(subWrap)
      })
    } else {
      items.forEach(([k, d]) => {
        const it = _libItemEl(k, d)
        if (term && d.title.toLowerCase().includes(term)) {
          it.querySelector('.nm').innerHTML = _highlight(d.title, term)
        }
        itemsWrap.appendChild(it)
      })
    }
    wrap.appendChild(itemsWrap)
  })
  if (Object.keys(groups).length === 0) {
    const empty = document.createElement('div')
    empty.className = 'lib-empty'
    empty.innerHTML = `<span class="lib-empty-ico">⌕</span><span>未找到匹配节点</span>`
    wrap.appendChild(empty)
  }
  _get_libraryBody().appendChild(wrap)
}

export function _enableLibDrop() {
  if (_get__libDropEnabled()) return
  _set__libDropEnabled(true)
  _get_canvasWrap().addEventListener('dragover', e => {
    if (e.dataTransfer.types.includes('text/node-type')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      _updateGhost(e)
    }
  })
  _get_canvasWrap().addEventListener('dragleave', e => {
    if (!_get_canvasWrap().contains(e.relatedTarget)) _clearGhost()
  })
  _get_canvasWrap().addEventListener('drop', e => {
    const k = e.dataTransfer.getData('text/node-type')
    if (!k) return
    e.preventDefault()
    const wp = _screenToWorld(e.clientX, e.clientY)
    _createNode(k, wp.x - 100, wp.y - 30)
    _clearGhost()
  })
}

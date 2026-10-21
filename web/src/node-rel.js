/**
 * matoga - 节点关系窗口
 * 以父子层级树（树状图）呈现节点画布中的节点关系：
 *   - 默认「数据流」方向：源节点为父，下游消费节点为子
 *   - 可切换「构成」方向：输出节点为父，上游提供节点为子
 * DAG 中的共享子节点以「引用」节点表示（虚线），避免重复展开。
 */

import { getGraphInfo, focusNodeInCanvas } from './node-canvas.js'
import { t, onLocaleChange } from './i18n.js'
import { createFloatingWindow } from './floating-window.js'

const NS = 'http://www.w3.org/2000/svg'

/* ── 布局度量 ─────────────────────────────── */
const M = {
  nodeW: 176,
  nodeH: 40,
  rowGap: 12,
  colGap: 72,
  rootGap: 36,
  pad: 28,
}
const ROW = M.nodeH + M.rowGap
const COL = M.nodeW + M.colGap

/* ── 模块状态 ─────────────────────────────── */
let _initialized = false
let _dir = 'down'                 // 'down' 数据流向下游 | 'up' 构成关系向上游
let _collapsed = new Set()        // 已折叠的节点 id
let _activeId = null              // 当前选中（联动）节点 id
let _tree = null                  // 最近一次构建的森林
let _graphMeta = null             // 统计信息
let _view = { x: 0, y: 0, zoom: 1 }
let _refreshTimer = null

function viewEl(){ return document.getElementById('nodeRelView') }

/* ── 树构建 ─────────────────────────────── */
function buildForest(graph, dir){
  const { nodes, edges, defs } = graph
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const order = new Map(nodes.map((n, i) => [n.id, i]))
  const fallbackDef = { title: '?', group: '', color: '#9a9a9a', inputs: [], outputs: [] }

  // 邻接表：父 -> 子（附带挂载端口信息）
  const children = new Map()
  const asChild = new Map()
  nodes.forEach(n => { children.set(n.id, []); asChild.set(n.id, 0) })
  edges.forEach(e => {
    const p = dir === 'down' ? e.from.node : e.to.node
    const c = dir === 'down' ? e.to.node : e.from.node
    if (!nodeById.has(p) || !nodeById.has(c) || p === c) return
    children.get(p).push({ childId: c, inPort: e.to.port, outPort: e.from.port })
    asChild.set(c, (asChild.get(c) || 0) + 1)
  })

  const expanded = new Set()
  function buildNode(id, depth, inPort, outPort){
    const raw = nodeById.get(id)
    const def = defs[raw.type] || fallbackDef
    const kids = (children.get(id) || []).slice()
      .sort((a, b) => (order.get(a.childId) || 0) - (order.get(b.childId) || 0))
    const ref = expanded.has(id)
    expanded.add(id)
    const childNodes = []
    if (!ref && !_collapsed.has(id)){
      kids.forEach(k => childNodes.push(buildNode(k.childId, depth + 1, k.inPort, k.outPort)))
    }
    return {
      id, depth, ref,
      title: raw.title || def.title,
      type: raw.type, def,
      inPort, outPort,
      children: childNodes,
      totalKids: kids.length,
      descendantCount: null,
    }
  }

  // 根 = 不作为子出现的节点（down：入度 0 源节点；up：出度 0 输出节点）
  const roots = nodes.filter(n => asChild.get(n.id) === 0).map(n => n.id)
  const forest = []
  roots.forEach(id => forest.push(buildNode(id, 0, null, null)))
  // 兜底：未被任何树覆盖的节点（成环 / 无法从根到达）单独成根
  nodes.forEach(n => {
    if (!expanded.has(n.id)) forest.push(buildNode(n.id, 0, null, null))
  })

  // 统计隐藏后代数（用于折叠徽章）
  function countDesc(tn){
    if (tn.descendantCount !== null) return tn.descendantCount
    let n = 0
    tn.children.forEach(c => { n += 1 + countDesc(c) })
    tn.descendantCount = n
    return n
  }
  forest.forEach(countDesc)

  let maxDepth = 0
  const walk = (tn) => { maxDepth = Math.max(maxDepth, tn.depth); tn.children.forEach(walk) }
  forest.forEach(walk)

  return { forest, maxDepth, expandedCount: expanded.size }
}

/* ── 布局（水平 tidy tree）──────────────── */
function layoutForest(forest){
  let y = 0
  forest.forEach((tn, i) => {
    if (i > 0) y += M.rootGap
    y = layoutNode(tn, y)
  })
  const width = Math.max(...forest.map(maxDepthOf), 0) * COL + M.nodeW
  return { width, height: y }
}
function maxDepthOf(tn){
  if (!tn.children.length) return tn.depth
  return Math.max(...tn.children.map(maxDepthOf))
}
function layoutNode(tn, top){
  const kids = tn.children
  if (!kids.length || _collapsed.has(tn.id) || tn.ref){
    tn.x = tn.depth * COL
    tn.y = top + ROW / 2
    return top + ROW
  }
  let cur = top
  kids.forEach(c => { cur = layoutNode(c, cur) })
  tn.x = tn.depth * COL
  tn.y = (kids[0].y + kids[kids.length - 1].y) / 2
  return cur
}

/* ── SVG 渲染 ────────────────────────────── */
function el(tag, attrs){
  const e = document.createElementNS(NS, tag)
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k])
  return e
}
function trunc(s, n){
  const arr = Array.from(s || '')
  return arr.length <= n ? (s || '') : arr.slice(0, n - 1).join('') + '…'
}

function renderNodeSvg(tn){
  const g = el('g', {
    class: 'nr-node' + (tn.ref ? ' ref' : '') + (_activeId === tn.id ? ' active' : ''),
    'data-id': tn.id,
    'data-act': 'node',
    transform: `translate(${tn.x},${tn.y - M.nodeH / 2})`,
  })
  const tip = el('title')
  tip.textContent = tn.outPort && tn.inPort
    ? `${tn.def.title} · ${tn.outPort} → ${tn.inPort}`
    : `${tn.def.title}${tn.def.group ? ' · ' + tn.def.group : ''}`
  g.appendChild(tip)

  g.appendChild(el('rect', { class: 'nr-box', width: M.nodeW, height: M.nodeH, rx: 6 }))
  g.appendChild(el('rect', { class: 'nr-accent', x: 0, y: 0, width: 4, height: M.nodeH, fill: tn.def.color }))

  const title = el('text', { class: 'nr-title', x: 12, y: 17 })
  title.textContent = trunc(tn.title, 15)
  g.appendChild(title)

  const sub = el('text', { class: 'nr-sub', x: 12, y: 31 })
  if (tn.inPort) sub.textContent = _dir === 'down' ? ('→ ' + tn.inPort) : ((tn.outPort || '') + ' →')
  else sub.textContent = tn.def.group || tn.type
  g.appendChild(sub)

  const badge = el('text', { class: 'nr-type-badge', x: M.nodeW - 8, y: 17, 'text-anchor': 'end' })
  badge.textContent = trunc(tn.type, 8)
  g.appendChild(badge)

  if (tn.ref){
    const rb = el('text', { class: 'nr-ref-badge', x: M.nodeW - 8, y: 31, 'text-anchor': 'end' })
    rb.textContent = '↻ ' + t('noderel.ref')
    g.appendChild(rb)
  }

  // 折叠切换按钮（有子级且非引用节点）
  if (tn.totalKids > 0 && !tn.ref){
    const tgl = el('g', {
      class: 'nr-toggle' + (_collapsed.has(tn.id) ? ' closed' : ''),
      'data-id': tn.id,
      'data-act': 'toggle',
      transform: `translate(${M.nodeW + 8},${M.nodeH / 2 - 8})`,
    })
    tgl.appendChild(el('rect', { class: 'nr-toggle-box', width: 16, height: 16, rx: 3 }))
    const sign = el('text', { class: 'nr-toggle-sign', x: 8, y: 12, 'text-anchor': 'middle' })
    sign.textContent = _collapsed.has(tn.id) ? '+' : '−'
    tgl.appendChild(sign)
    const tTip = el('title')
    tTip.textContent = t(_collapsed.has(tn.id) ? 'noderel.expandOne' : 'noderel.collapseOne')
    tgl.appendChild(tTip)
    g.appendChild(tgl)
  }

  // 折叠时的隐藏后代计数
  if (_collapsed.has(tn.id) && tn.descendantCount > 0){
    const cb = el('text', { class: 'nr-fold-count', x: M.nodeW + 34, y: 24 })
    cb.textContent = '+' + tn.descendantCount
    g.appendChild(cb)
  }
  return g
}

function renderEdgeSvg(parent, child){
  const x1 = parent.x + M.nodeW + (parent.totalKids > 0 && !parent.ref ? 26 : 4)
  const y1 = parent.y
  const x2 = child.x
  const y2 = child.y
  const dx = Math.max(24, (x2 - x1) * 0.5)
  const p = el('path', {
    class: 'nr-edge' + (child.ref ? ' ref' : ''),
    d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
    stroke: child.def.color,
    'data-child': child.id,
  })
  const tip = el('title')
  tip.textContent = `${parent.title} ${parent.outPort ? parent.outPort + ' → ' : ''}${child.inPort || ''} ${child.title}`.replace(/\s+/g, ' ').trim()
  p.appendChild(tip)
  return p
}

function renderSvg(){
  const frag = document.createDocumentFragment()
  const svg = el('svg', { class: 'nr-svg' })
  const world = el('g', { class: 'nr-world' })

  const { forest } = _tree
  const edges = []
  const nodes = []
  const walk = (tn) => {
    nodes.push(tn)
    tn.children.forEach(c => { edges.push([tn, c]); walk(c) })
  }
  forest.forEach(walk)
  edges.forEach(([p, c]) => world.appendChild(renderEdgeSvg(p, c)))
  nodes.forEach(tn => world.appendChild(renderNodeSvg(tn)))

  applyView(world)
  svg.appendChild(world)
  frag.appendChild(svg)
  return frag
}

function applyView(world){
  world.setAttribute('transform', `translate(${_view.x},${_view.y}) scale(${_view.zoom})`)
}

/* ── 主渲染 ─────────────────────────────── */
function render(){
  const box = viewEl()
  if (!box) return
  const graph = getGraphInfo()
  _tree = buildForest(graph, _dir)
  layoutForest(_tree.forest)   // 布局赋坐标（x/y）
  _graphMeta = {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    depth: _tree.maxDepth,
    roots: _tree.forest.length,
  }
  box.innerHTML = ''

  if (graph.nodes.length === 0){
    const empty = document.createElement('div')
    empty.className = 'nr-empty'
    empty.textContent = t('noderel.empty')
    box.appendChild(empty)
    updateStatusBar()
    return
  }

  const wrap = document.createElement('div')
  wrap.className = 'nr-scroll'
  wrap.appendChild(renderSvg())
  box.appendChild(wrap)

  const status = document.createElement('div')
  status.className = 'nr-status'
  status.id = 'nrStatus'
  box.appendChild(status)
  updateStatusBar()
}

function updateStatusBar(){
  const s = document.getElementById('nrStatus')
  if (!s || !_graphMeta) return
  const m = _graphMeta
  s.innerHTML =
    `<span>${t('noderel.statNodes', { n: m.nodes })}</span>` +
    `<span>${t('noderel.statEdges', { n: m.edges })}</span>` +
    `<span>${t('noderel.statDepth', { n: m.depth })}</span>` +
    `<span>${t('noderel.statRoots', { n: m.roots })}</span>` +
    `<span class="nr-dir">${t(_dir === 'down' ? 'noderel.dirDown' : 'noderel.dirUp')}</span>`
}

/* ── 视图操作 ────────────────────────────── */
function fitView(){
  const svg = viewEl() && viewEl().querySelector('.nr-svg')
  if (!svg || !_tree || !_tree.forest.length) return
  const box = viewEl().querySelector('.nr-scroll')
  if (!box) return
  const { width, height } = layoutForest(_tree.forest)
  const w = width + M.pad * 2, h = height + M.pad * 2
  const cw = box.clientWidth || 300, ch = box.clientHeight || 200
  const zoom = Math.min(Math.min(cw / w, ch / h), 1.2)
  _view.zoom = Math.max(zoom, 0.15)
  _view.x = (cw - w * _view.zoom) / 2 + M.pad * _view.zoom
  _view.y = (ch - h * _view.zoom) / 2 + M.pad * _view.zoom
  const world = svg.querySelector('.nr-world')
  if (world) applyView(world)
}

function zoomAt(svg, factor, cx, cy){
  const r = svg.getBoundingClientRect()
  const px = cx - r.left, py = cy - r.top
  const { x, y, zoom } = _view
  const wx = (px - x) / zoom, wy = (py - y) / zoom
  const nz = Math.min(2.5, Math.max(0.15, zoom * factor))
  _view.zoom = nz
  _view.x = px - wx * nz
  _view.y = py - wy * nz
  const world = svg.querySelector('.nr-world')
  if (world) applyView(world)
}

/* ── 交互 ───────────────────────────────── */
function onCanvasClick(e){
  const toggle = e.target.closest('[data-act="toggle"]')
  if (toggle){
    e.stopPropagation()
    const id = toggle.getAttribute('data-id')
    if (_collapsed.has(id)) _collapsed.delete(id)
    else _collapsed.add(id)
    render()
    return
  }
  const node = e.target.closest('[data-act="node"]')
  if (node){
    const id = node.getAttribute('data-id')
    _activeId = id
    focusNodeInCanvas(id)
    render()
  }
}

function bindInteractions(){
  const box = viewEl()
  if (!box) return

  box.addEventListener('click', onCanvasClick)

  // hover：高亮同 id 的所有副本（引用节点联动提示）
  box.addEventListener('pointerover', (e) => {
    const node = e.target.closest('[data-act="node"]')
    if (!node) return
    const id = node.getAttribute('data-id')
    box.querySelectorAll('.nr-node.hl').forEach(x => x.classList.remove('hl'))
    box.querySelectorAll(`.nr-node[data-id="${cssEsc(id)}"]`).forEach(x => x.classList.add('hl'))
  })
  box.addEventListener('pointerout', (e) => {
    if (e.target.closest('[data-act="node"]')) {
      box.querySelectorAll('.nr-node.hl').forEach(x => x.classList.remove('hl'))
    }
  })

  // 滚轮缩放（以指针为锚）
  box.addEventListener('wheel', (e) => {
    const svg = e.target.closest('.nr-svg')
    if (!svg) return
    e.preventDefault()
    zoomAt(svg, e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY)
  }, { passive: false })

  // 空白拖拽平移
  let pan = null
  box.addEventListener('pointerdown', (e) => {
    const svg = e.target.closest('.nr-svg')
    if (!svg) return
    if (e.target.closest('[data-act="node"],[data-act="toggle"]')) return
    pan = { sx: e.clientX, sy: e.clientY, vx: _view.x, vy: _view.y, svg }
    svg.classList.add('grabbing')
    svg.setPointerCapture && svg.setPointerCapture(e.pointerId)
  })
  box.addEventListener('pointermove', (e) => {
    if (!pan) return
    _view.x = pan.vx + (e.clientX - pan.sx)
    _view.y = pan.vy + (e.clientY - pan.sy)
    applyView(pan.svg.querySelector('.nr-world'))
  })
  const endPan = () => {
    if (pan && pan.svg) pan.svg.classList.remove('grabbing')
    pan = null
  }
  box.addEventListener('pointerup', endPan)
  box.addEventListener('pointercancel', endPan)
}

function cssEsc(s){ return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/"/g, '\\"') }

function actToggleDir(){
  _dir = _dir === 'down' ? 'up' : 'down'
  _collapsed.clear()
  render()
  fitView()
}
function actExpandAll(){
  _collapsed.clear()
  render()
}
function actCollapseAll(){
  const ids = new Set()
  const walk = (tn) => { if (tn.totalKids > 0 && !tn.ref) ids.add(tn.id); tn.children.forEach(walk) }
  if (_tree) _tree.forest.forEach(walk)
  _collapsed = ids
  render()
}
function actFit(){
  fitView()
}

/* ── 初始化 ─────────────────────────────── */
export { buildForest, layoutForest }

export function initNodeRel(){
  if (_initialized) return
  _initialized = true

  const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 800
  const fw = createFloatingWindow({
    id: 'nodeRel',
    title: t('panel.nodeRel'),
    icon: 'i-tree',
    x: Math.max(16, vw - 636),
    y: 72,
    w: Math.min(620, vw - 32),
    h: Math.min(420, vh - 160),
  })

  let view = document.getElementById('nodeRelView')
  if (!view){
    view = document.createElement('div')
    view.id = 'nodeRelView'
    view.className = 'nr-view'
  }
  fw.body.appendChild(view)

  const toolBtns = [
    fw.addToolButton({ icon: 'i-swap',     title: t('noderel.dirToggle'),   onClick: actToggleDir }),
    fw.addToolButton({ icon: 'i-plus',     title: t('noderel.expandAll'),   onClick: actExpandAll }),
    fw.addToolButton({ icon: 'i-minus',    title: t('noderel.collapseAll'), onClick: actCollapseAll }),
    fw.addToolButton({ icon: 'i-maximize', title: t('noderel.fit'),         onClick: actFit }),
  ]
  fw.onToggle = (open) => { if (open) fitView() }

  bindInteractions()
  render()
  requestAnimationFrame(() => fitView())

  // 画布结构变化 → 防抖刷新
  document.addEventListener('nodegraph:changed', () => {
    clearTimeout(_refreshTimer)
    _refreshTimer = setTimeout(() => {
      render()
    }, 160)
  })

  // 语言切换 → 标题 / 工具提示 / 状态栏重渲染
  onLocaleChange(() => {
    fw.setTitle(t('panel.nodeRel'))
    toolBtns[0].title = t('noderel.dirToggle')
    toolBtns[1].title = t('noderel.expandAll')
    toolBtns[2].title = t('noderel.collapseAll')
    toolBtns[3].title = t('noderel.fit')
    render()
  })

  // 面板尺寸变化（首次进入布局 / 窗口缩放）→ 自适应
  if (window.ResizeObserver){
    const box = viewEl()
    if (box) {
      let first = true
      const ro = new ResizeObserver(() => {
        if (first) { first = false; fitView() }
      })
      ro.observe(box)
    }
  }
}

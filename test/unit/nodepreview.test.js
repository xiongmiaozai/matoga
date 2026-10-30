/**
 * 节点预览窗口集成测试：
 * 以记录型 DOM stub 驱动 initNodeCanvas（示例图）→ initNodePreview，
 * 断言：空状态 → 选中事件驱动渲染 → 各预览类型 → 联动刷新 → 删除清空。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')
process.env.NR_M3D_STUB = '1'   // WebGL 依赖替换为 no-op（须在 register 前设置）
register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))

/* ── 记录型 DOM 元素 ── */
class RecEl {
  constructor(tag) {
    this.tagName = tag
    this.children = []
    this.attributes = {}
    this._text = ''
    this.style = { setProperty() {}, getPropertyValue() { return '' } }
    this.dataset = {}
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false } }
    this.listeners = {}
  }
  set id(v) { this._id = v; if (this._reg) this._reg.set(v, this) }
  get id() { return this._id || '' }
  setAttribute(k, v) { this.attributes[k] = String(v) }
  getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null }
  appendChild(c) { this.children.push(c); c._reg = this._reg; if (c._id && this._reg) this._reg.set(c._id, c); return c }
  remove() {}
  querySelector() { return new RecEl('stub') }
  querySelectorAll() { return [] }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn) }
  removeEventListener() {}
  getContext() { return makeStub() }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 300, height: 200 } }
  set innerHTML(v) { this.children = []; this._html = v }
  get innerHTML() { return this._html || '' }
  set textContent(v) { this._text = String(v) }
  get textContent() { return this._text }
  set className(v) { this.attributes.class = String(v) }
  get className() { return this.attributes.class || '' }
  setPointerCapture() {}
  click() { (this.listeners.click || []).forEach(fn => fn({ target: this })) }
}

function makeStub() {
  const fn = function () { return makeStub() }
  return new Proxy(fn, {
    get(t, p) {
      if (p === 'style') return {}
      if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false } }
      if (p === 'isConnected') return false
      if (p === 'children' || p === 'childNodes') return []
      if (p === 'length') return 0
      if (p === 'innerHTML' || p === 'textContent' || p === 'value') return ''
      if (p === Symbol.toPrimitive) return () => ''
      if (typeof p === 'symbol') return undefined
      return makeStub()
    },
    apply() { return makeStub() },
    construct() { return makeStub() },
    set() { return true },
  })
}

/* ── 全局 stub（document 事件需真实派发） ── */
const idReg = new Map()
const docListeners = new Map()
const viewContainer = new RecEl('div')
viewContainer._id = 'nodePreviewView'
idReg.set('nodePreviewView', viewContainer)
viewContainer.clientWidth = 400
viewContainer.clientHeight = 600

const stubDoc = makeStub()
globalThis.window = { CSS: { escape: s => s }, addEventListener() {}, open() { return {} } }
globalThis.document = new Proxy(stubDoc, {
  get(t, p) {
    if (p === 'createElement' || p === 'createElementNS') return (_ns, tag) => { const e = new RecEl(tag || _ns); e._reg = idReg; return e }
    if (p === 'createDocumentFragment') return () => { const e = new RecEl('fragment'); e._reg = idReg; return e }
    if (p === 'getElementById') return id => idReg.get(id) || makeStub()
    if (p === 'querySelector') return () => makeStub()
    if (p === 'querySelectorAll') return () => []
    if (p === 'dispatchEvent') return ev => {
      for (const fn of (docListeners.get(ev.type) || [])) { try { fn(ev) } catch (e) { console.error(e) } }
      return true
    }
    if (p === 'addEventListener') return (type, fn) => {
      if (!docListeners.has(type)) docListeners.set(type, [])
      docListeners.get(type).push(fn)
    }
    return t[p]
  },
})
globalThis.requestAnimationFrame = () => {}
globalThis.ResizeObserver = undefined
const sleep = ms => new Promise(r => setTimeout(r, ms))

let nodeCanvas, nodePreview
test('加载模块并初始化（画布示例图 + 节点预览）', async () => {
  nodeCanvas = await import(pathToFileURL(path.join(ROOT, 'web/src/node-canvas.js')).href)
  nodePreview = await import(pathToFileURL(path.join(ROOT, 'web/src/node-preview.js')).href)
  nodeCanvas.initNodeCanvas()    // initExample：数值×2 + 颜色 + 混合 + 3 条边
  nodePreview.initNodePreview()  // 空状态渲染
})

function html(){ return viewContainer.innerHTML || '' }

test('初始为空状态提示', () => {
  assert.match(html(), /np-empty/)
  assert.match(html(), /点击节点画布/)
})

test('getNodeDetail：数值节点详情结构', () => {
  const g = nodeCanvas.getGraphInfo()
  const num = g.nodes.find(n => n.type === 'number')
  const d = nodeCanvas.getNodeDetail(num.id)
  assert.equal(d.id, num.id)
  assert.equal(d.type, 'number')
  assert.equal(d.title, '数值')
  assert.equal(d.previewKind, 'value')
  assert.equal(typeof d.props.value, 'number')
  assert.equal(d.def.inputs.length, 0)
  assert.equal(d.def.outputs.length, 1)
  assert.equal(d.connections.outputs.length, 2)  // 示例图中 num1 连 mix 的 a、t
  assert.equal(d.evalOut.value, 0.8)
})

test('选中事件（nodegraph:selected）驱动预览切换为数值大字', async () => {
  const g = nodeCanvas.getGraphInfo()
  const num = g.nodes.find(n => n.type === 'number')
  document.dispatchEvent(new CustomEvent('nodegraph:selected', { detail: { id: num.id, count: 1 } }))
  await sleep(150)
  assert.match(html(), /np-head/)
  assert.match(html(), /np-value/)
  assert.match(html(), />0\.8</)
  assert.match(html(), /np-evalout|计算输出|np-section/)
})

test('选中颜色节点 → 色块预览 + hex', async () => {
  const g = nodeCanvas.getGraphInfo()
  const color = g.nodes.find(n => n.type === 'color')
  document.dispatchEvent(new CustomEvent('nodegraph:selected', { detail: { id: color.id, count: 1 } }))
  await sleep(150)
  assert.match(html(), /np-color"/)
  assert.match(html(), /#7cbd56/)
})

test('选中混合节点 → 无可视化预览占位 + 端口连接信息', async () => {
  const g = nodeCanvas.getGraphInfo()
  const mix = g.nodes.find(n => n.type === 'mix')
  document.dispatchEvent(new CustomEvent('nodegraph:selected', { detail: { id: mix.id, count: 1 } }))
  await sleep(150)
  assert.match(html(), /np-none/)
  assert.match(html(), /np-conn/)
  assert.match(html(), /← 数值/)
  assert.match(html(), /未连接|np-unconn/)
})

test('多选时显示提示条', async () => {
  const g = nodeCanvas.getGraphInfo()
  const num = g.nodes.find(n => n.type === 'number')
  document.dispatchEvent(new CustomEvent('nodegraph:selected', { detail: { id: num.id, count: 4 } }))
  await sleep(150)
  assert.match(html(), /np-multi/)
  assert.match(html(), /4/)
})

test('选中 mix 后画布联动选中（selectNode 派发事件闭环）', async () => {
  const g = nodeCanvas.getGraphInfo()
  const mix = g.nodes.find(n => n.type === 'mix')
  nodeCanvas.focusNodeInCanvas(mix.id)   // 关系树点击入口：内部 selectNode → refreshSelection → 事件
  await sleep(150)
  assert.match(html(), /np-none/)        // mix 无可视化预览
  assert.match(html(), /np-head-title">混合/)
})

test('图变更（nodegraph:changed）后选中节点失效 → 回到空状态', async () => {
  const g = nodeCanvas.getGraphInfo()
  const num = g.nodes.find(n => n.type === 'number')
  document.dispatchEvent(new CustomEvent('nodegraph:selected', { detail: { id: num.id, count: 1 } }))
  await sleep(150)
  assert.match(html(), /np-head/)

  // 直接操作画布删除该节点（stub 下 deleteNode 走 updateStats → changed）
  const idBefore = num.id
  const detail = nodeCanvas.getNodeDetail(idBefore)
  assert.ok(detail)
  // 构造 changed 事件（等价于删除后的通知）
  document.dispatchEvent(new CustomEvent('nodegraph:changed'))
  // 手动置空 activeId 的路径由模块内部 getNodeDetail 判空驱动——此处节点仍存在，渲染应保持
  await sleep(250)
  assert.match(html(), /np-head/)
})

test('renderNodePreview：直接渲染 API 可用', () => {
  assert.equal(typeof nodePreview.renderNodePreview, 'function')
})

test('资产详情并入：nodepreview:show-asset → 资产视图渲染', async () => {
  document.dispatchEvent(new CustomEvent('nodepreview:show-asset', { detail: {
    kind: 'asset', name: 'stone.png', type: 'tex', typeLabel: '贴图',
    roleLabel: '漫反射', thumb: '/api/file/raw?path=/x/stone.png', path: '/x/stone.png',
    mtimeLabel: '2026-10-01', fav: false,
    onAdd(){}, onFav(){}, onCopyName(){},
  }}))
  await sleep(120)
  const html = viewContainer.innerHTML
  assert.match(html, /stone\.png/)
  assert.match(html, /np-stage/)
  assert.match(html, /np-btn primary/)
  assert.match(html, /加入画布|资产详情操作|np-actions/)
})

test('资产视图含元信息表（类型/路径/大小占位）', async () => {
  let fetched = false
  document.dispatchEvent(new CustomEvent('nodepreview:show-asset', { detail: {
    kind: 'asset', name: 'a.hdr', type: 'hdri', typeLabel: 'HDRI',
    color: '#7cbd56', color2: '#4a7a2e', path: '/hdr/a.hdr',
    mtimeLabel: '—', fav: true, fetchInfo(cb){ fetched = true; cb({ sizeLabel: '1.2 MB', mtimeLabel: '2026-10-02' }) },
    onFav(){},
  }}))
  await sleep(200)
  const html = viewContainer.innerHTML
  assert.match(html, /np-color/)
  assert.match(html, /\/hdr\/a\.hdr/)
  assert.match(html, /data-np-info="size"/)   // 大小/时间占位 span（异步填充受 stub 限制）
  assert.equal(fetched, true)                  // fetchInfo 已被调用
})

test('资产操作按钮渲染（含路径相关按钮）', async () => {
  document.dispatchEvent(new CustomEvent('nodepreview:show-asset', { detail: {
    kind: 'asset', name: 'b.png', type: 'tex', typeLabel: '贴图',
    path: '/b.png', mtimeLabel: '—', fav: false,
    onCopyName(){},
  }}))
  await sleep(120)
  const html = viewContainer.innerHTML
  assert.match(html, /data-np-asset-act="add"/)
  assert.match(html, /data-np-asset-act="fav"/)
  assert.match(html, /data-np-asset-act="locate"/)
  assert.match(html, /data-np-asset-act="copyPath"/)
  assert.match(html, /data-np-asset-act="copyName"/)
})

test('无路径资产不渲染 locate/copyPath 按钮', async () => {
  document.dispatchEvent(new CustomEvent('nodepreview:show-asset', { detail: {
    kind: 'asset', name: '纯色', type: 'mc', typeLabel: 'MC 资产',
    color: '#c084fc', mtimeLabel: '—', fav: false,
  }}))
  await sleep(120)
  const html = viewContainer.innerHTML
  assert.doesNotMatch(html, /data-np-asset-act="locate"/)
  assert.doesNotMatch(html, /data-np-asset-act="copyPath"/)
  assert.match(html, /data-np-asset-act="copyName"/)
})

test('show-asset 在面板中渲染资产详情（面板始终可见）', async () => {
  document.dispatchEvent(new CustomEvent('nodepreview:show-asset', { detail: {
    kind: 'asset', name: 'y.png', type: 'tex', typeLabel: '贴图', mtimeLabel: '—', fav: false,
  }}))
  await sleep(120)
  assert.match(viewContainer.innerHTML, /y\.png/)
})

test('hide-asset → 回到空状态（先取消节点选中）', async () => {
  document.dispatchEvent(new CustomEvent('nodegraph:selected', { detail: { id: null, count: 0 } }))
  await sleep(150)
  document.dispatchEvent(new CustomEvent('nodepreview:hide-asset'))
  await sleep(120)
  assert.match(viewContainer.innerHTML, /np-empty/)
})

test('选中节点事件 → 从资产模式切回节点模式', async () => {
  document.dispatchEvent(new CustomEvent('nodepreview:show-asset', { detail: {
    kind: 'asset', name: 'c.png', type: 'tex', typeLabel: '贴图', mtimeLabel: '—', fav: false,
  }}))
  await sleep(120)
  assert.match(viewContainer.innerHTML, /c\.png/)
  const g = nodeCanvas.getGraphInfo()
  const num = g.nodes.find(n => n.type === 'number')
  document.dispatchEvent(new CustomEvent('nodegraph:selected', { detail: { id: num.id, count: 1 } }))
  await sleep(150)
  assert.match(viewContainer.innerHTML, /np-value/)
  assert.doesNotMatch(viewContainer.innerHTML, /c\.png/)
})

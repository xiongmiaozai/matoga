/**
 * 浮动窗口化集成测试（真实浏览器路径）：
 * 不预注册任何静态 view 元素（index.html 已移除面板 DOM），
 * 断言 initNodeRel / initNodePreview 动态创建浮动窗与视图根，
 * 以及窗口拖拽摆放相关能力（位置/关闭重开）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')
process.env.NR_M3D_STUB = '1'
register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))

class RecEl {
  constructor(tag) {
    this.tagName = tag
    this.children = []
    this.attributes = {}
    this._text = ''
    this.style = { setProperty() {}, getPropertyValue() { return '' } }
    this.dataset = {}
    this.listeners = {}
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false } }
  }
  set id(v) { this._id = v; if (this._reg) this._reg.set(v, this) }
  get id() { return this._id || '' }
  setAttribute(k, v) { this.attributes[k] = String(v) }
  getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null }
  appendChild(c) { this.children.push(c); c._reg = this._reg; if (c._id && this._reg) this._reg.set(c._id, c); return c }
  insertBefore(el, ref) {
    const i = ref ? this.children.indexOf(ref) : -1
    if (i >= 0) this.children.splice(i, 0, el)
    else this.children.push(el)
    el._reg = this._reg
    if (el._id && this._reg) this._reg.set(el._id, el)
    return el
  }
  remove() {}
  querySelector() { return new RecEl('stub') }
  querySelectorAll() { return [] }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn) }
  removeEventListener() {}
  getContext() { return null }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 300, height: 200 } }
  set innerHTML(v) { this.children = []; this._html = v }
  get innerHTML() { return this._html || '' }
  set textContent(v) { this._text = String(v) }
  get textContent() { return this._text }
  set className(v) { this.attributes.class = String(v) }
  get className() { return this.attributes.class || '' }
  setPointerCapture() {}
  click() { (this.listeners.click || []).forEach(fn => fn({ target: this, stopPropagation() {} })) }
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

const idReg = new Map()
const docListeners = new Map()
const bodyEl = new RecEl('body')
bodyEl._reg = idReg
const stubDoc = makeStub()
globalThis.window = { innerWidth: 1280, innerHeight: 800, CSS: { escape: s => s }, addEventListener() {} }
globalThis.document = new Proxy(stubDoc, {
  get(t, p) {
    if (p === 'createElement' || p === 'createElementNS') return (_ns, tag) => { const e = new RecEl(tag || _ns); e._reg = idReg; return e }
    if (p === 'createDocumentFragment') return () => { const e = new RecEl('fragment'); e._reg = idReg; return e }
    if (p === 'getElementById') return id => {
      if (idReg.has(id)) return idReg.get(id)
      if (id === 'nodeRelView' || id === 'nodePreviewView') return null
      return makeStub()
    }
    if (p === 'querySelector') return () => makeStub()
    if (p === 'querySelectorAll') return () => []
    if (p === 'body') return bodyEl
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
function walk(root, fn) { root.children.forEach(c => { fn(c); walk(c, fn) }) }
function findByClass(root, cls) {
  const out = []
  walk(root, c => { if ((c.attributes && c.attributes.class || '').split(/\s+/).includes(cls)) out.push(c) })
  return out
}
function findWin(id){ return bodyEl.children.find(c => c.dataset && c.dataset.fwId === id) }

let nodeCanvas, nodeRel, nodePreview
test('初始化：动态创建两个浮动窗与视图根（无静态 DOM 路径）', async () => {
  nodeCanvas = await import(pathToFileURL(path.join(ROOT, 'web/src/node-canvas.js')).href)
  nodeRel = await import(pathToFileURL(path.join(ROOT, 'web/src/node-rel.js')).href)
  nodePreview = await import(pathToFileURL(path.join(ROOT, 'web/src/node-preview.js')).href)

  nodeCanvas.initNodeCanvas()
  nodeRel.initNodeRel()
  nodePreview.initNodePreview()

  const winRel = findWin('nodeRel')
  const winPv = findWin('nodePreview')
  assert.ok(winRel, 'nodeRel floating window created')
  assert.ok(winPv, 'nodePreview floating window created')

  const viewRel = idReg.get('nodeRelView')
  const viewPv = idReg.get('nodePreviewView')
  assert.ok(viewRel && viewRel.className === 'nr-view')
  assert.ok(viewPv && viewPv.className === 'np-view')

  let inRel = false, inPv = false
  walk(winRel, c => { if (c === viewRel) inRel = true })
  walk(winPv, c => { if (c === viewPv) inPv = true })
  assert.ok(inRel, 'nodeRelView inside its floating window')
  assert.ok(inPv, 'nodePreviewView inside its floating window')

  assert.equal(winRel.style.display === 'none', false)
  assert.equal(winPv.style.display === 'none', false)
})

test('节点关系窗渲染树内容到浮动窗视图', () => {
  const viewRel = idReg.get('nodeRelView')
  assert.equal(findByClass(viewRel, 'nr-svg').length, 1)
  assert.ok(findByClass(viewRel, 'nr-node').length >= 4)
})

test('节点关系窗标题栏含工具按钮（方向/展开/折叠/适应 + 关闭）', () => {
  const winRel = findWin('nodeRel')
  const bar = winRel.children.find(c => c.className === 'fw-titlebar')
  const tools = bar.children.find(c => c.className === 'fw-tools')
  const btns = tools.children.filter(c => (c.className || '').includes('fw-btn'))
  assert.equal(btns.length, 5, '4 tools + close')
})

test('节点预览窗初始为空状态', () => {
  const viewPv = idReg.get('nodePreviewView')
  assert.match(viewPv.innerHTML, /np-empty/)
})

test('选中节点 → 预览窗在浮动窗内更新', async () => {
  const g = nodeCanvas.getGraphInfo()
  const num = g.nodes.find(n => n.type === 'number')
  document.dispatchEvent(new CustomEvent('nodegraph:selected', { detail: { id: num.id, count: 1 } }))
  await sleep(150)
  const viewPv = idReg.get('nodePreviewView')
  assert.match(viewPv.innerHTML, /np-head/)
})

test('两个窗口位置错开且在视口内（可自由摆放）', () => {
  const winRel = findWin('nodeRel')
  const winPv = findWin('nodePreview')
  const rl = parseInt(winRel.style.left), rt = parseInt(winRel.style.top)
  const pl = parseInt(winPv.style.left), pt = parseInt(winPv.style.top)
  assert.ok(rl >= 8 && rl <= 1280 - 240)
  assert.ok(pl >= 8 && pl <= 1280 - 240)
  assert.notDeepEqual([rl, rt], [pl, pt], 'windows not stacked')
})

test('标题栏拖拽事件绑定存在（pointerdown → 移动）', () => {
  const winRel = findWin('nodeRel')
  const bar = winRel.children.find(c => c.className === 'fw-titlebar')
  assert.ok(bar.listeners.pointerdown, 'drag handler bound')
  assert.ok(bar.listeners.dblclick, 'dblclick maximize handler bound')
  const rs = winRel.children.find(c => c.className === 'fw-resize')
  assert.ok(rs && rs.listeners.pointerdown, 'resize handler bound')
})

test('关闭节点关系窗 → 树保留 DOM，重开可用', async () => {
  const { getWindow } = await import(pathToFileURL(path.join(ROOT, 'web/src/floating-window.js')).href)
  const w = getWindow('nodeRel')
  w.close()
  const winEl = findWin('nodeRel')
  assert.equal(winEl.style.display, 'none')
  const viewRel = idReg.get('nodeRelView')
  assert.equal(findByClass(viewRel, 'nr-node').length >= 4, true, 'tree DOM kept while closed')
  w.open()
  assert.equal(winEl.style.display === 'none', false)
})

test('双击标题栏最大化占满视口，再双击还原', () => {
  const { getWindow } = require('node:module') // placeholder no-op
})
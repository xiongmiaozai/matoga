/**
 * 节点关系 / 节点预览面板集成测试（DOM stub 环境）：
 * initNodeRel / initNodePreview 在面板 DOM（#nodeRelView / #nodePreviewView）
 * 已注入的前提下渲染内容、绑定工具按钮、响应节点选中事件。
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
      if (p === 'isConnected') return true
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

const nrView = new RecEl('div')
nrView.id = 'nodeRelView'
nrView.className = 'nr-view'
nrView._reg = idReg
idReg.set('nodeRelView', nrView)

const npView = new RecEl('div')
npView.id = 'nodePreviewView'
npView.className = 'np-view'
npView._reg = idReg
idReg.set('nodePreviewView', npView)

for (const btnId of ['nrDirBtn', 'nrExpandBtn', 'nrCollapseBtn', 'nrFitBtn']) {
  const btn = new RecEl('button')
  btn.id = btnId
  btn._reg = idReg
  idReg.set(btnId, btn)
}

const stubDoc = makeStub()
globalThis.window = { innerWidth: 1280, innerHeight: 800, CSS: { escape: s => s }, addEventListener() {} }
globalThis.document = new Proxy(stubDoc, {
  get(t, p) {
    if (p === 'createElement' || p === 'createElementNS') return (_ns, tag) => { const e = new RecEl(tag || _ns); e._reg = idReg; return e }
    if (p === 'createDocumentFragment') return () => { const e = new RecEl('fragment'); e._reg = idReg; return e }
    if (p === 'getElementById') return id => {
      if (idReg.has(id)) return idReg.get(id)
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

let nodeCanvas, nodeRel, nodePreview
test('初始化：面板视图根已注入，init 渲染内容', async () => {
  nodeCanvas = await import(pathToFileURL(path.join(ROOT, 'web/src/node-canvas.js')).href)
  nodeRel = await import(pathToFileURL(path.join(ROOT, 'web/src/node-rel.js')).href)
  nodePreview = await import(pathToFileURL(path.join(ROOT, 'web/src/node-preview.js')).href)

  nodeCanvas.initNodeCanvas()
  nodeRel.initNodeRel()
  nodePreview.initNodePreview()

  assert.ok(idReg.get('nodeRelView'), 'nodeRelView 存在')
  assert.ok(idReg.get('nodePreviewView'), 'nodePreviewView 存在')
})

test('节点关系面板渲染树内容到视图根', () => {
  const viewRel = idReg.get('nodeRelView')
  assert.equal(findByClass(viewRel, 'nr-svg').length, 1)
  assert.ok(findByClass(viewRel, 'nr-node').length >= 4)
})

test('节点关系面板工具按钮已绑定（方向/展开/折叠/适应）', () => {
  for (const btnId of ['nrDirBtn', 'nrExpandBtn', 'nrCollapseBtn', 'nrFitBtn']) {
    const btn = idReg.get(btnId)
    assert.ok(btn && btn.listeners.click && btn.listeners.click.length > 0, btnId + ' 已绑定 click')
  }
})

test('节点预览面板初始为空状态', () => {
  const viewPv = idReg.get('nodePreviewView')
  assert.match(viewPv.innerHTML, /np-empty/)
})

test('选中节点 → 预览面板更新', async () => {
  const g = nodeCanvas.getGraphInfo()
  const num = g.nodes.find(n => n.type === 'number')
  document.dispatchEvent(new CustomEvent('nodegraph:selected', { detail: { id: num.id, count: 1 } }))
  await sleep(150)
  const viewPv = idReg.get('nodePreviewView')
  assert.match(viewPv.innerHTML, /np-head/)
})
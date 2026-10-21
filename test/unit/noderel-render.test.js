/**
 * 节点关系窗口渲染层集成测试：
 * 以记录型 DOM stub 驱动 initNodeCanvas（示例图）→ initNodeRel（树渲染），
 * 断言生成的 SVG 结构（节点/连线/折叠按钮/状态栏）。
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
    if (typeof window !== 'undefined' && window._idReg) window._idReg.set(this, null)
  }
  set id(v) { this._id = v; if (this._reg) this._reg.set(v, this) }
  get id() { return this._id || '' }
  setAttribute(k, v) {
    this.attributes[k] = String(v)
    if (k === 'class') this.attributes.class = String(v)
  }
  getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null }
  appendChild(c) {
    this.children.push(c)
    c._reg = this._reg
    if (c._id && this._reg) this._reg.set(c._id, c)
    return c
  }
  insertBefore(el, ref) {
    const i = ref ? this.children.indexOf(ref) : -1
    if (i >= 0) this.children.splice(i, 0, el)
    else this.children.push(el)
    el._reg = this._reg
    if (el._id && this._reg) this._reg.set(el._id, el)
    return el
  }
  remove() {}
  querySelector() { const e = new RecEl('stub'); e._reg = this._reg; return e }
  querySelectorAll() { return [] }
  addEventListener() {}
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
}
function walkTree(root, fn) { root.children.forEach(c => { fn(c); walkTree(c, fn) }) }
function findByClass(root, cls) {
  const out = []
  walkTree(root, c => { if ((c.attributes && c.attributes.class || '').split(/\s+/).includes(cls)) out.push(c) })
  return out
}

/* ── 全局 stub ── */
const idReg = new Map()
const viewContainer = new RecEl('div')
viewContainer._id = 'nodeRelView'
viewContainer.clientWidth = 900
viewContainer.clientHeight = 500
idReg.set('nodeRelView', viewContainer)

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
const stubDoc = makeStub()
const docListeners = new Map()
globalThis.window = { CSS: { escape: s => s }, addEventListener() {}, _idReg: idReg }
globalThis.document = new Proxy(stubDoc, {
  get(t, p) {
    if (p === 'createElement' || p === 'createElementNS') {
      return (_ns, tag) => { const e = new RecEl(tag || _ns); e._reg = idReg; return e }
    }
    if (p === 'createDocumentFragment') return () => { const e = new RecEl('fragment'); e._reg = idReg; return e }
    if (p === 'getElementById') return id => idReg.get(id) || makeStub()
    if (p === 'querySelector') return () => makeStub()
    if (p === 'querySelectorAll') return () => []
    if (p === 'dispatchEvent') return ev => {
      for (const fn of (docListeners.get(ev.type) || [])) { try { fn(ev) } catch {} }
      return true
    }
    if (p === 'addEventListener') return (type, fn) => {
      if (!docListeners.has(type)) docListeners.set(type, [])
      docListeners.get(type).push(fn)
    }
    return t[p]
  },
})
globalThis.requestAnimationFrame = fn => {}
globalThis.ResizeObserver = undefined

let nodeCanvas, nodeRel
test('加载模块并初始化画布示例图与节点关系视图', async () => {
  nodeCanvas = await import(pathToFileURL(path.join(ROOT, 'web/src/node-canvas.js')).href)
  nodeRel = await import(pathToFileURL(path.join(ROOT, 'web/src/node-rel.js')).href)

  nodeCanvas.initNodeCanvas()   // initExample：4 节点（数值×2、颜色、混合）+ 3 条边
  nodeRel.initNodeRel()         // 渲染父子树
})

test('渲染：生成 SVG 树，节点数 = 画布节点 + 引用副本', () => {
  const svgs = findByClass(viewContainer, 'nr-svg')
  assert.equal(svgs.length, 1)
  const nodes = findByClass(viewContainer, 'nr-node')
  const edges = findByClass(viewContainer, 'nr-edge')
  // 画布 4 节点；down 模式：num1(2 子) + num2(1 ref 子) + color1(根) → 4 实体 + 2 副本 = 6
  assert.equal(nodes.length, 6)
  // 3 条连线（a、b、t）
  assert.equal(edges.length, 3)
})

test('渲染：节点标题与类型徽章正确', () => {
  const nodes = findByClass(viewContainer, 'nr-node')
  const titles = nodes.map(n => findByClass(n, 'nr-title').map(t => t.textContent)[0])
  // num1(数值) + num2(数值) + color1(颜色) 为根；mix 出现 3 次（a、t 两端口 + b 端口引用副本）
  assert.deepEqual(titles.sort(), ['数值', '数值', '混合 mix(a,b,t)', '混合 mix(a,b,t)', '混合 mix(a,b,t)', '颜色'])
})

test('渲染：根节点 = 两个数值源 + 未连接的颜色', () => {
  const world = findByClass(viewContainer, 'nr-world')[0]
  const depth0 = world.children.filter(c =>
    (c.attributes['data-act'] === 'node') &&
    (c.attributes.transform || '').startsWith('translate(0,'))
  assert.equal(depth0.length, 3)
})

test('渲染：DAG 共享子带引用样式与引用徽章', () => {
  const refs = findByClass(viewContainer, 'nr-node').filter(n => (n.attributes.class || '').includes('ref'))
  // num1→mix 第二端口副本 + num2→mix 跨根引用副本
  assert.equal(refs.length, 2)
  assert.equal(findByClass(refs[0], 'nr-ref-badge').length, 1)
})

test('渲染：有子级的节点带折叠切换按钮', () => {
  const toggles = findByClass(viewContainer, 'nr-toggle')
  // num1（2 子）与 num2（1 ref 子）各一个
  assert.equal(toggles.length, 2)
})

test('渲染：状态栏统计文本', () => {
  const status = findByClass(viewContainer, 'nr-status')
  assert.equal(status.length, 1)
  const text = status[0].innerHTML
  assert.match(text, /节点 4/)
  assert.match(text, /连接 3/)
  assert.match(text, /根 3/)
  assert.match(text, /数据流/)
})

test('联动：画布新增节点 → nodegraph:changed → 树自动刷新', async () => {
  const before = findByClass(viewContainer, 'nr-node').length
  nodeCanvas.createNode('number', 10, 10)   // 触发 updateStats → 通知事件
  await new Promise(r => setTimeout(r, 260)) // 防抖 160ms
  const after = findByClass(viewContainer, 'nr-node').length
  assert.equal(after, before + 1)
  const status = findByClass(viewContainer, 'nr-status')[0]
  assert.match(status.innerHTML, /节点 5/)
})

test('渲染：连线使用端口类型着色', () => {
  const edges = findByClass(viewContainer, 'nr-edge')
  edges.forEach(e => assert.equal(e.attributes.stroke, '#7cbd56'))
})
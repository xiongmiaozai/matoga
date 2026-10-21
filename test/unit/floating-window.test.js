/**
 * 浮动窗口（floating-window.js）单测：
 * 创建/挂载、工具按钮注入、开关与 fw:toggle 事件、几何记忆（localStorage mock）、
 * 置顶、最小尺寸、双击最大化/还原。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')
register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))

class RecEl {
  constructor(tag) {
    this.tagName = tag
    this.children = []
    this.attributes = {}
    this._text = ''
    this.style = {}
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
  closest() { return null }
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
const _ls = new Map()
globalThis.localStorage = {
  getItem: k => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => _ls.set(k, String(v)),
  removeItem: k => _ls.delete(k),
}
const stubDoc = makeStub()
globalThis.window = { innerWidth: 1280, innerHeight: 800, addEventListener() {} }
globalThis.document = new Proxy(stubDoc, {
  get(t, p) {
    if (p === 'createElement' || p === 'createElementNS') return (_ns, tag) => { const e = new RecEl(tag || _ns); e._reg = idReg; return e }
    if (p === 'createDocumentFragment') return () => { const e = new RecEl('fragment'); e._reg = idReg; return e }
    if (p === 'getElementById') return id => idReg.get(id) || null
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

const sleep = ms => new Promise(r => setTimeout(r, ms))
let fw, createFloatingWindow, toggleWindow, getWindow
test('创建浮动窗：挂载 body、几何 clamp 到视口、默认打开', async () => {
  ;({ createFloatingWindow, toggleWindow, getWindow } = await import(pathToFileURL(path.join(ROOT, 'web/src/floating-window.js')).href))
  fw = createFloatingWindow({ id: 'testWin', title: '测试窗口', icon: 'i-tree', x: 99999, y: 40, w: 400, h: 300 })
  assert.equal(fw.id, 'testWin')
  assert.ok(bodyEl.children.includes(fw.win))
  assert.equal(fw.win.dataset.fwId, 'testWin')
  const left = parseInt(fw.win.style.left)
  assert.ok(left >= 8 && left <= 1280 - 400 - 8, 'left in viewport: ' + left)
  assert.equal(fw.win.style.width, '400px')
  assert.equal(fw.isOpen(), true)
})

test('同 id 重复创建返回同一实例（幂等）', () => {
  const again = createFloatingWindow({ id: 'testWin', title: 'x', x: 0, y: 0, w: 100, h: 100 })
  assert.equal(again, fw)
})

test('addToolButton：注入标题栏工具区（关闭按钮之前）', () => {
  const btn = fw.addToolButton({ icon: 'i-swap', title: '切换', onClick: () => {} })
  const tools = fw.bar.children.find(c => c.className === 'fw-tools')
  assert.ok(tools, 'tools exists')
  const closeBtn = tools.children.find(c => (c.className || '').includes('fw-close'))
  assert.ok(closeBtn, 'closeBtn exists')
  assert.ok(tools.children.indexOf(btn) < tools.children.indexOf(closeBtn), 'tool before close')
  assert.match(btn.innerHTML, /#i-swap/)
})

test('工具按钮 click 不触发窗口关闭（stopPropagation + 独立 handler）', () => {
  let hit = 0
  const btn = fw.addToolButton({ icon: 'i-plus', title: 't', onClick: () => { hit++ } })
  btn.click()
  assert.equal(hit, 1)
  assert.equal(fw.isOpen(), true)
})

test('close / open：切换 display 并派发 fw:toggle 事件', async () => {
  const states = []
  document.addEventListener('fw:toggle', (e) => states.push([e.detail.id, e.detail.open]))
  fw.close()
  assert.equal(fw.isOpen(), false)
  assert.equal(fw.win.style.display, 'none')
  fw.open()
  assert.equal(fw.isOpen(), true)
  assert.deepEqual(states, [['testWin', false], ['testWin', true]])
})

test('toggleWindow(id)：全局开关', () => {
  toggleWindow('testWin')
  assert.equal(fw.isOpen(), false)
  toggleWindow('testWin')
  assert.equal(fw.isOpen(), true)
})

test('getWindow(id) 注册表查询', () => {
  assert.equal(getWindow('testWin'), fw)
  assert.equal(getWindow('nope'), undefined)
})

test('几何记忆：localStorage 存位置与开关态', async () => {
  fw.close()
  const raw = _ls.get('matoga.fw.testWin')
  assert.ok(raw, 'saved')
  const saved = JSON.parse(raw)
  assert.equal(saved.open, false)
  assert.ok(typeof saved.x === 'number' && typeof saved.w === 'number')
})

test('最小尺寸约束：w/h 不低于下限', () => {
  const w2 = createFloatingWindow({ id: 'tiny', title: '小窗', x: 10, y: 10, w: 10, h: 10 })
  assert.ok(parseInt(w2.win.style.width) >= 240)
  assert.ok(parseInt(w2.win.style.height) >= 160)
})

test('onToggle 回调：属性式注册', async () => {
  let seen = null
  fw.onToggle = (open) => { seen = open }
  fw.close()
  assert.equal(seen, false)
  fw.open()
  assert.equal(seen, true)
  fw.onToggle = null
})

test('初始关闭态：open:false 创建时不显示', () => {
  const w3 = createFloatingWindow({ id: 'closed', title: '关', x: 10, y: 10, w: 300, h: 200, open: false })
  assert.equal(w3.isOpen(), false)
  assert.equal(w3.win.style.display, 'none')
})

test('双击标题栏最大化 → toggleMaximize 占满视口', () => {
  const w4 = createFloatingWindow({ id: 'maxi', title: '大', x: 100, y: 100, w: 300, h: 200 })
  assert.equal(w4.isMaximized(), false)
  ;(w4.bar.listeners.dblclick || []).forEach(fn => fn({ target: w4.bar, closest: () => null }))
  assert.equal(w4.isMaximized(), true)
  assert.equal(w4.win.style.left, '0px')
  assert.equal(w4.win.style.width, '100vw')
  // 再双击 → 还原
  ;(w4.bar.listeners.dblclick || []).forEach(fn => fn({ target: w4.bar, closest: () => null }))
  assert.equal(w4.isMaximized(), false)
  assert.equal(w4.win.style.left, '100px')
  assert.equal(w4.win.style.width, '300px')
})

test('最大化态持久化：localStorage 记忆 maximized', () => {
  const w5 = createFloatingWindow({ id: 'maxi2', title: '记', x: 50, y: 50, w: 300, h: 200 })
  w5.toggleMaximize()
  const saved = JSON.parse(_ls.get('matoga.fw.maxi2'))
  assert.equal(saved.maximized, true)
  w5.toggleMaximize()
  const saved2 = JSON.parse(_ls.get('matoga.fw.maxi2'))
  assert.equal(saved2.maximized, false)
})
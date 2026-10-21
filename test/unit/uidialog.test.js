/**
 * ui-dialog（Electron 兼容的 prompt/confirm 替代）单测：
 * Promise 语义、按钮/键盘路径的 resolve 值、取消行为。
 * 以最小 fake DOM 加载模块（无浏览器依赖）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')
register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))

function fakeEl(tag) {
  const el = {
    tag, className: '', textContent: '', placeholder: '', type: '',
    style: {}, value: '', children: [], handlers: {}, removed: false, parent: null,
    appendChild(c) { this.children.push(c); c.parent = this; return c },
    addEventListener(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn) },
    removeEventListener() {},
    remove() { this.removed = true },
    focus() {}, select() {},
    dispatch(ev, e) { (this.handlers[ev] || []).forEach(fn => fn(e)) },
  }
  return el
}

const created = []
const docHandlers = {}
globalThis.document = {
  createElement(tag) { const el = fakeEl(tag); created.push(el); return el },
  body: { appendChild() {} },
  addEventListener(ev, fn) { docHandlers[ev] = fn },
  removeEventListener(ev) { delete docHandlers[ev] },
}

const walk = (el, fn) => { fn(el); el.children.forEach(c => walk(c, fn)) }
const findByTag = (root, tag) => { const out = []; walk(root, c => { if (c.tag === tag) out.push(c) }); return out }

let uiPrompt, uiConfirm

test('加载 ui-dialog 模块（fake DOM 环境）', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'web/src/ui-dialog.js')).href)
  uiPrompt = mod.uiPrompt
  uiConfirm = mod.uiConfirm
  assert.equal(typeof uiPrompt, 'function')
  assert.equal(typeof uiConfirm, 'function')
})

test('uiPrompt：确定按钮 → resolve 输入值，遮罩移除', async () => {
  created.length = 0
  const p = uiPrompt({ title: 'T', label: 'L', value: 'abc' })
  const backdrop = created[0]
  const input = findByTag(backdrop, 'input')[0]
  assert.equal(input.value, 'abc')
  input.value = 'hello '
  const btns = findByTag(backdrop, 'button')
  const ok = btns[btns.length - 1]
  ok.dispatch('click', {})
  assert.equal(await p, 'hello ')
  assert.equal(backdrop.removed, true)
})

test('uiPrompt：取消按钮 → resolve null', async () => {
  created.length = 0
  const p = uiPrompt({ title: 'T' })
  const backdrop = created[0]
  const btns = findByTag(backdrop, 'button')
  btns[0].dispatch('click', {})
  assert.equal(await p, null)
  assert.equal(backdrop.removed, true)
})

test('uiPrompt：Enter → resolve 输入值；Esc → resolve null', async () => {
  created.length = 0
  const p1 = uiPrompt({ title: 'T' })
  const backdrop1 = created[0]
  const input1 = findByTag(backdrop1, 'input')[0]
  input1.value = 'x'
  input1.dispatch('keydown', { key: 'Enter', stopPropagation() {} })
  assert.equal(await p1, 'x')

  const start = created.length
  const p2 = uiPrompt({ title: 'T' })
  const backdrop2 = created[start]
  const input2 = findByTag(backdrop2, 'input')[0]
  input2.dispatch('keydown', { key: 'Escape', stopPropagation() {} })
  assert.equal(await p2, null)
})

test('uiConfirm：确定 → true，取消 → false', async () => {
  created.length = 0
  const p1 = uiConfirm({ title: 'T', message: 'M', danger: true })
  const backdrop1 = created[0]
  assert.ok(findByTag(backdrop1, 'div').some(d => d.textContent === 'M'))
  const btns1 = findByTag(backdrop1, 'button')
  btns1[btns1.length - 1].dispatch('click', {})
  assert.equal(await p1, true)

  const start = created.length
  const p2 = uiConfirm({ title: 'T' })
  const backdrop2 = created[start]
  const btns2 = findByTag(backdrop2, 'button')
  btns2[0].dispatch('click', {})
  assert.equal(await p2, false)
})

test('uiConfirm：document 级 Esc → false', async () => {
  created.length = 0
  const p = uiConfirm({ title: 'T' })
  const backdrop = created[0]
  docHandlers.keydown({ key: 'Escape' })
  assert.equal(await p, false)
  assert.equal(backdrop.removed, true)
})
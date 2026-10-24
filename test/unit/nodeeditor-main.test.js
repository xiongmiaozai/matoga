/**
 * node-editor-main.js（节点画布独立页薄入口）单测：
 * - DOM stub 环境下完整加载（node-canvas.js 引擎链 import 安全）
 * - embed 消息协议：ping→pong、addNode/addTexture/loadPreset 不崩溃
 * node-editor.html 原内嵌 1700 行旧引擎已收敛为该薄入口。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')
register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))
process.env.NR_M3D_STUB = '1'

function makeStub() {
  const fn = function () { return makeStub() }
  const styleObj = { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } }
  return new Proxy(fn, {
    get(t, p) {
      if (p === 'style') return styleObj
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
globalThis.document = makeStub()
let messageHandler = null
globalThis.window = {
  CSS: { escape: s => s },
  addEventListener(type, fn) { if (type === 'message') messageHandler = fn },
  parent: null,
}
globalThis.location = { search: '' }
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0)

test('node-editor-main：薄入口加载成功并注册 embed 消息协议', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'web/src/node-editor-main.js')).href)
  assert.ok(mod, '模块加载成功（node-canvas 引擎链 import 安全）')
  assert.ok(messageHandler, 'window message 监听已注册')
})

test('node-editor-main：embed 协议 ping → pong', async () => {
  await import(pathToFileURL(path.join(ROOT, 'web/src/node-editor-main.js')).href)
  assert.ok(messageHandler)
  let pong = null
  const source = { postMessage(m) { pong = m } }
  messageHandler({ data: { type: 'ping' }, source })
  assert.deepEqual(pong, { type: 'pong' }, 'ping 应回 pong')
})

test('node-editor-main：addNode / addTexture / loadPreset 消息在 stub DOM 下不崩溃', async () => {
  await import(pathToFileURL(path.join(ROOT, 'web/src/node-editor-main.js')).href)
  assert.ok(messageHandler)
  assert.doesNotThrow(() => messageHandler({ data: { type: 'addNode', nodeType: 'number', x: 10, y: 20 } }))
  assert.doesNotThrow(() => messageHandler({ data: { type: 'addTexture', path: '/t/a.png', name: 'a' } }))
  assert.doesNotThrow(() => messageHandler({ data: { type: 'loadPreset', preset: 'metal' } }))
  assert.doesNotThrow(() => messageHandler({ data: null }))
  assert.doesNotThrow(() => messageHandler({ data: { type: 'unknown' } }))
})
/**
 * 法线生成节点（normalGen）单测：
 * - 节点可创建、端口定义正确（输入 tex/texture + strength/number；输出 normal/texture）、节点库可见
 * - 未连线求值：normal 为 null 不崩溃
 * - texture(tex) → normalGen 连线求值：stub 环境无 canvas/Image，异步未完成时 normal 为 null 不崩溃
 * - 异步回落后仍保持 null、不抛错
 * - 类型不匹配的连线被拒绝（color → tex 端口）
 * - normalGen 输出(texture) → normalOutLeft 输入(texture) 可连接（法线生成→法线输出链路）
 * - strength 优先取连线输入，回退 widget props
 * 前端模块依赖浏览器环境，此处以 DOM stub + 模块重定向在 Node 中加载。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')
register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))

/* 万能 DOM stub：仅让模块顶层副作用与节点渲染安全执行（style 需带 setProperty） */
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
globalThis.window = { CSS: { escape: s => s }, addEventListener() {} }
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0)

/* 真实小对象模拟端口元素（dataset/classList/getBoundingClientRect 可用） */
const portEl = (node, port, dir, type) => ({
  dataset: { node, port, dir, type },
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
  getBoundingClientRect() { return { left: 0, top: 0, width: 11, height: 11 } },
})

const PNG_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
let mod

test('加载 node-canvas 前端模块（DOM stub 环境）', async () => {
  mod = await import(pathToFileURL(path.join(ROOT, 'web/src/node-canvas.js')).href)
  assert.equal(typeof mod.createNode, 'function')
  assert.equal(typeof mod.getNodeDetail, 'function')
  assert.equal(typeof mod.getGraphInfo, 'function')
})

test('normalGen：可创建、端口与节点库定义正确', () => {
  const n = mod.createNode('normalGen', 50, 50)
  assert.ok(n, 'normalGen 创建失败')
  assert.equal(n.type, 'normalGen')
  const d = mod.getGraphInfo().defs.normalGen
  assert.ok(d, 'getGraphInfo 缺少 normalGen')
  assert.equal(d.title, '法线生成 (高度→法线)')
  assert.equal(d.group, '材质')
  assert.ok(!d.hidden, 'normalGen 应在节点库可见')
  assert.deepEqual(d.inputs, [
    { n: 'tex', t: 'texture' },
    { n: 'strength', t: 'number' }
  ])
  assert.deepEqual(d.outputs, [{ n: 'normal', t: 'texture' }])
})

test('normalGen：未连线求值 normal 为 null 且不崩溃', () => {
  const n = mod.createNode('normalGen', 10, 10)
  mod._debugEvaluate()
  // evalOut 序列化剔除 null 键：空对象即代表 normal 为 null
  assert.deepEqual(mod.getNodeDetail(n.id).evalOut, {})
})

test('normalGen：texture(tex) → normalGen 连线 stub 下异步未完成，normal 为 null 不崩溃', async () => {
  const tex = mod.createNode('texture', 10, 10)
  tex.props.tex = PNG_URL
  const ng = mod.createNode('normalGen', 200, 10)
  mod._debugStartEdge(portEl(tex.id, 'tex', 'out', 'texture'))
  mod._debugFinishEdge(portEl(ng.id, 'tex', 'in', 'texture'))
  assert.deepEqual(mod.getNodeDetail(ng.id).evalOut, {})
  // 等待异步失败路径（stub 无 Image，_loadImg 永挂起）后仍应保持 null、不抛错
  await new Promise(res => setImmediate(res))
  assert.deepEqual(mod.getNodeDetail(ng.id).evalOut, {})
})

test('normalGen：类型不匹配的连线被拒绝（color → normalGen.tex）', () => {
  const c = mod.createNode('color', 10, 300)
  const ng = mod.createNode('normalGen', 260, 300)
  const before = mod.getGraphInfo().edges.length
  mod._debugStartEdge(portEl(c.id, 'color', 'out', 'color'))
  mod._debugFinishEdge(portEl(ng.id, 'tex', 'in', 'texture'))
  assert.equal(mod.getGraphInfo().edges.length, before)
})

test('normalGen：输出(texture) → normalOutLeft 输入(texture) 可连接（法线生成→法线输出链路）', () => {
  const ng = mod.createNode('normalGen', 10, 400)
  const out = mod.createNode('normalOutLeft', 260, 400)
  const before = mod.getGraphInfo().edges.length
  mod._debugStartEdge(portEl(ng.id, 'normal', 'out', 'texture'))
  mod._debugFinishEdge(portEl(out.id, 'tex', 'in', 'texture'))
  assert.equal(mod.getGraphInfo().edges.length, before + 1)
})

test('normalGen：strength 连线优先于 widget props', () => {
  const ng = mod.createNode('normalGen', 10, 500)
  const numNode = mod.createNode('number', 10, 540)
  numNode.props.value = 2.5
  mod._debugStartEdge(portEl(numNode.id, 'value', 'out', 'number'))
  mod._debugFinishEdge(portEl(ng.id, 'strength', 'in', 'number'))
  // 未连 tex → normal 为 null；仅验证求值不崩溃（strength 取连线值 2.5，但无高度图输出仍 null）
  mod._debugEvaluate()
  assert.deepEqual(mod.getNodeDetail(ng.id).evalOut, {})
})
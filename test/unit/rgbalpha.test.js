/**
 * RGB+A 拆分节点（rgbAlphaSplit）单测：
 * - 节点可创建、端口定义正确（输入 tex/texture；输出 rgb/alpha 两个 texture 端口）、节点库可见
 * - 未连线求值：两输出均为 null（evalOut 序列化剔除 null 键）且不崩溃
 * - texture 节点 → rgbAlphaSplit 连线求值：stub 环境无 canvas/Image，异步拆分未完成时输出为 null 不崩溃
 * - 类型不匹配的连线被拒绝（color → tex 端口）
 * - 拆分输出（texture）→ rgbaMerge 的 any 输入可连接；→ 贴图输出节点的 texture 输入可连接
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

test('rgbAlphaSplit：可创建、端口与节点库定义正确', () => {
  const n = mod.createNode('rgbAlphaSplit', 50, 50)
  assert.ok(n, 'rgbAlphaSplit 创建失败')
  assert.equal(n.type, 'rgbAlphaSplit')
  const d = mod.getGraphInfo().defs.rgbAlphaSplit
  assert.ok(d, 'getGraphInfo 缺少 rgbAlphaSplit')
  assert.equal(d.title, 'RGB+A 拆分')
  assert.equal(d.group, '材质')
  assert.ok(!d.hidden, 'rgbAlphaSplit 应在节点库可见')

  assert.deepEqual(d.inputs, [{ n: 'tex', t: 'texture' }])
  assert.deepEqual(d.outputs, [{ n: 'rgb', t: 'texture' }, { n: 'alpha', t: 'texture' }])
})

test('未连线时求值：两输出均为 null 且不崩溃', () => {
  const n = mod.createNode('rgbAlphaSplit', 10, 10)
  mod._debugEvaluate()
  // evalOut 序列化会剔除值为 null 的键：空对象即代表两输出均为 null
  assert.deepEqual(mod.getNodeDetail(n.id).evalOut, {})
})

test('texture(tex) → rgbAlphaSplit 连线求值：stub 下异步未完成，输出为 null 不崩溃', async () => {
  const tex = mod.createNode('texture', 10, 10)
  tex.props.tex = PNG_URL
  const split = mod.createNode('rgbAlphaSplit', 200, 10)
  mod._debugStartEdge(portEl(tex.id, 'tex', 'out', 'texture'))
  mod._debugFinishEdge(portEl(split.id, 'tex', 'in', 'texture'))
  assert.deepEqual(mod.getNodeDetail(split.id).evalOut, {})
  // 等待异步拆分失败路径（stub 无 Image）回调 evaluate() 后仍应保持 null、不抛错
  await new Promise(res => setImmediate(res))
  assert.deepEqual(mod.getNodeDetail(split.id).evalOut, {})
})

test('类型不匹配的连线被拒绝（color → rgbAlphaSplit.tex）', () => {
  const c = mod.createNode('color', 10, 300)
  const split = mod.createNode('rgbAlphaSplit', 260, 300)
  const before = mod.getGraphInfo().edges.length
  mod._debugStartEdge(portEl(c.id, 'color', 'out', 'color'))
  mod._debugFinishEdge(portEl(split.id, 'tex', 'in', 'texture'))
  assert.equal(mod.getGraphInfo().edges.length, before)
})

test('rgbAlphaSplit 两输出(texture) → rgbaMerge 输入(any) 可连接（拆分→合并链路）', () => {
  // 注：现有 createsCycle 引擎会拒绝同源节点到同一目标节点的第二条边，故连到两个 merge
  const split = mod.createNode('rgbAlphaSplit', 10, 400)
  const mergeA = mod.createNode('rgbaMerge', 300, 400)
  const mergeB = mod.createNode('rgbaMerge', 300, 560)
  const before = mod.getGraphInfo().edges.length
  mod._debugStartEdge(portEl(split.id, 'alpha', 'out', 'texture'))
  mod._debugFinishEdge(portEl(mergeA.id, 'a', 'in', 'any'))
  mod._debugStartEdge(portEl(split.id, 'rgb', 'out', 'texture'))
  mod._debugFinishEdge(portEl(mergeB.id, 'r', 'in', 'any'))
  assert.equal(mod.getGraphInfo().edges.length, before + 2)
  // evalOut 剔除 null 键：无 tex 键即代表合成结果为 null（stub 下异步未完成）
  for (const m of [mergeA, mergeB]) {
    const d = mod.getNodeDetail(m.id).evalOut
    assert.ok(!('tex' in d), 'stub 下 rgbaMerge tex 应为 null（异步未完成）')
  }
})

test('rgbAlphaSplit 输出(texture) → 贴图输出节点 tex 输入可连接', () => {
  const split = mod.createNode('rgbAlphaSplit', 10, 600)
  const out = mod.createNode('mainTexOutLeft', 300, 600)
  const before = mod.getGraphInfo().edges.length
  mod._debugStartEdge(portEl(split.id, 'rgb', 'out', 'texture'))
  mod._debugFinishEdge(portEl(out.id, 'tex', 'in', 'texture'))
  assert.equal(mod.getGraphInfo().edges.length, before + 1)
  // stub 下拆分异步未完成 → mainTextureUrl 为 null → evalOut 无该键
  const d = mod.getNodeDetail(out.id).evalOut
  assert.ok(!('mainTextureUrl' in d), 'stub 下拆分未完成时 mainTextureUrl 应为 null')
})
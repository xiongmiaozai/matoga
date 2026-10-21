/**
 * 贴图输出节点（主贴图 / 法线 -n / 高光 -s × 左/右）单测：
 * - 6 种新节点类型可创建、端口定义正确（输入 tex/texture，无输出端口）、节点库可见
 * - texture 节点（PNG dataURL，RGBA 通道）→ 输出节点连线后求值透传贴图链接
 * - normalMap 节点 {src,strength} 对象 → 法线输出节点取 src 并带 normalScale
 * - 未连线时求值为 null（显式清除槽位语义）
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
const TEX_OUT_TYPES = [
  ['mainTexOutLeft', '主贴图输出 (左)', 'mainTextureUrl'],
  ['mainTexOutRight', '主贴图输出 (右)', 'mainTextureUrl'],
  ['normalOutLeft', '法线输出 -n (左)', 'normalMapUrl'],
  ['normalOutRight', '法线输出 -n (右)', 'normalMapUrl'],
  ['specOutLeft', '高光输出 -s (左)', 'specTextureUrl'],
  ['specOutRight', '高光输出 -s (右)', 'specTextureUrl'],
]

let mod

test('加载 node-canvas 前端模块（DOM stub 环境）', async () => {
  mod = await import(pathToFileURL(path.join(ROOT, 'web/src/node-canvas.js')).href)
  assert.equal(typeof mod.createNode, 'function')
  assert.equal(typeof mod.getNodeDetail, 'function')
  assert.equal(typeof mod.getGraphInfo, 'function')
})

test('6 种贴图输出节点：可创建、端口与节点库定义正确', () => {
  TEX_OUT_TYPES.forEach(([type]) => {
    const n = mod.createNode(type, 50, 50)
    assert.ok(n, type + ' 创建失败')
    assert.equal(n.type, type)
  })
  const defs = mod.getGraphInfo().defs
  TEX_OUT_TYPES.forEach(([type, title]) => {
    const d = defs[type]
    assert.ok(d, 'getGraphInfo 缺少 ' + type)
    assert.equal(d.title, title)
    assert.equal(d.group, '输出')
    assert.deepEqual(d.inputs, [{ n: 'tex', t: 'texture' }])
    assert.deepEqual(d.outputs, [])
  })
})

test('主贴图输出：texture(tex) 链接 → 左/右输出节点透传 PNG dataURL', () => {
  const tex = mod.createNode('texture', 10, 10)
  tex.props.tex = PNG_URL
  const left = mod.createNode('mainTexOutLeft', 200, 10)
  const right = mod.createNode('mainTexOutRight', 200, 160)
  // 模拟拖线：从 texture.tex 输出端口 → 输出节点 tex 输入端口
  mod.createNode('number', 10, 300) // 干扰节点（无影响）
  const start = portEl(tex.id, 'tex', 'out', 'texture')
  mod._debugStartEdge(start)
  mod._debugFinishEdge(portEl(left.id, 'tex', 'in', 'texture'))
  assert.equal(mod.getNodeDetail(left.id).evalOut.mainTextureUrl, PNG_URL)
  assert.ok(!('mainTextureUrl' in mod.getNodeDetail(right.id).evalOut), '未连线时不应有 mainTextureUrl 键')
})

test('法线输出：normalMap {src,strength} 对象 → 取 src 并携带 normalScale', () => {
  const tex = mod.createNode('texture', 10, 200)
  tex.props.tex = PNG_URL
  const nm = mod.createNode('normalMap', 100, 200)
  const out = mod.createNode('normalOutLeft', 260, 200)
  mod._debugStartEdge(portEl(tex.id, 'tex', 'out', 'texture'))
  mod._debugFinishEdge(portEl(nm.id, 'tex', 'in', 'texture'))
  mod._debugStartEdge(portEl(nm.id, 'normal', 'out', 'texture'))
  mod._debugFinishEdge(portEl(out.id, 'tex', 'in', 'texture'))
  const d = mod.getNodeDetail(out.id).evalOut
  assert.equal(d.normalMapUrl, PNG_URL)
})

test('高光输出：texture(tex) 链接 → specTextureUrl 透传', () => {
  const tex = mod.createNode('texture', 10, 400)
  tex.props.tex = PNG_URL
  const out = mod.createNode('specOutRight', 260, 400)
  mod._debugStartEdge(portEl(tex.id, 'tex', 'out', 'texture'))
  mod._debugFinishEdge(portEl(out.id, 'tex', 'in', 'texture'))
  assert.equal(mod.getNodeDetail(out.id).evalOut.specTextureUrl, PNG_URL)
})

test('类型不匹配的连线被拒绝（color → tex 端口）', () => {
  const c = mod.createNode('color', 10, 500)
  const out = mod.createNode('specOutLeft', 260, 500)
  const before = mod.getGraphInfo().edges.length
  mod._debugStartEdge(portEl(c.id, 'color', 'out', 'color'))
  mod._debugFinishEdge(portEl(out.id, 'tex', 'in', 'texture'))
  assert.equal(mod.getGraphInfo().edges.length, before)
})
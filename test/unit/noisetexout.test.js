/**
 * 噪波纹理输出（tex 端口）单测：
 * - noise/voronoi/simplex/ridge/warp 均新增 tex(texture) 输出端口；out 仍为首端口（预览逻辑不受影响）
 * - eval 同时输出 out 数值（0~1）与 tex 纹理链接；DOM stub 下无真 canvas，tex 防御性为 null（不崩溃、不外泄异常值）
 * - 噪波 tex → rgbaMerge 通道输入（any 类型）连线成功（此前连 out 只得常量填充，噪波图案丢失）
 * - 噪波 tex → 主贴图输出节点 tex(texture) 连线成功
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

const NOISE_TYPES = ['noise', 'voronoi', 'simplex', 'ridge', 'warp']

let mod

test('加载 node-canvas 前端模块（DOM stub 环境）', async () => {
  mod = await import(pathToFileURL(path.join(ROOT, 'web/src/node-canvas.js')).href)
  assert.equal(typeof mod.createNode, 'function')
})

test('5 种噪波节点：均有 tex(texture) 输出端口，out 仍为首端口', () => {
  NOISE_TYPES.forEach(type => {
    const n = mod.createNode(type, 50, 50)
    assert.ok(n, type + ' 创建失败')
  })
  const defs = mod.getGraphInfo().defs
  NOISE_TYPES.forEach(type => {
    const d = defs[type]
    assert.ok(d, 'getGraphInfo 缺少 ' + type)
    assert.equal(d.outputs.length, 2, type + ' 应有 2 个输出端口')
    assert.deepEqual(d.outputs[0], { n: 'out', t: 'number' }, type + ' 首输出端口须仍为 out（预览取 outputs[0]）')
    assert.deepEqual(d.outputs[1], { n: 'tex', t: 'texture' }, type + ' 应有 tex 纹理输出端口')
  })
})

test('噪波节点 eval：out 数值正常；stub 无 canvas 时 tex 为 null 且不外泄', () => {
  NOISE_TYPES.forEach(type => {
    const n = mod.createNode(type, 150, 150)
    const d = mod.getNodeDetail(n.id)
    assert.equal(typeof d.evalOut.out, 'number', type + ' out 应为数')
    assert.ok(d.evalOut.out >= 0 && d.evalOut.out <= 1, type + ' out 应在 [0,1]')
    assert.ok(!('tex' in d.evalOut), type + ' stub 下 tex=null 不应出现在 evalOut（真浏览器下为 dataURL 字符串）')
  })
})

test('噪波 tex → rgbaMerge 通道输入（any）：连线成功建立', () => {
  const noise = mod.createNode('noise', 10, 10)
  const merge = mod.createNode('rgbaMerge', 300, 10)
  const before = mod.getGraphInfo().edges.length
  mod._debugStartEdge(portEl(noise.id, 'tex', 'out', 'texture'))
  mod._debugFinishEdge(portEl(merge.id, 'r', 'in', 'any'))
  const after = mod.getGraphInfo().edges
  assert.equal(after.length, before + 1, '噪波 tex → rgbaMerge.r 连线应成功')
  assert.equal(after[after.length - 1].from.port, 'tex')
  assert.equal(after[after.length - 1].to.port, 'r')
  const d = mod.getNodeDetail(merge.id)
  assert.ok(d.connections.inputs.some(c => c.fromPort === 'tex' && c.port === 'r'), 'rgbaMerge 连接详情应包含该边')
})

test('噪波 tex → 主贴图输出（texture）：连线成功透传', () => {
  const noise = mod.createNode('simplex', 10, 200)
  const out = mod.createNode('mainTexOutLeft', 300, 200)
  const before = mod.getGraphInfo().edges.length
  mod._debugStartEdge(portEl(noise.id, 'tex', 'out', 'texture'))
  mod._debugFinishEdge(portEl(out.id, 'tex', 'in', 'texture'))
  assert.equal(mod.getGraphInfo().edges.length, before + 1, '噪波 tex → texture 输入连线应成功')
  const d = mod.getNodeDetail(out.id)
  assert.ok(!('mainTextureUrl' in d.evalOut), 'stub 下 tex=null，输出节点应无 mainTextureUrl 键（真浏览器下透传 dataURL）')
})

test('噪波 out(number) → rgbaMerge（any）仍可连（常量语义保留）', () => {
  const noise = mod.createNode('ridge', 10, 400)
  const merge = mod.createNode('rgbaMerge', 300, 400)
  const before = mod.getGraphInfo().edges.length
  mod._debugStartEdge(portEl(noise.id, 'out', 'out', 'number'))
  mod._debugFinishEdge(portEl(merge.id, 'g', 'in', 'any'))
  assert.equal(mod.getGraphInfo().edges.length, before + 1)
})

test('噪波 tex(texture) → color 强类型端口：类型检查仍拒绝不匹配连线', () => {
  const noise = mod.createNode('warp', 10, 600)
  const outMat = mod.createNode('output', 500, 600)
  const before = mod.getGraphInfo().edges.length
  mod._debugStartEdge(portEl(noise.id, 'tex', 'out', 'texture'))
  mod._debugFinishEdge(portEl(outMat.id, 'baseColor', 'in', 'color'))
  assert.equal(mod.getGraphInfo().edges.length, before, 'texture → color 应被类型检查拒绝')
})
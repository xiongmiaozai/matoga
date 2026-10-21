/**
 * 节点关系窗口（node-rel.js）核心逻辑单测：
 * 父子树构建（数据流/构成双向）、DAG 共享引用、环防护、tidy 布局。
 * 前端模块依赖浏览器环境，此处以 DOM stub + 模块重定向在 Node 中加载。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

/* three / golden-layout 裸路径重定向（浏览器 import map 的 Node 等价物） */
const ROOT = path.resolve(__dirname, '../..')
register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))

/* 万能 DOM stub：仅让模块顶层副作用安全执行 */
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
globalThis.document = makeStub()
globalThis.window = { CSS: { escape: s => s }, addEventListener() {} }
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0)

const testGraph = {
  nodes: [
    { id: 'S1', type: 'number', title: null },
    { id: 'S2', type: 'number', title: null },
    { id: 'M', type: 'mix', title: null },
    { id: 'O', type: 'output', title: null },
    { id: 'ISO', type: 'color', title: null },
  ],
  edges: [
    { id: 'e1', from: { node: 'S1', port: 'value' }, to: { node: 'M', port: 'a' } },
    { id: 'e2', from: { node: 'S2', port: 'value' }, to: { node: 'M', port: 'b' } },
    { id: 'e3', from: { node: 'S1', port: 'value' }, to: { node: 'M', port: 't' } },
    { id: 'e4', from: { node: 'M', port: 'out' }, to: { node: 'O', port: 'baseColor' } },
  ],
  defs: {
    number: { title: '数值', group: '输入', color: '#7cbd56', inputs: [], outputs: [{ n: 'value', t: 'number' }] },
    mix: { title: '混合', group: '运算', color: '#7cbd56', inputs: [{ n: 'a', t: 'number' }], outputs: [{ n: 'out', t: 'number' }] },
    output: { title: '主输出', group: '输出', color: '#7cbd56', inputs: [{ n: 'baseColor', t: 'color' }], outputs: [] },
    color: { title: '颜色', group: '输入', color: '#c084fc', inputs: [], outputs: [{ n: 'color', t: 'color' }] },
  },
}

let buildForest, layoutForest

test('加载前端模块（DOM stub 环境）', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'web/src/node-rel.js')).href)
  buildForest = mod.buildForest
  layoutForest = mod.layoutForest
  assert.equal(typeof buildForest, 'function')
  assert.equal(typeof layoutForest, 'function')
})

test('down 模式：源节点为根，子为下游消费者', () => {
  const { forest, maxDepth } = buildForest(testGraph, 'down')
  assert.deepEqual(forest.map(r => r.id), ['S1', 'S2', 'ISO'])
  assert.equal(maxDepth, 2)

  const s1 = forest[0]
  assert.deepEqual(s1.children.map(c => c.id), ['M', 'M'])
  assert.equal(s1.children[0].inPort, 'a')
  assert.equal(s1.children[1].inPort, 't')
  assert.equal(s1.children[0].children[0].id, 'O')
})

test('down 模式：DAG 共享子节点转为引用（不重复展开）', () => {
  const { forest } = buildForest(testGraph, 'down')
  const s2 = forest[1]
  assert.equal(s2.children.length, 1)
  assert.equal(s2.children[0].id, 'M')
  assert.equal(s2.children[0].ref, true)
  assert.equal(s2.children[0].children.length, 0)
})

test('down 模式：孤立节点单独成根', () => {
  const { forest } = buildForest(testGraph, 'down')
  const iso = forest.find(r => r.id === 'ISO')
  assert.ok(iso)
  assert.equal(iso.children.length, 0)
})

test('up 模式：输出节点为根，子为上游提供者', () => {
  const { forest } = buildForest(testGraph, 'up')
  assert.deepEqual(forest.map(r => r.id).sort(), ['ISO', 'O'])
  const o = forest.find(r => r.id === 'O')
  assert.equal(o.children[0].id, 'M')
  const m = o.children[0]
  const solid = m.children.filter(c => !c.ref).map(c => c.id).sort()
  assert.deepEqual(solid, ['S1', 'S2'])
  assert.equal(m.children.filter(c => c.ref).length, 1)
  assert.equal(m.children.find(c => c.id === 'S1' && !c.ref).outPort, 'value')
})

test('环防护：第二次出现的一方转为引用，节点不丢失', () => {
  const cyclic = {
    nodes: [{ id: 'A', type: 'mix', title: null }, { id: 'B', type: 'mix', title: null }],
    edges: [
      { id: 'e1', from: { node: 'A', port: 'out' }, to: { node: 'B', port: 'a' } },
      { id: 'e2', from: { node: 'B', port: 'out' }, to: { node: 'A', port: 'b' } },
    ],
    defs: testGraph.defs,
  }
  const { forest } = buildForest(cyclic, 'down')
  const refs = []
  const seen = new Set()
  const walk = tn => { seen.add(tn.id); if (tn.ref) refs.push(tn.id); tn.children.forEach(walk) }
  forest.forEach(walk)
  assert.equal(refs.length, 1)
  assert.deepEqual([...seen].sort(), ['A', 'B'])
})

test('布局：父节点 y 对齐子节点中点，x 按深度分列', () => {
  const { forest } = buildForest(testGraph, 'down')
  const { width } = layoutForest(forest)
  assert.ok(width > 0)

  const s1 = forest[0]
  const kids = s1.children
  assert.ok(Math.abs(s1.y - (kids[0].y + kids[kids.length - 1].y) / 2) < 1e-9)
  assert.equal(s1.x, 0)
  assert.equal(kids[0].x > s1.x, true)
  assert.equal(kids[0].children[0].x > kids[0].x, true)
})

test('布局：多根之间保留额外间距', () => {
  const { forest } = buildForest(testGraph, 'down')
  layoutForest(forest)
  const s2 = forest[1]
  const s1Bottom = forest[0].children[forest[0].children.length - 1].y
  assert.ok(s2.y > s1Bottom)
})
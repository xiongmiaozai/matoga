/**
 * evaluate() 拓扑排序邻接表优化（O(V×E) → O(V+E)）的算法等价性单测。
 * 不加载前端模块（evaluate 依赖大量 DOM 副作用），而是直接对比
 * 「原始边遍历版」与「邻接表版」在大量随机 DAG 上产出的拓扑序一致。
 * 同时对比求值阶段「连入端口查找」的等价性。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

// 原始版拓扑排序：while(queue) 内 state.edges.forEach 找出边（O(V×E)）
function topoOriginal(nodeIds, edges) {
  const indeg = new Map()
  nodeIds.forEach(id => indeg.set(id, 0))
  edges.forEach(e => {
    if (nodeIds.includes(e.from) && nodeIds.includes(e.to)) {
      indeg.set(e.to, indeg.get(e.to) + 1)
    }
  })
  const queue = nodeIds.filter(id => indeg.get(id) === 0)
  const order = []
  const seen = new Set()
  while (queue.length) {
    const id = queue.shift()
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
    edges.forEach(e => {
      if (e.from === id) {
        indeg.set(e.to, indeg.get(e.to) - 1)
        if (indeg.get(e.to) === 0) queue.push(e.to)
      }
    })
  }
  return order
}

// 邻接表版拓扑排序：预建 outgoing，head 指针代替 shift（O(V+E)）
function topoAdj(nodeIds, edges) {
  const indeg = new Map()
  const outgoing = new Map()
  nodeIds.forEach(id => {
    indeg.set(id, 0)
    outgoing.set(id, [])
  })
  edges.forEach(e => {
    if (nodeIds.includes(e.from) && nodeIds.includes(e.to)) {
      indeg.set(e.to, indeg.get(e.to) + 1)
      outgoing.get(e.from).push(e)
    }
  })
  const queue = nodeIds.filter(id => indeg.get(id) === 0)
  const order = []
  const seen = new Set()
  let qHead = 0
  while (qHead < queue.length) {
    const id = queue[qHead++]
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
    const outs = outgoing.get(id)
    for (let i = 0; i < outs.length; i++) {
      const e = outs[i]
      const d = indeg.get(e.to) - 1
      indeg.set(e.to, d)
      if (d === 0) queue.push(e.to)
    }
  }
  return order
}

// 原始版求值输入查找：遍历所有边（O(E) per port）
function inputsOriginal(id, port, edges, results) {
  let val = undefined
  for (const e of edges) {
    if (e.to === id && e.toPort === port) {
      const r = results.get(e.from)
      if (r) val = r[e.fromPort]
    }
  }
  return val
}

// 邻接表版求值输入查找：只遍历 incoming[id]（O(deg) per port）
function inputsAdj(id, port, incoming, results) {
  let val = undefined
  const ins = incoming.get(id) || []
  for (let i = 0; i < ins.length; i++) {
    const e = ins[i]
    if (e.toPort === port) {
      const r = results.get(e.from)
      if (r) val = r[e.fromPort]
    }
  }
  return val
}

// 生成随机 DAG：节点 0..n-1，边只从小编号指向大编号（保证无环）
function randomDag(n, edgeProb, seed) {
  let s = seed
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  const nodes = []
  for (let i = 0; i < n; i++) nodes.push('N' + i)
  const edges = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (rnd() < edgeProb) {
        edges.push({
          from: 'N' + i,
          to: 'N' + j,
          fromPort: 'out',
          toPort: 'in'
        })
      }
    }
  }
  return { nodes, edges }
}

test('拓扑排序：空图两版一致', () => {
  assert.deepEqual(topoOriginal([], []), topoAdj([], []))
})

test('拓扑排序：单节点一致', () => {
  assert.deepEqual(topoOriginal(['A'], []), topoAdj(['A'], []))
})

test('拓扑排序：线性链一致', () => {
  const nodes = ['A', 'B', 'C', 'D']
  const edges = [
    { from: 'A', to: 'B' },
    { from: 'B', to: 'C' },
    { from: 'C', to: 'D' }
  ]
  assert.deepEqual(topoOriginal(nodes, edges), topoAdj(nodes, edges))
})

test('拓扑排序：菱形依赖一致', () => {
  const nodes = ['A', 'B', 'C', 'D']
  const edges = [
    { from: 'A', to: 'B' },
    { from: 'A', to: 'C' },
    { from: 'B', to: 'D' },
    { from: 'C', to: 'D' }
  ]
  assert.deepEqual(topoOriginal(nodes, edges), topoAdj(nodes, edges))
})

test('拓扑排序：含悬空边（指向不存在节点）一致', () => {
  const nodes = ['A', 'B']
  const edges = [
    { from: 'A', to: 'B' },
    { from: 'A', to: 'GHOST' },
    { from: 'GHOST', to: 'B' }
  ]
  assert.deepEqual(topoOriginal(nodes, edges), topoAdj(nodes, edges))
})

test('拓扑排序：1000 次随机 DAG 两版 order 完全一致', () => {
  for (let t = 0; t < 1000; t++) {
    const n = 5 + (t % 30)
    const { nodes, edges } = randomDag(n, 0.3, t * 2654435761 + 1)
    const a = topoOriginal(nodes, edges)
    const b = topoAdj(nodes, edges)
    assert.deepEqual(a, b, `DAG #${t} (n=${n}, e=${edges.length}) 不一致`)
  }
})

test('拓扑排序：大规模 DAG（200 节点）两版一致', () => {
  const { nodes, edges } = randomDag(200, 0.05, 42)
  const a = topoOriginal(nodes, edges)
  const b = topoAdj(nodes, edges)
  assert.deepEqual(a, b)
  assert.equal(a.length, 200, '所有节点都应入序')
})

test('求值输入查找：随机图上两版结果一致', () => {
  for (let t = 0; t < 500; t++) {
    const n = 4 + (t % 20)
    const { nodes, edges } = randomDag(n, 0.4, t * 40503 + 7)
    // 模拟求值结果：每个节点输出 { out: id }
    const results = new Map()
    nodes.forEach(id => results.set(id, { out: id }))
    // 预建 incoming 邻接表
    const incoming = new Map()
    nodes.forEach(id => incoming.set(id, []))
    edges.forEach(e => {
      if (nodes.includes(e.to)) incoming.get(e.to).push(e)
    })
    // 对每个节点的 'in' 端口对比
    for (const id of nodes) {
      const a = inputsOriginal(id, 'in', edges, results)
      const b = inputsAdj(id, 'in', incoming, results)
      assert.equal(a, b, `图 #${t} 节点 ${id} 输入查找不一致`)
    }
  }
})

test('求值输入查找：多条边连入同一端口，后者覆盖前者，两版一致', () => {
  const nodes = ['A', 'B', 'C']
  const edges = [
    { from: 'A', to: 'C', fromPort: 'out', toPort: 'in' },
    { from: 'B', to: 'C', fromPort: 'out', toPort: 'in' }
  ]
  const results = new Map([
    ['A', { out: 'VA' }],
    ['B', { out: 'VB' }]
  ])
  const incoming = new Map([
    ['A', []],
    ['B', []],
    ['C', [edges[0], edges[1]]]
  ])
  const a = inputsOriginal('C', 'in', edges, results)
  const b = inputsAdj('C', 'in', incoming, results)
  assert.equal(a, b)
  assert.equal(a, 'VB', '后者覆盖前者')
})

test('性能：邻接表版在大图上不慢于原始版（sanity）', () => {
  const { nodes, edges } = randomDag(500, 0.02, 99)
  const t0 = process.hrtime.bigint()
  topoOriginal(nodes, edges)
  const t1 = process.hrtime.bigint()
  topoAdj(nodes, edges)
  const t2 = process.hrtime.bigint()
  const origMs = Number(t1 - t0) / 1e6
  const adjMs = Number(t2 - t1) / 1e6
  // 邻接表版应明显快于原始版（O(V+E) vs O(V×E)）
  assert.ok(adjMs < origMs, `邻接表版(${adjMs}ms) 应快于原始版(${origMs}ms)`)
})

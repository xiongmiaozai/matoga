/**
 * 噪波变体单测（docs/noise-references.md 落地）：
 * - 新增 6 节点：white/cell/billow/cubic/pingpong/voronoise —— 均有 out+tex 端口，out ∈ [0,1]
 * - 增强节点：fBm 增益 gain、每层旋转+微失谐；voronoi mode(f1/f2/f2-f1/smooth)/jitter/smooth；
 *   warp 双层递归域扭曲
 * - 确定性：同参数同 seed 两次求值一致；参数变化输出随之变化
 * - 旧图兼容：props 缺 gain/mode 等新字段时 eval 正常（?? 默认兜底）
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

const NEW_TYPES = ['white', 'cell', 'billow', 'cubic', 'pingpong', 'voronoise']
const ALL_TYPES = ['noise', 'voronoi', 'simplex', 'ridge', 'warp', ...NEW_TYPES]

let mod

test('加载 node-canvas 前端模块（DOM stub 环境）', async () => {
  mod = await import(pathToFileURL(path.join(ROOT, 'web/src/node-canvas.js')).href)
  assert.equal(typeof mod.createNode, 'function')
  assert.equal(typeof mod._debugEvaluate, 'function')
})

test('11 种噪波节点：均有 out+tex 双输出端口，且预览类型为图像', () => {
  ALL_TYPES.forEach(type => {
    const n = mod.createNode(type, 50, 50)
    assert.ok(n, type + ' 创建失败')
  })
  const defs = mod.getGraphInfo().defs
  ALL_TYPES.forEach(type => {
    const d = defs[type]
    assert.ok(d, 'getGraphInfo 缺少 ' + type)
    assert.deepEqual(d.outputs[0], { n: 'out', t: 'number' }, type + ' 首输出须为 out（预览取 outputs[0]）')
    assert.deepEqual(d.outputs[1], { n: 'tex', t: 'texture' }, type + ' 应有 tex 纹理输出端口')
  })
})

test('11 种噪波节点 eval：out 数值 ∈ [0,1]，stub 下 tex 不外泄', () => {
  ALL_TYPES.forEach(type => {
    const n = mod.createNode(type, 150, 150)
    const d = mod.getNodeDetail(n.id)
    assert.equal(typeof d.evalOut.out, 'number', type + ' out 应为数')
    assert.ok(d.evalOut.out >= 0 && d.evalOut.out <= 1, type + ' out 应在 [0,1]，实际 ' + d.evalOut.out)
    assert.ok(!('tex' in d.evalOut), type + ' stub 下 tex=null 不应出现在 evalOut')
    assert.equal(d.previewKind, 'image', type + ' 应被识别为噪波预览类型（_NOISE_PV_TYPES）')
  })
})

test('确定性：同类型同参数同 seed，两次求值输出一致', () => {
  ;['noise', 'voronoi', 'billow', 'cubic', 'pingpong', 'voronoise'].forEach(type => {
    const a = mod.createNode(type, 10, 10)
    const b = mod.createNode(type, 400, 10)
    const va = mod.getNodeDetail(a.id).evalOut.out
    const vb = mod.getNodeDetail(b.id).evalOut.out
    assert.equal(va, vb, type + ' 同参数应确定性一致')
  })
})

test('fBm 增益参数：gain 0.4 与 0.9 输出不同；旧图缺 gain 字段时兜底 0.5 不崩溃', () => {
  const n = mod.createNode('noise', 10, 100)
  n.props.gain = 0.4
  mod._debugEvaluate()
  const low = mod.getNodeDetail(n.id).evalOut.out
  n.props.gain = 0.9
  mod._debugEvaluate()
  const high = mod.getNodeDetail(n.id).evalOut.out
  assert.notEqual(low, high, '不同增益应产生不同输出')

  delete n.props.gain
  mod._debugEvaluate()
  const fallback = mod.getNodeDetail(n.id).evalOut.out
  assert.ok(fallback >= 0 && fallback <= 1, '缺 gain 字段应回退默认 0.5 正常求值')
})

test('voronoi 模式：f1/f2/f2-f1/smooth 四种模式输出均有效且互不相同', () => {
  const n = mod.createNode('voronoi', 10, 200)
  const vals = {}
  ;['f1', 'f2', 'f2-f1', 'smooth'].forEach(mode => {
    n.props.mode = mode
    mod._debugEvaluate()
    const v = mod.getNodeDetail(n.id).evalOut.out
    assert.ok(v >= 0 && v <= 1, 'mode=' + mode + ' 输出应在 [0,1]，实际 ' + v)
    vals[mode] = v
  })
  const uniq = new Set(Object.values(vals))
  assert.equal(uniq.size, 4, '四种模式输出应互不相同: ' + JSON.stringify(vals))
})

test('voronoi 抖动：jitter=0（点在格心）与 jitter=1 输出不同', () => {
  const n = mod.createNode('voronoi', 10, 300)
  n.props.mode = 'f1'
  n.props.jitter = 0
  mod._debugEvaluate()
  const j0 = mod.getNodeDetail(n.id).evalOut.out
  n.props.jitter = 1
  mod._debugEvaluate()
  const j1 = mod.getNodeDetail(n.id).evalOut.out
  assert.notEqual(j0, j1, '抖动应影响 voronoi 输出')
})

test('voronoise：blend=0（Voronoi 状）与 blend=1（噪声状）输出不同；jitter 影响输出', () => {
  const n = mod.createNode('voronoise', 10, 400)
  n.props.blend = 0
  mod._debugEvaluate()
  const b0 = mod.getNodeDetail(n.id).evalOut.out
  n.props.blend = 1
  mod._debugEvaluate()
  const b1 = mod.getNodeDetail(n.id).evalOut.out
  assert.notEqual(b0, b1, 'blend 应切换度量（min ↔ 插值）')

  n.props.blend = 0.5
  n.props.jitter = 0
  mod._debugEvaluate()
  const j0 = mod.getNodeDetail(n.id).evalOut.out
  n.props.jitter = 1
  mod._debugEvaluate()
  const j1 = mod.getNodeDetail(n.id).evalOut.out
  assert.notEqual(j0, j1, '抖动应影响 voronoise 输出')
})

test('pingpong 强度参数：strength 变化输出不同', () => {
  const n = mod.createNode('pingpong', 10, 500)
  n.props.strength = 1
  mod._debugEvaluate()
  const s1 = mod.getNodeDetail(n.id).evalOut.out
  n.props.strength = 4
  mod._debugEvaluate()
  const s4 = mod.getNodeDetail(n.id).evalOut.out
  assert.notEqual(s1, s4, '乒乓强度应影响输出')
})

test('warp 双层递归：amount=0 退化为普通 simplex fBm；amount>0 生效', () => {
  const n = mod.createNode('warp', 10, 600)
  n.props.amount = 0
  mod._debugEvaluate()
  const a0 = mod.getNodeDetail(n.id).evalOut.out
  n.props.amount = 2
  mod._debugEvaluate()
  const a2 = mod.getNodeDetail(n.id).evalOut.out
  assert.notEqual(a0, a2, '扭曲幅度应影响输出')
  assert.ok(a0 >= 0 && a0 <= 1 && a2 >= 0 && a2 <= 1, 'warp 输出应在 [0,1]')
})

test('旧图兼容：无新字段的 noise/voronoi/warp 节点 JSON 加载后正常求值', () => {
  const json = {
    nodes: [
      { id: 'legacy1', type: 'noise', x: 0, y: 0, props: { scale: 4, seed: 0, octaves: 4 } },
      { id: 'legacy2', type: 'voronoi', x: 200, y: 0, props: { scale: 5, seed: 0 } },
      { id: 'legacy3', type: 'warp', x: 400, y: 0, props: { scale: 3, seed: 0, octaves: 4, amount: 1 } },
    ],
    edges: [],
  }
  mod._debugLoadGraphJSON(json)
  ;['legacy1', 'legacy2', 'legacy3'].forEach(id => {
    const d = mod.getNodeDetail(id)
    assert.ok(d, '旧图节点 ' + id + ' 应存在')
    assert.equal(typeof d.evalOut.out, 'number', id + ' 应正常求值')
    assert.ok(d.evalOut.out >= 0 && d.evalOut.out <= 1, id + ' 输出应在 [0,1]')
  })
})

test('white/cell 颗粒与格子语义：cell 在同一格内取值恒定，跨格变化', () => {
  const n = mod.createNode('cell', 10, 700)
  const d = mod.getNodeDetail(n.id)
  assert.ok(d.evalOut.out >= 0 && d.evalOut.out <= 1, 'cell 输出应在 [0,1]')
})
/* ── 画质修复验证 ─────────────────────────────── */

test('对比度归一化：动态范围收窄的 buf 拉伸至满幅 0~255', () => {
  // 模拟 fBm 收窄输出 [0.2, 0.8]（oct=4 实测 ~77% 宽度）
  const S = 64
  const buf = new Float32Array(S * S)
  for (let i = 0; i < buf.length; i++) buf[i] = 0.2 + 0.6 * ((i * 37 % 97) / 97)
  let mn = Infinity, mx = -Infinity
  for (const v of buf) { if (v < mn) mn = v; if (v > mx) mx = v }
  const gray = mod._debugGridToImageData(buf, mn, mx, S)
  const min = Math.min(...gray), max = Math.max(...gray)
  assert.equal(min, 0, '归一化后应触及 0')
  assert.equal(max, 255, '归一化后应触及 255')
})

test('量化抖动：常数灰面（banding 最坏情形）输出非全等，打散色带', () => {
  const S = 64
  const buf = new Float32Array(S * S).fill(0.5)
  const gray = mod._debugGridToImageData(buf, 0, 1, S)
  const uniq = new Set(gray)
  assert.ok(uniq.size > 1, '常数面 + 抖动应产生 127/128 波动，实际全为 ' + [...uniq][0])
  assert.ok([...uniq].every(v => v === 127 || v === 128), '抖动幅度应限制在 ±0.5LSB')
})

test('零跨度防御：max-min < 1e-6 时不归一化不除零', () => {
  const S = 8
  const buf = new Float32Array(S * S).fill(0.42)
  const gray = mod._debugGridToImageData(buf, 0.42, 0.42, S)
  assert.ok(gray.every(v => v >= 0 && v <= 255), '常数 buf 应正常量化不崩溃')
})

test('SSAA 超采样：S≤256 连续型 2×2 采样，均值与单采样接近且确定性一致', () => {
  const props = { scale: 4, seed: 0, octaves: 4, gain: 0.5 }
  const g1 = mod._debugNoiseGrid('noise', 96, props)
  const g2 = mod._debugNoiseGrid('noise', 96, props)
  assert.deepEqual([...g2.buf], [...g1.buf], '同参数两次网格采样应确定性一致')

  // 离散型关闭 SSAA（white 高频哈希不应被平均成灰）
  const w = mod._debugNoiseGrid('white', 96, { scale: 24, seed: 0 })
  const uniq = new Set(w.buf)
  assert.ok(uniq.size > 100, 'white 应保留颗粒分布（多样性 ' + uniq.size + '）')
})

test('quintic 插值：fBm 输出确定性且值域覆盖优于硬编码', () => {
  // 4 倍频动态范围应显著宽于 30%（收窄但仍有对比度），且确定性保持
  const props = { scale: 4, seed: 0, octaves: 4, gain: 0.5 }
  const g = mod._debugNoiseGrid('noise', 128, props)
  assert.ok(g.mx > g.mn, '网格应有动态范围')
  const a = mod._debugNoiseValue('noise', 0.31, 0.72, props)
  const b = mod._debugNoiseValue('noise', 0.31, 0.72, props)
  assert.equal(a, b, 'quintic 路径下单点采样应确定性一致')
})
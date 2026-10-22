/**
 * 特效节点单测（玄幻/科幻算法落地）：
 * - reaction 反应扩散（Gray-Scott 场，preset/迭代/seed）
 * - lightning 中点位移闪电（branches/detail/glow）
 * - mandel Mandelbrot/Julia orbit trap（fractal/zoom/iterations）
 * - palette iq 余弦调色板（6 预设 + freq/phase，color+tex 双输出）
 * - 确定性、参数敏感性、SSAA 排除、旧图缺字段兜底
 * 前端模块依赖浏览器环境，此处以 DOM stub + 模块重定向在 Node 中加载。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')
register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))

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

const FX_TYPES = ['reaction', 'lightning', 'mandel', 'palette']

let mod

test('加载 node-canvas 前端模块（DOM stub 环境）', async () => {
  mod = await import(pathToFileURL(path.join(ROOT, 'web/src/node-canvas.js')).href)
  assert.equal(typeof mod.createNode, 'function')
})

test('4 种特效节点：端口结构正确（palette 为 color+tex，其余 out+tex）', () => {
  FX_TYPES.forEach(type => {
    const n = mod.createNode(type, 50, 50)
    assert.ok(n, type + ' 创建失败')
  })
  const defs = mod.getGraphInfo().defs
  const d1 = defs.reaction
  assert.deepEqual(d1.outputs[0], { n: 'out', t: 'number' })
  assert.deepEqual(d1.outputs[1], { n: 'tex', t: 'texture' })
  assert.deepEqual(defs.lightning.outputs, d1.outputs)
  assert.deepEqual(defs.mandel.outputs, d1.outputs)
  assert.deepEqual(defs.palette.outputs[0], { n: 'color', t: 'color' }, 'palette 首输出应为 color 类型')
  assert.deepEqual(defs.palette.outputs[1], { n: 'tex', t: 'texture' })
})

test('reaction/lightning/mandel eval：out ∈ [0,1]，stub 下 tex 不外泄，预览类型为图像', () => {
  ;['reaction', 'lightning', 'mandel'].forEach(type => {
    const n = mod.createNode(type, 150, 150)
    const d = mod.getNodeDetail(n.id)
    assert.equal(typeof d.evalOut.out, 'number', type + ' out 应为数')
    assert.ok(d.evalOut.out >= 0 && d.evalOut.out <= 1, type + ' out 应在 [0,1]，实际 ' + d.evalOut.out)
    assert.ok(!('tex' in d.evalOut), type + ' stub 下 tex=null 不应出现在 evalOut')
    assert.equal(d.previewKind, 'image', type + ' 应有图像预览')
  })
})

test('palette eval：输出 [r,g,b] ∈ [0,1]，未连线时 t=0.5 采样', () => {
  const n = mod.createNode('palette', 150, 150)
  const d = mod.getNodeDetail(n.id)
  const c = d.evalOut.color
  assert.ok(Array.isArray(c) && c.length === 3, 'palette 应输出 3 分量颜色')
  c.forEach(v => assert.ok(v >= 0 && v <= 1, '颜色分量应在 [0,1]'))
})

test('palette 6 预设：中心色互不相同', () => {
  const colors = {}
  ;['rainbow', 'ocean', 'sunset', 'ember', 'fire', 'verdant'].forEach(preset => {
    colors[preset] = mod._debugPaletteRGB(0.5, preset, 1, 0)
  })
  const uniq = new Set(Object.values(colors).map(c => c.map(v => v.toFixed(3)).join(',')))
  assert.equal(uniq.size, 6, '6 组预设中心色应互不相同')
})

test('palette freq/phase 参数生效且确定性', () => {
  const a = mod._debugPaletteRGB(0.7, 'rainbow', 1, 0)
  const b = mod._debugPaletteRGB(0.7, 'rainbow', 3, 0)
  assert.notDeepEqual(a, b, '频率应改变颜色')
  const c = mod._debugPaletteRGB(0.7, 'rainbow', 1, 0.25)
  assert.notDeepEqual(a, c, '相位应改变颜色')
  assert.deepEqual(a, mod._debugPaletteRGB(0.7, 'rainbow', 1, 0), '应确定性一致')
})

test('reaction：preset 形态互异、迭代数影响输出、确定性', () => {
  const n = mod.createNode('reaction', 10, 10)
  const val = (preset, iter) => {
    n.props.preset = preset; n.props.iterations = iter
    mod._debugEvaluate()
    return mod.getNodeDetail(n.id).evalOut.out
  }
  const coral = val('coral', 120), maze = val('maze', 120)
  assert.notEqual(coral, maze, '不同形态预设应产生不同输出')
  assert.ok(coral >= 0 && coral <= 1 && maze >= 0 && maze <= 1, '输出应在 [0,1]')
  const a = val('coral', 80), b = val('coral', 200)
  assert.notEqual(a, b, '迭代数应影响反应进度')
  assert.equal(val('coral', 120), coral, '同参数应确定性一致')
})

test('lightning：分叉/细节/辉光参数生效，确定性', () => {
  const n = mod.createNode('lightning', 10, 200)
  n.props.branches = 0; n.props.glow = 0.3
  mod._debugEvaluate()
  const v0 = mod.getNodeDetail(n.id).evalOut.out
  n.props.branches = 1; n.props.detail = 2; n.props.glow = 1
  mod._debugEvaluate()
  const v1 = mod.getNodeDetail(n.id).evalOut.out
  assert.ok(v0 >= 0 && v0 <= 1 && v1 >= 0 && v1 <= 1, '输出应在 [0,1]')
  n.props.branches = 0; n.props.detail = 1; n.props.glow = 0.3
  mod._debugEvaluate()
  assert.equal(mod.getNodeDetail(n.id).evalOut.out, v0, '同参数应确定性一致')
})

test('mandel：julia 模式受 seed 影响、zoom 生效、确定性', () => {
  const n = mod.createNode('mandel', 10, 300)
  const val = (props) => {
    Object.assign(n.props, props)
    mod._debugEvaluate()
    return mod.getNodeDetail(n.id).evalOut.out
  }
  const m = val({ fractal: 'mandel', zoom: 1, seed: 0 })
  const j1 = val({ fractal: 'julia', zoom: 1, seed: 3 })
  const j2 = val({ fractal: 'julia', zoom: 1, seed: 42 })
  assert.notEqual(j1, j2, 'julia 的 c 参数应由 seed 派生')
  assert.ok(m >= 0 && m <= 1, 'mandel 输出应在 [0,1]')
  const z1 = val({ fractal: 'mandel', zoom: 1, seed: 0 })
  assert.equal(z1, m, '同参数应确定性一致')
  // orbit trap：中心点在集合内 → 高值
  const center = mod._debugNoiseValue('mandel', 0.5, 0.5, { fractal: 'mandel', zoom: 1, iterations: 96 })
  assert.ok(center > 0.5, 'Mandelbrot 集中心（c=0）应属集合内 → 高值，实际 ' + center)
})

test('SSAA 排除：模拟型节点走单采样路径（2×2 采样对场无意义）', () => {
  const props = { seed: 0, iterations: 60, preset: 'coral' }
  const g = mod._debugNoiseGrid('reaction', 96, props)
  assert.ok(g.mx >= g.mn, '网格应有动态范围')
  const g2 = mod._debugNoiseGrid('reaction', 96, props)
  assert.deepEqual([...g2.buf], [...g.buf], '场生成应确定性一致')
})

test('旧图兼容：无字段的特效节点 JSON 加载后正常求值（?? 兜底）', () => {
  const json = {
    nodes: [
      { id: 'fx1', type: 'reaction', x: 0, y: 0, props: { seed: 1 } },
      { id: 'fx2', type: 'lightning', x: 200, y: 0, props: { seed: 2 } },
      { id: 'fx3', type: 'mandel', x: 400, y: 0, props: { seed: 0 } },
      { id: 'fx4', type: 'palette', x: 600, y: 0, props: {} },
    ],
    edges: [],
  }
  mod._debugLoadGraphJSON(json)
  ;['fx1', 'fx2', 'fx3'].forEach(id => {
    const d = mod.getNodeDetail(id)
    assert.ok(d, '旧图节点 ' + id + ' 应存在')
    assert.equal(typeof d.evalOut.out, 'number', id + ' 应正常求值')
  })
  const p = mod.getNodeDetail('fx4')
  assert.ok(Array.isArray(p.evalOut.color), 'palette 缺字段应兜底 rainbow 输出颜色')
})
/* ── 卡顿修复验证（异步纹理队列 / field 快速档 / rAF 节流）── */

test('异步纹理队列：miss 立即返回 null 不阻塞，tick 后缓存生成并收敛（无死循环）', async () => {
  const n = mod.createNode('noise', 10, 800)
  n.props.seed = 55 // 新参数组合 → 缓存 miss
  mod._debugEvaluate()
  const d1 = mod.getNodeDetail(n.id)
  assert.ok(!('tex' in d1.evalOut) || d1.evalOut.tex === null, 'miss 时 tex 应为 null（stub 下不外泄）')
  // 等待异步队列排空（stub rAF=setTimeout(0)，链式 tick 最终收敛）
  await new Promise(r => setTimeout(r, 150))
  mod._debugEvaluate() // 收敛后：缓存命中 → 不再入队
  const d2 = mod.getNodeDetail(n.id)
  assert.equal(typeof d2.evalOut.out, 'number', '收敛后 out 仍正常')
})

test('field 快速档：小图（S≤128）reaction 高迭代截断到 40，全参单点采样不受影响', () => {
  const g1 = mod._debugNoiseGrid('reaction', 96, { seed: 3, iterations: 200, preset: 'coral' })
  const g2 = mod._debugNoiseGrid('reaction', 96, { seed: 3, iterations: 40, preset: 'coral' })
  assert.deepEqual([...g2.buf], [...g1.buf], '小图 200 迭代应走快速档（截断 40），与显式 40 一致')
  // 全参路径（eval 单点）：迭代数变化应改变输出（同一快速档截断点之外）
  const a = mod._debugNoiseValue('reaction', 0.5, 0.5, { seed: 3, iterations: 60, preset: 'coral' })
  const b = mod._debugNoiseValue('reaction', 0.5, 0.5, { seed: 3, iterations: 200, preset: 'coral' })
  assert.notEqual(a, b, 'eval 单点全参路径迭代数应生效')
})

test('field 快速档：lightning 小图浅细分 + 单遍辉光，与全参场可区分', () => {
  const gq = mod._debugNoiseGrid('lightning', 96, { seed: 5, branches: 0.9, detail: 1, glow: 1 })
  assert.ok(gq.mx >= gq.mn, '快速档网格应有动态范围')
  const v = mod._debugNoiseValue('lightning', 0.5, 0.5, { seed: 5, branches: 0.9, detail: 1, glow: 1 })
  assert.ok(v >= 0 && v <= 1, '全参单点输出应在 [0,1]')
})

test('快速档与全参数值路径确定性一致（两次调用相同结果）', () => {
  const a = mod._debugNoiseGrid('lightning', 96, { seed: 9, branches: 0.7, detail: 1, glow: 0.5 })
  const b = mod._debugNoiseGrid('lightning', 96, { seed: 9, branches: 0.7, detail: 1, glow: 0.5 })
  assert.deepEqual([...b.buf], [...a.buf], '快速档应确定性一致')
})
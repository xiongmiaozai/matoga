/**
 * PS 混合模式节点单测（27 种图层混合算法）：
 * - 数值/颜色双类型输入
 * - opacity 混合强度（0→原图，1→完全混合）
 * - 数学公式正确性（multiply/screen/overlay/difference 等）
 * - 边界安全（b=0/b=1 无 NaN/Infinity）
 * - 成分组（hue/saturation/color/luminosity）HSB 转换
 * - darkerColor/lighterColor 按亮度整体选择
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

const BLEND_MODES = [
  'normal','dissolve','darken','multiply','colorBurn','linearBurn','darkerColor',
  'lighten','screen','colorDodge','linearDodge','lighterColor',
  'overlay','softLight','hardLight','vividLight','linearLight','pinLight','hardMix',
  'difference','exclusion','subtract','divide',
  'hue','saturation','blendColor','luminosity',
]

let mod

test('加载 node-canvas 前端模块（DOM stub 环境）', async () => {
  mod = await import(pathToFileURL(path.join(ROOT, 'web/src/node-canvas.js')).href)
  assert.equal(typeof mod._debugPsBlendApply, 'function')
})

test('27 种混合模式节点均可创建', () => {
  const types = [
    'blendNormal','blendDissolve','blendDarken','blendMultiply','blendColorBurn','blendLinearBurn','blendDarkerColor',
    'blendLighten','blendScreen','blendColorDodge','blendLinearDodge','blendLighterColor',
    'blendOverlay','blendSoftLight','blendHardLight','blendVividLight','blendLinearLight','blendPinLight','blendHardMix',
    'blendDifference','blendExclusion','blendSubtract','blendDivide',
    'blendHue','blendSaturation','blendColor','blendLuminosity',
  ]
  types.forEach(t => {
    const n = mod.createNode(t, 10, 10)
    assert.ok(n, t + ' 创建失败')
  })
})

test('opacity=0 返回原图 a（数值）', () => {
  BLEND_MODES.forEach(m => {
    const r = mod._debugPsBlendApply(m, 0.3, 0.7, 0)
    assert.ok(Math.abs(r - 0.3) < 1e-9, m + ' opacity=0 应返回 a=0.3，实际 ' + r)
  })
})

test('opacity=0 返回原图 a（颜色）', () => {
  BLEND_MODES.forEach(m => {
    const r = mod._debugPsBlendApply(m, [0.2,0.4,0.6], [0.8,0.2,0.5], 0)
    assert.deepEqual(r, [0.2,0.4,0.6], m + ' opacity=0 应返回 a')
  })
})

test('multiply：a*b 公式正确', () => {
  assert.equal(mod._debugPsBlendApply('multiply', 0.5, 0.5, 1), 0.25)
  assert.equal(mod._debugPsBlendApply('multiply', 0.3, 0.6, 1), 0.18)
  const c = mod._debugPsBlendApply('multiply', [0.5,0.5,0.5], [0.4,0.6,0.8], 1)
  assert.deepEqual(c, [0.2,0.3,0.4])
})

test('screen：1-(1-a)(1-b) 公式正确', () => {
  assert.equal(mod._debugPsBlendApply('screen', 0.5, 0.5, 1), 0.75)
  assert.ok(Math.abs(mod._debugPsBlendApply('screen', 0.3, 0.6, 1) - 0.72) < 1e-9)
})

test('overlay：a<0.5 走乘法支路，a>=0.5 走滤色支路', () => {
  assert.ok(Math.abs(mod._debugPsBlendApply('overlay', 0.3, 0.6, 1) - 0.36) < 1e-9, 'a<0.5: 2ab')
  assert.ok(Math.abs(mod._debugPsBlendApply('overlay', 0.7, 0.6, 1) - 0.76) < 1e-9, 'a>=0.5: 1-2(1-a)(1-b)')
})

test('darken/lighten：min/max 正确', () => {
  assert.equal(mod._debugPsBlendApply('darken', 0.3, 0.6, 1), 0.3)
  assert.equal(mod._debugPsBlendApply('lighten', 0.3, 0.6, 1), 0.6)
})

test('difference：|a-b| 正确', () => {
  assert.equal(mod._debugPsBlendApply('difference', 0.3, 0.6, 1), 0.3)
  assert.equal(mod._debugPsBlendApply('difference', 0.6, 0.3, 1), 0.3)
})

test('exclusion：a+b-2ab 正确', () => {
  assert.ok(Math.abs(mod._debugPsBlendApply('exclusion', 0.3, 0.6, 1) - 0.54) < 1e-9)
})

test('subtract：max(0,a-b) 正确', () => {
  assert.equal(mod._debugPsBlendApply('subtract', 0.3, 0.6, 1), 0)
  assert.equal(mod._debugPsBlendApply('subtract', 0.6, 0.3, 1), 0.3)
})

test('divide：b=0 时返回 1（避免除零）', () => {
  assert.equal(mod._debugPsBlendApply('divide', 0.5, 0, 1), 1)
  assert.ok(Math.abs(mod._debugPsBlendApply('divide', 0.3, 0.6, 1) - 0.5) < 1e-9)
})

test('colorBurn/colorDodge 边界安全（b=0/b=1 无 NaN）', () => {
  const cases = [
    ['colorBurn', 0.5, 0], ['colorBurn', 0.5, 1],
    ['colorDodge', 0.5, 0], ['colorDodge', 0.5, 1],
    ['vividLight', 0.5, 0], ['vividLight', 0.5, 1],
  ]
  cases.forEach(([m,a,b]) => {
    const r = mod._debugPsBlendApply(m, a, b, 1)
    assert.ok(Number.isFinite(r), m + '(a=' + a + ',b=' + b + ') 应有限，实际 ' + r)
    assert.ok(r >= 0 && r <= 1, m + ' 应在 [0,1]')
  })
})

test('所有模式数值输出在 [0,1] 范围内', () => {
  const samples = [[0,0],[0,1],[1,0],[1,1],[0.25,0.75],[0.5,0.5],[0.9,0.1]]
  BLEND_MODES.forEach(m => {
    samples.forEach(([a,b]) => {
      const r = mod._debugPsBlendApply(m, a, b, 1)
      assert.ok(r >= -1e-9 && r <= 1 + 1e-9, m + '(' + a + ',' + b + ')=' + r + ' 超出 [0,1]')
    })
  })
})

test('颜色输出为 3 分量数组且在 [0,1]', () => {
  BLEND_MODES.forEach(m => {
    const r = mod._debugPsBlendApply(m, [0.2,0.5,0.8], [0.7,0.3,0.1], 1)
    assert.ok(Array.isArray(r) && r.length === 3, m + ' 颜色输出应为 3 分量数组')
    r.forEach(v => assert.ok(v >= -1e-9 && v <= 1 + 1e-9, m + ' 颜色分量 ' + v + ' 超出 [0,1]'))
  })
})

test('darkerColor/lighterColor：按亮度整体选择而非逐通道', () => {
  const a = [0.9, 0.1, 0.1], b = [0.2, 0.2, 0.2]
  const la = 0.299*0.9 + 0.587*0.1 + 0.114*0.1
  const lb = 0.299*0.2 + 0.587*0.2 + 0.114*0.2
  const dark = mod._debugPsBlendApply('darkerColor', a, b, 1)
  const light = mod._debugPsBlendApply('lighterColor', a, b, 1)
  if (la < lb) {
    assert.deepEqual(dark, a, 'darkerColor 应选亮度低的 a')
    assert.deepEqual(light, b, 'lighterColor 应选亮度高的 b')
  } else {
    assert.deepEqual(dark, b, 'darkerColor 应选亮度低的 b')
    assert.deepEqual(light, a, 'lighterColor 应选亮度高的 a')
  }
})

test('normal 模式：opacity=1 返回 b', () => {
  assert.equal(mod._debugPsBlendApply('normal', 0.3, 0.7, 1), 0.7)
  assert.deepEqual(mod._debugPsBlendApply('normal', [0.1,0.2,0.3], [0.4,0.5,0.6], 1), [0.4,0.5,0.6])
})

test('opacity 插值：out = lerp(a, blend(a,b), opacity)', () => {
  const blended = mod._debugPsBlendApply('multiply', 0.5, 0.5, 1)
  const half = mod._debugPsBlendApply('multiply', 0.5, 0.5, 0.5)
  assert.ok(Math.abs(half - (0.5 + (blended - 0.5) * 0.5)) < 1e-9, 'opacity=0.5 应为 a 与 blend 的中点')
})

test('成分组 hue：替换色相保留饱和度明度', () => {
  const a = [0.8, 0.2, 0.2]
  const b = [0.2, 0.2, 0.8]
  const r = mod._debugPsBlendApply('hue', a, b, 1)
  assert.ok(Array.isArray(r) && r.length === 3, 'hue 应输出颜色')
  r.forEach(v => assert.ok(v >= 0 && v <= 1, 'hue 分量应在 [0,1]'))
})

test('成分组 luminosity：替换明度保留色相饱和度', () => {
  const a = [0.8, 0.2, 0.2]
  const b = [0.2, 0.8, 0.2]
  const r = mod._debugPsBlendApply('luminosity', a, b, 1)
  assert.ok(Array.isArray(r) && r.length === 3, 'luminosity 应输出颜色')
  r.forEach(v => assert.ok(v >= 0 && v <= 1, 'luminosity 分量应在 [0,1]'))
})

test('成分组对数值输入退化为 normal（返回 b）', () => {
  ;['hue','saturation','blendColor','luminosity'].forEach(m => {
    const r = mod._debugPsBlendApply(m, 0.3, 0.7, 1)
    assert.ok(Math.abs(r - 0.7) < 1e-9, m + ' 对数值应退化为 normal 返回 b=0.7，实际 ' + r)
  })
})

test('hardMix：输出仅 0 或 1（实色混合）', () => {
  for (let i = 0; i < 20; i++) {
    const a = i / 20, b = (20 - i) / 20
    const r = mod._debugPsBlendApply('hardMix', a, b, 1)
    assert.ok(r === 0 || r === 1, 'hardMix 应输出 0 或 1，实际 ' + r)
  }
})

test('混合输入类型：a 为数值 b 为数组时按颜色处理', () => {
  const r = mod._debugPsBlendApply('multiply', 0.5, [0.4, 0.6, 0.8], 1)
  assert.ok(Array.isArray(r), '混合类型输入应返回数组')
  assert.deepEqual(r, [0.2, 0.3, 0.4])
})
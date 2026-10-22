/**
 * 节点库条目预览单测：
 * - 噪波/渐变/调色板 → pv-img 图像缩略图
 * - 颜色 → pv-color 色块；渐变 → pv-grad；数值 → pv-num 刻度条；向量 → pv-vec 坐标点
 * - PS 混合模式（27 种）→ pv-img 双渐变混合示例
 * - 其余类型回退 ic- 图标
 * - _BLEND_MODE_OF 映射完整；按 type 缓存命中
 * 前端模块依赖浏览器环境，以 DOM stub + 模块重定向在 Node 中加载。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')
process.env.NR_M3D_STUB = '1'
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
globalThis.window = { CSS: { escape: s => s }, addEventListener() {}, devicePixelRatio: 1 }
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0)

const NOISE_TYPES = ['noise','voronoi','simplex','ridge','warp','white','cell','billow','cubic','pingpong','voronoise','reaction','lightning','mandel','palette']
const BLEND_TYPES = ['blendNormal','blendDissolve','blendDarken','blendMultiply','blendColorBurn','blendLinearBurn','blendDarkerColor','blendLighten','blendScreen','blendColorDodge','blendLinearDodge','blendLighterColor','blendOverlay','blendSoftLight','blendHardLight','blendVividLight','blendLinearLight','blendPinLight','blendHardMix','blendDifference','blendExclusion','blendSubtract','blendDivide','blendHue','blendSaturation','blendColor','blendLuminosity']
const FALLBACK_TYPES = ['add','sub','mul','div','mix','clamp','texture','mainTex','sample','hdr','normalMap','rgbaMerge','rgbaSplit','rgbAlphaSplit','output','outputLeft','outputRight','preview']

let mod

test('加载 node-canvas 前端模块（DOM stub 环境）', async () => {
  mod = await import(pathToFileURL(path.join(ROOT, 'web/src/node-canvas.js')).href)
  assert.equal(typeof mod._debugLibPreviewHTML, 'function')
  assert.equal(typeof mod._debugGenLibPreview, 'function')
  assert.ok(mod._debugBlendModeOf && typeof mod._debugBlendModeOf === 'object')
})

test('_BLEND_MODE_OF 映射完整（27 种混合模式）', () => {
  assert.equal(Object.keys(mod._debugBlendModeOf).length, 27)
  BLEND_TYPES.forEach(t => {
    assert.ok(mod._debugBlendModeOf[t], '缺少混合模式映射：' + t)
  })
})

test('噪波/纹理类生成 pv-img 图像缩略图', () => {
  const def = { group: '纹理', color: 'var(--type-number)' }
  ;['noise','voronoi','palette','mandel','simplex','reaction'].forEach(t => {
    const html = mod._debugGenLibPreview(t, def)
    assert.ok(html.includes('pv pv-img'), t + ' 应返回 pv-img，实际：' + html.slice(0, 60))
  })
})

test('color 节点生成 pv-color 色块', () => {
  const html = mod._debugGenLibPreview('color', { group: '输入', color: 'var(--type-color)' })
  assert.ok(html.includes('pv pv-color'), 'color 应返回 pv-color，实际：' + html)
  assert.ok(html.includes('#7cbd56'), 'color 色块应含默认色 #7cbd56')
})

test('gradient 节点生成 pv-grad 渐变', () => {
  const html = mod._debugGenLibPreview('gradient', { group: '纹理', color: 'var(--type-color)' })
  assert.ok(html.includes('pv pv-grad'), 'gradient 应返回 pv-grad，实际：' + html)
  assert.ok(html.includes('linear-gradient'), 'gradient 应含 linear-gradient')
})

test('colorMix 节点生成 pv-grad 渐变', () => {
  const html = mod._debugGenLibPreview('colorMix', { group: '运算', color: 'var(--type-color)' })
  assert.ok(html.includes('pv pv-grad'), 'colorMix 应返回 pv-grad，实际：' + html)
})

test('number 节点生成 pv-num 刻度条', () => {
  const html = mod._debugGenLibPreview('number', { group: '输入', color: 'var(--type-number)' })
  assert.ok(html.includes('pv pv-num'), 'number 应返回 pv-num，实际：' + html)
  assert.ok(html.includes('mark'), 'pv-num 应含 mark 标记')
})

test('vector2 节点生成 pv-vec 坐标点', () => {
  const html = mod._debugGenLibPreview('vector2', { group: '输入', color: 'var(--type-vector)' })
  assert.ok(html.includes('pv pv-vec'), 'vector2 应返回 pv-vec，实际：' + html)
  assert.ok(html.includes('dot'), 'pv-vec 应含 dot')
})

test('27 种 PS 混合模式均生成 pv-img 示例图', () => {
  const def = { group: '混合', color: 'var(--type-color)' }
  BLEND_TYPES.forEach(t => {
    const html = mod._debugGenLibPreview(t, def)
    assert.ok(html.includes('pv pv-img'), t + ' 应返回 pv-img，实际：' + html.slice(0, 60))
  })
})

test('其余类型回退 ic- 图标', () => {
  const def = { group: '运算', color: 'var(--type-number)' }
  FALLBACK_TYPES.forEach(t => {
    const html = mod._debugGenLibPreview(t, def)
    assert.ok(html.includes('ic ic-'), t + ' 应回退 ic- 图标，实际：' + html.slice(0, 60))
  })
})

test('_libPreviewHTML 按 type 缓存命中（同引用）', () => {
  const def = { group: '纹理', color: 'var(--type-number)' }
  const a = mod._debugLibPreviewHTML('noise', def)
  const b = mod._debugLibPreviewHTML('noise', def)
  assert.equal(a, b, '同 type 两次调用应返回相同字符串（缓存）')
})

test('_libPreviewHTML 与 _genLibPreview 首次结果一致', () => {
  const def = { group: '输入', color: 'var(--type-color)' }
  const direct = mod._debugGenLibPreview('color', def)
  const cached = mod._debugLibPreviewHTML('color', def)
  assert.equal(direct, cached, 'color 预览应一致')
})
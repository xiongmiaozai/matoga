/**
 * normalGen 算法管线单测（_normalGenFromHeight）：
 * 纯函数，输入高度场 Float32Array，输出法线 RGBA，不依赖 canvas/Image。
 * 覆盖：平坦→中性法线、strength=0、水平渐变→R 偏移、四算子合法、smooth 平坦幂等、
 * 幂等性、未知 algo 回退 sobel。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')
let tex

test('加载 texture.js 纯模块', async () => {
  tex = await import(pathToFileURL(path.join(ROOT, 'web/src/node-canvas/texture.js')).href)
  assert.equal(typeof tex._normalGenFromHeight, 'function')
})

function flat(w, h, v = 0.5) {
  const a = new Float32Array(w * h)
  a.fill(v)
  return a
}

function px(d, i) {
  return [d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3]]
}

test('平坦高度图 → 法线全 (128,128,255)', () => {
  const r = tex._normalGenFromHeight(flat(3, 3), 3, 3, 'sobel', 1, 0)
  for (let i = 0; i < 9; i++) {
    assert.deepEqual(px(r.data, i), [128, 128, 255, 255])
  }
})

test('strength=0 → 法线全 (128,128,255)（梯度被乘 0）', () => {
  const height = new Float32Array([0, 0.5, 1, 0.2, 0.8, 0.4, 1, 0, 0.6])
  const r = tex._normalGenFromHeight(height, 3, 3, 'sobel', 0, 0)
  for (let i = 0; i < 9; i++) {
    assert.deepEqual(px(r.data, i), [128, 128, 255, 255])
  }
})

test('水平渐变 → 中间像素 R 偏离 128（有梯度响应）', () => {
  const height = new Float32Array([0, 0.5, 1])
  const r = tex._normalGenFromHeight(height, 3, 1, 'central', 1, 0)
  const [r0, g0, b0] = px(r.data, 0)
  assert.notEqual(r0, 128, 'R 应偏离 128')
  assert.ok(b0 > 200, 'B 应接近 255')
})

test('四种算子均产出合法输出（RGB∈[0,255], A=255）', () => {
  const height = new Float32Array([0, 0.3, 0.7, 1, 0.2, 0.5, 0.8, 0.1, 0.9])
  for (const algo of ['central', 'sobel', 'scharr', 'farid']) {
    const r = tex._normalGenFromHeight(height, 3, 3, algo, 2, 0)
    assert.equal(r.data.length, 36)
    for (let i = 0; i < 9; i++) {
      const [rr, gg, bb, aa] = px(r.data, i)
      assert.ok(0 <= rr && rr <= 255, `${algo} R 越界`)
      assert.ok(0 <= gg && gg <= 255, `${algo} G 越界`)
      assert.ok(0 <= bb && bb <= 255, `${algo} B 越界`)
      assert.equal(aa, 255, `${algo} A 应为 255`)
    }
  }
})

test('smooth>0 对平坦图无影响（仍中性法线）', () => {
  const r = tex._normalGenFromHeight(flat(5, 5, 0.5), 5, 5, 'sobel', 1, 2)
  for (let i = 0; i < 25; i++) {
    assert.deepEqual(px(r.data, i), [128, 128, 255, 255])
  }
})

test('幂等：相同输入两次调用结果完全一致', () => {
  const height = new Float32Array([0, 0.5, 1, 0.25, 0.75, 0.1, 0.9, 0.4, 0.6])
  const a = tex._normalGenFromHeight(height, 3, 3, 'scharr', 1.5, 1)
  const b = tex._normalGenFromHeight(height, 3, 3, 'scharr', 1.5, 1)
  assert.deepEqual(Array.from(a.data), Array.from(b.data))
})

test('未知 algo 回退 sobel', () => {
  const height = new Float32Array([0, 0.5, 1, 0.25, 0.75, 0.1, 0.9, 0.4, 0.6])
  const a = tex._normalGenFromHeight(height, 3, 3, 'unknown', 1, 0)
  const b = tex._normalGenFromHeight(height, 3, 3, 'sobel', 1, 0)
  assert.deepEqual(Array.from(a.data), Array.from(b.data))
})
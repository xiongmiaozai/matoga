/**
 * splitter-ratio 单元测试：分隔条比例计算纯函数。
 * - 水平排列（左右）取 width 占比
 * - 垂直排列（上下）取 height 占比
 * - 方向由两矩形质心差主轴判定，与 GL 类名解耦
 * - 零尺寸/负尺寸回退 50:50
 * - a + b === 100
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')
let computeSplitRatio

test('加载 splitter-ratio 模块', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'web/src/splitter-ratio.js')).href)
  computeSplitRatio = mod.computeSplitRatio
  assert.equal(typeof computeSplitRatio, 'function')
})

const rect = (left, top, width, height) => ({ left, top, width, height })

test('水平排列（左右面板）按 width 计算占比', () => {
  const r = computeSplitRatio(rect(0, 0, 300, 600), rect(310, 0, 700, 600))
  assert.equal(r.horizontal, true)
  assert.equal(r.a, 30)
  assert.equal(r.b, 70)
})

test('垂直排列（上下面板）按 height 计算占比', () => {
  const r = computeSplitRatio(rect(0, 0, 800, 200), rect(0, 210, 800, 600))
  assert.equal(r.horizontal, false)
  assert.equal(r.a, 25)
  assert.equal(r.b, 75)
})

test('a + b 恒等于 100', () => {
  for (const [p, n] of [
    [rect(0, 0, 123, 100), rect(130, 0, 456, 100)],
    [rect(0, 0, 1, 100), rect(10, 0, 999, 100)],
    [rect(0, 0, 800, 7), rect(0, 10, 800, 3)]
  ]) {
    const r = computeSplitRatio(p, n)
    assert.equal(r.a + r.b, 100, `a=${r.a} b=${r.b}`)
  }
})

test('零尺寸回退 50:50', () => {
  const r = computeSplitRatio(rect(0, 0, 0, 0), rect(0, 0, 0, 0))
  assert.equal(r.a, 50)
  assert.equal(r.b, 50)
})

test('负尺寸回退 50:50', () => {
  const r = computeSplitRatio(rect(0, 0, -10, 100), rect(0, 0, -20, 100))
  assert.equal(r.a, 50)
  assert.equal(r.b, 50)
})

test('等分时 50:50', () => {
  const r = computeSplitRatio(rect(0, 0, 400, 600), rect(410, 0, 400, 600))
  assert.equal(r.a, 50)
  assert.equal(r.b, 50)
})

test('质心判定方向：对角偏移取主轴', () => {
  // 左右排列但 y 也偏移，x 质心差更大 → horizontal
  const r = computeSplitRatio(rect(0, 0, 500, 100), rect(520, 50, 500, 100))
  assert.equal(r.horizontal, true)
  // 上下排列但 x 也偏移，y 质心差更大 → vertical
  const r2 = computeSplitRatio(rect(0, 0, 100, 500), rect(50, 520, 100, 500))
  assert.equal(r2.horizontal, false)
})

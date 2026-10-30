/**
 * 感知哈希纯函数单测（web/src/perceptual-hash.js）：
 * - computeAHash / computeDHash：相同图像哈希一致，不同图像哈希不同
 * - hammingDistance：相同=0，不同>0，长度不符校验
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const path = require('node:path')

const MOD_URL = pathToFileURL(path.resolve(__dirname, '../../web/src/perceptual-hash.js')).href

function makeRGBA(w, h, fn) {
  const buf = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, [r, g, b, a] = fn(x, y)
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a
  }
  return buf
}

test('computeAHash: 相同图像返回相同哈希', async () => {
  const { computeAHash } = await import(MOD_URL)
  const rgba = makeRGBA(16, 16, (x, y) => [x * 16, y * 16, 128, 255])
  const h1 = computeAHash(rgba, 16, 16)
  const h2 = computeAHash(rgba, 16, 16)
  assert.equal(h1, h2)
  assert.equal(h1.length, 16)
})

test('computeAHash: 不同图像返回不同哈希', async () => {
  const { computeAHash } = await import(MOD_URL)
  const rgba1 = makeRGBA(16, 16, (x) => [x * 16, 0, 0, 255])
  const rgba2 = makeRGBA(16, 16, (x) => [(15 - x) * 16, 0, 0, 255])
  assert.notEqual(computeAHash(rgba1, 16, 16), computeAHash(rgba2, 16, 16))
})

test('computeDHash: 相同图像返回相同哈希', async () => {
  const { computeDHash } = await import(MOD_URL)
  const rgba = makeRGBA(16, 16, (x, y) => [x * 16, y * 16, 128, 255])
  const h1 = computeDHash(rgba, 16, 16)
  const h2 = computeDHash(rgba, 16, 16)
  assert.equal(h1, h2)
  assert.equal(h1.length, 16)
})

test('computeDHash: 水平翻转图像哈希不同', async () => {
  const { computeDHash } = await import(MOD_URL)
  const rgba = makeRGBA(16, 16, (x, y) => [x * 16, y * 16, 128, 255])
  const flipped = makeRGBA(16, 16, (x, y) => [(15 - x) * 16, y * 16, 128, 255])
  assert.notEqual(computeDHash(rgba, 16, 16), computeDHash(flipped, 16, 16))
})

test('hammingDistance: 相同哈希距离为 0', async () => {
  const { hammingDistance } = await import(MOD_URL)
  const h = 'abcdef0123456789'
  assert.equal(hammingDistance(h, h), 0)
})

test('hammingDistance: 不同哈希距离 > 0', async () => {
  const { hammingDistance } = await import(MOD_URL)
  assert.ok(hammingDistance('0000000000000000', 'ffffffffffffffff') > 0)
})

test('hammingDistance: 长度不同返回 -1', async () => {
  const { hammingDistance } = await import(MOD_URL)
  assert.equal(hammingDistance('abc', 'abcd'), -1)
})

test('hammingDistance: 相似图像汉明距离小', async () => {
  const { computeDHash, hammingDistance } = await import(MOD_URL)
  const base = makeRGBA(16, 16, (x, y) => [x * 16, y * 16, 128, 255])
  const similar = makeRGBA(16, 16, (x, y) => [x * 16 + 1, y * 16, 128, 255])
  const different = makeRGBA(16, 16, () => [255, 255, 255, 255])
  const hBase = computeDHash(base, 16, 16)
  const hSimilar = computeDHash(similar, 16, 16)
  const hDiff = computeDHash(different, 16, 16)
  assert.ok(hammingDistance(hBase, hSimilar) <= hammingDistance(hBase, hDiff))
})

test('SIMILAR_THRESHOLD: 为合理正整数', async () => {
  const { SIMILAR_THRESHOLD } = await import(MOD_URL)
  assert.ok(SIMILAR_THRESHOLD > 0 && SIMILAR_THRESHOLD < 64)
})
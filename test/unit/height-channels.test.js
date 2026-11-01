/**
 * 高度图通道规整回归测试（Bug #1）：
 * 旧实现在 material3d.js 内联循环修改 data 后，putImageData 又重新 getImageData
 * 取回原始像素，导致 R→GBA 复制与 alpha=255 规整完全失效。
 * 现提取为纯函数 normalizeHeightChannels，直接操作并返回同一 imageData。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

test('normalizeHeightChannels: R 复制到 G/B，A 强制 255', async () => {
  const { normalizeHeightChannels } = await import('../../web/src/m3d/height-channels.js')
  const imageData = {
    data: new Uint8ClampedArray([
      10, 0, 0, 0,
      200, 30, 40, 128,
      255, 255, 255, 200,
    ]),
    width: 3,
    height: 1
  }
  const out = normalizeHeightChannels(imageData)
  assert.equal(out, imageData, '应返回同一 imageData 引用')
  const d = out.data
  assert.equal(d[0], 10); assert.equal(d[1], 10); assert.equal(d[2], 10); assert.equal(d[3], 255)
  assert.equal(d[4], 200); assert.equal(d[5], 200); assert.equal(d[6], 200); assert.equal(d[7], 255)
  assert.equal(d[8], 255); assert.equal(d[9], 255); assert.equal(d[10], 255); assert.equal(d[11], 255)
})

test('normalizeHeightChannels: 空数据不崩溃', async () => {
  const { normalizeHeightChannels } = await import('../../web/src/m3d/height-channels.js')
  const imageData = { data: new Uint8ClampedArray(0), width: 0, height: 0 }
  assert.equal(normalizeHeightChannels(imageData), imageData)
})

test('normalizeHeightChannels: 单像素 alpha=0 被规整为 255', async () => {
  const { normalizeHeightChannels } = await import('../../web/src/m3d/height-channels.js')
  const imageData = { data: new Uint8ClampedArray([128, 0, 0, 0]), width: 1, height: 1 }
  normalizeHeightChannels(imageData)
  assert.deepEqual(Array.from(imageData.data), [128, 128, 128, 255])
})
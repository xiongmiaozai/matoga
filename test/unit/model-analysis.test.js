/**
 * 模型多维度分析服务单测（server/services/model-analysis-service.js）：
 * - parseModelMeta：从模型 JSON/bbmodel 文本提取贴图引用数与动画标记
 * - texCountBucket：贴图数分桶（0 / 1 / 2-4 / 5+）
 * - nsOfPath / formatOfPath：路径 → 命名空间 / 格式
 */
const test = require('node:test')
const assert = require('node:assert/strict')

test('parseModelMeta: 解析贴图引用数（textures 对象去重计数）', async () => {
  const { parseModelMeta } = require('../../server/services/model-analysis-service')
  const json = JSON.stringify({
    textures: {
      all: 'block/oak_planks',
      particle: 'block/oak_planks',
      side: 'block/oak_log_side'
    },
    elements: [{ from: [0, 0, 0], to: [16, 16, 16] }]
  })
  const meta = parseModelMeta(json, 'json')
  assert.equal(meta.texRefs, 2)
  assert.equal(meta.animated, false)
})

test('parseModelMeta: bbmodel 动画标记（animations 数组非空）', async () => {
  const { parseModelMeta } = require('../../server/services/model-analysis-service')
  const bb = JSON.stringify({
    textures: { 0: 'block/stone' },
    animations: [{ name: 'idle', length: 1 }]
  })
  const meta = parseModelMeta(bb, 'bbmodel')
  assert.equal(meta.texRefs, 1)
  assert.equal(meta.animated, true)
})

test('parseModelMeta: 无 textures / 无 animation → 0 贴图、非动画', async () => {
  const { parseModelMeta } = require('../../server/services/model-analysis-service')
  const meta = parseModelMeta(JSON.stringify({ elements: [] }), 'json')
  assert.equal(meta.texRefs, 0)
  assert.equal(meta.animated, false)
})

test('parseModelMeta: 无效 JSON → 回退 0 贴图、非动画', async () => {
  const { parseModelMeta } = require('../../server/services/model-analysis-service')
  const meta = parseModelMeta('not json', 'json')
  assert.equal(meta.texRefs, 0)
  assert.equal(meta.animated, false)
})

test('texCountBucket: 贴图数分桶边界', async () => {
  const { texCountBucket } = require('../../server/services/model-analysis-service')
  assert.equal(texCountBucket(0), '0')
  assert.equal(texCountBucket(1), '1')
  assert.equal(texCountBucket(2), '2-4')
  assert.equal(texCountBucket(4), '2-4')
  assert.equal(texCountBucket(5), '5+')
  assert.equal(texCountBucket(100), '5+')
  assert.equal(texCountBucket(-1), '0')
})

test('nsOfPath: 从 assets/<ns>/ 路径提取命名空间', async () => {
  const { nsOfPath } = require('../../server/services/model-analysis-service')
  assert.equal(nsOfPath('assets/minecraft/models/block/stone.json'), 'minecraft')
  assert.equal(nsOfPath('assets/my_mod/items/sword.json'), 'my_mod')
  assert.equal(nsOfPath('other/path.json'), '')
})

test('formatOfPath: 按扩展名 / 前缀判定模型格式', async () => {
  const { formatOfPath } = require('../../server/services/model-analysis-service')
  assert.equal(formatOfPath('assets/minecraft/models/block/stone.json'), 'json')
  assert.equal(formatOfPath('model.bbmodel'), 'bbmodel')
  assert.equal(formatOfPath('bb:abc123'), 'bbmodel')
  assert.equal(formatOfPath('cm:custom1'), 'custom')
  assert.equal(formatOfPath(null), 'json')
})

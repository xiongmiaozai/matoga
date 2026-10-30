/**
 * 模型分组维度提取函数单测（web/src/utils.js）：
 * - modelNsOf / modelFormatOf：从 group.key 提取命名空间与格式
 * - modelTexBucketOf / modelAnimatedOf：从元数据映射读取贴图桶与动画标记
 * - modelCustomGroupOf：自定义正则规则匹配
 */
const test = require('node:test')
const assert = require('node:assert/strict')

test('modelNsOf: 从 group.key 提取命名空间', async () => {
  const { modelNsOf } = await import('../../web/src/model-group-dims.js')
  assert.equal(modelNsOf({ key: 'assets/minecraft/models/block/stone.json' }), 'minecraft')
  assert.equal(modelNsOf({ key: 'assets/mymod/items/sword.json' }), 'mymod')
  assert.equal(modelNsOf({ key: 'bb:abc' }), 'custom')
  assert.equal(modelNsOf({ key: 'cm:def' }), 'custom')
})

test('modelFormatOf: 按扩展名 / 前缀判定格式', async () => {
  const { modelFormatOf } = await import('../../web/src/model-group-dims.js')
  assert.equal(modelFormatOf({ key: 'assets/ns/models/block/stone.json' }), 'json')
  assert.equal(modelFormatOf({ key: 'model.bbmodel' }), 'bbmodel')
  assert.equal(modelFormatOf({ key: 'bb:id1' }), 'bbmodel')
  assert.equal(modelFormatOf({ key: 'cm:id2' }), 'custom')
})

test('modelTexBucketOf / modelAnimatedOf: 从元数据映射读取', async () => {
  const { modelTexBucketOf, modelAnimatedOf } = await import('../../web/src/model-group-dims.js')
  const meta = new Map([
    ['assets/ns/block/a.json', { texBucket: '1', animated: false }],
    ['assets/ns/block/b.json', { texBucket: '5+', animated: true }]
  ])
  assert.equal(modelTexBucketOf({ key: 'assets/ns/block/a.json' }, meta), '1')
  assert.equal(modelTexBucketOf({ key: 'assets/ns/block/b.json' }, meta), '5+')
  assert.equal(modelTexBucketOf({ key: 'assets/ns/block/c.json' }, meta), 'unknown')
  assert.equal(modelTexBucketOf({ key: 'x' }, null), 'unknown')
  assert.equal(modelAnimatedOf({ key: 'assets/ns/block/b.json' }, meta), true)
  assert.equal(modelAnimatedOf({ key: 'assets/ns/block/a.json' }, meta), false)
  assert.equal(modelAnimatedOf({ key: 'x' }, null), false)
})

test('modelCustomGroupOf: 正则规则匹配（首条命中返回规则名）', async () => {
  const { modelCustomGroupOf } = await import('../../web/src/model-group-dims.js')
  const rules = [
    { name: '木质方块', pattern: 'models/block/oak' },
    { name: '石质方块', pattern: 'models/block/stone' }
  ]
  assert.equal(modelCustomGroupOf({ key: 'assets/ns/models/block/oak_planks.json' }, rules), '木质方块')
  assert.equal(modelCustomGroupOf({ key: 'assets/ns/models/block/stone.json' }, rules), '石质方块')
  assert.equal(modelCustomGroupOf({ key: 'assets/ns/models/item/sword.json' }, rules), null)
  assert.equal(modelCustomGroupOf({ key: 'x' }, []), null)
  assert.equal(modelCustomGroupOf({ key: 'x' }, null), null)
})

test('modelCustomGroupOf: 无效正则跳过不报错', async () => {
  const { modelCustomGroupOf } = await import('../../web/src/model-group-dims.js')
  const rules = [{ name: 'bad', pattern: '[' }]
  assert.equal(modelCustomGroupOf({ key: 'anything' }, rules), null)
})
test('modelNameBucketOf: 按模型名首字母分桶 A-Z / #', async () => {
  const { modelNameBucketOf } = await import('../../web/src/model-group-dims.js')
  assert.equal(modelNameBucketOf({ key: 'assets/ns/models/block/oak_planks.json' }), 'O')
  assert.equal(modelNameBucketOf({ key: 'assets/ns/models/block/Stone.json' }), 'S')
  assert.equal(modelNameBucketOf({ key: 'assets/ns/items/铁剑.json' }), '#')
  assert.equal(modelNameBucketOf({ key: 'model.bbmodel' }), 'M')
  assert.equal(modelNameBucketOf({ key: '' }), '#')
})
test('modelPrefixBucketOf: 按名称前缀分桶（rail_flat/rail_corner → rail）', async () => {
  const { modelPrefixBucketOf } = await import('../../web/src/model-group-dims.js')
  assert.equal(modelPrefixBucketOf({ key: 'assets/ns/models/block/rail_flat.json' }), 'rail')
  assert.equal(modelPrefixBucketOf({ key: 'assets/ns/models/block/rail_corner_ne.json' }), 'rail')
  assert.equal(modelPrefixBucketOf({ key: 'assets/ns/models/block/rail_raised_ne.json' }), 'rail')
  assert.equal(modelPrefixBucketOf({ key: 'assets/ns/models/block/oak_planks.json' }), 'oak')
  assert.equal(modelPrefixBucketOf({ key: 'assets/ns/models/block/stone.json' }), '#')
  assert.equal(modelPrefixBucketOf({ key: 'assets/ns/items/_door.json' }), '#')
  assert.equal(modelPrefixBucketOf({ key: '' }), '#')
})

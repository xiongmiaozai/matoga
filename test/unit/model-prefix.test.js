/**
 * 模型名称前缀分组单测（web/src/model-prefix.js，资产库模型分类分组核心）：
 * - modelPrefixOf：去 .json/.bbmodel 扩展名后按第一个 _/-/空格 切分，小写归一；
 *   无分隔符（如 stone）/ 以分隔符开头 / 空名 → null（归入未分组）
 * - splitGroupsByPrefix：多桶 → 前缀子组（key 追加 #前缀、label 追加 · 前缀，按前缀排序），
 *   未分组桶排最后；单桶（全同前缀 / 全未分组 / 空）→ 不拆分，保持原组 key/label
 * - 条目引用不复制（卡片渲染/拖拽仍指向原对象）
 */
const test = require('node:test')
const assert = require('node:assert/strict')

test('modelPrefixOf: 按第一个 _ / - / 空格 切分并小写归一', async () => {
  const { modelPrefixOf } = await import('../../web/src/model-prefix.js')
  assert.equal(modelPrefixOf('oak_planks.json'), 'oak')
  assert.equal(modelPrefixOf('oak_log.json'), 'oak')
  assert.equal(modelPrefixOf('Oak_Leaves.json'), 'oak')
  assert.equal(modelPrefixOf('red-stone.json'), 'red')
  assert.equal(modelPrefixOf('my fence'), 'my')
  assert.equal(modelPrefixOf('oak_fence'), 'oak')
  assert.equal(modelPrefixOf('rail_flat_corner.json.bbmodel'), 'rail')
  assert.equal(modelPrefixOf('cube'), null)
  assert.equal(modelPrefixOf('stone.json'), null)
  assert.equal(modelPrefixOf('_door.json'), null)
  assert.equal(modelPrefixOf('  '), null)
  assert.equal(modelPrefixOf(''), null)
  assert.equal(modelPrefixOf(null), null)
})

test('splitGroupsByPrefix: 多前缀拆分，未分组排最后，前缀组按名称排序', async () => {
  const { splitGroupsByPrefix } = await import('../../web/src/model-prefix.js')
  const items = [
    { name: 'oak_planks.json' },
    { name: 'oak_log.json' },
    { name: 'birch_log.json' },
    { name: 'stone.json' },
    { name: 'acacia_planks.json' },
  ]
  const out = splitGroupsByPrefix('modelpack:mc:MyPack/block', 'MyPack · block', items, '未分组')
  assert.deepEqual(out.map(g => [g.key, g.label, g.items.length]), [
    ['modelpack:mc:MyPack/block#acacia', 'MyPack · block · acacia', 1],
    ['modelpack:mc:MyPack/block#birch', 'MyPack · block · birch', 1],
    ['modelpack:mc:MyPack/block#oak', 'MyPack · block · oak', 2],
    ['modelpack:mc:MyPack/block#', 'MyPack · block · 未分组', 1],
  ])
  /* 卡片条目为原对象引用（不复制） */
  assert.equal(out[2].items[0], items[0])
})

test('splitGroupsByPrefix: 全部同前缀 → 不拆分，保持原组', async () => {
  const { splitGroupsByPrefix } = await import('../../web/src/model-prefix.js')
  const items = [{ name: 'oak_planks.json' }, { name: 'oak_log.json' }]
  const out = splitGroupsByPrefix('g1', 'Group A', items, '未分组')
  assert.deepEqual(out, [{ key: 'g1', label: 'Group A', items }])
})

test('splitGroupsByPrefix: 全部未分组 / 空组 → 不拆分', async () => {
  const { splitGroupsByPrefix } = await import('../../web/src/model-prefix.js')
  const a = [{ name: 'stone.json' }, { name: 'cube.json' }]
  assert.deepEqual(splitGroupsByPrefix('g2', 'Group B', a, '未分组'), [{ key: 'g2', label: 'Group B', items: a }])
  assert.deepEqual(splitGroupsByPrefix('g3', 'Group C', [], '未分组'), [{ key: 'g3', label: 'Group C', items: [] }])
  assert.deepEqual(splitGroupsByPrefix('g4', 'Group D', null, '未分组'), [{ key: 'g4', label: 'Group D', items: [] }])
})

test('splitGroupsByPrefix: bb 模型（自由命名 / 含 id 兜底）与 MC 模型统一处理', async () => {
  const { splitGroupsByPrefix } = await import('../../web/src/model-prefix.js')
  const items = [
    { name: 'oak_fence' },
    { name: 'oak_fence-k2j3d9' },
    { name: '我的模型' },
  ]
  const out = splitGroupsByPrefix('bb', 'Blockbench 模型', items, '未分组')
  assert.deepEqual(out.map(g => [g.key, g.items.length]), [['bb#oak', 2], ['bb#', 1]])
  assert.equal(out[1].label, 'Blockbench 模型 · 未分组')
})
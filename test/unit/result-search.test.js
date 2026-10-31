/**
 * result-search 单测：对比结果搜索过滤（名称、中文、拼音、反向映射、缓存）
 */
const test = require('node:test')
const assert = require('node:assert/strict')

let mod
let zhMod
const _origFetch = globalThis.fetch

test('加载 result-search / zh-names ESM 模块', async () => {
  mod = await import('../../web/src/result-search.js')
  zhMod = await import('../../web/src/zh-names.js')
})

test('注入测试用中文/拼音映射', async () => {
  globalThis.fetch = async () => ({
    json: async () => ({
      ok: true,
      data: {
        byTexName: { stone: '石头', oak_door: '橡木门', crafting_table: '工作台' },
        byTexKey: { 'block/stone': '石头', 'item/oak_door': '橡木门', 'block/crafting_table': '工作台' },
        byTexPinyin: { stone: 'shitou', oak_door: 'xiangmumen', crafting_table: 'gongzuotai' },
        byZh: { 石头: 'stone', 橡木门: 'oak_door', 工作台: 'crafting_table' }
      }
    })
  })
  await zhMod.loadZhNames()
  globalThis.fetch = _origFetch
})

test('空搜索词恒命中（返回原数组）', () => {
  const arr = [{ key: 'stone' }, { key: 'oak_door' }]
  assert.deepEqual(mod.filterByResultSearch(arr, ''), arr)
  assert.deepEqual(mod.filterByResultSearch(arr, '   '), arr)
  assert.equal(mod.resultSearchMatch('stone', ''), true)
})

test('按 key 名称 includes 命中', () => {
  const arr = [{ key: 'stone' }, { key: 'oak_door' }, { key: 'iron_ingot' }]
  const r = mod.filterByResultSearch(arr, 'stone')
  assert.equal(r.length, 1)
  assert.equal(r[0].key, 'stone')
})

test('大小写归一', () => {
  const arr = [{ key: 'StoneBrick' }]
  assert.equal(mod.filterByResultSearch(arr, 'stonebrick').length, 1)
  assert.equal(mod.filterByResultSearch(arr, 'STONE').length, 1)
})

test('子序列模糊回退（token 长度≥2）', () => {
  const arr = [{ key: 'stone' }]
  assert.equal(mod.filterByResultSearch(arr, 'stn').length, 1)
})

test('空格多关键词每词都需命中', () => {
  const arr = [{ key: 'oak_door' }]
  assert.equal(mod.filterByResultSearch(arr, 'oak door').length, 1)
  assert.equal(mod.filterByResultSearch(arr, 'oak iron').length, 0)
})

test('中文译名命中', () => {
  const arr = [{ key: 'block/stone' }]
  assert.equal(mod.filterByResultSearch(arr, '石头').length, 1)
})

test('拼音命中英文资产', () => {
  const arr = [{ key: 'oak_door' }]
  assert.equal(mod.filterByResultSearch(arr, 'xiangmumen').length, 1)
})

test('反向映射：中文词命中对应英文 key', () => {
  const arr = [{ key: 'stone' }]
  assert.equal(mod.filterByResultSearch(arr, '石头').length, 1)
})

test('缓存命中：相同 key 第二次取缓存', () => {
  const cache = new Map()
  assert.equal(mod.resultSearchMatch('stone', 'stone', cache), true)
  assert.equal(cache.size, 1)
  assert.equal(mod.resultSearchMatch('stone', 'stone', cache), true)
  assert.equal(cache.size, 1)
})

test('缓存超 4096 自动清空', () => {
  const cache = new Map()
  for (let i = 0; i < 4097; i++) cache.set('k' + i, {})
  assert.equal(mod.resultSearchMatch('newkey', 'newkey', cache), true)
  assert.ok(cache.size <= 2, 'cache should be cleared and re-filled')
})

test('resultSearchFields 返回 name/zh/py 三字段', () => {
  const f = mod.resultSearchFields('block/stone')
  assert.equal(f.name, 'block/stone')
  assert.equal(f.zh, '石头')
  assert.ok(typeof f.py === 'string')
})

test('filterByResultSearch 不修改原数组', () => {
  const arr = [{ key: 'stone' }, { key: 'oak_door' }]
  const snapshot = arr.slice()
  mod.filterByResultSearch(arr, 'stone')
  assert.deepEqual(arr, snapshot)
})
test('变体名回退：搜中文命中所属方块贴图变体', () => {
  const arr = [
    { key: 'block/crafting_table_top' },
    { key: 'block/crafting_table_front' },
    { key: 'block/crafting_table_side' },
    { key: 'gui/crafting_table' }
  ]
  const r = mod.filterByResultSearch(arr, '工作台')
  assert.equal(r.length, 4, '变体名应通过 _ 分段回退命中所属方块中文名')
})

test('变体名回退：纯名 key 拼音命中', () => {
  const arr = [{ key: 'crafting_table_top' }]
  assert.equal(mod.filterByResultSearch(arr, 'gongzuotai').length, 1)
})

test('变体名回退不误伤无映射的贴图', () => {
  const arr = [{ key: 'block/unknown_thing_top' }]
  assert.equal(mod.filterByResultSearch(arr, '工作台').length, 0)
})
test('模型 key 带 .json 扩展名：搜中文命中', () => {
  const arr = [
    { key: 'block/crafting_table.json' },
    { key: 'models/block/crafting_table.json' }
  ]
  const r = mod.filterByResultSearch(arr, '工作台')
  assert.equal(r.length, 2, '模型 key 应去除 .json 后再查中文映射')
})

test('模型 key 带 .bbmodel/.glb 扩展名：搜中文命中', () => {
  const arr = [{ key: 'block/crafting_table.bbmodel' }, { key: 'block/crafting_table.glb' }]
  assert.equal(mod.filterByResultSearch(arr, '工作台').length, 2)
})

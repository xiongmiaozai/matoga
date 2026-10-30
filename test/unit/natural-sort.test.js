/**
 * 自然排序单测（web/src/natural-sort.js）：
 * - 数字段按数值比较：stone2 < stone10（localeCompare 会排成 stone10 < stone2）
 * - 文本段按 localeCompare('zh')
 * - 混合：数字与文本交界时数字排后
 * - 多段：oak_planks_01 < oak_planks_2 < oak_planks_10
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { pathToFileURL } = require('url')

let naturalCompare

test('加载 natural-sort 模块', async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '../../web/src/natural-sort.js')).href)
  naturalCompare = mod.naturalCompare
})

test('纯数字编号：stone2 < stone10', () => {
  assert.ok(naturalCompare('stone2', 'stone10') < 0)
  assert.ok(naturalCompare('stone10', 'stone2') > 0)
})

test('连续编号：item1 < item2 < item10', () => {
  const arr = ['item10', 'item2', 'item1', 'item20', 'item3']
  arr.sort(naturalCompare)
  assert.deepEqual(arr, ['item1', 'item2', 'item3', 'item10', 'item20'])
})

test('前缀+编号：oak_planks_01 < oak_planks_2 < oak_planks_10', () => {
  const arr = ['oak_planks_10', 'oak_planks_2', 'oak_planks_01']
  arr.sort(naturalCompare)
  assert.deepEqual(arr, ['oak_planks_01', 'oak_planks_2', 'oak_planks_10'])
})

test('纯文本：abc < abd < ac', () => {
  const arr = ['ac', 'abd', 'abc']
  arr.sort(naturalCompare)
  assert.deepEqual(arr, ['abc', 'abd', 'ac'])
})

test('相同字符串返回 0', () => {
  assert.equal(naturalCompare('stone', 'stone'), 0)
  assert.equal(naturalCompare('stone2', 'stone2'), 0)
})

test('前缀相同长度不同：stone < stone2', () => {
  assert.ok(naturalCompare('stone', 'stone2') < 0)
  assert.ok(naturalCompare('stone2', 'stone') > 0)
})

test('数字与文本交界：a2b < a10b', () => {
  assert.ok(naturalCompare('a2b', 'a10b') < 0)
})

test('空字符串', () => {
  assert.equal(naturalCompare('', ''), 0)
  assert.ok(naturalCompare('', 'a') < 0)
  assert.ok(naturalCompare('a', '') > 0)
})

test('MC 贴图典型场景', () => {
  const arr = [
    'stone10.png', 'stone2.png', 'stone1.png',
    'dirt.png', 'cobblestone10.png', 'cobblestone2.png'
  ]
  arr.sort(naturalCompare)
  assert.deepEqual(arr, [
    'cobblestone2.png', 'cobblestone10.png',
    'dirt.png',
    'stone1.png', 'stone2.png', 'stone10.png'
  ])
})
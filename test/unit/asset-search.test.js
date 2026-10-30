/**
 * asset-search 单测：子序列、多关键词、拼音、反向映射英文候选的匹配行为
 */
const test = require('node:test')
const assert = require('node:assert/strict')

let mod
test('加载 asset-search ESM 模块', async () => {
  mod = await import('../../web/src/asset-search.js')
})

test('subseq 子序列匹配', () => {
  assert.equal(mod.subseq('stone', 'stone'), true)
  assert.equal(mod.subseq('stone', 'stn'), true)
  assert.equal(mod.subseq('stone', 'sot'), false)
  assert.equal(mod.subseq('金合欢木门', '金合欢门'), true)
  assert.equal(mod.subseq('金合欢木门', '木金'), false)
  assert.equal(mod.subseq('abc', ''), true)
})

test('tokenMatches includes 优先命中', () => {
  assert.equal(mod.tokenMatches(['stone', '石头', 'shitou'], 'stone'), true)
  assert.equal(mod.tokenMatches(['stone', '石头', 'shitou'], '石头'), true)
  assert.equal(mod.tokenMatches(['stone', '石头', 'shitou'], 'shitou'), true)
})

test('tokenMatches 子序列回退（token 长度≥2）', () => {
  assert.equal(mod.tokenMatches(['金合欢木门'], '金合欢门'), true)
  assert.equal(mod.tokenMatches(['stone'], 'stn'), true)
})

test('tokenMatches 单字符不做子序列回退', () => {
  assert.equal(mod.tokenMatches(['stone'], 's'), true)
  assert.equal(mod.tokenMatches(['stone'], 'z'), false)
})

test('assetSearchMatch 空词恒命中', () => {
  assert.equal(mod.assetSearchMatch('stone', '石头', 'shitou', [], ''), true)
  assert.equal(mod.assetSearchMatch('stone', '石头', 'shitou', [], '   '), true)
})

test('assetSearchMatch 拼音命中英文资产', () => {
  assert.equal(mod.assetSearchMatch('stone', '石头', 'shitou', [], 'shitou'), true)
  assert.equal(mod.assetSearchMatch('acacia_door', '金合欢木门', 'jinhehuanmumen', [], 'jinhehuan'), true)
})

test('assetSearchMatch 中文子序列模糊命中', () => {
  assert.equal(mod.assetSearchMatch('acacia_door', '金合欢木门', 'jinhehuanmumen', [], '金合欢门'), true)
})

test('assetSearchMatch 反向映射英文候选命中', () => {
  assert.equal(mod.assetSearchMatch('stone', '', '', ['stone'], '石头'), false)
  assert.equal(mod.assetSearchMatch('iron_ingot', '', '', ['iron_ingot'], '铁锭'), false)
  assert.equal(mod.assetSearchMatch('stone', '', '', ['stone'], 'stone'), true)
})

test('assetSearchMatch 空格多关键词每词都需命中', () => {
  assert.equal(mod.assetSearchMatch('oak_door', '橡木门', 'xiangmumen', [], '橡木 门'), true)
  assert.equal(mod.assetSearchMatch('oak_door', '橡木门', 'xiangmumen', [], '橡木 铁'), false)
})

test('assetSearchMatch 大小写归一（term 侧归一，fields 由调用方小写）', () => {
  assert.equal(mod.assetSearchMatch('stone', '石头', 'shitou', [], 'STONE'), true)
  assert.equal(mod.assetSearchMatch('stone', '石头', 'shitou', [], 'ShItOu'), true)
})

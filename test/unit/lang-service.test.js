/**
 * lang-service 单测：
 * - buildMaps：从 zh_cn.json 构建 贴图名↔中文 映射（block/item/tile 旧版、.name 后缀、首次优先）
 * - getMaps：扫描包根目录下 assets/minecraft/lang/zh_cn.json，mc-packs 覆盖 official
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const langService = require('../../server/services/lang-service')

test('buildMaps 提取 block/item 译名并建立双向映射', () => {
  const maps = langService.buildMaps({
    'block.minecraft.stone': '石头',
    'item.minecraft.iron_ingot': '铁锭',
    'block.minecraft.grass_block': '草方块',
    'advancement.story.mineStone': '采石时代',
    'item.minecraft.iron_ingot.name': '铁锭（旧）'
  })
  assert.equal(maps.byTexName.stone, '石头')
  assert.equal(maps.byTexName.iron_ingot, '铁锭')
  assert.equal(maps.byTexKey['block/stone'], '石头')
  assert.equal(maps.byTexKey['item/iron_ingot'], '铁锭')
  assert.equal(maps.byZh['石头'], 'stone')
  assert.equal(maps.byZh['铁锭'], 'iron_ingot')
  assert.ok(!('mineStone' in maps.byTexName), '非 block/item 键应被忽略')
})

test('buildMaps tile 旧版前缀归一为 block', () => {
  const maps = langService.buildMaps({ 'tile.minecraft.oak_log.name': '橡木原木' })
  assert.equal(maps.byTexName.oak_log, '橡木原木')
  assert.equal(maps.byTexKey['block/oak_log'], '橡木原木')
})

test('buildMaps 首次出现的译名优先（不覆盖）', () => {
  const maps = langService.buildMaps({
    'block.minecraft.stone': '石头',
    'item.minecraft.stone': '石头块'
  })
  assert.equal(maps.byTexName.stone, '石头')
})

test('buildMaps 忽略空值与非字符串', () => {
  const maps = langService.buildMaps({
    'block.minecraft.air': '',
    'item.minecraft.foo': 123,
    'block.minecraft.bar': '栏杆'
  })
  assert.equal(maps.byTexName.bar, '栏杆')
  assert.ok(!('air' in maps.byTexName))
  assert.ok(!('foo' in maps.byTexName))
})

test('getMaps 扫描根目录并合并（mc 覆盖 official）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'matoga-lang-'))
  const officialRoot = path.join(tmp, 'official')
  const mcRoot = path.join(tmp, 'mc')
  const offDir = path.join(officialRoot, '26.3-Fabric', 'assets', 'minecraft', 'lang')
  const mcDir = path.join(mcRoot, 'mypack', 'assets', 'minecraft', 'lang')
  fs.mkdirSync(offDir, { recursive: true })
  fs.mkdirSync(mcDir, { recursive: true })
  fs.writeFileSync(
    path.join(offDir, 'zh_cn.json'),
    JSON.stringify({ 'block.minecraft.stone': '石头', 'item.minecraft.iron_ingot': '铁锭' })
  )
  fs.writeFileSync(path.join(mcDir, 'zh_cn.json'), JSON.stringify({ 'block.minecraft.stone': '石头（自定义）' }))
  langService.clearCache()
  try {
    const maps = await langService.getMaps([officialRoot, mcRoot])
    assert.equal(maps.byTexName.iron_ingot, '铁锭')
    assert.equal(maps.byTexName.stone, '石头（自定义）')
    assert.ok(maps.count > 0)
  } finally {
    langService.clearCache()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('getMaps 缓存：第二次调用返回同一引用', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'matoga-lang-cache-'))
  const dir = path.join(tmp, 'p', 'assets', 'minecraft', 'lang')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'zh_cn.json'), JSON.stringify({ 'block.minecraft.dirt': '泥土' }))
  langService.clearCache()
  try {
    const a = await langService.getMaps([tmp])
    const b = await langService.getMaps([tmp])
    assert.equal(a, b)
    assert.equal(a.byTexName.dirt, '泥土')
  } finally {
    langService.clearCache()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('getMaps 空根仍返回内置汉化表', async () => {
  langService.clearCache()
  const maps = await langService.getMaps([])
  assert.ok(maps.count > 0, '内置 zh_cn.json 应提供映射')
  assert.equal(maps.byTexName.stone, '石头')
  langService.clearCache()
})
test('buildMaps 生成无音调拼音映射（byTexPinyin）', () => {
  const maps = langService.buildMaps({
    'block.minecraft.stone': '石头',
    'block.minecraft.acacia_door': '金合欢木门'
  })
  assert.equal(maps.byTexPinyin.stone, 'shitou')
  assert.equal(maps.byTexPinyin.acacia_door, 'jinhehuanmumen')
})

test('buildMaps 拼音映射缺失依赖时降级为空对象', () => {
  const maps = langService.buildMaps({ 'block.minecraft.dirt': '泥土' })
  assert.ok(typeof maps.byTexPinyin === 'object')
  assert.ok('dirt' in maps.byTexPinyin || Object.keys(maps.byTexPinyin).length === 0)
})

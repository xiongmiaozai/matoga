/**
 * 模型对比纯函数单测（web/src/model-diff.js）：
 * - isModelEntry：包内模型 JSON 识别（assets/<ns>/models/**、1.21.4+ items/*.json；排除 blockstates/sounds/贴图/非 assets 根/子目录 items）
 * - prettyModelJson / parseModelText：压缩 JSON 规范化展开、非法 JSON 原文回退
 * - buildModelSummary：parent / elements / textures / 物品定义提取
 * - diffLines：行级 LCS 差异（same/del/add），操作序列可无损还原两侧；超限返回 null
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')

const MOD_URL = pathToFileURL(require('node:path').resolve(__dirname, '../../web/src/model-diff.js')).href

test('setup: 加载 model-diff 模块', async () => {
  const m = await import(MOD_URL)
  globalThis.__md = m
  assert.equal(typeof m.isModelEntry, 'function')
  assert.equal(typeof m.diffLines, 'function')
  assert.equal(typeof m.buildModelSummary, 'function')
  assert.equal(typeof m.parseModelText, 'function')
})

test('isModelEntry: models 与 items 路径识别', () => {
  const { isModelEntry } = globalThis.__md
  const e = (name) => ({ name, isDirectory: false, size: 10, mtime: 0 })
  assert.equal(isModelEntry(e('assets/minecraft/models/block/stone.json')), true)
  assert.equal(isModelEntry(e('assets/custom/models/item/handheld.json')), true)
  assert.equal(isModelEntry(e('assets/minecraft/models/block/deep/nested.json')), true)
  assert.equal(isModelEntry(e('assets/minecraft/items/diamond.json')), true)
  assert.equal(isModelEntry(e('assets/minecraft/items/diamond.JSON')), true)
  assert.equal(isModelEntry(e('models/block/stone.json')), true)
  assert.equal(isModelEntry(e('assets/minecraft/models/block/stone.bbmodel')), true)
})

test('isModelEntry: 非模型路径拒绝', () => {
  const { isModelEntry } = globalThis.__md
  const e = (name) => ({ name, isDirectory: false, size: 10, mtime: 0 })
  assert.equal(isModelEntry(e('assets/minecraft/blockstates/stone.json')), false)
  assert.equal(isModelEntry(e('assets/minecraft/sounds.json')), false)
  assert.equal(isModelEntry(e('assets/minecraft/textures/block/stone.png')), false)
  assert.equal(isModelEntry(e('assets/minecraft/textures/animated.json')), false)
  assert.equal(isModelEntry(e('pack.mcmeta')), false)
  assert.equal(isModelEntry(e('models/block/stone.json')), true)
  assert.equal(isModelEntry(e('assets/minecraft/items/sub/thing.json')), false)
  assert.equal(isModelEntry(e('assets/minecraft/models/block/stone.png')), false)
  assert.equal(isModelEntry(e('assets/minecraft/models/stone.json')), false)
  assert.equal(isModelEntry(e('assets/minecraft/models/.json')), false)
  assert.equal(isModelEntry(e('')), false)
})

test('isModelEntry: 目录与空值拒绝', () => {
  const { isModelEntry } = globalThis.__md
  assert.equal(isModelEntry({ name: 'assets/minecraft/models', isDirectory: true }), false)
  assert.equal(isModelEntry(null), false)
  assert.equal(isModelEntry(undefined), false)
  assert.equal(isModelEntry({ isDirectory: false }), false)
  assert.equal(isModelEntry({ name: 123, isDirectory: false }), false)
})

test('prettyModelJson: 压缩 JSON 展开为 2 空格缩进', () => {
  const { prettyModelJson } = globalThis.__md
  assert.equal(prettyModelJson('{"parent":"a","textures":{"all":"b"}}'), '{\n  "parent": "a",\n  "textures": {\n    "all": "b"\n  }\n}')
})

test('prettyModelJson: 非法 JSON 原文返回', () => {
  const { prettyModelJson } = globalThis.__md
  assert.equal(prettyModelJson('not json {'), 'not json {')
})

test('parseModelText: 合法/非法 JSON', () => {
  const { parseModelText } = globalThis.__md
  const ok = parseModelText('{"a":1}')
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.obj, { a: 1 })
  assert.equal(ok.pretty, '{\n  "a": 1\n}')
  const bad = parseModelText('{oops')
  assert.equal(bad.ok, false)
  assert.equal(bad.obj, null)
  assert.equal(bad.pretty, '{oops')
  assert.equal(parseModelText(undefined).ok, false)
})

test('buildModelSummary: 普通模型提取 parent/elements/textures', () => {
  const { buildModelSummary } = globalThis.__md
  const s = buildModelSummary({ parent: 'minecraft:block/cube_all', elements: [{}, {}, {}], textures: { all: '#side', side: 'block/x', top: 'block/y' } })
  assert.deepEqual(s, { itemDef: false, itemRef: null, parent: 'minecraft:block/cube_all', elements: 3, textures: 3 })
})

test('buildModelSummary: 1.21.4 物品定义与非对象', () => {
  const { buildModelSummary } = globalThis.__md
  const s = buildModelSummary({ model_reference: 'minecraft:block/diamond_ore' })
  assert.equal(s.itemDef, true)
  assert.equal(s.itemRef, 'minecraft:block/diamond_ore')
  assert.equal(buildModelSummary(null), null)
  assert.equal(buildModelSummary([1, 2]), null)
  assert.equal(buildModelSummary('x'), null)
  const bare = buildModelSummary({})
  assert.deepEqual(bare, { itemDef: false, itemRef: null, parent: null, elements: 0, textures: 0 })
})

test('diffLines: 相同输入全部 same', () => {
  const { diffLines } = globalThis.__md
  const ops = diffLines(['a', 'b'], ['a', 'b'])
  assert.deepEqual(ops, [{ type: 'same', text: 'a' }, { type: 'same', text: 'b' }])
})

test('diffLines: 纯删除 / 纯新增 / 空输入', () => {
  const { diffLines } = globalThis.__md
  assert.deepEqual(diffLines(['a', 'b'], ['a']), [{ type: 'same', text: 'a' }, { type: 'del', text: 'b' }])
  assert.deepEqual(diffLines(['a'], ['a', 'b']), [{ type: 'same', text: 'a' }, { type: 'add', text: 'b' }])
  assert.deepEqual(diffLines([], ['x']), [{ type: 'add', text: 'x' }])
  assert.deepEqual(diffLines(['x'], []), [{ type: 'del', text: 'x' }])
  assert.deepEqual(diffLines([], []), [])
})

test('diffLines: 修改行表达为相邻 del+add', () => {
  const { diffLines } = globalThis.__md
  const ops = diffLines(['{', '  "a": 1', '}'], ['{', '  "a": 2', '}'])
  assert.deepEqual(ops, [
    { type: 'same', text: '{' },
    { type: 'del', text: '  "a": 1' },
    { type: 'add', text: '  "a": 2' },
    { type: 'same', text: '}' },
  ])
})

test('diffLines: 操作序列可无损还原两侧（含乱序插入）', () => {
  const { diffLines } = globalThis.__md
  const a = ['{', '  "parent": "block/cube",', '  "textures": {', '    "all": "x"', '  }', '}']
  const b = ['{', '  "credit": "me",', '  "parent": "block/cube",', '  "textures": {', '    "all": "y",', '    "side": "z"', '  }', '}']
  const ops = diffLines(a, b)
  assert.deepEqual(ops.filter(o => o.type !== 'add').map(o => o.text), a)
  assert.deepEqual(ops.filter(o => o.type !== 'del').map(o => o.text), b)
})

test('diffLines: 超限输入返回 null（由上层退化为并排显示）', () => {
  const { diffLines } = globalThis.__md
  const big = Array.from({ length: 1200 }, (_, i) => 'line-' + i)
  assert.equal(diffLines(big, big.slice().reverse()), null)
  assert.notEqual(diffLines(big, big), null)
})
test('resolveTexPath: 带命名空间引用', () => {
  const { resolveTexPath } = globalThis.__md
  assert.equal(resolveTexPath('minecraft:block/stone'), 'assets/minecraft/textures/block/stone.png')
  assert.equal(resolveTexPath('custom:item/sword'), 'assets/custom/textures/item/sword.png')
})

test('resolveTexPath: 无命名空间默认 minecraft', () => {
  const { resolveTexPath } = globalThis.__md
  assert.equal(resolveTexPath('block/dirt'), 'assets/minecraft/textures/block/dirt.png')
})

test('resolveTexPath: 空值返回 null', () => {
  const { resolveTexPath } = globalThis.__md
  assert.equal(resolveTexPath(''), null)
  assert.equal(resolveTexPath(null), null)
  assert.equal(resolveTexPath(undefined), null)
})

test('extractTextureRefs: 提取 textures 引用', () => {
  const { extractTextureRefs } = globalThis.__md
  const obj = { textures: { all: 'minecraft:block/stone', side: 'block/dirt', particle: '#all' } }
  const refs = extractTextureRefs(obj)
  assert.deepEqual(refs, ['minecraft:block/stone', 'block/dirt'])
})

test('extractTextureRefs: 无 textures 返回空数组', () => {
  const { extractTextureRefs } = globalThis.__md
  assert.deepEqual(extractTextureRefs({}), [])
  assert.deepEqual(extractTextureRefs(null), [])
  assert.deepEqual(extractTextureRefs({ parent: 'block/cube' }), [])
})

test('checkTexRefs: 标记存在与缺失', () => {
  const { checkTexRefs } = globalThis.__md
  const obj = { textures: { all: 'minecraft:block/stone', side: 'minecraft:block/missing' } }
  const existing = new Set(['assets/minecraft/textures/block/stone.png'])
  const results = checkTexRefs(obj, existing)
  assert.equal(results.length, 2)
  assert.equal(results[0].ref, 'minecraft:block/stone')
  assert.equal(results[0].exists, true)
  assert.equal(results[1].ref, 'minecraft:block/missing')
  assert.equal(results[1].exists, false)
})

test('checkTexRefs: 支持数组传入 existingPaths', () => {
  const { checkTexRefs } = globalThis.__md
  const obj = { textures: { all: 'block/stone' } }
  const results = checkTexRefs(obj, ['assets/minecraft/textures/block/stone.png'])
  assert.equal(results[0].exists, true)
})
test('checkTexRefs: 原版贴图集合标记 vanilla（资源包未含但原版提供）', () => {
  const { checkTexRefs } = globalThis.__md
  const obj = { textures: { pot: 'block/flower_pot', dirt: 'block/dirt', miss: 'block/missing' } }
  const packPaths = new Set(['assets/minecraft/textures/block/dirt.png'])
  const vanillaPaths = new Set([
    'assets/minecraft/textures/block/flower_pot.png',
    'assets/minecraft/textures/block/dirt.png',
  ])
  const results = checkTexRefs(obj, packPaths, vanillaPaths)
  assert.equal(results.length, 3)
  assert.equal(results[0].ref, 'block/flower_pot')
  assert.equal(results[0].exists, false)
  assert.equal(results[0].vanilla, true)
  assert.equal(results[1].ref, 'block/dirt')
  assert.equal(results[1].exists, true)
  assert.equal(results[1].vanilla, false)
  assert.equal(results[2].ref, 'block/missing')
  assert.equal(results[2].exists, false)
  assert.equal(results[2].vanilla, false)
})

test('checkTexRefs: 无 vanillaPaths 时 vanilla 恒为 false（向后兼容）', () => {
  const { checkTexRefs } = globalThis.__md
  const obj = { textures: { a: 'block/stone' } }
  const results = checkTexRefs(obj, new Set())
  assert.equal(results[0].exists, false)
  assert.equal(results[0].vanilla, false)
})
test('checkTexRefs: 扩展名变体兜底（引用 .png 但包内实为 .jpg/.webp）', () => {
  const { checkTexRefs } = globalThis.__md
  const obj = { textures: { a: 'block/stone', b: 'block/dirt', c: 'block/missing' } }
  const packPaths = new Set([
    'assets/minecraft/textures/block/stone.jpg',
    'assets/minecraft/textures/block/dirt.webp',
  ])
  const results = checkTexRefs(obj, packPaths)
  assert.equal(results[0].ref, 'block/stone')
  assert.equal(results[0].exists, true, '引用 .png 但包内 .jpg 应命中变体兜底')
  assert.equal(results[1].ref, 'block/dirt')
  assert.equal(results[1].exists, true, '引用 .png 但包内 .webp 应命中变体兜底')
  assert.equal(results[2].exists, false, '无任何变体仍缺失')
})

test('checkTexRefs: vanilla 集合同样支持扩展名变体', () => {
  const { checkTexRefs } = globalThis.__md
  const obj = { textures: { a: 'block/flower_pot' } }
  const vanillaPaths = new Set(['assets/minecraft/textures/block/flower_pot.jpg'])
  const results = checkTexRefs(obj, new Set(), vanillaPaths)
  assert.equal(results[0].exists, false)
  assert.equal(results[0].vanilla, true, '原版集合 .jpg 变体应命中 vanilla')
})
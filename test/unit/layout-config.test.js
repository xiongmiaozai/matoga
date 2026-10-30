/**
 * layout-config（布局配置去重纯函数）单测：
 * 重复组件仅保留首个、空容器剪枝、无重复时结构不变、不可变性、对象形式 componentType。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const MOD_URL = pathToFileURL(path.resolve(__dirname, '../../web/src/layout-config.js')).href

function comp(componentType) { return { type: 'component', componentType, title: 't' } }
function row(content) { return { type: 'row', content } }
function col(content) { return { type: 'column', content } }
function stack(content) { return { type: 'stack', content } }

test('加载 layout-config 模块', async () => {
  const mod = await import(MOD_URL)
  assert.equal(typeof mod.dedupeComponents, 'function')
  assert.equal(typeof mod.hasDuplicateComponents, 'function')
})

test('dedupe: 同类型重复组件只保留首个（横向 row 场景）', async () => {
  const { dedupeComponents, hasDuplicateComponents } = await import(MOD_URL)
  const tree = row([stack([comp('a')]), stack([comp('b')]), stack([comp('a')]), stack([comp('a')])])
  const out = dedupeComponents(tree)
  assert.deepEqual(out, row([stack([comp('a')]), stack([comp('b')])]))
  assert.equal(hasDuplicateComponents(tree), true)
})

test('dedupe: 剪掉被清空的容器分支', async () => {
  const { dedupeComponents } = await import(MOD_URL)
  const tree = row([
    stack([comp('a')]),
    col([stack([comp('a')]), stack([comp('a')])]),
    stack([comp('b')]),
  ])
  const out = dedupeComponents(tree)
  assert.deepEqual(out, row([stack([comp('a')]), stack([comp('b')])]))
})

test('dedupe: 嵌套深处的重复被移除且保留首个出现位置', async () => {
  const { dedupeComponents } = await import(MOD_URL)
  const tree = row([
    col([stack([comp('a')]), stack([comp('b')])]),
    col([stack([comp('c')]), stack([comp('b')]), stack([comp('a')])]),
  ])
  const out = dedupeComponents(tree)
  assert.deepEqual(out, row([
    col([stack([comp('a')]), stack([comp('b')])]),
    col([stack([comp('c')])]),
  ]))
})

test('dedupe: 无重复时结构不变', async () => {
  const { dedupeComponents, hasDuplicateComponents } = await import(MOD_URL)
  const tree = row([col([stack([comp('a')])]), stack([comp('b')]), col([stack([comp('c')]), stack([comp('d')])])])
  const out = dedupeComponents(tree)
  assert.deepEqual(out, tree)
  assert.equal(hasDuplicateComponents(tree), false)
})

test('dedupe: 不修改原对象（不可变）', async () => {
  const { dedupeComponents } = await import(MOD_URL)
  const tree = row([stack([comp('a')]), stack([comp('a')])])
  const snapshot = JSON.stringify(tree)
  dedupeComponents(tree)
  assert.equal(JSON.stringify(tree), snapshot)
})

test('dedupe: null / undefined / 单组件根安全', async () => {
  const { dedupeComponents, hasDuplicateComponents } = await import(MOD_URL)
  assert.equal(dedupeComponents(null), null)
  assert.equal(dedupeComponents(undefined), null)
  assert.deepEqual(dedupeComponents(comp('a')), comp('a'))
  assert.equal(hasDuplicateComponents(null), false)
})

test('dedupe: componentType 对象形式 {id} 支持', async () => {
  const { dedupeComponents, hasDuplicateComponents } = await import(MOD_URL)
  const tree = row([stack([{ type: 'component', componentType: { id: 'x' }, title: 't' }]), stack([comp('x')])])
  assert.equal(hasDuplicateComponents(tree), true)
  const out = dedupeComponents(tree)
  assert.equal(out.content.length, 1)
  assert.equal(out.content[0].content[0].componentType.id, 'x')
})

test('dedupe: 整树仅同一种组件时保留一个', async () => {
  const { dedupeComponents } = await import(MOD_URL)
  const tree = row([stack([comp('a')]), stack([comp('a')]), stack([comp('a')])])
  const out = dedupeComponents(tree)
  assert.deepEqual(out, row([stack([comp('a')])]))
})
/* ── sanitizeLayoutConfig：白名单过滤 + 去重 + 剪枝 ── */

test('sanitize: 导出存在', async () => {
  const mod = await import(MOD_URL)
  assert.equal(typeof mod.sanitizeLayoutConfig, 'function')
})

test('sanitize: 剔除不在白名单内的组件（退役面板）', async () => {
  const { sanitizeLayoutConfig } = await import(MOD_URL)
  const tree = row([
    stack([comp('nodeRel'), comp('folderCard')]),
    stack([comp('nodePreview')]),
    stack([comp('compare')]),
  ])
  const out = sanitizeLayoutConfig(tree, ['folderCard', 'compare'])
  assert.deepEqual(out, row([stack([comp('folderCard')]), stack([comp('compare')])]))
})

test('sanitize: 根节点为退役 component 返回 null', async () => {
  const { sanitizeLayoutConfig } = await import(MOD_URL)
  assert.equal(sanitizeLayoutConfig(comp('nodeRel'), ['folderCard']), null)
  assert.deepEqual(sanitizeLayoutConfig(comp('folderCard'), ['folderCard']), comp('folderCard'))
})

test('sanitize: 全部组件被剔除时返回 null（触发默认布局回退）', async () => {
  const { sanitizeLayoutConfig } = await import(MOD_URL)
  const tree = row([col([stack([comp('nodeRel')]), stack([comp('nodePreview')])])])
  assert.equal(sanitizeLayoutConfig(tree, ['folderCard', 'compare']), null)
})

test('sanitize: 未知节点类型被剔除', async () => {
  const { sanitizeLayoutConfig } = await import(MOD_URL)
  const tree = row([
    { type: 'ground', content: [comp('folderCard')] },
    stack([comp('compare')]),
  ])
  const out = sanitizeLayoutConfig(tree, ['folderCard', 'compare'])
  assert.deepEqual(out, row([stack([comp('compare')])]))
})

test('sanitize: 白名单 + 去重组合（重复组件只留首个）', async () => {
  const { sanitizeLayoutConfig } = await import(MOD_URL)
  const tree = row([
    stack([comp('folderCard')]),
    stack([comp('nodeRel')]),
    stack([comp('folderCard')]),
    stack([comp('compare')]),
  ])
  const out = sanitizeLayoutConfig(tree, ['folderCard', 'compare'])
  assert.deepEqual(out, row([stack([comp('folderCard')]), stack([comp('compare')])]))
})

test('sanitize: componentType 对象形式 {id} 按白名单匹配', async () => {
  const { sanitizeLayoutConfig } = await import(MOD_URL)
  const tree = row([stack([{ type: 'component', componentType: { id: 'x' }, title: 't' }]), stack([comp('y')])])
  const out = sanitizeLayoutConfig(tree, ['x'])
  assert.deepEqual(out, row([stack([{ type: 'component', componentType: { id: 'x' }, title: 't' }])]))
})

test('sanitize: 白名单支持 Set 形式', async () => {
  const { sanitizeLayoutConfig } = await import(MOD_URL)
  const tree = row([stack([comp('a')]), stack([comp('b')])])
  const out = sanitizeLayoutConfig(tree, new Set(['a']))
  assert.deepEqual(out, row([stack([comp('a')])]))
})

test('sanitize: 空白名单 / null / undefined 安全', async () => {
  const { sanitizeLayoutConfig } = await import(MOD_URL)
  assert.equal(sanitizeLayoutConfig(row([stack([comp('a')])]), []), null)
  assert.equal(sanitizeLayoutConfig(null, ['a']), null)
  assert.equal(sanitizeLayoutConfig(undefined, ['a']), null)
  assert.equal(sanitizeLayoutConfig(row([]), ['a']), null)
})

test('sanitize: 不修改原对象（不可变）', async () => {
  const { sanitizeLayoutConfig } = await import(MOD_URL)
  const tree = row([stack([comp('a')]), stack([comp('nodeRel')])])
  const snapshot = JSON.stringify(tree)
  sanitizeLayoutConfig(tree, ['a'])
  assert.equal(JSON.stringify(tree), snapshot)
})

test('sanitize: 合法配置结构原样保留（仅重建容器）', async () => {
  const { sanitizeLayoutConfig } = await import(MOD_URL)
  const tree = row([col([stack([comp('a')]), stack([comp('b')])]), stack([comp('c')])])
  const out = sanitizeLayoutConfig(tree, ['a', 'b', 'c'])
  assert.deepEqual(out, tree)
})
test('migrate: 注入版本号 __v', async () => {
  const { migrateLayoutConfig, LAYOUT_VERSION } = await import(MOD_URL)
  const cfg = { root: row([stack([comp('a')])]) }
  const out = migrateLayoutConfig(cfg)
  assert.equal(out.__v, LAYOUT_VERSION)
  assert.equal(out.root.type, 'row')
})

test('migrate: 缺失 __v 的旧配置被迁移并打标', async () => {
  const { migrateLayoutConfig, LAYOUT_VERSION } = await import(MOD_URL)
  const cfg = { root: row([stack([comp('a')]), stack([comp('b')])]) }
  const out = migrateLayoutConfig(cfg)
  assert.equal(out.__v, LAYOUT_VERSION)
  assert.deepEqual(out.root, cfg.root)
})

test('migrate: 纯 root 结构（无 root 键）同样处理', async () => {
  const { migrateLayoutConfig, LAYOUT_VERSION } = await import(MOD_URL)
  const tree = row([stack([comp('a')])])
  const out = migrateLayoutConfig(tree)
  assert.equal(out.__v, LAYOUT_VERSION)
  assert.equal(out.root.type, 'row')
})

test('migrate: 非对象输入原样返回', async () => {
  const { migrateLayoutConfig } = await import(MOD_URL)
  assert.equal(migrateLayoutConfig(null), null)
  assert.equal(migrateLayoutConfig(undefined), undefined)
  assert.equal(migrateLayoutConfig('x'), 'x')
})

test('migrate: 不修改原始输入（不可变）', async () => {
  const { migrateLayoutConfig } = await import(MOD_URL)
  const cfg = { root: row([stack([comp('a')])]) }
  const snapshot = JSON.stringify(cfg)
  migrateLayoutConfig(cfg)
  assert.equal(JSON.stringify(cfg), snapshot)
})
test('migrate: leftSidebar 别名迁移为 folderCard', async () => {
  const { migrateLayoutConfig } = await import(MOD_URL)
  const cfg = { root: row([stack([comp('leftSidebar')]), stack([comp('compare')])]) }
  const out = migrateLayoutConfig(cfg)
  assert.deepEqual(out.root, row([stack([comp('folderCard')]), stack([comp('compare')])]))
})

test('migrate: 已是 folderCard 不受别名影响', async () => {
  const { migrateLayoutConfig } = await import(MOD_URL)
  const cfg = { root: row([stack([comp('folderCard')])]) }
  const out = migrateLayoutConfig(cfg)
  assert.deepEqual(out.root, row([stack([comp('folderCard')])]))
})
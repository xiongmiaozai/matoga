/**
 * parseTexGroup / buildGroups 单测（web/src/utils.js）：
 * - PBR 后缀识别：短后缀 _n/_s/_h/_e 与长后缀 _normal/_specular/_height/_emissive
 * - 长后缀优先于短后缀（避免 _normal 被 _n 截断为 _norma）
 * - 同一材质 PBR 套件归并到相同 groupKey
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')

/* utils.js → core.js/i18n.js 在顶层访问 document/window，stub 后方可加载 */
globalThis.document = { getElementById: () => null, documentElement: { lang: '' }, querySelectorAll: () => [] }
globalThis.window = { api: { getConfig: async () => ({}) } }

const MOD_URL = pathToFileURL(require('node:path').resolve(__dirname, '../../web/src/utils.js')).href

test('setup: 加载 utils 模块', async () => {
  const m = await import(MOD_URL)
  globalThis.__utils = m
  assert.equal(typeof m.parseTexGroup, 'function')
  assert.equal(typeof m.buildGroups, 'function')
})

test('parseTexGroup: 短后缀 PBR 角色', () => {
  const { parseTexGroup } = globalThis.__utils
  assert.deepEqual(parseTexGroup('assets/minecraft/textures/block/stone_n.png'), { groupKey: 'assets/minecraft/textures/block/stone', role: 'normal' })
  assert.deepEqual(parseTexGroup('assets/minecraft/textures/block/stone_s.png'), { groupKey: 'assets/minecraft/textures/block/stone', role: 'specular' })
  assert.deepEqual(parseTexGroup('assets/minecraft/textures/block/stone_h.png'), { groupKey: 'assets/minecraft/textures/block/stone', role: 'height' })
  assert.deepEqual(parseTexGroup('assets/minecraft/textures/block/stone_e.png'), { groupKey: 'assets/minecraft/textures/block/stone', role: 'emissive' })
})

test('parseTexGroup: 长后缀 PBR 角色（_normal/_specular/_height/_emissive）', () => {
  const { parseTexGroup } = globalThis.__utils
  assert.deepEqual(parseTexGroup('assets/minecraft/textures/block/stone_normal.png'), { groupKey: 'assets/minecraft/textures/block/stone', role: 'normal' })
  assert.deepEqual(parseTexGroup('assets/minecraft/textures/block/stone_specular.png'), { groupKey: 'assets/minecraft/textures/block/stone', role: 'specular' })
  assert.deepEqual(parseTexGroup('assets/minecraft/textures/block/stone_height.png'), { groupKey: 'assets/minecraft/textures/block/stone', role: 'height' })
  assert.deepEqual(parseTexGroup('assets/minecraft/textures/block/stone_emissive.png'), { groupKey: 'assets/minecraft/textures/block/stone', role: 'emissive' })
})

test('parseTexGroup: 长后缀不被短后缀截断（_normal ≠ _n + ormal）', () => {
  const { parseTexGroup } = globalThis.__utils
  const r = parseTexGroup('assets/minecraft/textures/block/flower_pot_normal.png')
  assert.equal(r.role, 'normal', '识别为 normal 而非 main')
  assert.equal(r.groupKey, 'assets/minecraft/textures/block/flower_pot', 'groupKey 剥离完整 _normal 而非 _n')
})

test('parseTexGroup: 连字符变体 -normal/-n', () => {
  const { parseTexGroup } = globalThis.__utils
  assert.deepEqual(parseTexGroup('tex/stone-normal.png'), { groupKey: 'tex/stone', role: 'normal' })
  assert.deepEqual(parseTexGroup('tex/stone-n.png'), { groupKey: 'tex/stone', role: 'normal' })
})

test('parseTexGroup: 无后缀贴图为 main 角色', () => {
  const { parseTexGroup } = globalThis.__utils
  assert.deepEqual(parseTexGroup('assets/minecraft/textures/block/stone.png'), { groupKey: 'assets/minecraft/textures/block/stone', role: 'main' })
})

test('parseTexGroup: 非图片文件为 file 角色', () => {
  const { parseTexGroup } = globalThis.__utils
  assert.deepEqual(parseTexGroup('assets/minecraft/models/block/stone.json'), { groupKey: 'assets/minecraft/models/block/stone.json', role: 'file' })
})

test('buildGroups: PBR 套件（长后缀）归并同组', () => {
  const { buildGroups } = globalThis.__utils
  const e = (name) => ({ name, isDirectory: false, size: 10, mtime: 0 })
  const entries = [
    e('assets/minecraft/textures/block/stone.png'),
    e('assets/minecraft/textures/block/stone_normal.png'),
    e('assets/minecraft/textures/block/stone_specular.png'),
    e('assets/minecraft/textures/block/stone_height.png'),
  ]
  const groups = buildGroups(entries)
  const key = 'assets/minecraft/textures/block/stone'
  assert.ok(groups.has(key), 'PBR 套件归并到同一 groupKey')
  const g = groups.get(key)
  assert.ok(g.main, 'main 贴图')
  assert.ok(g.normal, 'normal 贴图')
  assert.ok(g.specular, 'specular 贴图')
  assert.ok(g.height, 'height 贴图')
})
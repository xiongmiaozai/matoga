/**
 * keymap 单元测试：集中化快捷键映射表 + 匹配/格式化工具。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')

let KEYMAP, get, listByScope, scopes, parseCombo, matchKey, formatCombo

test('加载 keymap 模块', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'web/src/keymap.js')).href)
  KEYMAP = mod.KEYMAP
  get = mod.get
  listByScope = mod.listByScope
  scopes = mod.scopes
  parseCombo = mod.parseCombo
  matchKey = mod.matchKey
  formatCombo = mod.formatCombo
  assert.ok(Array.isArray(KEYMAP))
})

function ke(key, { ctrl = false, shift = false, alt = false, meta = false } = {}) {
  return { key, ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta }
}

test('KEYMAP 非空且每项含必需字段', () => {
  assert.ok(KEYMAP.length > 30)
  for (const b of KEYMAP) {
    assert.ok(b.id && b.scope && b.combo && b.description, `缺字段: ${JSON.stringify(b)}`)
    assert.ok(!b.id.includes(' '), `id 不应含空格: ${b.id}`)
  }
})

test('id 唯一', () => {
  const ids = KEYMAP.map(b => b.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('get 按 id 查找', () => {
  assert.equal(get('node.save').combo, 'Ctrl+S')
  assert.equal(get('nonexistent'), null)
})

test('listByScope 过滤', () => {
  const node = listByScope('node')
  assert.ok(node.length >= 13)
  assert.ok(node.every(b => b.scope === 'node'))
})

test('scopes 返回所有作用域', () => {
  const s = scopes()
  assert.ok(s.includes('table'))
  assert.ok(s.includes('node'))
  assert.ok(s.includes('fly'))
  assert.equal(new Set(s).size, s.length)
})

test('parseCombo 解析修饰键', () => {
  assert.deepEqual(parseCombo('Ctrl+Shift+Z'), { ctrl: true, shift: true, alt: false, key: 'Z' })
  assert.deepEqual(parseCombo('Ctrl+S'), { ctrl: true, shift: false, alt: false, key: 'S' })
  assert.deepEqual(parseCombo('F'), { ctrl: false, shift: false, alt: false, key: 'F' })
  assert.deepEqual(parseCombo('Alt+Drag'), { ctrl: false, shift: false, alt: true, key: 'Drag' })
})

test('matchKey 匹配 Ctrl+S（含 Cmd 兼容）', () => {
  assert.equal(matchKey(ke('s', { ctrl: true }), 'node.save'), true)
  assert.equal(matchKey(ke('s', { meta: true }), 'node.save'), true)
  assert.equal(matchKey(ke('s'), 'node.save'), false)
  assert.equal(matchKey(ke('S', { ctrl: true }), 'node.save'), true)
})

test('matchKey 匹配 Ctrl+Shift+Z', () => {
  assert.equal(matchKey(ke('z', { ctrl: true, shift: true }), 'node.redo'), true)
  assert.equal(matchKey(ke('z', { ctrl: true }), 'node.redo'), false)
})

test('matchKey 匹配单键 F', () => {
  assert.equal(matchKey(ke('f'), 'node.fit'), true)
  assert.equal(matchKey(ke('F'), 'node.fit'), true)
  assert.equal(matchKey(ke('f', { ctrl: true }), 'node.fit'), false)
})

test('matchKey 对非键盘 combo（Drag/Click）返回 false', () => {
  assert.equal(matchKey(ke('Drag'), 'uv.fineStep'), false)
  assert.equal(matchKey(ke('Click', { alt: true }), 'workspace.newTab'), false)
})

test('matchKey 未知 id 返回 false', () => {
  assert.equal(matchKey(ke('a'), 'nope'), false)
})

test('formatCombo 默认（PC）', () => {
  assert.equal(formatCombo('node.save'), 'Ctrl+S')
  assert.equal(formatCombo('node.redo'), 'Ctrl+Shift+Z')
  assert.equal(formatCombo('node.fit'), 'F')
})

test('formatCombo mac 模式', () => {
  assert.equal(formatCombo('node.save', true), '⌘S')
  assert.equal(formatCombo('node.redo', true), '⌘⇧Z')
  assert.equal(formatCombo('uv.fineStep', true), '⌥Drag')
})

test('formatCombo 未知 id 返回空串', () => {
  assert.equal(formatCombo('nope'), '')
})

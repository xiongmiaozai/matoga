/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * ws/layout-tree.js 单元测试：布局树遍历与完整性判定。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  walkConfig,
  collectComponentTypes,
  countComponentTypes,
  isConfigComplete,
  getDefaultConfig,
} from '../../web/src/ws/layout-tree.js'

function comp(id) {
  return { type: 'component', componentType: id, title: id }
}
function stack(content) {
  return { type: 'stack', content }
}
function row(content) {
  return { type: 'row', content }
}

test('walkConfig 遍历 content 子节点', () => {
  const tree = row([stack([comp('a')]), stack([comp('b')])])
  const seen = []
  walkConfig(tree, (n) => seen.push(n.type))
  assert.deepEqual(seen, ['row', 'stack', 'component', 'stack', 'component'])
})

test('walkConfig 也识别 contentItems（Golden-Layout 解析后形状）', () => {
  const tree = { type: 'row', contentItems: [{ type: 'stack', contentItems: [comp('x')] }] }
  const ids = collectComponentTypes(tree)
  assert.deepEqual([...ids], ['x'])
})

test('walkConfig 对空值安全', () => {
  assert.doesNotThrow(() => walkConfig(null, () => {}))
  assert.doesNotThrow(() => walkConfig(undefined, () => {}))
  assert.doesNotThrow(() => walkConfig('str', () => {}))
})

test('collectComponentTypes 收集去重后的组件类型', () => {
  const tree = row([stack([comp('a'), comp('b')]), stack([comp('a')])])
  const ids = collectComponentTypes(tree)
  assert.equal(ids.size, 2)
  assert.ok(ids.has('a'))
  assert.ok(ids.has('b'))
})

test('collectComponentTypes 可写入传入的 Set', () => {
  const out = new Set(['preset'])
  collectComponentTypes(row([stack([comp('a')])]), out)
  assert.deepEqual([...out].sort(), ['a', 'preset'])
})

test('countComponentTypes 统计每种组件出现次数', () => {
  const tree = row([stack([comp('a'), comp('a')]), stack([comp('b')])])
  assert.deepEqual(countComponentTypes(tree), { a: 2, b: 1 })
})

test('countComponentTypes 无组件时返回空对象', () => {
  assert.deepEqual(countComponentTypes(row([])), {})
})

test('isConfigComplete 至少 2 个不同组件才为真', () => {
  assert.equal(isConfigComplete(row([stack([comp('a')])])), false)
  assert.equal(isConfigComplete(row([stack([comp('a'), comp('b')])])), true)
})

test('isConfigComplete 同一组件重复两次仍不完整', () => {
  assert.equal(isConfigComplete(row([stack([comp('a'), comp('a')])])), false)
})

test('isConfigComplete 接受 {root} 包裹形状', () => {
  assert.equal(isConfigComplete({ root: row([stack([comp('a'), comp('b')])]) }), true)
  assert.equal(isConfigComplete({ root: row([stack([comp('a')])]) }), false)
})

test('isConfigComplete 对无效输入返回 false', () => {
  assert.equal(isConfigComplete(null), false)
  assert.equal(isConfigComplete(undefined), false)
  assert.equal(isConfigComplete({}), false)
  assert.equal(isConfigComplete({ root: null }), false)
  assert.equal(isConfigComplete('x'), false)
})

test('getDefaultConfig 返回含 root 的深拷贝', () => {
  const a = getDefaultConfig()
  assert.ok(a.root)
  assert.equal(a.root.type, 'row')
  const b = getDefaultConfig()
  assert.notEqual(a.root, b.root, '两次调用不应共享同一对象')
  a.root.type = 'mutated'
  assert.equal(b.root.type, 'row', '修改副本不应影响新副本')
})

test('默认布局本身是完整的', () => {
  const cfg = getDefaultConfig()
  assert.equal(isConfigComplete(cfg), true)
  assert.ok(collectComponentTypes(cfg.root).size >= 2)
})

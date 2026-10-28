/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * ws/preset-model.js 单元测试：预设数据模型与导入导出序列化。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  presetNames,
  isSavedPreset,
  getPresetConfig,
  setPreset,
  deletePresetEntry,
  renamePresetEntry,
  buildPresetExport,
  presetExportFileName,
  buildAllPresetsExport,
  ALL_PRESETS_FILE_NAME,
  parsePresetImport,
} from '../../web/src/ws/preset-model.js'

test('presetNames 把激活项排最前并去重', () => {
  const names = presetNames('b', { a: {}, b: {}, c: {} })
  assert.deepEqual(names, ['b', 'a', 'c'])
})

test('presetNames 过滤空值与空映射', () => {
  assert.deepEqual(presetNames(null, {}), [])
  assert.deepEqual(presetNames('', {}), [])
  assert.deepEqual(presetNames('x', null), ['x'])
})

test('isSavedPreset 判断预设是否存在', () => {
  assert.equal(isSavedPreset({ a: {} }, 'a'), true)
  assert.equal(isSavedPreset({ a: {} }, 'b'), false)
  assert.equal(isSavedPreset(null, 'a'), false)
})

test('getPresetConfig 取出配置，缺失返回 null', () => {
  assert.deepEqual(getPresetConfig({ a: { config: { root: 1 } } }, 'a'), { root: 1 })
  assert.equal(getPresetConfig({ a: {} }, 'a'), null)
  assert.equal(getPresetConfig({}, 'zz'), null)
  assert.equal(getPresetConfig(null, 'a'), null)
})

test('setPreset 写入配置与时间戳', () => {
  const presets = {}
  setPreset(presets, 'w1', { root: 1 }, 1234)
  assert.deepEqual(presets.w1, { config: { root: 1 }, updatedAt: 1234 })
})

test('setPreset 保留预设上的其他字段', () => {
  const presets = { w1: { note: 'keep', config: { old: 1 } } }
  setPreset(presets, 'w1', { root: 2 }, 99)
  assert.equal(presets.w1.note, 'keep')
  assert.deepEqual(presets.w1.config, { root: 2 })
  assert.equal(presets.w1.updatedAt, 99)
})

test('deletePresetEntry 删除并返回是否成功', () => {
  const presets = { a: {}, b: {} }
  assert.equal(deletePresetEntry(presets, 'a'), true)
  assert.equal('a' in presets, false)
  assert.equal(deletePresetEntry(presets, 'zz'), false)
  assert.equal(deletePresetEntry(null, 'a'), false)
})

test('renamePresetEntry 保留 config 并移除旧键', () => {
  const presets = { old: { config: { root: 7 } } }
  renamePresetEntry(presets, 'old', 'new')
  assert.equal('old' in presets, false)
  assert.deepEqual(presets.new.config, { root: 7 })
})

test('renamePresetEntry 对不存在的旧名不产生新键', () => {
  const presets = {}
  renamePresetEntry(presets, 'nope', 'new')
  assert.deepEqual(presets, {})
})

test('buildPresetExport 产出可解析的带 version 载荷', () => {
  const text = buildPresetExport('工作区A', { root: { type: 'row' } })
  const data = JSON.parse(text)
  assert.equal(data.name, '工作区A')
  assert.equal(data.version, 1)
  assert.deepEqual(data.config, { root: { type: 'row' } })
  assert.ok(text.includes('\n'), '应为格式化输出')
})

test('presetExportFileName 替换非法字符但保留中文', () => {
  assert.equal(presetExportFileName('工作区A'), 'workspace-工作区A.json')
  assert.equal(presetExportFileName('a/b:c*d'), 'workspace-a_b_c_d.json')
  assert.equal(presetExportFileName('x y'), 'workspace-x_y.json')
})

test('buildAllPresetsExport 包裹 presets 与 version', () => {
  const text = buildAllPresetsExport({ a: { config: {} } })
  const data = JSON.parse(text)
  assert.equal(data.version, 1)
  assert.deepEqual(Object.keys(data.presets), ['a'])
})

test('ALL_PRESETS_FILE_NAME 为固定值', () => {
  assert.equal(ALL_PRESETS_FILE_NAME, 'workspaces-all.json')
})

test('parsePresetImport 解析批量载荷', () => {
  const text = JSON.stringify({ presets: { a: { config: { root: 1 } }, b: { config: { root: 2 } } } })
  const r = parsePresetImport(text)
  assert.equal(r.kind, 'batch')
  assert.equal(r.entries.length, 2)
  assert.deepEqual(r.entries[0], ['a', { config: { root: 1 } }])
})

test('parsePresetImport 批量载荷过滤掉无 config 的项', () => {
  const text = JSON.stringify({ presets: { a: { config: { root: 1 } }, bad: { note: 'x' } } })
  const r = parsePresetImport(text)
  assert.equal(r.kind, 'batch')
  assert.equal(r.entries.length, 1)
  assert.equal(r.entries[0][0], 'a')
})

test('parsePresetImport 批量载荷全无 config 时判为无效', () => {
  const r = parsePresetImport(JSON.stringify({ presets: { bad: { note: 'x' } } }))
  assert.equal(r.kind, 'invalid')
})

test('parsePresetImport 解析单个载荷', () => {
  const r = parsePresetImport(JSON.stringify({ name: 'w', config: { root: 3 } }))
  assert.equal(r.kind, 'single')
  assert.equal(r.name, 'w')
  assert.deepEqual(r.config, { root: 3 })
})

test('parsePresetImport 对缺字段判为无效', () => {
  assert.equal(parsePresetImport(JSON.stringify({ name: 'w' })).kind, 'invalid')
  assert.equal(parsePresetImport(JSON.stringify({ config: {} })).kind, 'invalid')
})

test('parsePresetImport 对坏 JSON 判为无效并给出原因', () => {
  const r = parsePresetImport('{not json')
  assert.equal(r.kind, 'invalid')
  assert.match(r.reason, /JSON 解析失败/)
})

test('parsePresetImport 对非对象判为无效', () => {
  assert.equal(parsePresetImport('"str"').kind, 'invalid')
  assert.equal(parsePresetImport('123').kind, 'invalid')
  assert.equal(parsePresetImport('null').kind, 'invalid')
})

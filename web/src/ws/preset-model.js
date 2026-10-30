/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 工作区预设的数据模型与序列化。
 *
 * 从 workspace.js 抽出：只处理预设映射（name → {config, updatedAt}）与
 * 导入导出载荷，不依赖 Golden-Layout 实例与 DOM，Vue 迁移时可直接复用。
 * 网络请求仍由调用方负责，本模块保持无副作用（除标注的原地更新函数）。
 */

/**
 * 预设展示顺序：当前激活项排最前，其余按对象键序，去重并过滤空值。
 * @param {string} active 当前激活的预设名
 * @param {Record<string, object>} presets
 * @returns {string[]}
 */
export function presetNames(active, presets) {
  return [...new Set([active, ...Object.keys(presets || {})])].filter(Boolean)
}

/**
 * 预设是否已保存（存在且有 config）。
 * @param {Record<string, object>} presets
 * @param {string} name
 * @returns {boolean}
 */
export function isSavedPreset(presets, name) {
  return !!(presets && presets[name])
}

/**
 * 取预设的布局配置。
 * @param {Record<string, object>} presets
 * @param {string} name
 * @returns {object|null}
 */
export function getPresetConfig(presets, name) {
  if (presets && presets[name] && presets[name].config) return presets[name].config
  return null
}

/**
 * 原地写入预设配置（保存 / 另存为 / 自动保存共用）。
 * @param {Record<string, object>} presets
 * @param {string} name
 * @param {object} config
 * @param {number} [now] 时间戳，便于测试注入
 */
export function setPreset(presets, name, config, now = Date.now()) {
  presets[name] = presets[name] || {}
  presets[name].config = config
  presets[name].updatedAt = now
}

/**
 * 原地删除预设。
 * @param {Record<string, object>} presets
 * @param {string} name
 * @returns {boolean} 是否确实删除了
 */
export function deletePresetEntry(presets, name) {
  if (!presets || !(name in presets)) return false
  delete presets[name]
  return true
}

/**
 * 原地重命名预设，保留其 config。
 * @param {Record<string, object>} presets
 * @param {string} oldName
 * @param {string} newName
 */
export function renamePresetEntry(presets, oldName, newName) {
  if (!presets || !(oldName in presets)) return
  presets[newName] = presets[oldName]
  delete presets[oldName]
}

/**
 * 单个预设的导出载荷。
 * @param {string} name
 * @param {object} config
 * @returns {string} 已格式化的 JSON 文本
 */
export function buildPresetExport(name, config) {
  return JSON.stringify({ name, config, version: 1 }, null, 2)
}

/**
 * 单个预设的导出文件名（非法字符替换为下划线，保留中文）。
 * @param {string} name
 * @returns {string}
 */
export function presetExportFileName(name) {
  return 'workspace-' + String(name).replace(/[^\w\u4e00-\u9fa5]/g, '_') + '.json'
}

/**
 * 全部预设的导出载荷。
 * @param {Record<string, object>} presets
 * @returns {string}
 */
export function buildAllPresetsExport(presets) {
  return JSON.stringify({ presets: presets || {}, version: 1 }, null, 2)
}

/** 全部预设导出的固定文件名 */
export const ALL_PRESETS_FILE_NAME = 'workspaces-all.json'

/**
 * 解析导入文件内容。
 * 支持两种形状：批量 `{presets:{name:{config}}}` 与单个 `{name, config}`。
 * @param {string} text 文件原文
 * @returns {{kind: 'batch', entries: Array<[string, object]>} | {kind: 'single', name: string, config: object} | {kind: 'invalid', reason: string}}
 */
export function parsePresetImport(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { kind: 'invalid', reason: 'JSON 解析失败: ' + e.message }
  }
  if (!data || typeof data !== 'object') return { kind: 'invalid', reason: '文件内容不是对象' }
  if (data.presets) {
    const entries = Object.entries(data.presets).filter(([, p]) => p && p.config)
    if (!entries.length) return { kind: 'invalid', reason: '没有可导入的预设' }
    return { kind: 'batch', entries }
  }
  if (!data.name || !data.config) return { kind: 'invalid', reason: '无效的预设文件' }
  return { kind: 'single', name: data.name, config: data.config }
}

/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 集中化快捷键映射表（单一数据源）。
 * 各模块的 keydown 监听器仍保留原有逻辑，本模块仅提供数据与匹配工具，
 * 供右键菜单提示、未来设置面板自定义键位、文档生成等复用。
 */

/** @typedef {{ id: string, scope: string, combo: string, description: string, macCombo?: string }} Binding */

/** @type {Binding[]} */
export const KEYMAP = [
  // 主对比表
  { id: 'table.closePreview', scope: 'table', combo: 'Escape', description: '关闭预览' },
  { id: 'table.undo', scope: 'table', combo: 'Ctrl+Z', description: '撤销' },
  { id: 'table.copyRow', scope: 'table', combo: 'Ctrl+C', description: '复制选中行到另一侧' },
  { id: 'table.copyName', scope: 'table', combo: 'Ctrl+Shift+C', description: '复制选中行名称到剪贴板' },
  { id: 'table.paste', scope: 'table', combo: 'Ctrl+V', description: '粘贴到另一侧' },
  { id: 'table.down', scope: 'table', combo: 'ArrowDown', description: '下移选中行' },
  { id: 'table.up', scope: 'table', combo: 'ArrowUp', description: '上移选中行' },
  { id: 'table.pageDown', scope: 'table', combo: 'PageDown', description: '下翻 10 行' },
  { id: 'table.pageUp', scope: 'table', combo: 'PageUp', description: '上翻 10 行' },
  { id: 'table.home', scope: 'table', combo: 'Home', description: '跳到首行' },
  { id: 'table.end', scope: 'table', combo: 'End', description: '跳到末行' },
  { id: 'table.open', scope: 'table', combo: 'Enter', description: '打开选中项' },

  // 视图切换
  { id: 'view.table', scope: 'view', combo: 'Ctrl+1', description: '表格视图' },
  { id: 'view.modelCategory', scope: 'view', combo: 'Ctrl+2', description: '模型分类视图' },
  { id: 'view.chart', scope: 'view', combo: 'Ctrl+3', description: '图表视图' },
  { id: 'view.showInFolder', scope: 'view', combo: 'Ctrl+DoubleClick', description: '在文件夹中显示' },

  // UV 编辑器
  { id: 'uv.undo', scope: 'uv', combo: 'Ctrl+Z', description: '撤销编辑' },
  { id: 'uv.redo', scope: 'uv', combo: 'Ctrl+Shift+Z', description: '重做编辑' },
  { id: 'uv.redoY', scope: 'uv', combo: 'Ctrl+Y', description: '重做编辑' },
  { id: 'uv.fineStep', scope: 'uv', combo: 'Alt+Drag', description: '0.25 步长微调' },

  // 节点画布
  { id: 'node.undo', scope: 'node', combo: 'Ctrl+Z', description: '撤销' },
  { id: 'node.redo', scope: 'node', combo: 'Ctrl+Shift+Z', description: '重做' },
  { id: 'node.redoY', scope: 'node', combo: 'Ctrl+Y', description: '重做' },
  { id: 'node.duplicate', scope: 'node', combo: 'Ctrl+D', description: '复制节点' },
  { id: 'node.copy', scope: 'node', combo: 'Ctrl+C', description: '复制选中' },
  { id: 'node.cut', scope: 'node', combo: 'Ctrl+X', description: '剪切选中' },
  { id: 'node.paste', scope: 'node', combo: 'Ctrl+V', description: '粘贴' },
  { id: 'node.selectAll', scope: 'node', combo: 'Ctrl+A', description: '全选' },
  { id: 'node.save', scope: 'node', combo: 'Ctrl+S', description: '保存项目' },
  { id: 'node.delete', scope: 'node', combo: 'Delete', description: '删除选中节点/边' },
  { id: 'node.backspace', scope: 'node', combo: 'Backspace', description: '删除选中节点/边' },
  { id: 'node.fit', scope: 'node', combo: 'F', description: '适应视图' },
  { id: 'node.layout', scope: 'node', combo: 'L', description: '自动布局' },
  { id: 'node.cancel', scope: 'node', combo: 'Escape', description: '关闭菜单/清除选择/取消连线' },

  // 3D 飞行模式
  { id: 'fly.forward', scope: 'fly', combo: 'W', description: '前进' },
  { id: 'fly.backward', scope: 'fly', combo: 'S', description: '后退' },
  { id: 'fly.left', scope: 'fly', combo: 'A', description: '左移' },
  { id: 'fly.right', scope: 'fly', combo: 'D', description: '右移' },
  { id: 'fly.descend', scope: 'fly', combo: 'Q', description: '下降' },
  { id: 'fly.ascend', scope: 'fly', combo: 'E', description: '上升' },
  { id: 'fly.boost', scope: 'fly', combo: 'Shift', description: '加速' },

  // HDRI 预览
  { id: 'hdri.yawLeft', scope: 'hdri', combo: 'ArrowLeft', description: '偏航左' },
  { id: 'hdri.yawRight', scope: 'hdri', combo: 'ArrowRight', description: '偏航右' },
  { id: 'hdri.pitchUp', scope: 'hdri', combo: 'ArrowUp', description: '俯仰上' },
  { id: 'hdri.pitchDown', scope: 'hdri', combo: 'ArrowDown', description: '俯仰下' },
  { id: 'hdri.reset', scope: 'hdri', combo: 'R', description: '重置视角' },
  { id: 'hdri.fullscreen', scope: 'hdri', combo: 'F', description: '切换全屏' },

  // 资产库
  { id: 'asset.back', scope: 'asset', combo: 'Backspace', description: '返回上级' },

  // 通用对话框
  { id: 'dialog.confirm', scope: 'dialog', combo: 'Enter', description: '确认/提交' },
  { id: 'dialog.cancel', scope: 'dialog', combo: 'Escape', description: '取消/关闭' },

  // 工作区
  { id: 'workspace.newTab', scope: 'workspace', combo: 'Alt+Click', description: '新建标签组' },

  // 节点模式
  { id: 'nodeMode.exit', scope: 'nodeMode', combo: 'Escape', description: '退出节点模式' }
]

const INDEX = new Map(KEYMAP.map(b => [b.id, b]))

/** 按 id 查找绑定。 */
export function get(id) {
  return INDEX.get(id) || null
}

/** 按作用域过滤。 */
export function listByScope(scope) {
  return KEYMAP.filter(b => b.scope === scope)
}

/** 所有作用域。 */
export function scopes() {
  return [...new Set(KEYMAP.map(b => b.scope))]
}

/**
 * 解析 combo 字符串为结构化修饰键 + 主键。
 * @returns {{ ctrl: boolean, shift: boolean, alt: boolean, key: string }}
 */
export function parseCombo(combo) {
  const parts = combo.split('+')
  const key = parts[parts.length - 1]
  return {
    ctrl: parts.includes('Ctrl'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    key
  }
}

/**
 * 判断 KeyboardEvent 是否匹配某绑定 id（忽略 Drag/Click/DoubleClick 等非键盘 combo）。
 * @param {KeyboardEvent} e
 * @param {string} id
 */
export function matchKey(e, id) {
  const b = get(id)
  if (!b) return false
  const p = parseCombo(b.combo)
  if (p.key === 'Drag' || p.key === 'Click' || p.key === 'DoubleClick') return false
  const ctrl = e.ctrlKey || e.metaKey
  if (p.ctrl !== ctrl) return false
  if (p.shift !== !!e.shiftKey) return false
  if (p.alt !== !!e.altKey) return false
  const ek = e.key
  if (p.key.length === 1) return ek.toLowerCase() === p.key.toLowerCase()
  return ek === p.key
}

/**
 * 格式化 combo 为显示文本。mac 为 true 时 Ctrl 显示为 Cmd（⌘）。
 */
export function formatCombo(id, mac = false) {
  const b = get(id)
  if (!b) return ''
  const parts = b.combo.split('+')
  const out = parts.map(p => {
    if (p === 'Ctrl') return mac ? '⌘' : 'Ctrl'
    if (p === 'Shift') return mac ? '⇧' : 'Shift'
    if (p === 'Alt') return mac ? '⌥' : 'Alt'
    return p
  })
  return out.join(mac ? '' : '+')
}

/**
 * matoga - 工作区面板定义与默认布局
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 workspace.js 原样搬出，逻辑未改。
 */

/* 默认面板清单；调用方持有可变副本（运行时由 getPanelDefs() 覆盖为清单实况） */
export const DEFAULT_PANEL_DEFS = [
  { id: 'folderCard', title: '文件夹选择', icon: 'i-folder' },
  { id: 'compareSettings', title: '对比设置', icon: 'i-compare' },
  { id: 'actions', title: '操作', icon: 'i-swap' },
  { id: 'compare', title: '贴图对比', icon: 'i-compare' },
  { id: 'modelCategory', title: '模型分类', icon: 'i-cube' },
  { id: 'chart', title: '可视化', icon: 'i-pie' },
  { id: 'preview', title: '预览', icon: 'i-image' },
  { id: 'material3d', title: '3D 视口', icon: 'i-cube' },
  { id: 'detail', title: '详情', icon: 'i-layers' },
  { id: 'nodeCanvas', title: '节点画布', icon: 'i-node' },
  { id: 'nodeLibrary', title: '节点库', icon: 'i-layers' },
  { id: 'assetLibrary', title: '总资产库', icon: 'i-folder' },

  { id: 'uvEditor', title: 'UV 编辑器', icon: 'i-grid' }
]

export function comp(id, title) {
  return { type: 'component', componentType: id, title, reorderEnabled: true, minSize: '120px' }
}
export function stack(c, size) {
  const s = { type: 'stack', content: c, minSize: '28px' }
  if (size) s.size = size
  return s
}
export function col(c, size) {
  return { type: 'column', size, content: c, minSize: '120px' }
}
export function row(c) {
  return { type: 'row', content: c, minSize: '120px' }
}

export const DEFAULT_LAYOUT = row([
  col(
    [
      stack([comp('folderCard', '文件夹选择')]),
      stack([comp('compareSettings', '对比设置')]),
      stack([comp('actions', '操作')])
    ],
    '1fr'
  ),
  stack([comp('compare', '贴图对比'), comp('modelCategory', '模型分类'), comp('chart', '可视化')]),
  col([stack([comp('preview', '预览')]), stack([comp('detail', '详情')])], '1.3fr')
])

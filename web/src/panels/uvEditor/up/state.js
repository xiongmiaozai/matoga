/**
 * matoga - UV 编辑器面板：共享状态
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 panel.js 原样搬出。这些状态被多个子模块读写，而 ESM 导入绑定只读
 * （对导入的 let 赋值会抛 "Assignment to constant variable"），故挂在 S 上。
 */
export const S = {
  editor: null, // createUvEditor 返回的编辑器实例
  sel: null, // 当前选中的模型项
  saveBtn: null,
  hintEl: null,
  source: null, // 模型来源描述
  options: [], // 可选模型列表
  inited: false
}

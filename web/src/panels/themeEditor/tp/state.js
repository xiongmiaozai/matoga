/**
 * matoga - 主题编辑器面板：共享状态
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 panel.js 原样搬出。这些草稿状态被多个子模块读写，而 ESM 导入绑定只读
 * （对导入的 let 赋值会抛 "Assignment to constant variable"），故挂在 S 上。
 */
export const S = {
  editing: null,      // 当前编辑中的主题记录（null = 新建）
  draftTokens: {},    // 草稿 token 值
  draftName: '',
  draftMode: 'light',
  draftBase: 'light',
}

/**
 * matoga - 节点项目：共享状态
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 project.js 原样搬出。这些状态被多个子模块读写，而 ESM 导入绑定只读
 * （对导入的 let 赋值会抛 "Assignment to constant variable"），故挂在 S 上。
 */
export const S = {
  currentProject: null,     // 当前打开的项目
  dirty: false,             // 是否有未保存改动
  autoSaveTimer: null,
  suspendAutoSave: false,
  saving: false,
  lastSavedSig: null,       // 上次保存时的图签名
  graphToComfy: null,       // 由图模块注入
  loadGraphJSON: null,      // 由图模块注入
}

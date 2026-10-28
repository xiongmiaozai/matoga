/**
 * matoga - UV 贴图库选择器：共享状态
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-tex-picker.js 原样搬出。这些状态被多个子模块读写，而 ESM 导入绑定只读
 * （对导入的 let 赋值会抛 "Assignment to constant variable"），故统一挂在 S 上。
 */
export const S = {
  packs: [],        /* [{ source, name, kind, root, label, materials: [材质组] }] */
  packIdx: 0,
  searchText: '',
  shown: 0,         /* 当前渲染条数（分页） */
  filtered: [],     /* 当前包 + 搜索过滤后的材质组列表 */
  loadError: null,
  resolve: null,    /* 本次打开的 Promise resolve */

  /* DOM 引用（initPicker 时赋值） */
  win: null,
  packSel: null,
  searchInput: null,
  gridEl: null,
  moreBtn: null,
  emptyEl: null,
  statusEl: null,
}

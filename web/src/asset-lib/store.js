/**
 * matoga - 总资产库：面板运行时状态
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 迁出。集中保存面板的可变状态，供各子模块共享读写
 * （ESM 的 import 绑定不可重新赋值，故用单一可变对象承载）。
 */
import { loadList } from './dom.js'

export const BROWSE_CLICK_DELAY = 240

export const S = {
  searchTerm: '',
  categoryFilter: 'all',
  /* 方块/物品内容过滤（与分类标签正交的维度）：'all' | 'block' | 'item' */
  contentKindFilter: 'all',
  sortKey: 'name',
  sortDir: 'asc',
  viewMode: 'grid',

  mcEntries: null,
  officialEntries: null,
  hdriEntries: null,
  projectEntries: null,
  canvasPresets: null,      /* 自定义画布预设（config.canvasCustomPresets），null = 未加载 */
  texPacks: null,
  modelPacks: null,         /* /api/asset/model 聚合结果（包内 .json 模型），null = 未加载 */
  importedModels: null,     /* 用户导入模型（/api/imported-models），null = 未加载 */
  customModels: null,       /* 自定义模型（/api/custom-models），null = 未加载 */
  /* 各模型类的专属本地目录（用于「打开本地位置」）：imported=导入模型，custom=自定义模型 */
  modelDirs: { imported: '', custom: '' },
  lastTexSig: '',
  loadErrors: { hdri: null, mc: null, official: null, project: null, tex: null, model: null },

  favorites: loadList('matoga:assetFav'),
  recent: loadList('matoga:assetRecent'),
  serverSynced: false,

  ctxMenu: null,
  pollTimer: null,
  detailCurrent: null,
  browse: null,       // { item, pack, dir }：总资产库面板内的包内容浏览状态
  browseSeq: 0,
  clickTimer: null,
}

/* 刷新回调：由主文件 asset-library.js 注入。
   子模块（sections-model.js 等）需要触发整库刷新，若直接 import 主文件会
   形成 主文件 → 子模块 → 主文件 的循环依赖（ESM 下静默变空绑定）。 */
let _refresh = async () => {}

export function setRefreshHooks(fn) {
  if (typeof fn === 'function') _refresh = fn
}

export async function refreshVia() {
  return _refresh()
}

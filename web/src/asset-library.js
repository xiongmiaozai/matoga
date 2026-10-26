/**
 * matoga - 总资产库面板
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 聚合多类资产到 #assetLibraryBody：
 *  1. 材质贴图（聚合左右已选目录 + MC 材质包 + MC 官方包内的全部贴图，
 *     数据源 state.leftEntries/rightEntries 与 /api/asset/tex，按文件夹/包类别分子组展示）
 *  2. 模型（MC 材质包/官方包内 assets/<ns>/models/*.json 与 1.21.4+ 物品定义
 *     assets/<ns>/items/*.json + 用户导入模型 /api/imported-models + 自定义模型 /api/custom-models；
 *     各来源拥有独立专属本地目录，
 *     分组头「打开本地位置」直达；双击详情显示 parent/贴图引用，
 *     添加/拖拽 = 在 3D 视口查看）
 *  3. HDRI 预设（/api/hdri/list）
 *  4. MC 资源包（config.mcPacksPath + /api/mc-packs/list，整包储存为包媒体，点开浏览包内贴图）
 *  5. MC 官方材质包（config.officialPacksPath + /api/mc-official/list，解析 pack.mcmeta 分析版本）
 *  6. 内置节点预设（金属/塑料/玻璃/织物/自发光）
 * 收藏夹与最近使用通过后端 /api/asset 持久化，localStorage 作为离线回退。
 * 单击卡片打开详情面板（大图预览 + 元数据），拖拽或详情面板按钮添加到画布。
 * 双击文件夹型资产（MC 资源包 / 官方材质包）在面板内切换为文件管理器式包内容浏览。
 */

import { state, IMG_EXTS, showToast } from './core.js'
import { fileUrl, formatSize, formatDate, escAttr, apiUrl, setTexDragData, contentKindOfPath } from './utils.js'
import { addNodeAt, addTextureAt, loadPreset, saveNodeProject, loadNodeProject, serializeGraphData, loadCanvasPresetGraph } from './node-canvas.js'
import { t, onLocaleChange } from './i18n.js'
import { uiPrompt, uiConfirm } from './ui-dialog.js'
import { viewMcModelInViewport, viewImportedModelInViewport, isViewportVisible } from './mc-model-viewer.js'
import { activateMaterial3DHost } from './material3d.js'
import { ensureModelThumb, observeModelThumbs } from './model-thumb.js'

import { splitGroupsByPrefix } from './model-prefix.js'
import { openCreateModelDialog, previewCustomModel } from './create-model-dialog.js'

/* 常量与纯路径/角色工具已拆出，见 asset-lib/helpers.js */
import {
  PRESETS, ALL_TYPES, SECTION_CATS, QUICK_CATS, MAX_RECENT, HDRI_EXTS, TEX_GROUP_PAGE,
  PROJECTS_API, MC_OFFICIAL_API, MC_PACKS_API, CRAFT_PACKS_API,
  IMPORT_API, CUSTOM_API, MODEL_JSON_RE, MODEL_DIR_PATH_RE,
  packApiFor, detectTypeFromPath, classifyByRole, isValidAssetKey, categoryLabel,
  presetName, roleText, isImg, thumbUrl, hdriThumbUrl,
  parsePackTexPath, packTexThumbUrl, parsePackModelPath, isVirtualAssetPath,
  userModelFilePath, packRawUrl, officialRawUrl, mcRawUrl,
} from './asset-lib/helpers.js'
import { el, shade, loadList, saveList } from './asset-lib/dom.js'
import { tryActivateModelViewport, viewMcModelAsset, viewImportedModelAsset } from './asset-lib/model-view.js'
import { S, BROWSE_CLICK_DELAY } from './asset-lib/store.js'
import { loadHdri, loadMc, loadModelAssets, loadTexPacks } from './asset-lib/loaders.js'
import { loadOfficial } from './asset-lib/sections-official.js'
import { loadProjects, refreshProjectsQuiet } from './asset-lib/projects.js'
import { loadCanvasPresets } from './asset-lib/presets.js'
import { applyFilter, rebuild } from './asset-lib/filters.js'
import { buildToolbar, sigEntries, startPoll } from './asset-lib/toolbar.js'
import { browseUp, renderBrowse } from './asset-lib/pack-browser.js'
import { hideCtxMenu } from './asset-lib/ctx-menu.js'
import { openDetail } from './asset-lib/detail.js'
import { loadAssetStore } from './asset-lib/api.js'

/* ── 模型查看：3D 视口 已移至 asset-lib/model-view.js ── */

/* el / shade / loadList / saveList 已移至 asset-lib/dom.js */

/* 面板运行时状态已迁至 asset-lib/store.js（S 对象承载，供子模块共享读写） */

export async function refreshAssetLibrary() {
  await Promise.all([loadHdri(), loadMc(), loadOfficial(), loadProjects(), loadTexPacks(), loadModelAssets(), loadCanvasPresets()])
  rebuild()
}

export function initAssetLibrary() {
  const search = document.getElementById('assetLibSearch')
  if (search) search.addEventListener('input', () => { S.searchTerm = search.value; applyFilter() })
  buildToolbar()
  const refreshBtn = document.getElementById('assetLibRefresh')
  if (refreshBtn) refreshBtn.addEventListener('click', () => { if (S.browse) renderBrowse(); else refreshAssetLibrary() })
  document.addEventListener('custom-model:created', () => { refreshAssetLibrary() })
  document.addEventListener('click', hideCtxMenu)
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('.asset-card')) hideCtxMenu() })
  document.addEventListener('keydown', (e) => {
    if (!S.browse || e.key !== 'Backspace') return
    const ae = document.activeElement
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return
    e.preventDefault()
    browseUp()
  })
  document.addEventListener('nodeproject:saved', () => { refreshProjectsQuiet() })
  onLocaleChange(() => {
    buildToolbar()
    if (S.browse) { renderBrowse(); return }
    rebuild()
    if (S.detailCurrent) openDetail(S.detailCurrent)
  })
  S.lastTexSig = sigEntries()
  rebuild()
  loadAssetStore()
  refreshAssetLibrary()
  startPoll()
}
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
import { naturalCompare } from './natural-sort.js'
import {
  addNodeAt,
  addTextureAt,
  loadPreset,
  saveNodeProject,
  loadNodeProject,
  serializeGraphData,
  loadCanvasPresetGraph
} from './node-canvas.js'
import { t, onLocaleChange } from './i18n.js'
import { loadZhNames, zhOfItem, zhOfTexPath, zhOfTexName, pinyinOfItem, enCandidatesOfZh } from './zh-names.js'
import { assetSearchMatch } from './asset-search.js'
import { uiPrompt, uiConfirm } from './ui-dialog.js'
import { viewMcModelInViewport, viewImportedModelInViewport, isViewportVisible } from './mc-model-viewer.js'
import { activateMaterial3DHost } from './material3d.js'
import { ensureModelThumb, observeModelThumbs } from './model-thumb.js'
import { doDownloadZip, openExportDialog } from './asset-lib/export-dialog.js'

import { splitGroupsByPrefix } from './model-prefix.js'
import { openCreateModelDialog, previewCustomModel } from './create-model-dialog.js'
import { openCreatePackDialog } from './create-pack-dialog.js'
import { openImportPackDialog } from './import-pack-dialog.js'
import { packEntryRawUrl, isAddableAssetPath, isModelBrowsePath, pbLoadView, pbSaveView, openPackBrowser, browseTo, browseUp, exitBrowse, browseCrumbs, buildBrowseHead, buildBrowseCrumbsBar, buildBrowseToolbar, setBrowseStatus, browseEntryPath, buildBrowseFolderCard, buildBrowseFileRow, fillBrowseError, fillBrowseView, renderBrowse, setHooks as setAssetBrowseHooks } from './asset-lib/browse.js'
import { collectTexGroups, buildAssetGroup, buildTexGroup, buildTexSection, collectModelGroups, texRefToAssetPath, collectModelTexturePaths, matchTexturesToPaths, buildModelSection, setHooks as setAssetCollectHooks } from './asset-lib/collect.js'
import { applyFilter, updateStat, sigEntries, startPoll, buildToolbar, setHooks as setAssetToolbarHooks } from './asset-lib/toolbar.js'
import { modelMetaRows, bbModelMetaRows, fetchModelMetaRows, openDetail, showModelDetail, showDetail, refreshDetailFav, hideDetail, setHooks as setAssetDetailHooks } from './asset-lib/detail.js'
/* 门面 re-export（§2.3） */
export { modelMetaRows, bbModelMetaRows, fetchModelMetaRows, openDetail, showModelDetail, showDetail, refreshDetailFav, hideDetail } from './asset-lib/detail.js'
/* 门面 re-export（§2.3） */
export { applyFilter, updateStat, sigEntries, startPoll, buildToolbar } from './asset-lib/toolbar.js'
/* 门面 re-export（§2.3） */
export { collectTexGroups, buildAssetGroup, buildTexGroup, buildTexSection, collectModelGroups, texRefToAssetPath, collectModelTexturePaths, matchTexturesToPaths, buildModelSection } from './asset-lib/collect.js'
/* 门面 re-export（§2.3） */
export { packEntryRawUrl, isAddableAssetPath, isModelBrowsePath, pbLoadView, pbSaveView, openPackBrowser, browseTo, browseUp, exitBrowse, browseCrumbs, buildBrowseHead, buildBrowseCrumbsBar, buildBrowseToolbar, setBrowseStatus, browseEntryPath, buildBrowseFolderCard, buildBrowseFileRow, fillBrowseError, fillBrowseView, renderBrowse } from './asset-lib/browse.js'

const PRESETS = [
  { id: 'metal', color: '#c8c8d0' },
  { id: 'plastic', color: '#e0e0e0' },
  { id: 'glass', color: '#e0eef5' },
  { id: 'fabric', color: '#b39880' },
  { id: 'emissive', color: '#fff3c0' }
]

const ALL_TYPES = ['tex', 'model', 'hdri', 'mc', 'official', 'preset', 'project', 'craft']
/* 分区渲染顺序（rebuild 遵循此顺序，不含 fav/recent 快捷分区） */
const SECTION_CATS = ['project', 'preset', 'tex', 'model', 'hdri', 'mc', 'official']
/* 快捷视图分区：内容为其它分区的副本，仅在选中对应标签时展示（搜索时也不重复展示） */
const QUICK_CATS = new Set(['fav', 'recent'])
const MAX_RECENT = 50
const HDRI_EXTS = new Set(['hdr', 'exr'])
const TEX_GROUP_PAGE = 400
const PROJECTS_API = '/api/node-projects'
const MC_OFFICIAL_API = '/api/mc-official'
const MC_PACKS_API = '/api/mc-packs'
const CRAFT_PACKS_API = '/api/craft-packs'

const IMPORT_API = '/api/imported-models'
const CUSTOM_API = '/api/custom-models'
const MODEL_JSON_RE = /\.json$/i
/* 包浏览中的模型文件：assets/<ns>/models/**（旧格式）或 assets/<ns>/items/*.json（1.21.4+ 物品定义） */
const MODEL_DIR_PATH_RE = /^assets\/[^/]+\/(models|items)\//

/* 包媒体 API 前缀：mc 资源包与官方材质包共用同一套包浏览/读取接口 */
function packApiFor(type) {
  if (type === 'mc') return MC_PACKS_API
  if (type === 'craft') return CRAFT_PACKS_API
  return MC_OFFICIAL_API
}

const ROLE_PATTERNS_STRONG = [
  { role: 'normal', re: /(?:_|-|^)(normal|nrm|nor|nmap|normalmap|tangent)(?=\.|_|-|$)/i },
  {
    role: 'specular',
    re: /(?:_|-|^)(specular|spec|spc|smap|specmap|roughness|rough|metalness|metal|metallic|reflect|f0)(?=\.|_|-|$)/i
  },
  { role: 'height', re: /(?:_|-|^)(height|hmap|heightmap|displacement|disp|bump|depth)(?=\.|_|-|$)/i },
  { role: 'emissive', re: /(?:_|-|^)(emissive|emis|emit|glow|illum|light)(?=\.|_|-|$)/i },
  { role: 'ao', re: /(?:_|-|^)(ao|occlusion|sss|subsurface)(?=\.|_|-|$)/i },
  { role: 'opacity', re: /(?:_|-|^)(opacity|alpha|mask|transparency)(?=\.|_|-|$)/i },
  { role: 'main', re: /(?:_|-|^)(diffuse|diff|albedo|base|color|col|main|texture|tex)(?=\.|_|-|$)/i }
]

const ROLE_PATTERNS_WEAK = [
  { role: 'normal', re: /(?:_|-)n(?=\.|_|-|$)/i },
  { role: 'specular', re: /(?:_|-)s(?=\.|_|-|$)/i },
  { role: 'height', re: /(?:_|-)h(?=\.|_|-|$)/i },
  { role: 'emissive', re: /(?:_|-)e(?=\.|_|-|$)/i },
  { role: 'main', re: /(?:_|-)(?:d|c)(?=\.|_|-|$)/i }
]

const TYPE_LABEL_KEYS = {
  tex: 'asset.catTex',
  model: 'asset.catModel',
  hdri: 'asset.catHdri',
  mc: 'asset.catMc',
  official: 'asset.catOfficial',
  preset: 'asset.catPreset',
  project: 'asset.catProject',
  craft: 'asset.catCraft'
}


function classifyByRole(name) {
  if (!name || typeof name !== 'string') return null
  const lower = name.toLowerCase()
  for (const { role, re } of ROLE_PATTERNS_STRONG) {
    if (re.test(lower)) return role
  }
  for (const { role, re } of ROLE_PATTERNS_WEAK) {
    if (re.test(lower)) return role
  }
  return null
}

function isValidAssetKey(key) {
  if (typeof key !== 'string' || !key) return false
  const idx = key.indexOf(':')
  if (idx <= 0) return false
  return ALL_TYPES.includes(key.slice(0, idx))
}

function categoryLabel(type) {
  const k = TYPE_LABEL_KEYS[type]
  return k ? t(k) : type
}

let searchTerm = ''
let categoryFilter = 'all'
/* 方块/物品内容过滤（与分类标签正交的维度）：'all' | 'block' | 'item' */
let contentKindFilter = 'all'
let sortKey = 'name'
let sortDir = 'asc'
let viewMode = 'grid'

let mcEntries = null
let officialEntries = null
let hdriEntries = null
let projectEntries = null
let canvasPresets = null /* 自定义画布预设（config.canvasCustomPresets），null = 未加载 */
let texPacks = null
let modelPacks = null /* /api/asset/model 聚合结果（包内 .json 模型），null = 未加载 */
let importedModels = null /* 用户导入模型（/api/imported-models），null = 未加载 */
let customModels = null /* 自定义模型（/api/custom-models），null = 未加载 */
/* 各模型类的专属本地目录（用于「打开本地位置」）：imported=导入模型，custom=自定义模型 */
let modelDirs = { imported: '', custom: '' }
let lastTexSig = ''
let loadErrors = { hdri: null, mc: null, official: null, project: null, tex: null, model: null }

let favorites = loadList('matoga:assetFav')
let favKeys = new Set(favorites.map(f => f.key))
function syncFavKeys() { favKeys = new Set(favorites.map(f => f.key)) }
let recent = loadList('matoga:assetRecent')
let serverSynced = false

let ctxMenu = null
let pollTimer = null
let detailCurrent = null
let browse = null // { item, pack, dir }：总资产库面板内的包内容浏览状态
let browseSeq = 0

const BROWSE_CLICK_DELAY = 240

function presetName(id) {
  return t('m3d.preset' + id.charAt(0).toUpperCase() + id.slice(1))
}

function roleText(role) {
  const keys = {
    preset: 'asset.rolePreset',
    main: 'asset.roleMain',
    normal: 'asset.roleNormal',
    specular: 'asset.roleSpecular',
    height: 'asset.roleHeight',
    emissive: 'asset.roleEmissive',
    ao: 'asset.roleAo',
    opacity: 'asset.roleOpacity',
    project: 'asset.roleProject',
    model: 'asset.roleModel'
  }
  return keys[role] ? t(keys[role]) : role
}

function isImg(e) {
  return e && !e.isDirectory && IMG_EXTS.has((e.name.split('.').pop() || '').toLowerCase())
}
function thumbUrl(p) {
  return fileUrl(p)
}
function hdriThumbUrl(p) {
  return '/api/hdri/thumb?path=' + encodeURIComponent(p)
}

/* zip 包内贴图的虚拟路径：pack:<source>:<packName>/<包内相对路径>（无磁盘绝对路径，
   thumb / 添加到画布走对应包媒体 raw 接口） */
function parsePackTexPath(p) {
  if (typeof p !== 'string' || !p.startsWith('pack:')) return null
  const rest = p.slice(5)
  const ci = rest.indexOf(':')
  if (ci <= 0) return null
  const source = rest.slice(0, ci)
  const remain = rest.slice(ci + 1)
  const si = remain.indexOf('/')
  if (si <= 0) return null
  return { source, packName: remain.slice(0, si), rel: remain.slice(si + 1) }
}

function packTexThumbUrl(source, packName, rel) {
  return packRawUrl(packApiFor(source), packName, rel)
}

/* zip 包内模型的虚拟路径：packmodel:<source>:<packName>/<包内相对路径>（与贴图 pack: 前缀区分） */
function parsePackModelPath(p) {
  if (typeof p !== 'string' || !p.startsWith('packmodel:')) return null
  const rest = p.slice(10)
  const ci = rest.indexOf(':')
  if (ci <= 0) return null
  const source = rest.slice(0, ci)
  const remain = rest.slice(ci + 1)
  const si = remain.indexOf('/')
  if (si <= 0) return null
  return { source, packName: remain.slice(0, si), rel: remain.slice(si + 1) }
}

/* 无磁盘路径的虚拟资产（zip 包内贴图 / 包内模型 / 用户模型虚拟 id）：不可直接定位、不可 stat；
   im/cm/bb 模型由 item.modelFile 提供真实磁盘路径供定位 */
function isVirtualAssetPath(item) {
  if (!item || typeof item.path !== 'string' || !item.path) return false
  if (parsePackTexPath(item.path)) return true
  if (parsePackModelPath(item.path)) return true
  if (item.path.startsWith('bb:')) return true
  if (item.path.startsWith('im:')) return true
  if (item.path.startsWith('cm:')) return true
  return false
}

/* 用户模型（im/cm/bb）在磁盘上的模型文件绝对路径：<模型根目录>/<id>/model.<ext> */
function userModelFilePath(dir, m) {
  if (!dir || !m || !m.id || !m.file) return null
  return dir.replace(/[\\/]+$/, '') + '/' + m.id + '/' + m.file
}

/* ── 模型查看：3D 视口 ── */

/* 3D 视口未激活（用户尚未打开过「3D 视口」面板或预览 3D tab）时自动激活：
   优先点击预览面板 3D tab（等价用户点击，含 tab 切换），回退独立视口面板宿主。
   返回 true 表示视口已就绪，可重试模型展示 */
function tryActivateModelViewport() {
  if (isViewportVisible()) return true
  const pvBtn = document.querySelector('.pv-tabs button[data-pv-tab="3d"]')
  if (pvBtn) {
    pvBtn.click()
    return true
  }
  const host = document.getElementById('material3dStandaloneHost')
  if (host) {
    activateMaterial3DHost(host)
    return true
  }
  return false
}

/* 3D 视口查看 MC 包内 .json 模型（models/ 路径或 items/ 物品定义；parent 链 + elements + 包内贴图） */
async function viewMcModelAsset(source, packName, rel, name) {
  try {
    let r = await viewMcModelInViewport({ api: packApiFor(source), packName, rel })
    if (!r.shown && tryActivateModelViewport()) {
      r = await viewMcModelInViewport({ api: packApiFor(source), packName, rel })
    }
    if (r.shown) showToast(t('asset.toastModelViewport', { name }))
    else showToast(t('asset.toastModelViewportNoView'))
  } catch (e) {
    showToast(t('asset.toastModelOpenFail') + ': ' + (e.message || e))
  }
}

/* 3D 视口查看导入模型（data/imported-models，.bbmodel / MC .json） */
async function viewImportedModelAsset(id, name) {
  try {
    let r = await viewImportedModelInViewport({ id })
    if (!r.shown && tryActivateModelViewport()) {
      r = await viewImportedModelInViewport({ id })
    }
    if (r.shown) showToast(t('asset.toastModelViewport', { name }))
    else showToast(t('asset.toastModelViewportNoView'))
  } catch (e) {
    showToast(t('asset.toastModelOpenFail') + ': ' + (e.message || e))
  }
}

function el(tag, cls, html) {
  const d = document.createElement(tag)
  if (cls) d.className = cls
  if (html != null) d.innerHTML = html
  return d
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16)
  let r = (n >> 16) + amt,
    g = ((n >> 8) & 0xff) + amt,
    b = (n & 0xff) + amt
  r = Math.max(0, Math.min(255, r))
  g = Math.max(0, Math.min(255, g))
  b = Math.max(0, Math.min(255, b))
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}

function loadList(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || []
  } catch {
    return []
  }
}
function saveList(key, arr) {
  try {
    localStorage.setItem(key, JSON.stringify(arr))
  } catch {}
}

async function assetApiCall(method, path, body) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  const j = await res.json()
  if (!j || !j.ok) throw new Error((j && j.msg) || 'bad response')
  return j.data
}

async function loadAssetStore() {
  try {
    const data = await assetApiCall('GET', '/api/asset')
    if (Array.isArray(data.favorites)) {
      favorites = data.favorites
      syncFavKeys()
      saveList('matoga:assetFav', favorites)
    }
    if (Array.isArray(data.recent)) {
      recent = data.recent
      saveList('matoga:assetRecent', recent)
    }
    serverSynced = true
  } catch {
    serverSynced = false
  }
  rebuild()
}

function persistFavorites() {
  syncFavKeys()
  saveList('matoga:assetFav', favorites)
  if (serverSynced) assetApiCall('PUT', '/api/asset/favorites', { items: favorites }).catch(() => {})
}

function persistRecent() {
  saveList('matoga:assetRecent', recent)
  if (serverSynced) assetApiCall('PUT', '/api/asset/recent', { items: recent }).catch(() => {})
}

function sortItems(items) {
  const arr = items.slice()
  const byName = (a, b) => naturalCompare(a.name, b.name)
  arr.sort((a, b) => {
    let cmp
    if (sortKey === 'mtime') cmp = (a.mtime || 0) - (b.mtime || 0)
    else if (sortKey === 'fav') cmp = (isFav(a) ? 1 : 0) - (isFav(b) ? 1 : 0)
    else cmp = byName(a, b)
    if (cmp === 0 && sortKey !== 'name') cmp = byName(a, b)
    return sortDir === 'asc' ? cmp : -cmp
  })
  return arr
}

function itemFromStored(s) {
  let onAdd,
    onBrowse,
    name = s.name
  let modelThumb = null
  if (s.type === 'preset') {
    const id = s.key.slice(8)
    if (id.startsWith('cp:')) {
      const cp = (canvasPresets || []).find(p => 'cp:' + p.id === id)
      onAdd = cp ? () => loadCanvasPresetGraph(cp.graph) : () => showToast(t('asset.canvasPresetMissing'))
      name = cp ? cp.name : s.name || name
    } else {
      onAdd = () => loadPreset(id)
      name = presetName(id)
    }
  } else if (s.type === 'project') {
    const id = s.key.slice(8)
    onAdd = () => loadNodeProject(id)
  } else if (s.type === 'hdri') {
    onAdd = () => addNodeAt('hdr')
  } else if (s.type === 'official') {
    onAdd = () => {
      if (s.path) window.api.showInFolder(s.path)
    }
    onBrowse = () => openPackBrowser({ key: s.key, name: s.name, type: 'official', path: s.path, badge: s.badge })
  } else if (s.type === 'mc') {
    onAdd = () => {
      if (s.path) window.api.showInFolder(s.path)
    }
    onBrowse = () => openPackBrowser({ key: s.key, name: s.name, type: 'mc', path: s.path, badge: s.badge })
  } else if (s.type === 'craft') {
    onAdd = () => {
      if (s.path) window.api.showInFolder(s.path)
    }
    onBrowse = () => openPackBrowser({ key: s.key, name: s.name, type: 'craft', path: s.path, badge: s.badge })
  } else if (s.type === 'model') {
    const pm = parsePackModelPath(s.path)
    if (pm) {
      onAdd = () => viewMcModelAsset(pm.source, pm.packName, pm.rel, s.name)
      modelThumb = {
        kind: 'mc',
        api: packApiFor(pm.source),
        packName: pm.packName,
        rel: pm.rel,
        path: s.path,
        mtime: s.mtime || 0
      }
    } else {
      onAdd = () => {
        if (s.path) window.api.showInFolder(s.path)
      }
    }
  } else {
    const pp = parsePackTexPath(s.path)
    if (pp) {
      /* zip 包内贴图（虚拟路径）：经包媒体 raw 接口读取后添加 */
      onAdd = () => addPackTextureToCanvas({ type: pp.source }, { name: pp.packName }, { path: pp.rel, name: s.name })
    } else {
      onAdd = () => addTextureAt(s.path, s.name)
    }
  }
  return {
    key: s.key,
    name,
    thumb: s.thumb,
    type: s.type,
    path: s.path,
    craftPath: s.craftPath,
    locatePath: s.locatePath,
    mtime: s.mtime || 0,
    role: s.role,
    color: s.color,
    badge: s.badge,
    modelThumb,
    onAdd,
    onBrowse
  }
}

function storeFromItem(it) {
  const isModelThumb = it.type === 'model' && it.thumb && it.thumb.startsWith('/api/asset/model-thumb')
  return {
    key: it.key,
    name: it.name,
    thumb: isModelThumb ? null : it.thumb,
    type: it.type,
    path: it.path,
    mtime: it.mtime || 0,
    role: it.role,
    color: it.color,
    badge: it.badge
  }
}

/* 虚拟路径（pack:/packmodel:）经包列表解析出真实文件路径：<包根>/<包名>/<包内相对路径> */
function virtualToRealPath(p) {
  const pp = parsePackTexPath(p) || parsePackModelPath(p)
  if (!pp) return null
  const entries = pp.source === 'mc' ? mcEntries : pp.source === 'official' ? officialEntries : null
  const pack = (entries || []).find(e => e && e.name === pp.packName && e.fullPath)
  return pack ? pack.fullPath.replace(/[\\/]+$/, '') + '/' + pp.rel : null
}

/* 条目定位路径（含制作包条目）：locatePath（服务端已解析）→ craftPath 副本 →
 * modelFile → 磁盘绝对路径 → 包内虚拟路径经包列表解析；均无则 null（虚拟资产不可定位） */
function resolveLocatePath(item) {
  if (!item) return null
  if (item.locatePath) return item.locatePath
  if (item.craftPath) return item.craftPath
  if (item.modelFile) return item.modelFile
  const p = item.path
  if (typeof p !== 'string' || !p) return null
  if (p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)) return p
  return virtualToRealPath(p)
}

function isFav(item) {
  return favKeys.has(item.key)
}

function toggleFav(item) {
  if (!isValidAssetKey(item.key)) return
  if (isFav(item)) {
    favorites = favorites.filter(f => f.key !== item.key)
    showToast(t('asset.toastFavRemoved'))
  } else {
    favorites.unshift(storeFromItem(item))
    showToast(t('asset.toastFavAdded'))
  }
  persistFavorites()
  rebuild()
  refreshDetailFav()
}

function pushRecent(item) {
  if (!isValidAssetKey(item.key)) return
  recent = recent.filter(r => r.key !== item.key)
  recent.unshift(storeFromItem(item))
  if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT)
  persistRecent()
  if (categoryFilter === 'recent') rebuild()
}

function makeCard(item) {
  const card = el('div', 'asset-card')
  card.draggable = true
  card.dataset.name = item.name
  card.dataset.type = item.type
  card.dataset.key = item.key
  card.dataset.kind = contentKindOfPath(item.path) || ''
  const zh = zhOfItem(item)
  if (zh) card.dataset.zhName = zh
  const py = pinyinOfItem(item)
  if (py) card.dataset.pinyin = py

  const th = el('div', 'ac-thumb')
  const isModelThumbUrl = item.modelThumb && item.thumb && item.thumb.startsWith('/api/asset/model-thumb')
  const effectiveThumb = isModelThumbUrl ? null : item.thumb
  if (effectiveThumb) {
    const img = el('img')
    img.loading = 'lazy'
    img.alt = ''
    img.src = effectiveThumb
    img.addEventListener('error', () => {
      th.innerHTML = ''
      th.appendChild(el('span', 'ac-icon', '<svg class="ico"><use href="#i-image"/></svg>'))
    })
    th.appendChild(img)
  } else if (item.color && !item.icon) {
    th.style.background = `linear-gradient(135deg, ${item.color}, ${shade(item.color, -30)})`
    if (item.modelThumb) {
      th.classList.add('ac-thumb-3d')
      th._modelThumbItem = item
    }
  } else {
    if (item.color) th.style.background = `linear-gradient(135deg, ${item.color}, ${shade(item.color, -30)})`
    th.appendChild(el('span', 'ac-icon', `<svg class="ico"><use href="#${item.icon || 'i-image'}"/></svg>`))
    if (item.modelThumb) {
      th.classList.add('ac-thumb-3d')
      th._modelThumbItem = item
    }
  }
  card.appendChild(th)
  card.appendChild(el('div', 'ac-name', item.name))
  if (item.role) card.appendChild(el('div', 'ac-role ' + item.role, roleText(item.role)))
  else if (item.badge) card.appendChild(el('div', 'ac-role official', item.badge))

  const star = el('button', 'ac-star' + (isFav(item) ? ' on' : ''), isFav(item) ? '★' : '☆')
  star.title = isFav(item) ? t('asset.favOff') : t('asset.favOn')
  star.addEventListener('click', e => {
    e.stopPropagation()
    toggleFav(item)
  })
  card.appendChild(star)

  if (item.type === 'mc' && item.pack) {
    const ex = el('button', 'ac-star', '⬇')
    ex.title = '导出为 zip'
    ex.style.cssText =
      'position:absolute;top:4px;right:28px;font-size:13px;background:none;border:none;' +
      'color:var(--text,#e8e8e8);cursor:pointer;opacity:.7;padding:0 2px;'
    ex.addEventListener('click', e => {
      e.stopPropagation()
      exportMcPackZip(item)
    })
    card.appendChild(ex)
  }

  const add = () => {
    pushRecent(item)
    item.onAdd()
  }
  /* 可浏览（文件夹型）资产：单击延迟触发详情，双击直接进入包内容浏览 */
  let clickTimer = null
  card.addEventListener('click', () => {
    if (item.onBrowse) {
      if (clickTimer) clearTimeout(clickTimer)
      clickTimer = setTimeout(() => {
        clickTimer = null
        openDetail(item)
      }, BROWSE_CLICK_DELAY)
    } else {
      openDetail(item)
    }
  })
  card.addEventListener('dblclick', e => {
    if (!item.onBrowse) return
    e.preventDefault()
    if (clickTimer) {
      clearTimeout(clickTimer)
      clickTimer = null
    }
    item.onBrowse()
  })
  card.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', item.name)
    /* 贴图卡片：附带可加载的 raw URL，供 UV 编辑器等接收方拖放直接使用 */
    if (item.type === 'tex' && item.thumb)
      setTexDragData(e.dataTransfer, { name: item.name, url: item.thumb, path: item.path })
    e.dataTransfer.effectAllowed = 'copy'
    card.classList.add('dragging')
  })
  card.addEventListener('dragend', e => {
    card.classList.remove('dragging')
    if (droppedOnCanvas(e)) add()
  })
  card.addEventListener('contextmenu', e => {
    e.preventDefault()
    showCtxMenu(e, item)
  })
  return card
}

function droppedOnCanvas(e) {
  const c = document.getElementById('canvas-wrap')
  if (!c) return false
  const r = c.getBoundingClientRect()
  if (!(
    r.width > 0 &&
    r.height > 0 &&
    e.clientX >= r.left &&
    e.clientX <= r.right &&
    e.clientY >= r.top &&
    e.clientY <= r.bottom
  ))
    return false
  /* 已投放到 UV 编辑器画布（浮窗可能覆盖节点画布上方）→ 不再视为添加到节点画布 */
  for (const uv of document.querySelectorAll('.uvv-canvas-wrap')) {
    const u = uv.getBoundingClientRect()
    if (
      u.width > 0 &&
      u.height > 0 &&
      e.clientX >= u.left &&
      e.clientX <= u.right &&
      e.clientY >= u.top &&
      e.clientY <= u.bottom
    )
      return false
  }
  return true
}

function loadCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem('matoga:assetCollapsed')) || [])
  } catch {
    return new Set()
  }
}
function saveCollapsed(set) {
  try {
    localStorage.setItem('matoga:assetCollapsed', JSON.stringify([...set]))
  } catch {}
}
let collapsedSet = loadCollapsed()

/* 贴图子分组（文件夹/包类别）的折叠状态 */
function loadTexCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem('matoga:assetTexCollapsed')) || [])
  } catch {
    return new Set()
  }
}
function saveTexCollapsed(set) {
  try {
    localStorage.setItem('matoga:assetTexCollapsed', JSON.stringify([...set]))
  } catch {}
}
let texCollapsedSet = loadTexCollapsed()

/* 模型子分组（导入 / 自定义 / 包类别）的折叠状态 */
function loadModelCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem('matoga:assetModelCollapsed')) || [])
  } catch {
    return new Set()
  }
}
function saveModelCollapsed(set) {
  try {
    localStorage.setItem('matoga:assetModelCollapsed', JSON.stringify([...set]))
  } catch {}
}
let modelCollapsedSet = loadModelCollapsed()

function buildSection(catKey, title, items, errMsg, loading) {
  const sorted = sortItems(items)
  const count = sorted.length
  const sec = el('div', 'asset-lib-section')
  sec.dataset.cat = catKey
  if (collapsedSet.has(catKey)) sec.classList.add('collapsed')
  const head = el(
    'div',
    'asset-lib-section-head',
    `<span class="caret">▾</span><span>${title}</span><span class="cnt">${count}</span>`
  )
  head.addEventListener('click', () => {
    sec.classList.toggle('collapsed')
    if (sec.classList.contains('collapsed')) {
      collapsedSet.add(catKey)
      saveCollapsed(collapsedSet)
    } else {
      collapsedSet.delete(catKey)
      saveCollapsed(collapsedSet)
    }
  })
  sec.appendChild(head)
  const grid = el('div', 'asset-lib-grid')
  if (viewMode === 'list') grid.classList.add('list-view')
  if (loading && !count) {
    grid.appendChild(el('div', 'asset-lib-hint', t('asset.loading')))
  } else if (errMsg && !count) {
    grid.appendChild(el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg: errMsg })))
  } else if (!count) {
    return null
  } else {
    for (const it of sorted) grid.appendChild(makeCard(it))
  }
  sec.appendChild(grid)
  return sec
}

const CANVAS_PRESET_MAX_BYTES = 8 * 1024 * 1024 /* 后端 body 上限 12MB，留余量 */

async function loadCanvasPresets() {
  try {
    const cfg = await window.api.getConfig()
    canvasPresets = cfg && Array.isArray(cfg.canvasCustomPresets) ? cfg.canvasCustomPresets : []
  } catch {
    canvasPresets = []
  }
}

async function saveCanvasPresetAs() {
  let graph = null
  try {
    graph = serializeGraphData()
  } catch {
    graph = null
  }
  if (!graph || !Array.isArray(graph.nodes) || !graph.nodes.length) {
    showToast(t('asset.canvasPresetEmpty'))
    return
  }
  const name = await uiPrompt({ title: t('asset.canvasPresetSaveTitle'), label: t('asset.canvasPresetNamePrompt') })
  if (name === null) return
  const n = name.trim()
  if (!n) {
    showToast(t('asset.canvasPresetNameEmpty'))
    return
  }
  try {
    const cfg = await window.api.getConfig()
    const presets = cfg && Array.isArray(cfg.canvasCustomPresets) ? cfg.canvasCustomPresets : []
    presets.push({
      id: 'cp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: n,
      graph,
      createdAt: Date.now()
    })
    if (JSON.stringify(presets).length > CANVAS_PRESET_MAX_BYTES) {
      showToast(t('asset.canvasPresetTooLarge'))
      return
    }
    await window.api.setConfig({ canvasCustomPresets: presets })
    canvasPresets = presets
    showToast(t('asset.canvasPresetSaved'))
    rebuild()
  } catch (e) {
    showToast(t('asset.canvasPresetSaveFail') + ': ' + (e.message || e))
  }
}

async function deleteCanvasPreset(item) {
  if (!item.canvasPresetId) return
  if (
    !(await uiConfirm({
      title: t('asset.presetSection'),
      message: t('asset.canvasPresetDeleteConfirm', { name: item.name }),
      danger: true
    }))
  )
    return
  try {
    const cfg = await window.api.getConfig()
    const presets = (cfg && Array.isArray(cfg.canvasCustomPresets) ? cfg.canvasCustomPresets : []).filter(
      p => p.id !== item.canvasPresetId
    )
    await window.api.setConfig({ canvasCustomPresets: presets })
    canvasPresets = presets
    favorites = favorites.filter(f => f.key !== item.key)
    recent = recent.filter(r => r.key !== item.key)
    persistFavorites()
    persistRecent()
    showToast(t('asset.canvasPresetDeleted'))
    rebuild()
  } catch (e) {
    showToast(t('asset.canvasPresetDeleteFail') + ': ' + (e.message || e))
  }
}

function buildPresetSection() {
  const items = PRESETS.map(p => ({
    key: 'preset:' + p.id,
    name: presetName(p.id),
    color: p.color,
    type: 'preset',
    path: null,
    mtime: 0,
    role: 'preset',
    onAdd: () => loadPreset(p.id)
  }))
  for (const p of canvasPresets || []) {
    if (!p || !p.id || !p.graph) continue
    items.push({
      key: 'preset:cp:' + p.id,
      name: p.name,
      color: '#8ab4f8',
      type: 'preset',
      path: null,
      mtime: p.createdAt || 0,
      role: 'preset',
      canvasPresetId: p.id,
      onAdd: () => loadCanvasPresetGraph(p.graph)
    })
  }
  const sorted = sortItems(items)
  const sec = el('div', 'asset-lib-section')
  sec.dataset.cat = 'preset'
  if (collapsedSet.has('preset')) sec.classList.add('collapsed')
  const head = el(
    'div',
    'asset-lib-section-head',
    `<span class="caret">▾</span><span>${t('asset.presetSection')}</span><span class="cnt">${sorted.length}</span>`
  )
  head.addEventListener('click', () => {
    sec.classList.toggle('collapsed')
    if (sec.classList.contains('collapsed')) {
      collapsedSet.add('preset')
      saveCollapsed(collapsedSet)
    } else {
      collapsedSet.delete('preset')
      saveCollapsed(collapsedSet)
    }
  })
  sec.appendChild(head)

  const actions = el('div', 'asset-lib-sec-actions')
  const saveBtn = el('button', 'asset-lib-sec-btn', t('asset.canvasPresetSave'))
  saveBtn.title = t('asset.canvasPresetSaveTitle')
  saveBtn.addEventListener('click', e => {
    e.stopPropagation()
    saveCanvasPresetAs()
  })
  actions.appendChild(saveBtn)
  sec.appendChild(actions)

  const grid = el('div', 'asset-lib-grid')
  if (viewMode === 'list') grid.classList.add('list-view')
  for (const it of sorted) grid.appendChild(makeCard(it))
  sec.appendChild(grid)
  return sec
}

/* ── 材质贴图节：聚合左右目录 + MC 材质包 + 官方包全部贴图，按文件夹/包类别分组 ── */

/* ── 模型节：MC 材质包/官方包内 assets/<ns>/models/*.json，按来源/包类别/名称前缀分组 ── */

/* 在系统文件管理器中打开某类模型的专属本地目录（imported / custom） */
function openModelDir(kind) {
  const dir = modelDirs[kind]
  if (!dir) {
    showToast(t('asset.openLocalDirUnavailable'))
    return
  }
  window.api.openPath(dir).then(err => {
    if (err) showToast(t('asset.openLocalDirUnavailable'))
  })
}

/* MC 贴图引用 → 资产相对路径："minecraft:block/stone" → assets/minecraft/textures/block/stone.png
   与 mc-model-viewer.textureAssetPath 同语义（前端独立实现避免循环依赖） */
/* 从模型 JSON 收集所有贴图引用需要的资产路径（含 #别名解析） */
/* 按文件名匹配贴图到资产路径：文件名去扩展名 === 资产路径末段去扩展名 */
async function fileToDataUrl(f) {
  const buf = await f.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  return 'data:' + (f.type || 'image/png') + ';base64,' + btoa(bin)
}

async function uploadModelToLibrary() {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = '.json,.bbmodel,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff,.tif,.avif'
  input.onchange = async () => {
    const files = input.files ? Array.from(input.files) : []
    if (!files.length) return
    const modelFiles = files.filter(f => /\.(json|bbmodel)$/i.test(f.name))
    const texFiles = files.filter(f => !/\.(json|bbmodel)$/i.test(f.name))
    if (!modelFiles.length) {
      showToast(t('asset.toastModelUploadFail', { msg: t('asset.toastNoModelFile') }))
      return
    }
    try {
      let totalTex = 0
      for (const f of modelFiles) {
        const text = await f.text()
        const name = f.name.replace(/\.(json|bbmodel)$/i, '')
        const ext = /\.bbmodel$/i.test(f.name) ? 'bbmodel' : 'json'
        let textures = null
        if (texFiles.length && ext === 'json') {
          let json = null
          try {
            json = JSON.parse(text)
          } catch {}
          const needed = collectModelTexturePaths(json)
          if (needed.length) {
            const matched = matchTexturesToPaths(texFiles, needed)
            const keys = Object.keys(matched)
            if (keys.length) {
              textures = {}
              for (const p of keys) textures[p] = await fileToDataUrl(matched[p])
            }
          }
        }
        const r = await assetApiCall('POST', IMPORT_API, { name, data: text, ext, textures })
        totalTex += (r && r.texCount) || 0
        showToast(t('asset.toastModelImported', { name }))
      }
      if (totalTex) showToast(t('asset.toastTexturesImported', { count: totalTex }))
      await refreshAssetLibrary()
    } catch (e) {
      showToast(t('asset.toastModelUploadFail', { msg: e.message || '' }))
    }
  }
  input.click()
}

/* 删除用户模型（导入模型 / 自定义模型）：确认后调用 DELETE，清理收藏与最近记录并刷新 */
async function deleteUserModel(item) {
  const d = item.modelDelete
  if (!d || !d.id) return
  if (
    !(await uiConfirm({
      title: t('asset.modelSection'),
      message: t('asset.modelDeleteConfirm', { name: item.name }),
      danger: true
    }))
  )
    return
  try {
    await assetApiCall('DELETE', d.api + '/' + encodeURIComponent(d.id))
    favorites = favorites.filter(f => f.key !== item.key)
    recent = recent.filter(r => r.key !== item.key)
    persistFavorites()
    persistRecent()
    showToast(t('asset.toastModelDeleted', { name: item.name }))
    if (detailCurrent === item) hideDetail()
    await refreshAssetLibrary()
  } catch (e) {
    showToast(t('asset.toastModelDeleteFail', { msg: e.message || '' }))
  }
}

function buildHdriSection() {
  const items = (hdriEntries || []).map(e => ({
    key: 'hdri:' + e.fullPath,
    name: e.name,
    thumb: hdriThumbUrl(e.fullPath),
    type: 'hdri',
    path: e.fullPath,
    mtime: e.mtime || 0,
    role: 'preset',
    onAdd: () => addNodeAt('hdr')
  }))
  return buildSection('hdri', t('asset.hdriSection'), items, loadErrors.hdri, hdriEntries === null)
}

function buildMcSection() {
  /* mc-packs 下每个资源包是一个「包媒体」：整包卡片储存，双击打开浏览包内贴图 */
  const items = (mcEntries || []).map(p => {
    const it = {
      key: 'mc:' + p.fullPath,
      name: p.name,
      thumb: p.firstTexture ? mcRawUrl(p.name, p.firstTexture) : null,
      type: 'mc',
      path: p.fullPath,
      mtime: p.mtime || 0,
      badge: officialBadge(p),
      pack: p,
      onAdd: () => {
        if (p.fullPath) window.api.showInFolder(p.fullPath)
      }
    }
    it.onBrowse = () => openPackBrowser(it)
    return it
  })
  const sorted = sortItems(items)
  const sec = el('div', 'asset-lib-section')
  sec.dataset.cat = 'mc'
  if (collapsedSet.has('mc')) sec.classList.add('collapsed')
  const head = el(
    'div',
    'asset-lib-section-head',
    `<span class="caret">▾</span><span>${t('asset.mcSection')}</span><span class="cnt">${sorted.length}</span>`
  )
  head.addEventListener('click', () => {
    sec.classList.toggle('collapsed')
    if (sec.classList.contains('collapsed')) {
      collapsedSet.add('mc')
      saveCollapsed(collapsedSet)
    } else {
      collapsedSet.delete('mc')
      saveCollapsed(collapsedSet)
    }
  })
  const importBtn = el('button', 'asset-lib-section-action', '+ 导入')
  importBtn.title = '导入资源包'
  importBtn.style.cssText =
    'margin-left:auto;background:none;border:1px solid var(--border,#333);' +
    'border-radius:5px;padding:1px 8px;font-size:11px;cursor:pointer;color:var(--text,#e8e8e8);'
  importBtn.addEventListener('click', async ev => {
    ev.stopPropagation()
    await openImportPackDialog({
      onImported: async () => {
        await loadMc()
        rebuild()
      }
    })
  })
  head.appendChild(importBtn)
  const createBtn = el('button', 'asset-lib-section-action', '+ 创建')
  createBtn.title = '创建材质包'
  createBtn.style.cssText =
    'margin-left:6px;background:none;border:1px solid var(--border,#333);' +
    'border-radius:5px;padding:1px 8px;font-size:11px;cursor:pointer;color:var(--text,#e8e8e8);'
  createBtn.addEventListener('click', async ev => {
    ev.stopPropagation()
    await openCreatePackDialog({
      onCreated: async () => {
        await loadMc()
        rebuild()
      }
    })
  })
  head.appendChild(createBtn)
  const batchBtn = el('button', 'asset-lib-section-action', '⬇ 批量导出')
  batchBtn.title = '批量导出为 zip'
  batchBtn.style.cssText =
    'margin-left:6px;background:none;border:1px solid var(--border,#333);' +
    'border-radius:5px;padding:1px 8px;font-size:11px;cursor:pointer;color:var(--text,#e8e8e8);'
  batchBtn.addEventListener('click', async ev => {
    ev.stopPropagation()
    await exportMcPacksBatch()
  })
  head.appendChild(batchBtn)
  sec.appendChild(head)

  const grid = el('div', 'asset-lib-grid')
  if (viewMode === 'list') grid.classList.add('list-view')
  if (mcEntries === null) {
    grid.appendChild(el('div', 'asset-lib-hint', t('asset.loading')))
  } else if (loadErrors.mc) {
    grid.appendChild(el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg: loadErrors.mc })))
  } else if (!sorted.length) {
    grid.appendChild(el('div', 'asset-lib-hint', t('asset.mcEmpty')))
  } else {
    for (const it of sorted) grid.appendChild(makeCard(it))
  }
  sec.appendChild(grid)
  return sec
}

/* ── MC 官方材质包（pack.mcmeta 版本分析 / 包内贴图浏览 / 重命名）──── */

function officialRawUrl(packName, relPath) {
  return packRawUrl(MC_OFFICIAL_API, packName, relPath)
}

function mcRawUrl(packName, relPath) {
  return packRawUrl(MC_PACKS_API, packName, relPath)
}

function packRawUrl(apiBase, packName, relPath) {
  return apiUrl(apiBase + '/' + encodeURIComponent(packName) + '/raw?path=' + encodeURIComponent(relPath))
}

async function addPackTextureToCanvas(item, pack, tex) {
  try {
    const res = await fetch(packRawUrl(packApiFor(item.type), pack.name, tex.path))
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const blob = await res.blob()
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result)
      fr.onerror = () => reject(new Error('read blob failed'))
      fr.readAsDataURL(blob)
    })
    addTextureAt(dataUrl, tex.name)
    showToast(t('asset.toastTexAdded', { name: tex.name }))
  } catch (e) {
    showToast(t('asset.toastTexAddFail') + ': ' + e.message)
  }
}

function officialBadge(p) {
  if (!p || !p.valid) return null
  if (p.formatRange) return p.formatRange
  if (p.format != null) return 'pack_format ' + p.format
  return null
}

function officialSuggestName(p) {
  const range = (p && p.formatRange) || ''
  if (range)
    return range
      .replace(/\s*–\s*/g, '-')
      .replace(/\s+-\s+/g, '-')
      .trim()
  if (p && p.format != null) return 'pack_format-' + p.format
  return (p && p.name) || ''
}

function buildOfficialSection() {
  const items = (officialEntries || []).map(p => {
    const it = {
      key: 'official:' + p.fullPath,
      name: p.name,
      thumb: p.firstTexture ? officialRawUrl(p.name, p.firstTexture) : null,
      type: 'official',
      path: p.fullPath,
      mtime: p.mtime || 0,
      badge: officialBadge(p),
      pack: p,
      onAdd: () => {
        if (p.fullPath) window.api.showInFolder(p.fullPath)
      }
    }
    it.onBrowse = () => openPackBrowser(it)
    return it
  })
  const sorted = sortItems(items)
  const sec = el('div', 'asset-lib-section')
  sec.dataset.cat = 'official'
  if (collapsedSet.has('official')) sec.classList.add('collapsed')
  const head = el(
    'div',
    'asset-lib-section-head',
    `<span class="caret">▾</span><span>${t('asset.officialSection')}</span><span class="cnt">${sorted.length}</span>`
  )
  head.addEventListener('click', () => {
    sec.classList.toggle('collapsed')
    if (sec.classList.contains('collapsed')) {
      collapsedSet.add('official')
      saveCollapsed(collapsedSet)
    } else {
      collapsedSet.delete('official')
      saveCollapsed(collapsedSet)
    }
  })
  sec.appendChild(head)

  const grid = el('div', 'asset-lib-grid')
  if (viewMode === 'list') grid.classList.add('list-view')
  if (officialEntries === null) {
    grid.appendChild(el('div', 'asset-lib-hint', t('asset.loading')))
  } else if (loadErrors.official) {
    grid.appendChild(el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg: loadErrors.official })))
  } else if (!sorted.length) {
    grid.appendChild(el('div', 'asset-lib-hint', t('asset.officialEmpty')))
  } else {
    for (const it of sorted) grid.appendChild(makeCard(it))
  }
  sec.appendChild(grid)
  return sec
}

async function loadOfficial() {
  try {
    const data = await assetApiCall('GET', MC_OFFICIAL_API + '/list')
    officialEntries = (data && data.packs) || []
    loadErrors.official = null
  } catch (e) {
    loadErrors.official = e.message || '未知错误'
    if (officialEntries === null) officialEntries = []
  }
}

async function refreshOfficialQuiet() {
  await loadOfficial()
  rebuild()
}

async function renameOfficialAsset(item, byVersion) {
  const p = item.pack || {}
  const def = byVersion ? officialSuggestName(p) || item.name : item.name
  const name = await uiPrompt({
    title: t('asset.officialRenamePrompt'),
    label: t('asset.officialNamePrompt'),
    value: def
  })
  if (name === null) return
  const n = name.trim()
  if (!n || n === item.name) return
  const oldKey = item.key
  const oldPath = item.path
  try {
    const data = await assetApiCall('PUT', MC_OFFICIAL_API + '/rename', { from: item.name, to: n })
    const newKey = 'official:' + (data && data.to ? data.to : oldPath)
    const newBadge = byVersion ? officialSuggestName(p) || item.badge : item.badge
    favorites.forEach(f => {
      if (f.key === oldKey) {
        f.key = newKey
        f.name = n
        f.path = (data && data.to) || f.path
        f.badge = newBadge
      }
    })
    recent.forEach(r => {
      if (r.key === oldKey) {
        r.key = newKey
        r.name = n
        r.path = (data && data.to) || r.path
        r.badge = newBadge
      }
    })
    persistFavorites()
    persistRecent()
    showToast(t('asset.toastOfficialRenamed'))
    refreshOfficialQuiet()
  } catch (e) {
    showToast(t('asset.toastOfficialRenameFail') + ': ' + e.message)
  }
}

/* ── 包内容浏览（文件管理器式，在总资产库面板内切换视图） ──── */

/* 包浏览中的模型文件判定：assets/<ns>/models/** 下的 .json */
async function loadProjects() {
  try {
    const data = await assetApiCall('GET', PROJECTS_API)
    projectEntries = (data && data.projects) || []
    loadErrors.project = null
  } catch (e) {
    loadErrors.project = e.message || '未知错误'
    if (projectEntries === null) projectEntries = []
  }
}

function projectThumbUrl(id) {
  return apiUrl(PROJECTS_API + '/' + encodeURIComponent(id) + '/thumb')
}

async function refreshProjectsQuiet() {
  await loadProjects()
  rebuild()
}

async function saveProjectAs() {
  const name = await uiPrompt({ title: t('asset.projectSaveTitle'), label: t('asset.projectNamePrompt') })
  if (name === null) return
  const n = name.trim()
  if (!n) {
    showToast(t('asset.projectNameEmpty'))
    return
  }
  try {
    await saveNodeProject(n)
    showToast(t('asset.toastProjectSaved'))
    refreshProjectsQuiet()
  } catch (e) {
    showToast(t('asset.toastProjectSaveFail') + ': ' + e.message)
  }
}

async function updateProjectWithCanvas(p) {
  if (
    !(await uiConfirm({ title: t('asset.projectSection'), message: t('asset.projectUpdateConfirm', { name: p.name }) }))
  )
    return
  try {
    await saveNodeProject(p.name, p.id)
    showToast(t('asset.toastProjectSaved'))
    refreshProjectsQuiet()
  } catch (e) {
    showToast(t('asset.toastProjectSaveFail') + ': ' + e.message)
  }
}

async function deleteProjectAsset(p) {
  if (
    !(await uiConfirm({
      title: t('asset.projectSection'),
      message: t('asset.projectDeleteConfirm', { name: p.name }),
      danger: true
    }))
  )
    return
  try {
    await assetApiCall('DELETE', PROJECTS_API + '/' + encodeURIComponent(p.id))
    showToast(t('asset.toastProjectDeleted'))
    favorites = favorites.filter(f => f.key !== 'project:' + p.id)
    recent = recent.filter(r => r.key !== 'project:' + p.id)
    persistFavorites()
    persistRecent()
    try {
      await assetApiCall('DELETE', '/api/craft-pack/items/' + encodeURIComponent('project:' + p.id))
    } catch {}

    refreshProjectsQuiet()
  } catch (e) {
    showToast(t('asset.toastProjectDeleteFail') + ': ' + e.message)
  }
}

async function renameProjectAsset(p) {
  const name = await uiPrompt({
    title: t('asset.projectRenamePrompt'),
    label: t('asset.projectNamePrompt'),
    value: p.name
  })
  if (name === null) return
  const n = name.trim()
  if (!n || n === p.name) return
  try {
    await assetApiCall('PUT', PROJECTS_API + '/' + encodeURIComponent(p.id) + '/rename', { name: n })
    favorites.forEach(f => {
      if (f.key === 'project:' + p.id) f.name = n
    })
    recent.forEach(r => {
      if (r.key === 'project:' + p.id) r.name = n
    })
    persistFavorites()
    persistRecent()
    showToast(t('asset.toastProjectRenamed'))
    refreshProjectsQuiet()
  } catch (e) {
    showToast(t('asset.toastProjectRenameFail') + ': ' + e.message)
  }
}

function buildProjectSection() {
  const items = (projectEntries || []).map(p => ({
    key: 'project:' + p.id,
    name: p.name,
    thumb: projectThumbUrl(p.id),
    type: 'project',
    path: p.dir || null,
    mtime: p.updatedAt || 0,
    role: 'project',
    id: p.id,
    nodeCount: p.nodeCount || 0,
    textureCount: p.textureCount || 0,
    onAdd: () => loadNodeProject(p.id).catch(e => showToast(t('asset.toastProjectLoadFail') + ': ' + e.message))
  }))
  const sorted = sortItems(items)
  const sec = el('div', 'asset-lib-section')
  sec.dataset.cat = 'project'
  if (collapsedSet.has('project')) sec.classList.add('collapsed')
  const head = el(
    'div',
    'asset-lib-section-head',
    `<span class="caret">▾</span><span>${t('asset.projectSection')}</span><span class="cnt">${sorted.length}</span>`
  )
  head.addEventListener('click', () => {
    sec.classList.toggle('collapsed')
    if (sec.classList.contains('collapsed')) {
      collapsedSet.add('project')
      saveCollapsed(collapsedSet)
    } else {
      collapsedSet.delete('project')
      saveCollapsed(collapsedSet)
    }
  })
  sec.appendChild(head)

  const actions = el('div', 'asset-lib-sec-actions')
  const saveBtn = el('button', 'asset-lib-sec-btn', t('asset.projectSave'))
  saveBtn.title = t('asset.projectSaveTitle')
  saveBtn.addEventListener('click', e => {
    e.stopPropagation()
    saveProjectAs()
  })
  actions.appendChild(saveBtn)
  sec.appendChild(actions)

  const grid = el('div', 'asset-lib-grid')
  if (viewMode === 'list') grid.classList.add('list-view')
  if (projectEntries === null) {
    grid.appendChild(el('div', 'asset-lib-hint', t('asset.loading')))
  } else if (loadErrors.project) {
    grid.appendChild(el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg: loadErrors.project })))
  } else if (!sorted.length) {
    grid.appendChild(el('div', 'asset-lib-hint', t('asset.projectEmpty')))
  } else {
    for (const it of sorted) grid.appendChild(makeCard(it))
  }
  sec.appendChild(grid)
  return sec
}

function buildFavSection() {
  if (!favorites.length) return null
  return buildSection('fav', t('asset.favSection'), favorites.map(itemFromStored), null, false)
}

function buildRecentSection() {
  if (!recent.length) return null
  return buildSection('recent', t('asset.recentSection'), recent.map(itemFromStored), null, false)
}

function rebuild() {
  const body = document.getElementById('assetLibraryBody')
  if (!body) return
  if (browse) return /* 包内容浏览模式独占列表区 */
  const scrollTop = body.scrollTop
  body.innerHTML = ''
  const sections = [
    buildFavSection(),
    buildRecentSection(),
    buildProjectSection(),
    buildPresetSection(),
    buildTexSection(),
    buildModelSection(),
    buildHdriSection(),
    buildMcSection(),
    buildOfficialSection()
  ].filter(Boolean)
  for (const s of sections) body.appendChild(s)
  body.scrollTop = scrollTop
  observeModelThumbs(body)
  applyFilter()
}

async function deleteMcPack(item) {
  const name = item.pack && item.pack.name
  if (!name) return
  if (!(await uiConfirm({ title: 'MC 资源包', message: '确定删除「' + name + '」？此操作不可撤销。', danger: true })))
    return
  try {
    await assetApiCall('DELETE', MC_PACKS_API + '/' + encodeURIComponent(name))
    favorites = favorites.filter(f => f.key !== item.key)
    recent = recent.filter(r => r.key !== item.key)
    persistFavorites()
    persistRecent()
    showToast('已删除：' + name)
    if (detailCurrent === item) hideDetail()
    await loadMc()
    rebuild()
  } catch (e) {
    showToast('删除失败：' + (e.message || e))
  }
}

async function exportMcPackZip(item) {
  const name = item.pack && item.pack.name
  if (!name) return
  const r = await openExportDialog({ packs: [{ name }], isBatch: false })
  if (!r) return
  await doDownloadZip(
    MC_PACKS_API + '/' + encodeURIComponent(name) + '/export',
    { skipPackPng: r.skipPackPng, noCompress: r.noCompress },
    '正在导出「' + name + '」…',
    '已导出：'
  )
}

async function exportMcPacksBatch() {
  const packs = (mcEntries || []).filter(p => p && p.name).map(p => ({ name: p.name }))
  if (!packs.length) {
    showToast('没有可导出的资源包')
    return
  }
  const r = await openExportDialog({ packs, isBatch: true })
  if (!r) return
  await doDownloadZip(
    MC_PACKS_API + '/export-batch',
    { names: r.names, skipPackPng: r.skipPackPng, noCompress: r.noCompress },
    '正在导出 ' + r.names.length + ' 个资源包…',
    '已导出（' + r.names.length + ' 个包）：'
  )
}

function showCtxMenu(e, item) {
  hideCtxMenu()
  ctxMenu = el('div', 'asset-ctx-menu')
  const opts = []
  /* 定位：craftPath 副本失效时回退源路径/包内虚拟路径解析（服务端 locatePath 优先） */
  const locatePath = resolveLocatePath(item)
  if (locatePath) {
    opts.push({ label: t('asset.ctxLocate'), fn: () => window.api.showInFolder(locatePath) })
    opts.push({ label: t('asset.ctxCopyPath'), fn: () => copyText(locatePath) })
  }
  opts.push({ label: t('asset.ctxCopyName'), fn: () => copyText(item.name) })
  opts.push({ label: isFav(item) ? t('asset.ctxUnfav') : t('asset.ctxFav'), fn: () => toggleFav(item) })

  if (item.type === 'model') {
    opts.push({
      label: t('asset.detailViewViewport'),
      fn: () => {
        pushRecent(item)
        item.onAdd && item.onAdd()
      }
    })
    if (item.modelDelete) {
      opts.push({ label: t('asset.ctxDeleteModel'), fn: () => deleteUserModel(item) })
    }
  } else {
    opts.push({
      label: t('asset.ctxSendCanvas'),
      fn: () => {
        pushRecent(item)
        item.onAdd()
      }
    })
  }
  if (item.type === 'project') {
    opts.push({ label: t('asset.ctxUpdateProject'), fn: () => updateProjectWithCanvas(item) })
    opts.push({ label: t('asset.ctxRenameProject'), fn: () => renameProjectAsset(item) })
    opts.push({ label: t('asset.ctxDeleteProject'), fn: () => deleteProjectAsset(item) })
  }
  if (item.type === 'preset' && item.canvasPresetId) {
    opts.push({ label: t('asset.ctxDeleteCanvasPreset'), fn: () => deleteCanvasPreset(item) })
  }
  if (item.type === 'official' && item.pack) {
    opts.push({ label: t('asset.ctxRenameOfficial'), fn: () => renameOfficialAsset(item, false) })
    if (officialSuggestName(item.pack)) {
      opts.push({ label: t('asset.ctxRenameByVersion'), fn: () => renameOfficialAsset(item, true) })
    }
  }
  if (item.type === 'mc' && item.pack) {
    opts.push({ label: '导出为 zip', fn: () => exportMcPackZip(item) })
    opts.push({ label: '删除', fn: () => deleteMcPack(item) })
  }
  for (const it of opts) {
    const mi = el('div', 'asset-ctx-item', it.label)
    mi.addEventListener('click', () => {
      hideCtxMenu()
      it.fn()
    })
    ctxMenu.appendChild(mi)
  }
  document.body.appendChild(ctxMenu)
  ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px'
  ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - 160) + 'px'
}

function hideCtxMenu() {
  if (ctxMenu) {
    ctxMenu.remove()
    ctxMenu = null
  }
}

async function copyText(s) {
  try {
    await navigator.clipboard.writeText(s)
    showToast(t('asset.toastCopied'))
  } catch {
    showToast(t('asset.toastCopyFail'))
  }
}

async function loadHdri() {
  try {
    const data = await assetApiCall('GET', '/api/hdri/list')
    /* /api/hdri/list 的 data 本身就是数组（{ok:true,data:[...]}）。
       兼容旧的 {entries:[...]} 形状，避免 hdriEntries 为 undefined 后 .map 抛错。 */
    hdriEntries = Array.isArray(data) ? data : ((data && data.entries) || [])
    loadErrors.hdri = null
  } catch (e) {
    loadErrors.hdri = e.message || '未知错误'
    if (hdriEntries === null) hdriEntries = []
  }
}

async function loadMc() {
  try {
    const data = await assetApiCall('GET', MC_PACKS_API + '/list')
    mcEntries = (data && data.packs) || []
    loadErrors.mc = null
  } catch (e) {
    loadErrors.mc = e.message || '未知错误'
    if (mcEntries === null) mcEntries = []
  }
}

/* 总资产库贴图聚合：MC 材质包 + 官方包全部贴图（按包/类别分组） */
async function loadTexPacks() {
  try {
    await loadZhNames()
    const data = await assetApiCall('GET', '/api/asset/tex')
    texPacks = (data && data.packs) || []
    loadErrors.tex = null
  } catch (e) {
    loadErrors.tex = e.message || '未知错误'
    if (texPacks === null) texPacks = []
  }
}

/* 总资产库模型聚合：包内 .json 模型（/api/asset/model）+ 导入模型 + 自定义模型 */
async function loadModelAssets() {
  try {
    await loadZhNames()
    const data = await assetApiCall('GET', '/api/asset/model')
    modelPacks = (data && data.packs) || []
    loadErrors.model = null
  } catch (e) {
    loadErrors.model = e.message || '未知错误'
    if (modelPacks === null) modelPacks = []
  }
  try {
    const data = await assetApiCall('GET', IMPORT_API)
    importedModels = (data && data.models) || []
  } catch {
    importedModels = []
  }
  try {
    const data = await assetApiCall('GET', '/api/custom-models')
    customModels = (data && data.models) || []
  } catch {
    customModels = []
  }
  try {
    const loc = await assetApiCall('GET', IMPORT_API + '/location')
    modelDirs.imported = (loc && loc.dir) || ''
  } catch {
    modelDirs.imported = ''
  }
  try {
    const loc = await assetApiCall('GET', '/api/custom-models/location')
    modelDirs.custom = (loc && loc.dir) || ''
  } catch {
    modelDirs.custom = ''
  }
}

export async function refreshAssetLibrary() {
  await Promise.all([
    loadHdri(),
    loadMc(),
    loadOfficial(),
    loadProjects(),
    loadTexPacks(),
    loadModelAssets(),
    loadCanvasPresets()
  ])
  rebuild()
}

/* 模型详情元信息：MC .json 模型（parent / 贴图引用 / 元素数） */
/* 模型详情元信息：.bbmodel（格式 / 分辨率 / 元素与贴图数） */
/* 卡片点击入口：模型详情需先拉取 JSON 元信息（parent / 贴图引用等），其余直接展示 */
let _initialized = false
export function initAssetLibrary() {
  if (_initialized) return
  _initialized = true
  const search = document.getElementById('assetLibSearch')
  const searchClear = document.getElementById('assetLibSearchClear')
  if (search) {
    const runSearch = () => {
      searchTerm = search.value
      if (searchClear) searchClear.classList.toggle('is-hidden', !search.value)
      applyFilter()
    }
    let timer
    search.addEventListener('input', () => {
      clearTimeout(timer)
      timer = setTimeout(runSearch, 180)
    })
    search.addEventListener('keydown', e => {
      if (e.key === 'Escape' && search.value) {
        search.value = ''
        runSearch()
      }
    })
    if (searchClear)
      searchClear.addEventListener('click', () => {
        search.value = ''
        runSearch()
        search.focus()
      })
  }
  buildToolbar()
  const refreshBtn = document.getElementById('assetLibRefresh')
  if (refreshBtn)
    refreshBtn.addEventListener('click', () => {
      if (browse) renderBrowse()
      else refreshAssetLibrary()
    })
  document.addEventListener('custom-model:created', () => {
    refreshAssetLibrary()
  })
  document.addEventListener('click', hideCtxMenu)
  document.addEventListener('contextmenu', e => {
    if (!e.target.closest('.asset-card')) hideCtxMenu()
  })
  document.addEventListener('keydown', e => {
    if (!browse || e.key !== 'Backspace') return
    const ae = document.activeElement
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable))
      return
    e.preventDefault()
    browseUp()
  })
  document.addEventListener('nodeproject:saved', () => {
    refreshProjectsQuiet()
  })
  onLocaleChange(() => {
    buildToolbar()
    if (browse) {
      renderBrowse()
      return
    }
    rebuild()
    if (detailCurrent) openDetail(detailCurrent)
  })
  lastTexSig = sigEntries()
  rebuild()
  loadAssetStore()
  refreshAssetLibrary()
  startPoll()
}


/* AssetBrowse 依赖注入 */
setAssetBrowseHooks({
  packRawUrl: packRawUrl,
  packApiFor: packApiFor,
  rebuild: rebuild,
  el: el,
  officialBadge: officialBadge,
  pushRecent: pushRecent,
  viewMcModelAsset: viewMcModelAsset,
  addPackTextureToCanvas: addPackTextureToCanvas,
  assetApiCall: assetApiCall,
  get_MC_OFFICIAL_API: () => MC_OFFICIAL_API,
  get_MODEL_DIR_PATH_RE: () => MODEL_DIR_PATH_RE,
  get_MODEL_JSON_RE: () => MODEL_JSON_RE,
  get_mcEntries: () => mcEntries,
  get_officialEntries: () => officialEntries,
  get_browse: () => browse,
  set_browse: v => { browse = v },
  get_browseSeq: () => browseSeq,
  set_browseSeq: v => { browseSeq = v }
})

/* AssetCollect 依赖注入 */
setAssetCollectHooks({
  isImg: isImg,
  thumbUrl: thumbUrl,
  classifyByRole: classifyByRole,
  packTexThumbUrl: packTexThumbUrl,
  addPackTextureToCanvas: addPackTextureToCanvas,
  el: el,
  sortItems: sortItems,
  makeCard: makeCard,
  applyFilter: applyFilter,
  saveTexCollapsed: saveTexCollapsed,
  saveCollapsed: saveCollapsed,
  openModelDir: openModelDir,
  userModelFilePath: userModelFilePath,
  viewImportedModelAsset: viewImportedModelAsset,
  packApiFor: packApiFor,
  viewMcModelAsset: viewMcModelAsset,
  uploadModelToLibrary: uploadModelToLibrary,
  refreshAssetLibrary: refreshAssetLibrary,
  saveModelCollapsed: saveModelCollapsed,
  get_collapsedSet: () => collapsedSet,
  get_TEX_GROUP_PAGE: () => TEX_GROUP_PAGE,
  get_texCollapsedSet: () => texCollapsedSet,
  get_loadErrors: () => loadErrors,
  get_importedModels: () => importedModels,
  get_modelDirs: () => modelDirs,
  get_IMPORT_API: () => IMPORT_API,
  get_customModels: () => customModels,
  get_CUSTOM_API: () => CUSTOM_API,
  get_MODEL_JSON_RE: () => MODEL_JSON_RE,
  get_modelCollapsedSet: () => modelCollapsedSet,
  get_texPacks: () => texPacks,
  set_texPacks: v => { texPacks = v },
  get_viewMode: () => viewMode,
  set_viewMode: v => { viewMode = v },
  get_modelPacks: () => modelPacks,
  set_modelPacks: v => { modelPacks = v }
})

/* AssetToolbar 依赖注入 */
setAssetToolbarHooks({
  el: el,
  categoryLabel: categoryLabel,
  rebuild: rebuild,
  get_browse: () => browse,
  get_searchTerm: () => searchTerm,
  get_QUICK_CATS: () => QUICK_CATS,
  get_SECTION_CATS: () => SECTION_CATS,
  get_recent: () => recent,
  get_contentKindFilter: () => contentKindFilter,
  set_contentKindFilter: v => { contentKindFilter = v },
  get_categoryFilter: () => categoryFilter,
  set_categoryFilter: v => { categoryFilter = v },
  get_pollTimer: () => pollTimer,
  set_pollTimer: v => { pollTimer = v },
  get_lastTexSig: () => lastTexSig,
  set_lastTexSig: v => { lastTexSig = v },
  get_sortKey: () => sortKey,
  set_sortKey: v => { sortKey = v },
  get_sortDir: () => sortDir,
  set_sortDir: v => { sortDir = v },
  get_viewMode: () => viewMode,
  set_viewMode: v => { viewMode = v }
})

/* AssetDetail 依赖注入 */
setAssetDetailHooks({
  parsePackModelPath: parsePackModelPath,
  packRawUrl: packRawUrl,
  packApiFor: packApiFor,
  assetApiCall: assetApiCall,
  isVirtualAssetPath: isVirtualAssetPath,
  resolveLocatePath: resolveLocatePath,
  roleText: roleText,
  shade: shade,
  isFav: isFav,
  pushRecent: pushRecent,
  toggleFav: toggleFav,
  copyText: copyText,
  deleteUserModel: deleteUserModel,
  renameOfficialAsset: renameOfficialAsset,
  addPackTextureToCanvas: addPackTextureToCanvas,
  get_IMPORT_API: () => IMPORT_API,
  get_detailCurrent: () => detailCurrent,
  set_detailCurrent: v => { detailCurrent = v }
})
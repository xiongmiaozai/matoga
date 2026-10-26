/**
 * matoga - 总资产库：常量与纯路径/角色工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，逻辑未改。此处只放不依赖面板运行时状态的
 * 常量、API 前缀、角色识别正则、zip 包内虚拟路径解析与各类 URL 构造。
 */
import { IMG_EXTS } from '../core.js'
import { apiUrl, fileUrl } from '../utils.js'
import { t } from '../i18n.js'

export const PRESETS = [
  { id: 'metal',     color: '#c8c8d0' },
  { id: 'plastic',   color: '#e0e0e0' },
  { id: 'glass',     color: '#e0eef5' },
  { id: 'fabric',    color: '#b39880' },
  { id: 'emissive',  color: '#fff3c0' },
]

export const ALL_TYPES = ['tex', 'model', 'hdri', 'mc', 'official', 'preset', 'project', 'craft']
/* 分区级分类（.asset-lib-section 的 data-cat）：选中「全部」时展示的常规分区 */
export const SECTION_CATS = ['tex', 'model', 'hdri', 'mc', 'official', 'preset', 'project']
/* 快捷视图分区：内容为其它分区的副本，仅在选中对应标签时展示（搜索时也不重复展示） */
export const QUICK_CATS = new Set(['fav', 'recent'])
export const MAX_RECENT = 50
export const HDRI_EXTS = new Set(['hdr', 'exr'])
export const TEX_GROUP_PAGE = 400
export const PROJECTS_API = '/api/node-projects'
export const MC_OFFICIAL_API = '/api/mc-official'
export const MC_PACKS_API = '/api/mc-packs'
export const CRAFT_PACKS_API = '/api/craft-packs'

export const IMPORT_API = '/api/imported-models'
export const CUSTOM_API = '/api/custom-models'
export const MODEL_JSON_RE = /\.json$/i
/* 包浏览中的模型文件：assets/<ns>/models/**（旧格式）或 assets/<ns>/items/*.json（1.21.4+ 物品定义） */
export const MODEL_DIR_PATH_RE = /^assets\/[^/]+\/(models|items)\//

/* 包媒体 API 前缀：mc 资源包与官方材质包共用同一套包浏览/读取接口 */
export function packApiFor(type) {
  if (type === 'mc') return MC_PACKS_API
  if (type === 'craft') return CRAFT_PACKS_API
  return MC_OFFICIAL_API
}

export const ROLE_PATTERNS_STRONG = [
  { role: 'normal',    re: /(?:_|-|^)(normal|nrm|nor|nmap|normalmap|tangent)(?=\.|_|-|$)/i },
  { role: 'specular',  re: /(?:_|-|^)(specular|spec|spc|smap|specmap|roughness|rough|metalness|metal|metallic|reflect|f0)(?=\.|_|-|$)/i },
  { role: 'height',    re: /(?:_|-|^)(height|hmap|heightmap|displacement|disp|bump|depth)(?=\.|_|-|$)/i },
  { role: 'emissive',  re: /(?:_|-|^)(emissive|emis|emit|glow|illum|light)(?=\.|_|-|$)/i },
  { role: 'ao',        re: /(?:_|-|^)(ao|occlusion|sss|subsurface)(?=\.|_|-|$)/i },
  { role: 'opacity',   re: /(?:_|-|^)(opacity|alpha|mask|transparency)(?=\.|_|-|$)/i },
  { role: 'main',      re: /(?:_|-|^)(diffuse|diff|albedo|base|color|col|main|texture|tex)(?=\.|_|-|$)/i },
]

export const ROLE_PATTERNS_WEAK = [
  { role: 'normal',    re: /(?:_|-)n(?=\.|_|-|$)/i },
  { role: 'specular',  re: /(?:_|-)s(?=\.|_|-|$)/i },
  { role: 'height',    re: /(?:_|-)h(?=\.|_|-|$)/i },
  { role: 'emissive',  re: /(?:_|-)e(?=\.|_|-|$)/i },
  { role: 'main',      re: /(?:_|-)(?:d|c)(?=\.|_|-|$)/i },
]

export const TYPE_LABEL_KEYS = {
  tex: 'asset.catTex', model: 'asset.catModel', hdri: 'asset.catHdri', mc: 'asset.catMc', official: 'asset.catOfficial', preset: 'asset.catPreset', project: 'asset.catProject', craft: 'asset.catCraft',
}

export function detectTypeFromPath(p) {
  if (!p || typeof p !== 'string') return null
  const ext = (p.split('.').pop() || '').toLowerCase()
  if (HDRI_EXTS.has(ext)) return 'hdri'
  if (IMG_EXTS.has(ext)) return 'tex'
  return null
}

export function classifyByRole(name) {
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

export function isValidAssetKey(key) {
  if (typeof key !== 'string' || !key) return false
  const idx = key.indexOf(':')
  if (idx <= 0) return false
  return ALL_TYPES.includes(key.slice(0, idx))
}

export function categoryLabel(type) {
  const k = TYPE_LABEL_KEYS[type]
  return k ? t(k) : type
}

export function presetName(id) {
  return t('m3d.preset' + id.charAt(0).toUpperCase() + id.slice(1))
}

export function roleText(role) {
  const keys = { preset: 'asset.rolePreset', main: 'asset.roleMain', normal: 'asset.roleNormal', specular: 'asset.roleSpecular', height: 'asset.roleHeight', emissive: 'asset.roleEmissive', ao: 'asset.roleAo', opacity: 'asset.roleOpacity', project: 'asset.roleProject', model: 'asset.roleModel' }
  return keys[role] ? t(keys[role]) : role
}

export function isImg(e) { return e && !e.isDirectory && IMG_EXTS.has((e.name.split('.').pop() || '').toLowerCase()) }
export function thumbUrl(p) { return fileUrl(p) }
export function hdriThumbUrl(p) { return '/api/hdri/thumb?path=' + encodeURIComponent(p) }

/* zip 包内贴图的虚拟路径：pack:<source>:<packName>/<包内相对路径>（无磁盘绝对路径，
   thumb / 添加到画布走对应包媒体 raw 接口） */
export function parsePackTexPath(p) {
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

export function packTexThumbUrl(source, packName, rel) {
  return packRawUrl(packApiFor(source), packName, rel)
}

/* zip 包内模型的虚拟路径：packmodel:<source>:<packName>/<包内相对路径>（与贴图 pack: 前缀区分） */
export function parsePackModelPath(p) {
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
export function isVirtualAssetPath(item) {
  if (!item || typeof item.path !== 'string' || !item.path) return false
  if (parsePackTexPath(item.path)) return true
  if (parsePackModelPath(item.path)) return true
  if (item.path.startsWith('bb:')) return true
  if (item.path.startsWith('im:')) return true
  if (item.path.startsWith('cm:')) return true
  return false
}

/* 用户模型（im/cm/bb）在磁盘上的模型文件绝对路径：<模型根目录>/<id>/model.<ext> */
export function userModelFilePath(dir, m) {
  if (!dir || !m || !m.id || !m.file) return null
  return dir.replace(/[\\/]+$/, '') + '/' + m.id + '/' + m.file
}

export function packRawUrl(apiBase, packName, relPath) {
  return apiUrl(apiBase + '/' + encodeURIComponent(packName) + '/raw?path=' + encodeURIComponent(relPath))
}

export function officialRawUrl(packName, relPath) {
  return packRawUrl(MC_OFFICIAL_API, packName, relPath)
}

export function mcRawUrl(packName, relPath) {
  return packRawUrl(MC_PACKS_API, packName, relPath)
}


/**
 * matoga - MC 模型 3D 视口渲染器
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 解析两类模型并构建 THREE.Group，经 material3d 的自定义模型通道在 3D 视口展示：
 *  1. MC 资源包内 .json 模型：沿 parent 继承链合并（子覆盖父），elements 盒体 +
 *     faces UV（0-16 像素坐标 / 16 → 0-1），贴图从包媒体 raw 接口加载；
 *     无 elements 的 item/generated 类模型回退为竖直 sprite 平面（layer0）。
 *     1.21.4+ 物品模型定义（assets/<ns>/items/*.json）：解析引用树（model / condition /
 *     select / range_dispatch / composite / special）取默认状态模型，composite 多模型
 *     合并渲染并应用 transformation（平移/旋转/缩放，单位：块）。
 *  2. Blockbench .bbmodel：Cube 元素（欧拉角 rotation）+ 内嵌 base64 贴图。
 * 贴图按 NearestFilter 像素风渲染，cutout 透明（alphaTest），共享缓存避免重复加载。
 * 动画贴图（<name>.png.mcmeta）：竖长条 PNG 逐帧采样（map.repeat 缩至单帧区域、
 * map.offset 按帧号平移，采样窗口 half-texel inset 避开帧边界渗色，rAF 循环按
 * wall-clock 驱动），而非把多帧整图压扁到面上。
 *
 * 同时产出 UV 贴图布局（lastLayout / getLastModelLayout）：贴图列表 + 每元素每面的
 * UV 像素矩形 / 旋转 / 镜像标记，供 UV 贴图视图浮动窗口（uv-view.js）叠加展示。
 */

import * as THREE from 'three'
import {
  showCustomModel,
  showCustomModelPair,
  hasVisibleViewport,
  applyPbrMapsToModelMaterial,
  setModelEmptyHint,
  makeMaterial
} from './material3d.js'
import { t as _t } from './i18n.js'
import { fileUrl, apiUrl, joinPath } from './url-utils.js'
import { defaultFaceUv, resolveItemDefRefs, MAX_ITEM_DEF_DEPTH } from './mcv/geometry.js'
import { rawUrl, texCacheKey, fetchJson, fetchOkData, parentModelPath, setHooks as setMcvPathsHooks } from './mcv/paths.js'
import { applyItemTransformation, getOfficialPack, parseAnimMeta, animFrameIndexAt, setHooks as setMcvGeoToolsHooks } from './mcv/geo-tools.js'
import { clamp01, colormapRel, loadColormapData, sampleColormap, resolveTintColor, infer2dTintType, sampleTintForTexture, textureAssetPath, loadTextureCached, setHooks as setTexToolsHooks } from './mcv/tex-tools.js'
import { packRelToMcRef, texUrlToRef, resolveMcModelRaw, borrowTemplateTextures, parseUv, applyFaceUvs, setHooks as setTexRefToolsHooks } from './mcv/tex-ref-tools.js'
import { isSpecialTexPath, texPathForRef, writeMcTexRef, resolveTextureRef, expandTextureAliases, resolveMcModel, isItemDefPath, texturesHasConcreteRef, hasUnresolvedTexRefs, shulkerBoxEntityTexRef, resolveMcModelAsset, setHooks as setAssetResolveHooks } from './mcv/asset-resolve.js'
/* 门面 re-export（§2.3） */
export { isSpecialTexPath, texPathForRef, writeMcTexRef, resolveTextureRef, expandTextureAliases, resolveMcModel, isItemDefPath, texturesHasConcreteRef, hasUnresolvedTexRefs, shulkerBoxEntityTexRef, resolveMcModelAsset } from './mcv/asset-resolve.js'
/* 门面 re-export（§2.3） */
export { packRelToMcRef, texUrlToRef, resolveMcModelRaw, borrowTemplateTextures, parseUv, applyFaceUvs } from './mcv/tex-ref-tools.js'
/* 门面 re-export（§2.3） */
export { clamp01, colormapRel, loadColormapData, sampleColormap, resolveTintColor, infer2dTintType, sampleTintForTexture, textureAssetPath, loadTextureCached } from './mcv/tex-tools.js'
/* 门面 re-export（文档 §2.3） */
export { applyItemTransformation, getOfficialPack, parseAnimMeta, animFrameIndexAt } from './mcv/geo-tools.js'
/* 门面 re-export：这些函数原为本地 export，搬走后仍须从本文件对外可见 */
export { rawUrl, texCacheKey, fetchJson, fetchOkData, parentModelPath } from './mcv/paths.js'

/* 门面 re-export：这两个函数原为本地导出，搬到 mcv/geometry.js 后仍须从本模块
   对外可见，否则外部 import 拿到 undefined（曾导致 5 个单测失败）。 */
export { defaultFaceUv, resolveItemDefRefs } from './mcv/geometry.js'

const MAX_PARENT_DEPTH = 8
const MAX_ELEMENTS = 4096
const MAX_ITEM_DEF_REFS = 16
/* 跨模型共享材质：userData.shared 标记（material3d dispose 时跳过，避免重复 dispose 后渲染失效） */
const HIDDEN_MAT = new THREE.MeshBasicMaterial({ visible: false })
HIDDEN_MAT.userData.shared = true
const PLACEHOLDER_MAT = new THREE.MeshStandardMaterial({ color: 0x9a9aa8, roughness: 0.9 })
PLACEHOLDER_MAT.userData.shared = true

/* BoxGeometry 材质索引顺序（+x,-x,+y,-y,+z,-z）↔ MC 面名 */
const FACE_KEYS = ['east', 'west', 'up', 'down', 'south', 'north']
const MAT_INDEX = { east: 0, west: 1, up: 2, down: 3, south: 4, north: 5 }

const texCache = new Map() /* key → Promise<Texture|null> */
const modelJsonCache = new Map() /* url → Promise<json>（parent 链公共基类不重复 fetch） */

/* ── 生物群系染色（tintindex / tints）──────────────────────
   MC 草方块/草丛/叶子等面标记 tintindex，渲染时用 colormap（grass.png /
   foliage.png，256×256，横轴 temperature 纵轴 downfall）采样一个颜色，
   与灰度基底贴图逐像素相乘（MeshPhysicalMaterial.color × map）。
   1.21.4+ items/*.json 用 tints 数组显式声明染色类型与参数；方块模型仅标记
   tintindex，类型按贴图名启发式推断（leaves/vine/lily → foliage，余 → grass）。
   constant 类型为固定颜色（value 低 24 位 RGB）。 */
const BIOMES = [
  { id: 'plains', temperature: 0.5, downfall: 0.4 },
  { id: 'forest', temperature: 0.7, downfall: 0.8 },
  { id: 'dark_forest', temperature: 0.7, downfall: 0.8 },
  { id: 'jungle', temperature: 0.95, downfall: 0.9 },
  { id: 'desert', temperature: 2.0, downfall: 0.0 },
  { id: 'savanna', temperature: 1.2, downfall: 0.0 },
  { id: 'swamp', temperature: 0.8, downfall: 0.9 },
  { id: 'taiga', temperature: 0.25, downfall: 0.8 },
  { id: 'snowy', temperature: 0.0, downfall: 0.5 },
  { id: 'mushroom', temperature: 0.9, downfall: 1.0 },
  { id: 'beach', temperature: 0.5, downfall: 0.4 },
  { id: 'badlands', temperature: 2.0, downfall: 0.0 }
]
let currentBiome = BIOMES[0]
const colormapCache = new Map() /* key → Promise<ImageData|null> */

/* tintindex + tints（item 定义）→ 染色颜色；texPath 用于无 tints 时启发式推断类型 */
export function getMcBiomes() {
  return BIOMES
}
export function getCurrentBiome() {
  return currentBiome
}
export function setCurrentBiome(id) {
  const b = BIOMES.find(x => x.id === id)
  if (b) currentBiome = b
}

/* 2D 贴图预览染色：按贴图名推断 tint 类型（无 tintindex 信息，用白名单）。
    grass → grass colormap，foliage → foliage colormap；constant → 固定色（水/熔岩）；
    返回 null 表示不染色。
    bamboo_* 优先匹配 grass（bamboo 叶用草色），避免落到 _leaves → foliage */
const CONSTANT_TINTS = {
  water_still: [0x3f, 0x76, 0xe4],
  water_flow: [0x3f, 0x76, 0xe4],
  lava_still: [0xfe, 0xa1, 0x00],
  lava_flow: [0xfe, 0xa1, 0x00]
}
/* 供 2D 贴图预览复用：贴图绝对路径 → 当前生物群系下的染色颜色 {r,g,b} 0-1 或 null。
    constant 类型直接返回固定色；grass/foliage 从路径中 assets/minecraft/textures/
    前缀推断资源包根，加载 colormap 并采样 */
/* 最近一次成功展示的模型 UV 布局（uv-view 浮窗数据源） */
let lastLayout = null
let lastLayoutPair = null /* 左右对比布局 { left, right }，仅 pair 路径设置；单模型为 null */
let lastRenderFn = null /* 供生物群系切换后重渲染（单模型/对比） */


/* 资源 raw URL 构造：包模式走 /api/pack/<name>/raw?path=<rel>（any=1 放行 .mcmeta 等扩展）；
    文件根模式（对比结果等任意文件夹）走 /api/file/raw?path=<join(root,rel)>（file 接口直接读任意路径，无需 any）；
    扩展引用（data:/file:/URL）直接可加载，原样返回 */
/* 贴图缓存键：包模式与文件根模式命名空间隔离，避免对比场景与包场景贴图混缓存 */
/* parent 引用 → 包内模型路径："minecraft:block/cube" / "block/cube" → assets/minecraft/models/block/cube.json */
/* 贴图引用 → 包内贴图路径："minecraft:block/stone" → assets/minecraft/textures/block/stone.png；
    引用已带图片扩展名（社区包写法）不再追加，防 stone.png.png */
const TEX_REF_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i

/* matoga 扩展贴图引用（模型 textures 表值直接可加载，跳过命名空间解析）：
    data:<dataURL> 内嵌 / file:<绝对磁盘路径> / 站内 URL（/api/...） / 外部 http(s) URL。
    UV 编辑器替换的任意来源贴图以此形式持久化到模型 JSON，重新打开自动加载 */
const SPECIAL_TEX_RE = /^(data:|file:|https?:\/\/|\/)/i

/* 引用值 → 贴图路径（扩展引用原样；标准引用走命名空间解析） */
/* 包内贴图路径 → 标准 MC 引用（assets/<ns>/textures/<rest>.png → <ns>:<rest>） */
/* 替换贴图 URL → 模型贴图引用（智能引用）：
    '' → 移除；dataURL → data: 内嵌；外部 http(s) → 原样；
    站内 file raw URL → file:<磁盘路径>；站内包 raw URL → 模型包上下文
    （ctx = { api, packName }，可缺省）匹配时转标准 MC 引用（保持 MC 兼容），
    跨包保留站内 URL（重新打开可直接加载） */
/* 模型 textures 表贴图引用写回：解析命中 oldTexPath 的键改写为 newRef。
    直接持有该路径的键（含 #互引链命中）统一改写到新值；oldTexPath = '' 匹配被移除的空键 */
/* #引用键未定义时的方向别名回退（社区模型常见断链：faces 引用 #up/#north 而
   textures 表内仅有 top/bottom 等非标键，或反向命名）。仅补原本解析失败
   （灰色占位 / UV 面跳过）的场景，已定义键不受影响；防环 guard 贯穿回退链 */
const TEX_REF_FALLBACK = {
  north: ['side', 'all'],
  south: ['side', 'all'],
  east: ['side', 'all'],
  west: ['side', 'all'],
  side: ['all'],
  all: ['side'],
  up: ['top', 'all'],
  top: ['up', 'all'],
  down: ['bottom', 'all'],
  bottom: ['down', 'all']
}

/* 解析 "#side" 引用链（textures 表内互引，防环）到最终贴图路径 */
/* 旧版/社区包的贴图别名展开（vanilla Deserializer 行为）：
   all → 六方向，side → 四水平方向（putIfAbsent 语义；保留原键以便 "#all" 引用仍可解析） */
/* ── 内置 vanilla 基础模型（parent 断链兜底）────────────────
    普通资源包不含 vanilla 基类文件（block/cube 等），模型 parent 链指向它们时
    fetch 404 → 旧实现静默吞掉 → elements/textures 丢失 → 空模型或贴图全灰。
    兜底：fetch 失败时按包内相对路径查此表继续解析（包内存在同路径文件时优先包内
    覆盖版本）；textures 键与 vanilla 一致，配合 expandTextureAliases 展开工作。
    未收录的衍生基类（cube_column 等）断链时仍按原行为跳过。 */
const BUILTIN_PARENT_MODELS = {
  'assets/minecraft/models/block/cube.json': {
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: {
          down: { texture: '#down' },
          up: { texture: '#up' },
          north: { texture: '#north' },
          south: { texture: '#south' },
          west: { texture: '#west' },
          east: { texture: '#east' }
        }
      }
    ]
  },
  'assets/minecraft/models/block/cube_all.json': {
    parent: 'minecraft:block/cube',
    textures: { all: '#all' }
  },
  'assets/minecraft/models/block/cube_bottom_top.json': {
    parent: 'minecraft:block/cube',
    textures: { down: '#end', up: '#end', side: '#side' }
  },
  'assets/minecraft/models/block/block.json': {},
  'assets/minecraft/models/item/generated.json': {},
  'assets/minecraft/models/item/handheld.json': { parent: 'minecraft:item/generated' },
  'assets/minecraft/models/item/template_shulker_box.json': {}
}

/* fetch 模型 JSON 并沿 parent 链合并：elements 取最近定义层，textures 子覆盖父。
    包内不存在时回退内置 vanilla 基类（普通资源包不含基类文件）。
    合并在原始 textures 表上进行（子键覆盖父键，all/side 别名不参与中间合并），
    最外层解析完成后统一展开一次——若逐层先展开再合并，子层的 side 展开键
    （north/south/east/west）会错误覆盖父层的显式方向键（command_block 的
    north=#front / south=#back 被覆盖成 #side → front/back 贴图丢失）。 */
/* ── 1.21.4+ 物品模型定义（assets/<ns>/items/*.json）────────
   结构：{ model: <节点> }，节点按 type 递归解析出要渲染的普通模型引用：
     model          → 引用 models/ 路径（可带 transformation / tints）
     condition      → 取 on_false（属性默认未满足态，如弓未拉弦）
     select / range_dispatch → 取 fallback
     composite      → 收集 models 数组全部引用（多模型合并渲染）
     special        → base 引用（盾/旗等内置实体渲染之外的基础形状）
   未知类型忽略；tints（染色）不影响几何，跳过 */
/* item 定义路径判定（assets/<ns>/items/*.json，与 models/ 路径区分） */
/* 模板模型文件名判定（template_*）：vanilla 约定模板自身不定义 textures，由子模型注入 */
export function isTemplateModelName(rel) {
  if (typeof rel !== 'string') return false
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  return name.startsWith('template_')
}

/* textures 表是否含至少一个具体贴图引用（非空、非 # 变量引用）。
   全为 # 变量引用或空表 → false：此类模型（template_*、coral_fan、coral_wall_fan 等
   父模板）自身无法解析出贴图，需借用子模型 textures 才能预览 */
/* elements 中是否存在 textures 表未定义的 #变量 引用（混合模板场景）。
   flower_pot_cross 等模板既有具体引用（flowerpot/dirt）又有未定义变量引用（plant）：
   texturesHasConcreteRef 误判为已就绪 → plant 面灰色占位。此处检测 elements 各面
   引用的 #key 是否在 textures 表中有对应键，缺键 → true，需借用子模型 textures 补全 */
/* 模板模型（template_* 及 coral_fan/coral_wall_fan 等无具体贴图的父模板）直接预览时
   textures 全空或仅含 # 变量引用 → 所有面回退灰色占位。借用同级目录下引用该模板为
   parent 的子模型的 textures，让模板也能显示真实贴图。包模式走 entries 接口列目录，
   fileRoot 模式走 /api/compare/scan 非递归列目录；最多探测 60 个候选 .json，
   命中首个含贴图的子模型即止 */
/* shulker_box 内嵌渲染器贴图引用 → 实体贴图引用：
   minecraft:shulker_yellow → minecraft:entity/shulker/shulker_yellow */
/* 统一模型资产解析入口：rel 为 models/ 路径或 items/ 定义路径。
    返回 { parts: [{ elements, textures, transform }] }（多 parts 仅出现在 composite）；
    模型文件不存在 / 非法 → parts 空（shown:false 语义） */
/* 判定 parts 是否为"空模型"：模型文件存在且合法，但所有 part 既无 elements 也无 textures
   （如 air / structure_void / barrier 等空方块）。用于在视口叠加友好提示而非留白。
   parts 为空数组（文件不存在/非法）不算空模型，返回 false */
export function isPartsEmptyModel(parts) {
  if (!Array.isArray(parts) || !parts.length) return false
  return parts.every(
    p => p && Array.isArray(p.elements) && !p.elements.length && (!p.textures || !Object.keys(p.textures).length)
  )
}

/* item 定义 transformation（块单位）应用到子模型 Group：
   顶点变换 T + L*(S*(R*v))——外层 position/quaternion 承载 T/L，scale 承载 S，
   right_rotation 非单位四元数时经内层 Group 承载 R（保持与 vanilla 组合顺序一致）。
   负 scale（镜像）翻转三角绕序，材质置 DoubleSide 防背面剔除消失 */
function parseVec3(v, fallback) {
  if (Array.isArray(v) && v.length >= 3 && v.every(n => Number.isFinite(+n))) return [+v[0], +v[1], +v[2]]
  if (typeof v === 'string') {
    const a = v.split(',').map(s => +s.trim())
    if (a.length >= 3 && a.every(n => Number.isFinite(n))) return a.slice(0, 3)
  }
  return fallback
}

/* face.rotation（0/90/180/270，顺时针）：几何四角 [TL,TR,BL,BR] 的采样角随之轮转
   （贴图顺时针转 90° 后，原 BL 像素显示在几何 TL 位置：TL←BL, TR←TL, BL←BR, BR←TR） */
const FACE_ROT_ORDER = {
  90: [2, 0, 3, 1],
  180: [3, 2, 1, 0],
  270: [1, 3, 0, 2]
}

/* vanilla 默认 UV（face 无 uv 字段时按元素 from/to 尺寸计算，v 自顶向下）：
   水平面 u 取 x 范围、v 取 z 范围（down 垂直翻转）；侧面 v 取 y 范围（16-to.y → 16-from.y）；
   north/east 面贴图相对世界坐标水平翻转（观察方向所致）。
   例：蛋糕主体 [1,0,1]→[15,8,15]：up→[1,1,15,15]（cake_top 中央 14×14），
   side→u 1-15 / v 8-16（cake_side 下半），而非整张 16×16 拉伸。
   uvScale≠16（bbmodel resolution）时按比例换算 */
/* BoxGeometry 每面 4 顶点 UV（左上/右上/左下/右下）按 MC 像素坐标重映射（uvScale=16 或 bbmodel resolution）
   无 uv 的 face 用 vanilla 默认 UV（按元素尺寸），防止整张贴图拉伸 */
/* element 变换：MC 单轴旋转 / bbmodel 欧拉旋转均绕 origin，几何中心置于元素中心 */
function applyElementTransform(mesh, el, center) {
  const c = [(center[0] - 8) / 16, (center[1] - 8) / 16, (center[2] - 8) / 16]
  const rot = el.rotation
  if (!rot) {
    mesh.position.set(c[0], c[1], c[2])
    return
  }
  const origin = parseVec3(Array.isArray(rot) ? el.origin : rot.origin, [8, 8, 8]).map(v => (v - 8) / 16)
  if (Array.isArray(rot)) {
    mesh.rotation.set(
      ((+rot[0] || 0) * Math.PI) / 180,
      ((+rot[1] || 0) * Math.PI) / 180,
      ((+rot[2] || 0) * Math.PI) / 180
    )
  } else if (rot.axis === 'x' || rot.axis === 'y' || rot.axis === 'z') {
    mesh.rotation[rot.axis] = ((+rot.angle || 0) * Math.PI) / 180
  } else {
    mesh.position.set(c[0], c[1], c[2])
    return
  }
  /* position = origin + R(center - origin) */
  const off = new THREE.Vector3(c[0] - origin[0], c[1] - origin[1], c[2] - origin[2])
  off.applyEuler(mesh.rotation)
  mesh.position.set(origin[0] + off.x, origin[1] + off.y, origin[2] + off.z)
}

/* faces "all" 简写展开（bbmodel / 社区模型）：复制到未定义的方向面（不改原对象） */
function expandElementFaces(el) {
  let faces = el && el.faces && typeof el.faces === 'object' ? el.faces : {}
  if (faces.all && typeof faces.all === 'object') {
    faces = { ...faces }
    for (const k of FACE_KEYS) if (!faces[k]) faces[k] = faces.all
  }
  return faces
}

/* 通用构建：elements（MC 或 bbmodel Cube）→ THREE.Group
    matFor(faceKey, faceDef, el) 返回该面材质（null/undefined → 隐藏面） */
export function buildModelGroup(elements, matFor, uvScale = 16) {
  const group = new THREE.Group()
  const scale = uvScale || 16
  const list = (Array.isArray(elements) ? elements : []).slice(0, MAX_ELEMENTS)
  for (const el of list) {
    if (!el || typeof el !== 'object') continue
    const from = parseVec3(el.from, [0, 0, 0])
    const to = parseVec3(el.to, [16, 16, 16])
    const sx = Math.abs(to[0] - from[0]) || 0.01,
      sy = Math.abs(to[1] - from[1]) || 0.01,
      sz = Math.abs(to[2] - from[2]) || 0.01
    const geo = new THREE.BoxGeometry(sx / 16, sy / 16, sz / 16)
    const faces = expandElementFaces(el)
    applyFaceUvs(geo, faces, scale, from, to)
    const mats = FACE_KEYS.map(key => {
      const m = matFor(key, faces[key], el)
      return m || HIDDEN_MAT
    })
    const mesh = new THREE.Mesh(geo, mats)
    mesh.castShadow = true
    mesh.receiveShadow = true
    /* 原始 element 引用（编辑联动：uv-view 编辑 UV 后按引用定位 mesh 重映射几何 UV） */
    mesh.userData.mcElement = el
    mesh.userData.uvScale = scale
    applyElementTransform(mesh, el, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2])
    group.add(mesh)
  }
  return group
}

/* MC 贴图像素风参数（同步/异步两条赋值路径共用） */
function applyTexParams(tex) {
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

function makeModelMaterial(tex, withParallax = false) {
  const m = withParallax
    ? makeMaterial()
    : new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.0, alphaTest: 0.5 })
  if (withParallax) {
    m.roughness = 0.9
    m.metalness = 0.0
    m.alphaTest = 0.5
  }
  if (tex) m.map = applyTexParams(tex)
  return m
}

/* 官方材质包缓存（懒加载）：贴图加载失败时回退到 official-packs 加载 vanilla 贴图。
   资源包常仅含自定义模型/贴图，引用的 vanilla 贴图不在包内 → 灰色占位；
   回退到 official-packs 加载原版贴图，避免 shulker_box 等方块预览无贴图 */
let officialPackCache = null
let officialPackLoading = null
/* 贴图加载 + official-packs vanilla 回退：包内贴图缺失时尝试 official-packs 同路径贴图。
   返回 { tex, anim } 或 null。仅对标准 MC 贴图路径生效（扩展引用 data:/file:/URL 不回退） */
async function loadTexWithOfficialFallback(texPath, api, packName, fileRoot) {
  const ck = texCacheKey(api, packName, texPath, fileRoot)
  const url = rawUrl(api, packName, texPath, fileRoot, false)
  const metaPromise = loadAnimMetaCached(ck + ':mcmeta', packMcmetaUrl(api, packName, texPath, fileRoot))
  let tex = await loadTextureCached(ck, url)
  if (tex) return { tex, metaPromise }
  if (isSpecialTexPath(texPath)) return null
  const official = await getOfficialPack()
  if (!official) return null
  const fbCk = texCacheKey(official.api, official.packName, texPath, undefined)
  const fbUrl = rawUrl(official.api, official.packName, texPath, undefined, false)
  const fbTex = await loadTextureCached(fbCk, fbUrl)
  if (!fbTex) return null
  return {
    tex: fbTex,
    metaPromise: loadAnimMetaCached(
      fbCk + ':mcmeta',
      packMcmetaUrl(official.api, official.packName, texPath, undefined)
    )
  }
}

/* ── 动画贴图（.png.mcmeta）──────────────────────
   MC 动画贴图：竖长条 PNG（帧竖向堆叠，帧数 = 高/帧高），同目录 <name>.png.mcmeta：
     { animation: { frametime, interpolate, width, height, frames } }
   - frametime：每帧 tick 数（默认 1，20 tick/s）
   - frames：自定义帧序（帧号或 { index, time }；缺省 0..N-1 循环）
   - width / height：帧尺寸（缺省 width=贴图宽、height=width）
   采样：map.repeat 缩至单帧区域、map.offset.y 平移到当前帧（帧 0 在贴图顶部，
   THREE v 轴向上故 offset = 1-(i+1)·ry）；interpolate 帧间渐变以离散切换近似
   （双采样混合需自定义 shader，从简）。注册表 + rAF 循环按 wall-clock 驱动。 */

const TICKS_PER_SEC = 20

/* mcmeta JSON → 动画定义（非法 / 单帧 → null）；timeline 为 [{ index, ticks }]（ticks ≥ 1 整数） */
/* 播放时刻（秒）→ 帧号：帧边界均为整数 tick，换算到 tick 域比较（避免浮点累积误差），循环播放 */
/* 贴图采样矩阵 → 指定帧（几何 UV 已归一化 [0,1]；越界 clamp）。
    half-texel inset：采样窗口自帧边界内收半像素（texel 域 [i·fh+0.5, (i+1)·fh-0.5]），
    NearestFilter 取整后仍覆盖帧内全部行/列（视觉无损失），但窗口永不触碰帧边界——
    否则边界精确压在 texel 分界上，光栅化插值的浮点误差叠加 RepeatWrapping 会把
    相邻帧的边缘行采进来（帧数非 2 的幂时 offset 本身就有 float 表示误差），
    渲染为面边缘的水平/垂直渗色线 */
export function applyTexAnimFrame(tex, anim, frameIndex) {
  if (!tex || !anim || !tex.repeat || !tex.offset) return tex
  const i = Math.min(Math.max(Math.round(+frameIndex || 0), 0), anim.frameCount - 1)
  const rx = anim.frameW / anim.texW
  const ry = anim.frameH / anim.texH
  const ex = 0.5 / anim.texW
  const ey = 0.5 / anim.texH
  tex.repeat.set(rx - 2 * ex, ry - 2 * ey)
  tex.offset.set(ex, 1 - (i + 1) * ry + ey)
  return tex
}

/* mcmeta 原始 JSON 缓存（404 / 解析失败 → null 一并缓存：非动画贴图不反复探测） */
const animMetaCache = new Map() /* key → Promise<object|null> */

function loadAnimMetaCached(key, url) {
  if (!animMetaCache.has(key))
    animMetaCache.set(
      key,
      fetchJson(url).catch(() => null)
    )
  return animMetaCache.get(key)
}

/* 动画贴图注册表 + rAF 驱动循环（注册表空时停转；无 rAF 环境（node 单测）安全跳过） */
const animatedTexs = new Map() /* THREE.Texture → anim */
let animRAF = 0

function scheduleAnimTick() {
  if (animRAF || typeof requestAnimationFrame !== 'function') return
  animRAF = requestAnimationFrame(() => {
    animRAF = 0
    if (!animatedTexs.size) return
    const now =
      typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
    for (const [tex, anim] of animatedTexs) applyTexAnimFrame(tex, anim, animFrameIndexAt(anim, now / 1000))
    scheduleAnimTick()
  })
}

function texImageSize(tex) {
  const img = tex && tex.image
  if (!img) return null
  const w = +img.naturalWidth || +img.width || 0
  const h = +img.naturalHeight || +img.height || 0
  return w > 0 && h > 0 ? { w, h } : null
}

/* 收集 group 内动画贴图的 { tex, anim }（去重；离屏缩略图多帧渲染用：
    逐帧 applyTexAnimFrame + animFrameIndexAt 驱动采样窗口） */
export function getModelTexAnims(group) {
  const out = []
  if (!group || typeof group.traverse !== 'function') return out
  group.traverse(o => {
    if (!o || !o.isMesh) return
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    for (const m of mats) {
      if (!m || !m.map || !animatedTexs.has(m.map)) continue
      if (out.some(e => e.tex === m.map)) continue
      out.push({ tex: m.map, anim: animatedTexs.get(m.map) })
    }
  })
  return out
}

/* 贴图加载完成后：按 mcmeta 配置动画采样（首帧 + 注册驱动循环）；非动画仅设像素风参数。
   metaPromise 由调用方与贴图加载并行发起（此处只做解析与应用），返回 anim | null */
function attachPackTexture(tex, metaPromise) {
  if (!tex) return Promise.resolve(null)
  const size = texImageSize(tex)
  if (!size) {
    applyTexParams(tex)
    return Promise.resolve(null)
  }
  return metaPromise
    .then(meta => {
      applyTexParams(tex)
      const anim = parseAnimMeta(meta, size.w, size.h)
      if (!anim) return null
      applyTexAnimFrame(tex, anim, 0)
      animatedTexs.set(tex, anim)
      scheduleAnimTick()
      return anim
    })
    .catch(() => {
      applyTexParams(tex)
      return null
    })
}

/* 仅配置动画采样（不修改 filter/wrap，由调用方预先设置）；用于非包通道（如左右对比预览）
    复用本模块 animatedTexs 注册表与 rAF 循环；metaPromise 解析为 mcmeta JSON 或 null。
    返回 anim | null（终态 resolve）。贴图需已设好 RepeatWrapping（applyTexAnimFrame 用 repeat/offset） */
export function attachTextureAnimOnly(tex, metaPromise) {
  if (!tex) return Promise.resolve(null)
  const size = texImageSize(tex)
  if (!size) return Promise.resolve(null)
  return Promise.resolve(metaPromise)
    .then(meta => {
      const anim = parseAnimMeta(meta, size.w, size.h)
      if (!anim) return null
      applyTexAnimFrame(tex, anim, 0)
      animatedTexs.set(tex, anim)
      scheduleAnimTick()
      return anim
    })
    .catch(() => null)
}

/* 从动画注册表移除贴图（贴图 dispose / 替换前调用，避免 rAF 操作已释放贴图） */
export function unloadTextureAnim(tex) {
  if (tex && animatedTexs.has(tex)) animatedTexs.delete(tex)
}

/* 贴图同目录动画元数据 URL（raw 接口 any=1 放行 .mcmeta 扩展名）；扩展引用无动画元数据 */
function packMcmetaUrl(api, packName, texPath, fileRoot) {
  if (isSpecialTexPath(texPath)) return null
  return rawUrl(api, packName, texPath + '.mcmeta', fileRoot, true)
}

/* MC 面材质：faces[key].texture（"#ref" / "ns:path"）→ 包内贴图；引用缺失用占位材质。
    贴图异步加载完成后写入 mat.map（mcmeta 请求与贴图并行，动画贴图先配好帧采样再挂载）；
    失败置 mat.userData.texFailed。
    userData.texReady：贴图加载流程 promise（终态必 resolve：成功设 map / 失败置 texFailed），
    离屏缩略图据此事件驱动等待（替代轮询 mat.map） */
export function mcMatFor(
  textures,
  api,
  packName,
  fileRoot,
  fallbackRoot,
  overrideUrl,
  tints,
  biome,
  withParallax = false
) {
  const effBiome = biome || currentBiome
  return (key, face) => {
    if (!face || typeof face !== 'object' || typeof face.texture !== 'string') return null
    const texPath = resolveTextureRef(textures, face.texture)
    if (!texPath) return PLACEHOLDER_MAT
    const ck = overrideUrl ? 'ov:' + overrideUrl : texCacheKey(api, packName, texPath, fileRoot)
    const url = overrideUrl || rawUrl(api, packName, texPath, fileRoot, false)
    const metaPromise = loadAnimMetaCached(ck + ':mcmeta', packMcmetaUrl(api, packName, texPath, fileRoot))
    const mat = makeModelMaterial(null, withParallax)
    const tintIndex = Number.isInteger(face.tintindex) ? face.tintindex : -1
    if (tintIndex >= 0) {
      resolveTintColor(tintIndex, tints, effBiome, texPath, api, packName, fileRoot, fallbackRoot)
        .then(color => {
          if (mat.userData.replaced || !color) return
          mat.color = color
          mat.needsUpdate = true
        })
        .catch(() => {})
    }
    if (!overrideUrl && !isSpecialTexPath(texPath)) {
      const dot = texPath.lastIndexOf('.')
      if (dot >= 0) {
        const base = texPath.slice(0, dot),
          ext = texPath.slice(dot)
        applyPbrMapsToModelMaterial(
          mat,
          rawUrl(api, packName, base + '_n' + ext, fileRoot, false),
          rawUrl(api, packName, base + '_s' + ext, fileRoot, false),
          false,
          withParallax ? rawUrl(api, packName, base + '_h' + ext, fileRoot, false) : null
        )
      }
    }
    mat.userData.texReady = loadTextureCached(ck, url).then(async tex => {
      if (mat.userData.replaced) return
      if (tex) {
        await attachPackTexture(tex, metaPromise)
        if (mat.userData.replaced) return
        mat.map = tex
        mat.needsUpdate = true
        return
      }
      if (!overrideUrl && fallbackRoot) {
        const fbCk = texCacheKey(api, packName, texPath, fallbackRoot)
        const fbUrl = rawUrl(api, packName, texPath, fallbackRoot, false)
        const fbTex = await loadTextureCached(fbCk, fbUrl)
        if (mat.userData.replaced) return
        if (fbTex) {
          await attachPackTexture(
            fbTex,
            loadAnimMetaCached(fbCk + ':mcmeta', packMcmetaUrl(api, packName, texPath, fallbackRoot))
          )
          if (mat.userData.replaced) return
          mat.map = fbTex
          mat.needsUpdate = true
          return
        }
      }
      /* 跨 official-packs 回退：包内 + fallbackRoot 均无贴图时加载 vanilla 贴图 */
      if (!overrideUrl && !isSpecialTexPath(texPath)) {
        const official = await getOfficialPack()
        if (official) {
          const fbCk = texCacheKey(official.api, official.packName, texPath, undefined)
          const fbUrl = rawUrl(official.api, official.packName, texPath, undefined, false)
          const fbTex = await loadTextureCached(fbCk, fbUrl)
          if (mat.userData.replaced) return
          if (fbTex) {
            await attachPackTexture(
              fbTex,
              loadAnimMetaCached(fbCk + ':mcmeta', packMcmetaUrl(official.api, official.packName, texPath, undefined))
            )
            if (mat.userData.replaced) return
            mat.map = fbTex
            mat.needsUpdate = true
            return
          }
        }
      }
      mat.userData.texFailed = true
    })
    return mat
  }
}

/* sprite 回退贴图键选择：优先 layer0（item/generated），缺失时回退 particle
   （shulker_box 等特殊渲染方块模型链仅含 particle 键，无 layer0 → 原先无法识别贴图） */
export function spriteTexKey(textures) {
  if (!textures || typeof textures !== 'object') return null
  if (textures.layer0 != null) return '#layer0'
  if (textures.particle != null) return '#particle'
  return null
}

/* item/generated 类模型（无 elements）：layer0 贴图竖直 sprite 平面。
   支持 fallbackRoot：贴图先从 fileRoot 加载，失败回退到 fallbackRoot，再回退 official */
export function buildItemSpriteGroup(textures, api, packName, fileRoot, fallbackRoot, withParallax = false) {
  const texPath = resolveTextureRef(textures, spriteTexKey(textures))
  if (!texPath) return null
  const geo = new THREE.PlaneGeometry(1.2, 1.2)
  const mat = makeModelMaterial(null, withParallax)
  mat.side = THREE.DoubleSide
  mat.transparent = true
  const ck = texCacheKey(api, packName, texPath, fileRoot)
  const url = rawUrl(api, packName, texPath, fileRoot, false)
  const metaPromise = loadAnimMetaCached(ck + ':mcmeta', packMcmetaUrl(api, packName, texPath, fileRoot))
  mat.userData.texReady = loadTextureCached(ck, url).then(async tex => {
    if (mat.userData.replaced) return
    if (tex) {
      await attachPackTexture(tex, metaPromise)
      if (mat.userData.replaced) return
      mat.map = tex
      mat.needsUpdate = true
      return
    }
    if (fallbackRoot) {
      const fbCk = texCacheKey(api, packName, texPath, fallbackRoot)
      const fbUrl = rawUrl(api, packName, texPath, fallbackRoot, false)
      const fbTex = await loadTextureCached(fbCk, fbUrl)
      if (mat.userData.replaced) return
      if (fbTex) {
        await attachPackTexture(
          fbTex,
          loadAnimMetaCached(fbCk + ':mcmeta', packMcmetaUrl(api, packName, texPath, fallbackRoot))
        )
        if (mat.userData.replaced) return
        mat.map = fbTex
        mat.needsUpdate = true
        return
      }
    }
    if (!isSpecialTexPath(texPath)) {
      const official = await getOfficialPack()
      if (official) {
        const fbCk = texCacheKey(official.api, official.packName, texPath, undefined)
        const fbUrl = rawUrl(official.api, official.packName, texPath, undefined, false)
        const fbTex = await loadTextureCached(fbCk, fbUrl)
        if (mat.userData.replaced) return
        if (fbTex) {
          await attachPackTexture(
            fbTex,
            loadAnimMetaCached(fbCk + ':mcmeta', packMcmetaUrl(official.api, official.packName, texPath, undefined))
          )
          if (mat.userData.replaced) return
          mat.map = fbTex
          mat.needsUpdate = true
          return
        }
      }
    }
    mat.userData.texFailed = true
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return group
}

/* bbmodel 面材质：faces[key].texture 为 textures 数组索引，source 为 base64 dataURL。
    cachePrefix 区分不同模型（Blockbench 贴图 id 在各模型间会重复） */
export function bbMatFor(bbTextures, cachePrefix, withParallax = false) {
  const list = Array.isArray(bbTextures) ? bbTextures : []
  return (key, face) => {
    if (!face || typeof face !== 'object' || face.texture == null) return null
    const tex = list[+face.texture]
    if (!tex || typeof tex.source !== 'string' || !tex.source.startsWith('data:')) return PLACEHOLDER_MAT
    const mat = makeModelMaterial(null, withParallax)
    const ck = cachePrefix + ':' + (tex.id != null ? String(tex.id) : tex.name || tex.source.length)
    mat.userData.texReady = loadTextureCached(ck, tex.source).then(t => {
      if (mat.userData.replaced) return
      if (t) {
        mat.map = applyTexParams(t)
        mat.needsUpdate = true
      } else mat.userData.texFailed = true
    })
    return mat
  }
}

/* ── UV 贴图布局（uv-view.js 浮窗数据源）──────────────────
   layout: {
     type: 'mc' | 'bb', uvScale, sprite?,
     textures: [{ name, url }],                       // 去重贴图（raw URL 或 dataURL）
     elements: [{ faces: { [face]: { tex, uv:[x1,y1,x2,y2], rotation, mirror } } }]
   }  uv 为贴图像素坐标（v 自顶向下），mirror = uv[2] < uv[0] 水平镜像采样 */

function normFaceRotation(rot) {
  return Number.isFinite(+rot) ? (((Math.round(+rot / 90) * 90) % 360) + 360) % 360 : 0
}

function texDisplayName(texPath) {
  if (isSpecialTexPath(texPath)) {
    /* 扩展引用显示名：data: → data / file: 与 URL → 取文件名去扩展 */
    if (/^data:/i.test(texPath)) return 'data'
    let raw = texPath
    try {
      if (/^file:/i.test(texPath)) raw = texPath.replace(/^file:/i, '')
      else if (/^https?:\/\//i.test(texPath)) raw = new URL(texPath).pathname
      else raw = decodeURIComponent(new URL(texPath, 'http://matoga.local').searchParams.get('path') || texPath)
    } catch {}
    return (String(raw).split('/').pop() || 'texture').replace(TEX_REF_EXT_RE, '')
  }
  return texPath.replace(/^assets\/[^/]+\/textures\//, '').replace(TEX_REF_EXT_RE, '')
}

/* MC elements + textures 表 → 布局（贴图去重：texPath → 索引）。
    texPaths：布局贴图索引 → 解析出的贴图路径（含扩展引用），供 UV 编辑器
    替换贴图时把新引用写回模型 textures 表（保存/导出持久化） */
export function buildMcLayout(elements, textures, api, packName, fileRoot) {
  const texList = []
  const texPaths = []
  const texIndex = new Map()
  const texIndexOf = texPath => {
    if (!texIndex.has(texPath)) {
      texIndex.set(texPath, texList.length)
      texList.push({
        name: texDisplayName(texPath),
        url: rawUrl(api, packName, texPath, fileRoot, false),
        mcmetaUrl: packMcmetaUrl(api, packName, texPath, fileRoot)
      })
      texPaths.push(texPath)
    }
    return texIndex.get(texPath)
  }
  const outElements = []
  const list = (Array.isArray(elements) ? elements : []).slice(0, MAX_ELEMENTS)
  for (const el of list) {
    if (!el || typeof el !== 'object') continue
    const faces = expandElementFaces(el)
    const from = parseVec3(el.from, [0, 0, 0])
    const to = parseVec3(el.to, [16, 16, 16])
    const out = {}
    for (const key of FACE_KEYS) {
      const face = faces[key]
      if (!face || typeof face !== 'object' || typeof face.texture !== 'string') continue
      const texPath = resolveTextureRef(textures, face.texture)
      if (!texPath) continue
      const uv = parseUv(face.uv) || defaultFaceUv(key, from, to) || [0, 0, 16, 16]
      out[key] = { tex: texIndexOf(texPath), uv, rotation: normFaceRotation(face.rotation), mirror: uv[2] < uv[0] }
    }
    if (Object.keys(out).length) outElements.push({ faces: out, el })
  }
  return { type: 'mc', uvScale: 16, textures: texList, texPaths, elements: outElements }
}

/* item/generated sprite 回退布局：layer0 整幅贴图单面（spriteEl 为合成 element 引用，供贴图替换联动） */
export function buildSpriteLayout(textures, api, packName, spriteEl, fileRoot) {
  textures = textures && typeof textures === 'object' ? textures : {}
  const texPath = resolveTextureRef(textures, spriteTexKey(textures))
  if (!texPath) return null
  return {
    type: 'mc',
    uvScale: 16,
    sprite: true,
    textures: [
      {
        name: texDisplayName(texPath),
        url: rawUrl(api, packName, texPath, fileRoot, false),
        mcmetaUrl: packMcmetaUrl(api, packName, texPath, fileRoot)
      }
    ],
    texPaths: [texPath],
    elements: [{ faces: { sprite: { tex: 0, uv: [0, 0, 16, 16], rotation: 0, mirror: false } }, el: spriteEl || null }]
  }
}

/* bbmodel → 布局（无效贴图项过滤但保持索引对齐：faces.texture 引用原始数组下标）。
    texOrigin：原始 json.textures 下标 → 布局贴图索引（-1 无效项），供 UV 编辑器
    把替换后的内嵌贴图（dataURL）写回原始 bbmodel JSON 保存 */
export function buildBbLayout(json) {
  json = json && typeof json === 'object' ? json : {}
  const uvScale = Number.isFinite(+json.resolution) && +json.resolution > 0 ? +json.resolution : 16
  const raw = Array.isArray(json.textures) ? json.textures : []
  const texList = []
  const texOrigin = raw.map(tex => {
    if (tex && typeof tex.source === 'string' && tex.source.startsWith('data:')) {
      texList.push({ name: tex.name || 'texture ' + texList.length, url: tex.source })
      return texList.length - 1
    }
    return -1
  })
  const outElements = []
  const list = (Array.isArray(json.elements) ? json.elements : []).slice(0, MAX_ELEMENTS)
  for (const el of list) {
    if (!el || typeof el !== 'object') continue
    const faces = expandElementFaces(el)
    const from = parseVec3(el.from, [0, 0, 0])
    const to = parseVec3(el.to, [16, 16, 16])
    const out = {}
    for (const key of FACE_KEYS) {
      const face = faces[key]
      if (!face || typeof face !== 'object' || face.texture == null) continue
      const ti = texOrigin[+face.texture]
      if (ti == null || ti < 0) continue
      const uv = parseUv(face.uv) || defaultFaceUv(key, from, to, uvScale) || [0, 0, uvScale, uvScale]
      out[key] = { tex: ti, uv, rotation: normFaceRotation(face.rotation), mirror: uv[2] < uv[0] }
    }
    if (Object.keys(out).length) outElements.push({ faces: out, el })
  }
  return { type: 'bb', uvScale, textures: texList, texOrigin, elements: outElements }
}

/* ── 模型编辑联动（uv-view 编辑 → 3D 实时更新 + 导出）──────────
   layout.elements[i].el 持有原始 element 引用（与 parts / bbmodel json 中的对象同一引用），
   编辑写回原始 element 后按引用从 activeElementMeshes 定位 mesh 重映射几何 UV；
   material3d 的渲染循环逐帧执行 → 变更下一帧即生效（实时预览）。 */

const activeElementMeshes = new Map() /* 原始 element → mesh（当前展示模型） */
let activeExportModel = null /* 导出信息：{ type:'mc', parts, filename } | { type:'bb', json, filename } */

/* 展示成功后绑定：收集 mesh.userData.mcElement → mesh 映射 + 导出信息（bindActiveModel 也可供测试注入）；
    exportModel.ctx = { api, packName } 模型包上下文（mc 包模式传入，替换贴图时用于
    判断能否把新贴图转成标准 MC 引用；im/bb 等无包上下文不传 → 一律扩展引用形式） */
export function bindActiveModel(group, exportModel, append = false) {
  if (!append) {
    activeElementMeshes.clear()
    activeExportModel = exportModel || null
  }
  if (!group || typeof group.traverse !== 'function') return
  group.traverse(o => {
    if (o && o.isMesh && o.userData && o.userData.mcElement) activeElementMeshes.set(o.userData.mcElement, o)
  })
}

/* 编辑落成显式 face（来自 "all" 展开或默认 UV 的面：显式定义优先，与 Blockbench 语义一致） */
function ensureExplicitFace(el, faceKey) {
  if (!el || typeof el !== 'object') return null
  if (!el.faces || typeof el.faces !== 'object') el.faces = {}
  let f = el.faces[faceKey]
  if (f && typeof f === 'object') return f
  const expanded = expandElementFaces(el)
  const src = expanded[faceKey]
  const tex = src && typeof src === 'object' && typeof src.texture === 'string' ? src.texture : undefined
  f = tex != null ? { texture: tex } : {}
  el.faces[faceKey] = f
  return f
}

function remapMeshFaceUv(mesh, el) {
  applyFaceUvs(
    mesh.geometry,
    el.faces,
    mesh.userData.uvScale || 16,
    parseVec3(el.from, [0, 0, 0]),
    parseVec3(el.to, [16, 16, 16])
  )
}

/* UV 编辑写回：原始 element face.uv 更新 + mesh 几何 UV 重映射（视口下一帧生效）；返回是否联动成功 */
export function updateModelFaceUv(element, faceKey, uv) {
  const mesh = activeElementMeshes.get(element)
  if (!mesh || !mesh.geometry) return false
  if (!Array.isArray(uv) || uv.length !== 4 || !uv.every(n => Number.isFinite(+n))) return false
  const face = ensureExplicitFace(element, faceKey)
  if (!face) return false
  face.uv = [+uv[0], +uv[1], +uv[2], +uv[3]]
  remapMeshFaceUv(mesh, element)
  return true
}

/* 面贴图旋转（0/90/180/270）写回 + 重映射 */
export function updateModelFaceRotation(element, faceKey, rotation) {
  const mesh = activeElementMeshes.get(element)
  if (!mesh || !mesh.geometry) return false
  const face = ensureExplicitFace(element, faceKey)
  if (!face) return false
  face.rotation = Number.isFinite(+rotation) ? (((Math.round(+rotation / 90) * 90) % 360) + 360) % 360 : 0
  remapMeshFaceUv(mesh, element)
  return true
}

/* 材质贴图替换（编辑器自定义贴图）：阻断旧贴图异步加载竞态 + 摘除动画注册 */
function swapFaceTexture(mat, tex) {
  if (!mat || (mat.userData && mat.userData.shared)) return false
  mat.userData.replaced = true
  if (mat.map && animatedTexs.has(mat.map)) animatedTexs.delete(mat.map)
  mat.map = tex
  mat.needsUpdate = true
  return true
}

/* 材质贴图清除（编辑器移除材质）：map 置 null → 纯色面 */
function clearFaceTexture(mat) {
  if (!mat || (mat.userData && mat.userData.shared)) return false
  mat.userData.replaced = true
  if (mat.map && animatedTexs.has(mat.map)) animatedTexs.delete(mat.map)
  mat.map = null
  mat.needsUpdate = true
  return true
}

/* 贴图替换：dataURL 或可加载 URL（贴图库 raw URL）→ 更新 layout 中引用 texIndex 的所有面材质（含 sprite 单材质面）。
     替换成功后把新贴图引用写回模型 textures 表（智能引用：同包 → 标准 MC 引用，
     其他 → 扩展引用），导出/保存即持久化，重新打开模型自动加载。
     extra（材质球配套）：{ normal, specular } URL 字符串 → 同步应用到面材质做 3D 视口 PBR 预览
     （空串清除对应 map；extra 省略则不动 PBR，保持模型加载时自动配的 PBR） */
export async function updateModelTexture(texIndex, texUrl, layout, extra) {
  const lay = layout || lastLayout
  if (!lay || !Array.isArray(lay.elements)) return false
  if (
    typeof texUrl !== 'string' ||
    !(texUrl.startsWith('data:') || /^https?:\/\//i.test(texUrl) || texUrl.startsWith('/'))
  )
    return false
  let tex = null
  try {
    tex = await new THREE.TextureLoader().loadAsync(texUrl)
  } catch {
    return false
  }
  if (!tex) return false
  applyTexParams(tex)
  let touched = 0
  for (const layEl of lay.elements) {
    const mesh = layEl && layEl.el ? activeElementMeshes.get(layEl.el) : null
    if (!mesh) continue
    for (const key in layEl.faces) {
      const lf = layEl.faces[key]
      if (!lf || lf.tex !== texIndex) continue
      const mi = MAT_INDEX[key]
      if (mi != null && Array.isArray(mesh.material)) {
        let mat = mesh.material[mi]
        if (!mat || (mat.userData && mat.userData.shared)) {
          mat = makeModelMaterial(null)
          mesh.material[mi] = mat
        }
        if (swapFaceTexture(mat, tex)) {
          touched++
          if (extra) applyPbrMapsToModelMaterial(mat, extra.normal, extra.specular, true, extra.height)
        }
      } else if (mi == null && mesh.material && !Array.isArray(mesh.material)) {
        if (swapFaceTexture(mesh.material, tex)) {
          touched++
          if (extra) applyPbrMapsToModelMaterial(mesh.material, extra.normal, extra.specular, true, extra.height)
        }
      }
    }
  }
  writeBackTexRef(texIndex, texUrl, lay)
  return touched > 0
}

/* 移除材质：清空 layout 中引用 texIndex 的所有面材质贴图（面变纯色；含 sprite 单材质面）。
     引用同步写回空值（重新打开模型 → 面灰色）；配套 PBR（法线/高光）一并清除 */
export function clearModelTexture(texIndex, layout) {
  const lay = layout || lastLayout
  if (!lay || !Array.isArray(lay.elements)) return false
  let touched = 0
  for (const layEl of lay.elements) {
    const mesh = layEl && layEl.el ? activeElementMeshes.get(layEl.el) : null
    if (!mesh) continue
    for (const key in layEl.faces) {
      const lf = layEl.faces[key]
      if (!lf || lf.tex !== texIndex) continue
      const mi = MAT_INDEX[key]
      if (mi != null && Array.isArray(mesh.material)) {
        let mat = mesh.material[mi]
        if (!mat || (mat.userData && mat.userData.shared)) {
          mat = makeModelMaterial(null)
          mesh.material[mi] = mat
        }
        if (clearFaceTexture(mat)) {
          touched++
          applyPbrMapsToModelMaterial(mat, '', '', true, '')
        }
      } else if (mi == null && mesh.material && !Array.isArray(mesh.material)) {
        if (clearFaceTexture(mesh.material)) {
          touched++
          applyPbrMapsToModelMaterial(mesh.material, '', '', true, '')
        }
      }
    }
  }
  writeBackTexRef(texIndex, '', lay)
  return touched > 0
}

/* 贴图引用写回（uv 编辑替换/移除 → 模型数据持久化）：
    mc：texPaths 定位旧路径 → 解析命中键改写为智能引用（texPaths 同步更新支持连续替换）；
    bb：texOrigin 定位原始下标写 source（dataURL 直接写；站内 URL 异步 fetch 转 dataURL，
    转换失败保留 URL 兜底） */
function writeBackTexRef(texIndex, texUrl, lay) {
  const m = activeExportModel
  if (!m || !lay) return
  if (m.type === 'bb' && m.json && Array.isArray(lay.texOrigin) && Array.isArray(m.json.textures)) {
    const src = String(texUrl || '')
    for (let rawIdx = 0; rawIdx < lay.texOrigin.length; rawIdx++) {
      if (lay.texOrigin[rawIdx] !== texIndex || !m.json.textures[rawIdx]) continue
      if (src.startsWith('data:')) {
        m.json.textures[rawIdx].source = src
      } else if (src.startsWith('/')) {
        fetch(apiUrl(src))
          .then(r => (r.ok ? r.blob() : null))
          .then(blob =>
            blob
              ? new Promise(resolve => {
                  const rd = new FileReader()
                  rd.onload = () => resolve(String(rd.result))
                  rd.onerror = () => resolve(null)
                  rd.readAsDataURL(blob)
                })
              : null
          )
          .then(dataUrl => {
            if (dataUrl) m.json.textures[rawIdx].source = dataUrl
          })
          .catch(() => {})
      }
    }
    return
  }
  if (m.type === 'mc' && Array.isArray(lay.texPaths) && Array.isArray(m.parts)) {
    const oldPath = lay.texPaths[texIndex]
    if (typeof oldPath !== 'string') return
    const ref = texUrlToRef(texUrl, m.ctx)
    if (ref == null) return
    for (const p of m.parts) {
      if (p && p.textures) writeMcTexRef(p.textures, oldPath, ref)
    }
    lay.texPaths[texIndex] = texPathForRef(ref)
  }
}

/* UV 视图 hover/选中 → 3D 视口对应面 emissive 高亮 */
let highlightedFace = null /* { element, faceKey, mat } */

export function highlightModelFace(element, faceKey, on) {
  if (highlightedFace) {
    try {
      if (highlightedFace.mat.emissive) highlightedFace.mat.emissive.setHex(0x000000)
    } catch {}
    highlightedFace = null
  }
  if (!on) return true
  const mesh = activeElementMeshes.get(element)
  if (!mesh) return false
  const mi = MAT_INDEX[faceKey]
  const mat =
    mi != null && Array.isArray(mesh.material)
      ? mesh.material[mi]
      : mi == null && mesh.material && !Array.isArray(mesh.material)
        ? mesh.material
        : null
  if (!mat || (mat.userData && mat.userData.shared)) return false
  try {
    if (!mat.emissive) return false
    mat.emissive.setHex(0x2e4a8f)
    highlightedFace = { element, faceKey, mat }
    return true
  } catch {
    return false
  }
}

/* 导出当前模型 JSON（编辑直接写回原始 element 引用 → 序列化即包含 UV 修改；
   mc 为烘焙后的独立模型（parent 链已合并），bb 为完整 bbmodel） */
export function exportActiveModelJson() {
  const m = activeExportModel
  if (!m) return null
  if (m.type === 'bb' && m.json && typeof m.json === 'object') {
    return { filename: m.filename || 'model.bbmodel', json: m.json }
  }
  const parts = Array.isArray(m.parts) ? m.parts : []
  const textures = {}
  const elements = []
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue
    for (const k in p.textures || {}) if (textures[k] == null) textures[k] = p.textures[k]
    for (const el of p.elements || []) elements.push(el)
  }
  if (!elements.length) return null
  return { filename: m.filename || 'model.json', json: { textures, elements } }
}

export function getActiveModelSource() {
  const m = activeExportModel
  if (!m || !m.source) return null
  return m.source
}

/* 最近一次成功展示的模型布局（无模型 / 已被清除时为 null） */
export function getLastModelLayout() {
  return lastLayout
}

/* 左右对比布局（pair 路径）：{ left, right }，单模型/无模型时为 null。
    UV 编辑器据此渲染左右切换 tab，按 activeSide 取对应 layout */
export function getLastModelLayoutPair() {
  return lastLayoutPair
}

/* 模型成功展示后广播（uv-view 浮窗监听以自动刷新；无 DOM 环境安全跳过） */
function notifyModelShown(layout) {
  try {
    if (
      typeof window !== 'undefined' &&
      typeof window.dispatchEvent === 'function' &&
      typeof CustomEvent !== 'undefined'
    ) {
      window.dispatchEvent(new CustomEvent('mcmodel:shown', { detail: { layout } }))
    }
  } catch {}
}

/* ── 对外入口 ─────────────────────────────────────── */

/* 获取导入模型 JSON（data/imported-models，可能是 .bbmodel 或 MC .json；供缩略图/视口复用） */
export async function fetchImportedModelJson(id) {
  const data = await fetchOkData('/api/imported-models/' + encodeURIComponent(id))
  const json = data && data.json
  return json && typeof json === 'object' ? json : null
}

/* 获取导入模型完整信息 { json, texRoot }：texRoot 为模型专属子目录绝对路径，
   MC .json 贴图引用按命名空间解析后从该目录加载（导入贴图随模型一同落盘到 <id>/assets/...） */
export async function fetchImportedModelFull(id) {
  const data = await fetchOkData('/api/imported-models/' + encodeURIComponent(id))
  const json = data && data.json
  return {
    json: json && typeof json === 'object' ? json : null,
    texRoot: data && typeof data.texDir === 'string' ? data.texDir : null
  }
}

/* MC 包内 .json 模型（models/ 路径或 items/ 物品定义）→ 3D 视口；返回 { shown, noElements } */
export async function viewMcModelInViewport({ api, packName, rel, fileRoot }) {
  const { parts } = await resolveMcModelAsset(api, packName, rel, fileRoot)
  let noElements = false
  let layout = null
  const subs = []
  let anyTransform = false
  for (const part of parts) {
    let sub = null
    let partLayout = null
    if (part.elements.length) {
      sub = buildModelGroup(
        part.elements,
        mcMatFor(part.textures, api, packName, fileRoot, undefined, undefined, part.tints),
        16
      )
      partLayout = buildMcLayout(part.elements, part.textures, api, packName, fileRoot)
    } else {
      /* sprite 合成 element（mesh 挂引用 → 贴图替换联动；UV 编辑不适用） */
      const spriteEl = { faces: { sprite: { texture: spriteTexKey(part.textures) || undefined } } }
      sub = buildItemSpriteGroup(part.textures, api, packName, fileRoot)
      if (sub && sub.children[0]) sub.children[0].userData.mcElement = spriteEl
      noElements = true
      partLayout = buildSpriteLayout(part.textures, api, packName, spriteEl, fileRoot)
    }
    if (!sub || !sub.children.length) continue
    if (part.transform) {
      applyItemTransformation(sub, part.transform)
      anyTransform = true
    }
    if (!layout && partLayout) layout = partLayout
    subs.push(sub)
  }
  if (!subs.length) {
    if (isPartsEmptyModel(parts)) setModelEmptyHint(_t('m3d.modelEmpty'))
    return { shown: false, noElements }
  }
  /* 单部件无变换：直接展示（保持既有层级契约，children[0] 即 Mesh）；
     多部件/带变换：外层合并 Group——transformation 在内层子 Group 上，
     不被视口归一化（showCustomModel 重设 position/scale）覆盖 */
  let group
  if (subs.length === 1 && !anyTransform) group = subs[0]
  else {
    group = new THREE.Group()
    for (const s of subs) group.add(s)
  }
  const shown = showCustomModel(group)
  if (shown) {
    setModelEmptyHint('')
    lastLayout = layout
    lastLayoutPair = null
    notifyModelShown(lastLayout)
    bindActiveModel(group, {
      type: 'mc',
      parts,
      filename: rel.split('/').pop() || 'model.json',
      ctx: { api, packName }
    })
    lastRenderFn = () => viewMcModelInViewport({ api, packName, rel, fileRoot })
  }
  return { shown, noElements }
}

/* 生物群系切换后重渲染最近一次展示的 MC 模型（单模型或左右对比） */
export async function rerenderLastMcModel() {
  if (!lastRenderFn) return false
  return lastRenderFn()
}

async function buildMcGroupFromRel(fileRoot, rel, texRoot, overrideUrl) {
  const texSource = texRoot || fileRoot
  const fbRoot = texRoot && !overrideUrl ? fileRoot : undefined
  const { parts } = await resolveMcModelAsset(undefined, undefined, rel, fileRoot)
  let layout = null
  const subs = []
  let anyTransform = false
  for (const part of parts) {
    let sub = null
    let partLayout = null
    if (part.elements.length) {
      sub = buildModelGroup(
        part.elements,
        mcMatFor(part.textures, undefined, undefined, texSource, fbRoot, overrideUrl, part.tints),
        16
      )
      partLayout = buildMcLayout(part.elements, part.textures, undefined, undefined, texSource)
    } else {
      const spriteEl = { faces: { sprite: { texture: spriteTexKey(part.textures) || undefined } } }
      sub = buildItemSpriteGroup(part.textures, undefined, undefined, texSource)
      if (sub && sub.children[0]) sub.children[0].userData.mcElement = spriteEl
      partLayout = buildSpriteLayout(part.textures, undefined, undefined, spriteEl, texSource)
    }
    if (!sub || !sub.children.length) continue
    if (part.transform) {
      applyItemTransformation(sub, part.transform)
      anyTransform = true
    }
    if (!layout && partLayout) layout = partLayout
    subs.push(sub)
  }
  if (!subs.length) {
    return {
      group: null,
      layout: null,
      parts,
      filename: rel.split('/').pop() || 'model.json',
      emptyModel: isPartsEmptyModel(parts)
    }
  }
  let group
  if (subs.length === 1 && !anyTransform) group = subs[0]
  else {
    group = new THREE.Group()
    for (const s of subs) group.add(s)
  }
  return { group, layout, parts, filename: rel.split('/').pop() || 'model.json', emptyModel: false }
}

export async function viewMcModelPairInViewport({ left, right, rightRoot, isStale }) {
  const [lr, rr] = await Promise.all([
    left ? buildMcGroupFromRel(left.fileRoot, left.rel).catch(() => null) : Promise.resolve(null),
    right
      ? buildMcGroupFromRel(right.fileRoot, right.rel).catch(() => null)
      : left && rightRoot
        ? buildMcGroupFromRel(left.fileRoot, left.rel, rightRoot).catch(() => null)
        : Promise.resolve(null)
  ])
  if (isStale && isStale()) return { shown: false }
  const lrGroup = lr && lr.group
  const rrGroup = rr && rr.group
  if (!lrGroup && !rrGroup) {
    if ((lr && lr.emptyModel) || (rr && rr.emptyModel)) setModelEmptyHint(_t('m3d.modelEmpty'))
    return { shown: false }
  }
  const shown = showCustomModelPair(lrGroup, rrGroup)
  if (shown) {
    setModelEmptyHint('')
    lastLayout = (lr && lr.layout) || (rr && rr.layout)
    lastLayoutPair = { left: lr && lr.layout, right: rr && rr.layout }
    notifyModelShown(lastLayout)
    if (lr) bindActiveModel(lr.group, { type: 'mc', parts: lr.parts, filename: lr.filename })
    if (rr) bindActiveModel(rr.group, { type: 'mc', parts: rr.parts, filename: rr.filename }, !lr)
    lastRenderFn = () => viewMcModelPairInViewport({ left, right, rightRoot })
  }
  return { shown }
}

/* 贴图效果对比：左=左模型+左贴图，右=右模型+右贴图（模型或贴图缺失回退左侧）。
   右侧展示替换后模型与贴图的组合效果；左侧模型缺失时两侧几何均取右侧模型 */
export async function viewMcModelTexCompareInViewport({ left, right, rightRoot, leftTexUrl, rightTexUrl, isStale }) {
  const rGeo = right || left
  const [lr, rr] = await Promise.all([
    left ? buildMcGroupFromRel(left.fileRoot, left.rel, null, leftTexUrl).catch(() => null) : Promise.resolve(null),
    rGeo
      ? buildMcGroupFromRel(rGeo.fileRoot, rGeo.rel, rGeo === right ? rightRoot : rGeo.fileRoot, rightTexUrl).catch(
          () => null
        )
      : Promise.resolve(null)
  ])
  if (isStale && isStale()) return { shown: false }
  const lrGroup = lr && lr.group
  const rrGroup = rr && rr.group
  if (!lrGroup && !rrGroup) {
    if ((lr && lr.emptyModel) || (rr && rr.emptyModel)) setModelEmptyHint(_t('m3d.modelEmpty'))
    return { shown: false }
  }
  const shown = showCustomModelPair(lrGroup, rrGroup)
  if (shown) {
    setModelEmptyHint('')
    lastLayout = (lr && lr.layout) || (rr && rr.layout)
    lastLayoutPair = { left: lr && lr.layout, right: rr && rr.layout }
    notifyModelShown(lastLayout)
    if (lr) bindActiveModel(lr.group, { type: 'mc', parts: lr.parts, filename: lr.filename })
    if (rr) bindActiveModel(rr.group, { type: 'mc', parts: rr.parts, filename: rr.filename }, !lr)
    lastRenderFn = () => viewMcModelTexCompareInViewport({ left, right, rightRoot, leftTexUrl, rightTexUrl })
  }
  return { shown }
}

/* 获取模型引用的材质贴图列表（不展示，供预览面板列出"对应的材质有哪些"）：
   合并所有 parts（composite 多部件）的 layout.textures 并按贴图名去重。
   与 viewMcModelInViewport 同解析路径，但不构建几何/不进视口，轻量 */
export async function resolveModelTexList({ api, packName, rel, fileRoot }) {
  const { parts } = await resolveMcModelAsset(api, packName, rel, fileRoot)
  const seen = new Map()
  for (const part of parts) {
    let lay = null
    if (part.elements.length) {
      lay = buildMcLayout(part.elements, part.textures, api, packName, fileRoot)
    } else {
      const spriteEl = { faces: { sprite: { texture: spriteTexKey(part.textures) || undefined } } }
      lay = buildSpriteLayout(part.textures, api, packName, spriteEl, fileRoot)
    }
    if (!lay || !Array.isArray(lay.textures)) continue
    for (const tx of lay.textures) {
      if (tx && typeof tx.name === 'string' && !seen.has(tx.name)) seen.set(tx.name, tx.url)
    }
  }
  return [...seen].map(([name, url]) => ({ name, url }))
}

/* 导入模型（data/imported-models/<id>/model.*，.bbmodel 或 MC .json）→ 3D 视口；返回 { shown } */
export async function viewImportedModelInViewport({ id }) {
  const { json, texRoot } = await fetchImportedModelFull(id)
  if (!json || typeof json !== 'object') return { shown: false }
  const isBb = !!(json.meta && (json.meta.format === 'bbmodel' || json.meta.model_format))
  if (isBb) {
    if (!Array.isArray(json.elements) || !json.elements.length) {
      setModelEmptyHint(_t('m3d.modelEmpty'))
      return { shown: false }
    }
    const uvScale = Number.isFinite(+json.resolution) && +json.resolution > 0 ? +json.resolution : 16
    const group = buildModelGroup(json.elements, bbMatFor(json.textures, 'bbm:' + id), uvScale)
    if (!group.children.length) return { shown: false }
    const shown = showCustomModel(group)
    if (shown) {
      setModelEmptyHint('')
      lastLayout = buildBbLayout(json)
      lastLayoutPair = null
      notifyModelShown(lastLayout)
      bindActiveModel(group, { type: 'bb', json, source: { kind: 'im', id }, filename: (id || 'model') + '.bbmodel' })
    }
    return { shown }
  }
  /* MC .json：自包含 elements；texRoot 为模型专属目录，贴图从 <id>/assets/... 加载（缺失回退占位） */
  if (!Array.isArray(json.elements) || !json.elements.length) {
    setModelEmptyHint(_t('m3d.modelEmpty'))
    return { shown: false }
  }
  const textures = json.textures && typeof json.textures === 'object' ? json.textures : {}
  const group = buildModelGroup(json.elements, mcMatFor(textures, undefined, undefined, texRoot || undefined), 16)
  if (!group.children.length) return { shown: false }
  const shown = showCustomModel(group)
  if (shown) {
    setModelEmptyHint('')
    const parts = [{ elements: json.elements, textures }]
    lastLayout = buildMcLayout(json.elements, textures, undefined, undefined, texRoot || undefined)
    lastLayoutPair = null
    notifyModelShown(lastLayout)
    bindActiveModel(group, { type: 'mc', parts, source: { kind: 'im', id }, filename: (id || 'model') + '.json' })
  }
  return { shown }
}

/* 自定义模型（data/custom-models/<id>/model.json）→ 3D 视口；返回 { shown }
    模型 JSON 自包含 elements（模板已内联展开）；若有 parent 且无 elements，
    沿官方包 parent 链合并；贴图从官方包加载（api/packName 可缺省 → 占位灰） */
export async function viewCustomModelInViewport({ id, api, packName }) {
  const model = await fetchOkData('/api/custom-models/' + encodeURIComponent(id) + '/raw')
  if (!model || typeof model !== 'object') return { shown: false }
  let elements = Array.isArray(model.elements) ? model.elements : null
  let textures = model.textures && typeof model.textures === 'object' ? model.textures : {}
  if (model.parent) {
    const parentRel = parentModelPath(model.parent)
    if (parentRel) {
      try {
        const p = await resolveMcModelRaw(api, packName, parentRel, 0, undefined)
        if (!elements && p.elements.length) elements = p.elements
        const merged = { ...p.textures }
        for (const k in textures) merged[k] = textures[k]
        textures = merged
      } catch {}
    }
  }
  textures = expandTextureAliases(textures)
  let group = null
  let layout = null
  if (elements && elements.length) {
    group = buildModelGroup(elements, mcMatFor(textures, api, packName), 16)
    layout = buildMcLayout(elements, textures, api, packName)
  } else {
    const spriteEl = { faces: { sprite: { texture: spriteTexKey(textures) || undefined } } }
    group = buildItemSpriteGroup(textures, api, packName)
    if (group && group.children[0]) group.children[0].userData.mcElement = spriteEl
    layout = buildSpriteLayout(textures, api, packName, spriteEl)
  }
  if (!group || !group.children.length) {
    if (!elements || !elements.length) setModelEmptyHint(_t('m3d.modelEmpty'))
    return { shown: false }
  }
  const shown = showCustomModel(group)
  if (shown) {
    setModelEmptyHint('')
    lastLayout = layout
    lastLayoutPair = null
    notifyModelShown(layout)
    bindActiveModel(group, {
      type: 'mc',
      parts: [{ elements: elements || [], textures, transform: null }],
      source: { kind: 'cm', id },
      filename: (id || 'custom') + '.json',
      ctx: { api, packName }
    })
  }
  return { shown }
}

export function isViewportVisible() {
  return hasVisibleViewport()
}

/* 路径工具模块的依赖注入 */
setMcvPathsHooks({ isSpecialTexPath })


/* geo-tools 模块的常量注入（常量留主文件） */
setMcvGeoToolsHooks({
  get_TICKS_PER_SEC: () => TICKS_PER_SEC
})

/* 贴图与着色工具 常量注入 */
setTexToolsHooks({
  get_colormapCache: () => colormapCache,
  get_CONSTANT_TINTS: () => CONSTANT_TINTS,
  get_currentBiome: () => currentBiome,
  get_TEX_REF_EXT_RE: () => TEX_REF_EXT_RE,
  get_texCache: () => texCache
})

/* 贴图引用与模型解析工具 常量注入 */
setTexRefToolsHooks({
  get_modelJsonCache: () => modelJsonCache,
  get_BUILTIN_PARENT_MODELS: () => BUILTIN_PARENT_MODELS,
  get_MAX_PARENT_DEPTH: () => MAX_PARENT_DEPTH,
  get_FACE_KEYS: () => FACE_KEYS,
  get_FACE_ROT_ORDER: () => FACE_ROT_ORDER,
  get_MAT_INDEX: () => MAT_INDEX
})

/* 模型资产解析 常量注入 */
setAssetResolveHooks({
  get_SPECIAL_TEX_RE: () => SPECIAL_TEX_RE,
  get_TEX_REF_FALLBACK: () => TEX_REF_FALLBACK,
  get_MAX_ITEM_DEF_REFS: () => MAX_ITEM_DEF_REFS
})
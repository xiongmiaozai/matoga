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
import { showCustomModel, hasVisibleViewport } from './material3d.js'

/* fileUrl / joinPath 内联（与 utils.js 同实现）：避免 import utils.js 触发 core.js 的
   DOM 依赖，保持本模块在 node 单测（NR_M3D_STUB）环境下可加载 */
function fileUrl(p) { return '/api/file/raw?path=' + encodeURIComponent(p) }
function joinPath(base, rel) {
  const b = base.replace(/\\/g, '/').replace(/\/+$/, '')
  const r = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  return b + '/' + r
}

const MAX_PARENT_DEPTH = 8
const MAX_ELEMENTS = 4096
const MAX_ITEM_DEF_DEPTH = 12
const MAX_ITEM_DEF_REFS = 16
/* 跨模型共享材质：userData.shared 标记（material3d dispose 时跳过，避免重复 dispose 后渲染失效） */
const HIDDEN_MAT = new THREE.MeshBasicMaterial({ visible: false })
HIDDEN_MAT.userData.shared = true
const PLACEHOLDER_MAT = new THREE.MeshStandardMaterial({ color: 0x9a9aa8, roughness: 0.9 })
PLACEHOLDER_MAT.userData.shared = true

/* BoxGeometry 材质索引顺序（+x,-x,+y,-y,+z,-z）↔ MC 面名 */
const FACE_KEYS = ['east', 'west', 'up', 'down', 'south', 'north']
const MAT_INDEX = { east: 0, west: 1, up: 2, down: 3, south: 4, north: 5 }

const texCache = new Map()   /* key → Promise<Texture|null> */

/* 最近一次成功展示的模型 UV 布局（uv-view 浮窗数据源） */
let lastLayout = null

function apiUrl(p) {
  return (typeof window !== 'undefined' && window.matogaCore && window.matogaCore.url) ? window.matogaCore.url(p) : p
}

/* 资源 raw URL 构造：包模式走 /api/pack/<name>/raw?path=<rel>（any=1 放行 .mcmeta 等扩展）；
   文件根模式（对比结果等任意文件夹）走 /api/file/raw?path=<join(root,rel)>（file 接口直接读任意路径，无需 any） */
function rawUrl(api, packName, rel, fileRoot, any) {
  if (fileRoot) return fileUrl(joinPath(fileRoot, rel))
  const q = any ? '&any=1' : ''
  return apiUrl(`${api}/${encodeURIComponent(packName)}/raw?path=${encodeURIComponent(rel)}${q}`)
}

/* 贴图缓存键：包模式与文件根模式命名空间隔离，避免对比场景与包场景贴图混缓存 */
function texCacheKey(api, packName, texPath, fileRoot) {
  return fileRoot ? `file:${fileRoot}:${texPath}` : `${api}:${packName}:${texPath}`
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const j = await res.json()
  /* raw 接口失败响应为 200 + {ok:false} 包裹（fail() 不改状态码）：显式判定失败，
     否则错误对象被当作模型 JSON 使用 → parent 链静默丢失 elements/textures */
  if (j && j.ok === false) throw new Error((j && j.msg) || 'bad response')
  return j
}

async function fetchOkData(path) {
  const res = await fetch(apiUrl(path))
  const j = await res.json()
  if (!j || !j.ok) throw new Error((j && j.msg) || 'bad response')
  return j.data
}

/* parent 引用 → 包内模型路径："minecraft:block/cube" / "block/cube" → assets/minecraft/models/block/cube.json */
export function parentModelPath(parent) {
  if (typeof parent !== 'string' || !parent) return null
  let ns = 'minecraft', rest = parent
  const ci = parent.indexOf(':')
  if (ci >= 0) { ns = parent.slice(0, ci); rest = parent.slice(ci + 1) }
  if (!rest) return null
  return `assets/${ns}/models/${rest}.json`
}

/* 贴图引用 → 包内贴图路径："minecraft:block/stone" → assets/minecraft/textures/block/stone.png；
   引用已带图片扩展名（社区包写法）不再追加，防 stone.png.png */
const TEX_REF_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i

export function textureAssetPath(ref) {
  if (typeof ref !== 'string' || !ref) return null
  let ns = 'minecraft', rest = ref
  const ci = ref.indexOf(':')
  if (ci >= 0) { ns = ref.slice(0, ci); rest = ref.slice(ci + 1) }
  if (!rest) return null
  return `assets/${ns}/textures/${TEX_REF_EXT_RE.test(rest) ? rest : rest + '.png'}`
}

/* #引用键未定义时的方向别名回退（社区模型常见断链：faces 引用 #up/#north 而
   textures 表内仅有 top/bottom 等非标键，或反向命名）。仅补原本解析失败
   （灰色占位 / UV 面跳过）的场景，已定义键不受影响；防环 guard 贯穿回退链 */
const TEX_REF_FALLBACK = {
  north: ['side', 'all'], south: ['side', 'all'], east: ['side', 'all'], west: ['side', 'all'],
  side: ['all'], all: ['side'],
  up: ['top', 'all'], top: ['up', 'all'],
  down: ['bottom', 'all'], bottom: ['down', 'all'],
}

/* 解析 "#side" 引用链（textures 表内互引，防环）到最终贴图路径 */
export function resolveTextureRef(textures, ref, seen) {
  if (typeof ref !== 'string' || !ref) return null
  const guard = seen || new Set()
  if (guard.has(ref)) return null
  guard.add(ref)
  if (ref.startsWith('#')) {
    const key = ref.slice(1)
    const val = (textures && typeof textures === 'object') ? textures[key] : undefined
    if (typeof val === 'string' && val) return resolveTextureRef(textures, val, guard)
    for (const alt of TEX_REF_FALLBACK[key] || []) {
      const hit = resolveTextureRef(textures, '#' + alt, guard)
      if (hit) return hit
    }
    return null
  }
  return textureAssetPath(ref)
}

/* 旧版/社区包的贴图别名展开（vanilla Deserializer 行为）：
   all → 六方向，side → 四水平方向（putIfAbsent 语义；保留原键以便 "#all" 引用仍可解析） */
export function expandTextureAliases(textures) {
  const out = { ...(textures && typeof textures === 'object' ? textures : {}) }
  const fill = (src, keys) => {
    if (typeof src !== 'string' || !src) return
    for (const k of keys) if (out[k] == null) out[k] = src
  }
  fill(out.all, ['down', 'up', 'north', 'south', 'east', 'west'])
  fill(out.side, ['north', 'south', 'east', 'west'])
  return out
}

/* ── 内置 vanilla 基础模型（parent 断链兜底）────────────────
    普通资源包不含 vanilla 基类文件（block/cube 等），模型 parent 链指向它们时
    fetch 404 → 旧实现静默吞掉 → elements/textures 丢失 → 空模型或贴图全灰。
    兜底：fetch 失败时按包内相对路径查此表继续解析（包内存在同路径文件时优先包内
    覆盖版本）；textures 键与 vanilla 一致，配合 expandTextureAliases 展开工作。
    未收录的衍生基类（cube_column 等）断链时仍按原行为跳过。 */
const BUILTIN_PARENT_MODELS = {
  'assets/minecraft/models/block/cube.json': {
    elements: [{
      from: [0, 0, 0], to: [16, 16, 16],
      faces: {
        down: { texture: '#down' }, up: { texture: '#up' },
        north: { texture: '#north' }, south: { texture: '#south' },
        west: { texture: '#west' }, east: { texture: '#east' },
      },
    }],
  },
  'assets/minecraft/models/block/cube_all.json': {
    parent: 'minecraft:block/cube',
    textures: { all: '#all' },
  },
  'assets/minecraft/models/block/cube_bottom_top.json': {
    parent: 'minecraft:block/cube',
    textures: { down: '#end', up: '#end', side: '#side' },
  },
  'assets/minecraft/models/block/block.json': {},
  'assets/minecraft/models/item/generated.json': {},
  'assets/minecraft/models/item/handheld.json': { parent: 'minecraft:item/generated' },
}

/* fetch 模型 JSON 并沿 parent 链合并：elements 取最近定义层，textures 子覆盖父。
    包内不存在时回退内置 vanilla 基类（普通资源包不含基类文件）。
    合并在原始 textures 表上进行（子键覆盖父键，all/side 别名不参与中间合并），
    最外层解析完成后统一展开一次——若逐层先展开再合并，子层的 side 展开键
    （north/south/east/west）会错误覆盖父层的显式方向键（command_block 的
    north=#front / south=#back 被覆盖成 #side → front/back 贴图丢失）。 */
async function resolveMcModelRaw(api, packName, rel, depth = 0, fileRoot) {
  const url = rawUrl(api, packName, rel, fileRoot, true)
  let model
  try {
    model = await fetchJson(url)
  } catch (e) {
    const builtin = BUILTIN_PARENT_MODELS[rel]
    if (!builtin) throw e
    model = builtin
  }
  if (!model || typeof model !== 'object') throw new Error('invalid model json')
  let elements = Array.isArray(model.elements) ? model.elements : null
  const textures = (model.textures && typeof model.textures === 'object') ? model.textures : {}
  if (model.parent && depth < MAX_PARENT_DEPTH) {
    const parentRel = parentModelPath(model.parent)
    if (parentRel) {
      try {
        const p = await resolveMcModelRaw(api, packName, parentRel, depth + 1, fileRoot)
        if (!elements && p.elements.length) elements = p.elements
        const merged = { ...p.textures }
        for (const k in textures) merged[k] = textures[k]
        return { elements: elements || [], textures: merged }
      } catch {}
    }
  }
  return { elements: elements || [], textures }
}

export async function resolveMcModel(api, packName, rel, depth = 0, fileRoot) {
  const { elements, textures } = await resolveMcModelRaw(api, packName, rel, depth, fileRoot)
  return { elements, textures: expandTextureAliases(textures) }
}

/* ── 1.21.4+ 物品模型定义（assets/<ns>/items/*.json）────────
   结构：{ model: <节点> }，节点按 type 递归解析出要渲染的普通模型引用：
     model          → 引用 models/ 路径（可带 transformation / tints）
     condition      → 取 on_false（属性默认未满足态，如弓未拉弦）
     select / range_dispatch → 取 fallback
     composite      → 收集 models 数组全部引用（多模型合并渲染）
     special        → base 引用（盾/旗等内置实体渲染之外的基础形状）
   未知类型忽略；tints（染色）不影响几何，跳过 */
export function resolveItemDefRefs(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > MAX_ITEM_DEF_DEPTH) return out
  const type = typeof node.type === 'string' ? node.type.replace(/^[^:]*:/, '') : ''
  switch (type) {
    case 'model':
      if (typeof node.model === 'string' && node.model) {
        out.push({ model: node.model, transformation: node.transformation || null })
      }
      break
    case 'condition':
      resolveItemDefRefs(node.on_false, out, depth + 1)
      break
    case 'select':
    case 'range_dispatch':
      resolveItemDefRefs(node.fallback, out, depth + 1)
      break
    case 'composite':
      for (const m of Array.isArray(node.models) ? node.models : []) {
        resolveItemDefRefs(m, out, depth + 1)
      }
      break
    case 'special':
      if (typeof node.base === 'string' && node.base) {
        out.push({ model: node.base, transformation: node.transformation || null })
      }
      break
    default: break
  }
  return out
}

/* item 定义路径判定（assets/<ns>/items/*.json，与 models/ 路径区分） */
export function isItemDefPath(rel) {
  return typeof rel === 'string' && /^assets\/[^/]+\/items\/[^/]+\.json$/.test(rel)
}

/* 统一模型资产解析入口：rel 为 models/ 路径或 items/ 定义路径。
    返回 { parts: [{ elements, textures, transform }] }（多 parts 仅出现在 composite）；
    模型文件不存在 / 非法 → parts 空（shown:false 语义） */
export async function resolveMcModelAsset(api, packName, rel, fileRoot) {
  if (!isItemDefPath(rel)) {
    try {
      const { elements, textures } = await resolveMcModel(api, packName, rel, 0, fileRoot)
      return { parts: [{ elements, textures, transform: null }] }
    } catch {
      return { parts: [] }
    }
  }
  const url = rawUrl(api, packName, rel, fileRoot, true)
  let def = null
  try { def = await fetchJson(url) } catch {}
  const refs = resolveItemDefRefs(def && def.model).slice(0, MAX_ITEM_DEF_REFS)
  const parts = []
  for (const r of refs) {
    const mp = parentModelPath(r.model)
    if (!mp) continue
    try {
      const { elements, textures } = await resolveMcModel(api, packName, mp, 0, fileRoot)
      parts.push({ elements, textures, transform: r.transformation || null })
    } catch {}
  }
  return { parts }
}

/* item 定义 transformation（块单位）应用到子模型 Group：
   顶点变换 T + L*(S*(R*v))——外层 position/quaternion 承载 T/L，scale 承载 S，
   right_rotation 非单位四元数时经内层 Group 承载 R（保持与 vanilla 组合顺序一致）。
   负 scale（镜像）翻转三角绕序，材质置 DoubleSide 防背面剔除消失 */
export function applyItemTransformation(group, tr) {
  if (!group || !tr || typeof tr !== 'object') return group
  const t = Array.isArray(tr.translation) ? tr.translation : null
  if (t && t.length >= 3 && t.every(n => Number.isFinite(+n))) {
    group.position.set(+t[0], +t[1], +t[2])
  }
  const toQuat = (q) => {
    if (!Array.isArray(q) || q.length < 4 || !q.every(n => Number.isFinite(+n))) return null
    return new THREE.Quaternion(+q[0], +q[1], +q[2], +q[3]).normalize()
  }
  const lq = toQuat(tr.left_rotation)
  if (lq) group.quaternion.copy(lq)
  const s = Array.isArray(tr.scale) ? tr.scale : null
  const rq = toQuat(tr.right_rotation)
  if (s && s.length >= 3 && s.every(n => Number.isFinite(+n))) {
    group.scale.set(+s[0], +s[1], +s[2])
    if (rq) {
      const inner = new THREE.Group()
      inner.quaternion.copy(rq)
      for (const c of [...group.children]) inner.add(c)
      group.add(inner)
    }
    if (+s[0] < 0 || +s[1] < 0 || +s[2] < 0) {
      group.traverse(o => {
        const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])
        for (const m of mats) { if (m && !(m.userData && m.userData.shared)) m.side = THREE.DoubleSide }
      })
    }
  }
  return group
}

function parseVec3(v, fallback) {
  if (Array.isArray(v) && v.length >= 3 && v.every(n => Number.isFinite(+n))) return [+v[0], +v[1], +v[2]]
  if (typeof v === 'string') {
    const a = v.split(',').map(s => +s.trim())
    if (a.length >= 3 && a.every(n => Number.isFinite(n))) return a.slice(0, 3)
  }
  return fallback
}

function parseUv(uv) {
  const a = Array.isArray(uv) ? uv : (typeof uv === 'string' ? uv.split(',').map(s => +s.trim()) : null)
  if (a && a.length === 4 && a.every(n => Number.isFinite(n))) return a
  return null
}

/* face.rotation（0/90/180/270，顺时针）：几何四角 [TL,TR,BL,BR] 的采样角随之轮转
   （贴图顺时针转 90° 后，原 BL 像素显示在几何 TL 位置：TL←BL, TR←TL, BL←BR, BR←TR） */
const FACE_ROT_ORDER = {
  90:  [2, 0, 3, 1],
  180: [3, 2, 1, 0],
  270: [1, 3, 0, 2],
}

/* vanilla 默认 UV（face 无 uv 字段时按元素 from/to 尺寸计算，v 自顶向下）：
   水平面 u 取 x 范围、v 取 z 范围（down 垂直翻转）；侧面 v 取 y 范围（16-to.y → 16-from.y）；
   north/east 面贴图相对世界坐标水平翻转（观察方向所致）。
   例：蛋糕主体 [1,0,1]→[15,8,15]：up→[1,1,15,15]（cake_top 中央 14×14），
   side→u 1-15 / v 8-16（cake_side 下半），而非整张 16×16 拉伸。
   uvScale≠16（bbmodel resolution）时按比例换算 */
export function defaultFaceUv(key, from, to, uvScale = 16) {
  if (!Array.isArray(from) || !Array.isArray(to)) return null
  const fx = +from[0], fy = +from[1], fz = +from[2]
  const tx = +to[0], ty = +to[1], tz = +to[2]
  if (![fx, fy, fz, tx, ty, tz].every(Number.isFinite)) return null
  let uv
  switch (key) {
    case 'up':    uv = [fx, fz, tx, tz]; break
    case 'down':  uv = [fx, 16 - tz, tx, 16 - fz]; break
    case 'north': uv = [16 - tx, 16 - ty, 16 - fx, 16 - fy]; break
    case 'south': uv = [fx, 16 - ty, tx, 16 - fy]; break
    case 'east':  uv = [16 - tz, 16 - ty, 16 - fz, 16 - fy]; break
    case 'west':  uv = [fz, 16 - ty, tz, 16 - fy]; break
    default: return null
  }
  if (uvScale && uvScale !== 16) {
    const s = uvScale / 16
    uv = uv.map(v => v * s)
  }
  return uv
}

/* BoxGeometry 每面 4 顶点 UV（左上/右上/左下/右下）按 MC 像素坐标重映射（uvScale=16 或 bbmodel resolution）
   无 uv 的 face 用 vanilla 默认 UV（按元素尺寸），防止整张贴图拉伸 */
function applyFaceUvs(geo, faces, uvScale, from, to) {
  if (!faces || typeof faces !== 'object') return
  const uvAttr = geo.attributes.uv
  if (!uvAttr) return
  for (const key of FACE_KEYS) {
    const f = faces[key]
    if (!f || typeof f !== 'object') continue
    const uv = parseUv(f.uv) || defaultFaceUv(key, from, to, uvScale)
    if (!uv) continue
    /* u1/u2 与 v1/v2 支持翻转（uv[2] < uv[0] 时为水平镜像采样） */
    const u1 = uv[0] / uvScale, u2 = uv[2] / uvScale
    const v1 = 1 - uv[1] / uvScale, v2 = 1 - uv[3] / uvScale
    const corners = [[u1, v1], [u2, v1], [u1, v2], [u2, v2]]
    const rot = Number.isFinite(+f.rotation) ? ((Math.round(+f.rotation / 90) * 90) % 360 + 360) % 360 : 0
    const order = FACE_ROT_ORDER[rot] || [0, 1, 2, 3]
    const i = MAT_INDEX[key] * 4
    for (let k = 0; k < 4; k++) {
      const c = corners[order[k]]
      uvAttr.setXY(i + k, c[0], c[1])
    }
  }
  uvAttr.needsUpdate = true
}

/* element 变换：MC 单轴旋转 / bbmodel 欧拉旋转均绕 origin，几何中心置于元素中心 */
function applyElementTransform(mesh, el, center) {
  const c = [(center[0] - 8) / 16, (center[1] - 8) / 16, (center[2] - 8) / 16]
  const rot = el.rotation
  if (!rot) { mesh.position.set(c[0], c[1], c[2]); return }
  const origin = parseVec3(Array.isArray(rot) ? el.origin : rot.origin, [8, 8, 8]).map(v => (v - 8) / 16)
  if (Array.isArray(rot)) {
    mesh.rotation.set(
      (+rot[0] || 0) * Math.PI / 180,
      (+rot[1] || 0) * Math.PI / 180,
      (+rot[2] || 0) * Math.PI / 180,
    )
  } else if (rot.axis === 'x' || rot.axis === 'y' || rot.axis === 'z') {
    mesh.rotation[rot.axis] = (+rot.angle || 0) * Math.PI / 180
  } else {
    mesh.position.set(c[0], c[1], c[2]); return
  }
  /* position = origin + R(center - origin) */
  const off = new THREE.Vector3(c[0] - origin[0], c[1] - origin[1], c[2] - origin[2])
  off.applyEuler(mesh.rotation)
  mesh.position.set(origin[0] + off.x, origin[1] + off.y, origin[2] + off.z)
}

/* faces "all" 简写展开（bbmodel / 社区模型）：复制到未定义的方向面（不改原对象） */
function expandElementFaces(el) {
  let faces = (el && el.faces && typeof el.faces === 'object') ? el.faces : {}
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
    const sx = Math.abs(to[0] - from[0]) || 0.01, sy = Math.abs(to[1] - from[1]) || 0.01, sz = Math.abs(to[2] - from[2]) || 0.01
    const geo = new THREE.BoxGeometry(sx / 16, sy / 16, sz / 16)
    const faces = expandElementFaces(el)
    applyFaceUvs(geo, faces, scale, from, to)
    const mats = FACE_KEYS.map(key => {
      const m = matFor(key, faces[key], el)
      return m || HIDDEN_MAT
    })
    const mesh = new THREE.Mesh(geo, mats)
    mesh.castShadow = true; mesh.receiveShadow = true
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

function makeModelMaterial(tex) {
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.9, metalness: 0.0, alphaTest: 0.5 })
  if (tex) m.map = applyTexParams(tex)
  return m
}

function loadTextureCached(key, url) {
  if (!texCache.has(key)) {
    const loader = new THREE.TextureLoader()
    /* 失败不缓存（下次可重试） */
    const p = loader.loadAsync(url).catch(() => { texCache.delete(key); return null })
    texCache.set(key, p)
  }
  return texCache.get(key)
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
export function parseAnimMeta(meta, texW, texH) {
  const anim = (meta && typeof meta === 'object') ? meta.animation : null
  if (!anim || typeof anim !== 'object') return null
  const w = Number.isFinite(+texW) ? +texW : 0
  const h = Number.isFinite(+texH) ? +texH : 0
  if (w <= 0 || h <= 0) return null
  const fw = Number.isFinite(+anim.width) && +anim.width > 0 ? Math.floor(+anim.width) : w
  const fh = Number.isFinite(+anim.height) && +anim.height > 0 ? Math.floor(+anim.height) : fw
  if (fw <= 0 || fh <= 0 || fw > w || fh > h) return null
  const frameCount = Math.floor(h / fh)
  if (frameCount <= 1) return null
  const defaultTicks = Math.max(1, Math.round(Number.isFinite(+anim.frametime) ? +anim.frametime : 1))
  const timeline = []
  if (Array.isArray(anim.frames)) {
    for (const f of anim.frames) {
      let index = -1, ticks = defaultTicks
      if (typeof f === 'number' && Number.isFinite(f)) index = Math.floor(f)
      else if (f && typeof f === 'object' && Number.isFinite(+f.index)) {
        index = Math.floor(+f.index)
        if (Number.isFinite(+f.time) && +f.time > 0) ticks = Math.max(1, Math.round(+f.time))
      }
      if (index < 0 || index >= frameCount) continue
      timeline.push({ index, ticks })
    }
  }
  if (!timeline.length) for (let i = 0; i < frameCount; i++) timeline.push({ index: i, ticks: defaultTicks })
  const totalTicks = timeline.reduce((s, f) => s + f.ticks, 0)
  return { texW: w, texH: h, frameW: fw, frameH: fh, frameCount, timeline, totalSec: totalTicks / TICKS_PER_SEC }
}

/* 播放时刻（秒）→ 帧号：帧边界均为整数 tick，换算到 tick 域比较（避免浮点累积误差），循环播放 */
export function animFrameIndexAt(anim, tSec) {
  const tl = anim && anim.timeline
  if (!tl || !tl.length) return 0
  const totalSec = anim.totalSec
  const t = totalSec > 0 ? (tSec % totalSec) : 0
  const tick = Math.max(0, Math.floor(t * TICKS_PER_SEC))
  let acc = 0
  for (const f of tl) {
    acc += f.ticks
    if (tick < acc) return f.index
  }
  return tl[tl.length - 1].index
}

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
const animMetaCache = new Map()   /* key → Promise<object|null> */

function loadAnimMetaCached(key, url) {
  if (!animMetaCache.has(key)) animMetaCache.set(key, fetchJson(url).catch(() => null))
  return animMetaCache.get(key)
}

/* 动画贴图注册表 + rAF 驱动循环（注册表空时停转；无 rAF 环境（node 单测）安全跳过） */
const animatedTexs = new Map()   /* THREE.Texture → anim */
let animRAF = 0

function scheduleAnimTick() {
  if (animRAF || typeof requestAnimationFrame !== 'function') return
  animRAF = requestAnimationFrame(() => {
    animRAF = 0
    if (!animatedTexs.size) return
    const now = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now()
    for (const [tex, anim] of animatedTexs) applyTexAnimFrame(tex, anim, animFrameIndexAt(anim, now / 1000))
    scheduleAnimTick()
  })
}

function texImageSize(tex) {
  const img = tex && tex.image
  if (!img) return null
  const w = +img.naturalWidth || +img.width || 0
  const h = +img.naturalHeight || +img.height || 0
  return (w > 0 && h > 0) ? { w, h } : null
}

/* 收集 group 内动画贴图的 { tex, anim }（去重；离屏缩略图多帧渲染用：
    逐帧 applyTexAnimFrame + animFrameIndexAt 驱动采样窗口） */
export function getModelTexAnims(group) {
  const out = []
  if (!group || typeof group.traverse !== 'function') return out
  group.traverse(o => {
    if (!o || !o.isMesh) return
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])
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
  if (!size) { applyTexParams(tex); return Promise.resolve(null) }
  return metaPromise.then(meta => {
    applyTexParams(tex)
    const anim = parseAnimMeta(meta, size.w, size.h)
    if (!anim) return null
    applyTexAnimFrame(tex, anim, 0)
    animatedTexs.set(tex, anim)
    scheduleAnimTick()
    return anim
  }).catch(() => { applyTexParams(tex); return null })
}

/* 贴图同目录动画元数据 URL（raw 接口 any=1 放行 .mcmeta 扩展名） */
function packMcmetaUrl(api, packName, texPath, fileRoot) {
  return rawUrl(api, packName, texPath + '.mcmeta', fileRoot, true)
}

/* MC 面材质：faces[key].texture（"#ref" / "ns:path"）→ 包内贴图；引用缺失用占位材质。
    贴图异步加载完成后写入 mat.map（mcmeta 请求与贴图并行，动画贴图先配好帧采样再挂载）；
    失败置 mat.userData.texFailed。
    userData.texReady：贴图加载流程 promise（终态必 resolve：成功设 map / 失败置 texFailed），
    离屏缩略图据此事件驱动等待（替代轮询 mat.map） */
export function mcMatFor(textures, api, packName, fileRoot) {
  return (key, face) => {
    if (!face || typeof face !== 'object' || typeof face.texture !== 'string') return null
    const texPath = resolveTextureRef(textures, face.texture)
    if (!texPath) return PLACEHOLDER_MAT
    const ck = texCacheKey(api, packName, texPath, fileRoot)
    const url = rawUrl(api, packName, texPath, fileRoot, false)
    const metaPromise = loadAnimMetaCached(ck + ':mcmeta', packMcmetaUrl(api, packName, texPath, fileRoot))
    const mat = makeModelMaterial(null)
    mat.userData.texReady = loadTextureCached(ck, url).then(tex => {
      if (mat.userData.replaced) return   /* 编辑器已换贴图：晚到的异步加载不覆盖 */
      if (!tex) { mat.userData.texFailed = true; return }
      return attachPackTexture(tex, metaPromise).then(() => {
        if (mat.userData.replaced) return
        mat.map = tex; mat.needsUpdate = true
      })
    })
    return mat
  }
}

/* item/generated 类模型（无 elements）：layer0 贴图竖直 sprite 平面 */
export function buildItemSpriteGroup(textures, api, packName, fileRoot) {
  const texPath = resolveTextureRef(textures, textures.layer0 != null ? '#layer0' : null)
  if (!texPath) return null
  const geo = new THREE.PlaneGeometry(1.2, 1.2)
  const mat = makeModelMaterial(null)
  mat.side = THREE.DoubleSide
  mat.transparent = true
  const ck = texCacheKey(api, packName, texPath, fileRoot)
  const url = rawUrl(api, packName, texPath, fileRoot, false)
  const metaPromise = loadAnimMetaCached(ck + ':mcmeta', packMcmetaUrl(api, packName, texPath, fileRoot))
  mat.userData.texReady = loadTextureCached(ck, url).then(tex => {
    if (mat.userData.replaced) return
    if (!tex) { mat.userData.texFailed = true; return }
    return attachPackTexture(tex, metaPromise).then(() => {
      if (mat.userData.replaced) return
      mat.map = tex; mat.needsUpdate = true
    })
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return group
}

/* bbmodel 面材质：faces[key].texture 为 textures 数组索引，source 为 base64 dataURL。
    cachePrefix 区分不同模型（Blockbench 贴图 id 在各模型间会重复） */
export function bbMatFor(bbTextures, cachePrefix) {
  const list = Array.isArray(bbTextures) ? bbTextures : []
  return (key, face) => {
    if (!face || typeof face !== 'object' || face.texture == null) return null
    const tex = list[+face.texture]
    if (!tex || typeof tex.source !== 'string' || !tex.source.startsWith('data:')) return PLACEHOLDER_MAT
    const mat = makeModelMaterial(null)
    const ck = cachePrefix + ':' + (tex.id != null ? String(tex.id) : (tex.name || tex.source.length))
    mat.userData.texReady = loadTextureCached(ck, tex.source).then(t => {
      if (mat.userData.replaced) return
      if (t) { mat.map = applyTexParams(t); mat.needsUpdate = true }
      else mat.userData.texFailed = true
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
  return Number.isFinite(+rot) ? ((Math.round(+rot / 90) * 90) % 360 + 360) % 360 : 0
}

function texDisplayName(texPath) {
  return texPath.replace(/^assets\/[^/]+\/textures\//, '').replace(TEX_REF_EXT_RE, '')
}

/* MC elements + textures 表 → 布局（贴图去重：texPath → 索引） */
export function buildMcLayout(elements, textures, api, packName, fileRoot) {
  const texList = []
  const texIndex = new Map()
  const texIndexOf = (texPath) => {
    if (!texIndex.has(texPath)) {
      texIndex.set(texPath, texList.length)
      texList.push({
        name: texDisplayName(texPath),
        url: rawUrl(api, packName, texPath, fileRoot, false),
        mcmetaUrl: packMcmetaUrl(api, packName, texPath, fileRoot),
      })
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
  return { type: 'mc', uvScale: 16, textures: texList, elements: outElements }
}

/* item/generated sprite 回退布局：layer0 整幅贴图单面（spriteEl 为合成 element 引用，供贴图替换联动） */
export function buildSpriteLayout(textures, api, packName, spriteEl, fileRoot) {
  textures = (textures && typeof textures === 'object') ? textures : {}
  const texPath = resolveTextureRef(textures, textures.layer0 != null ? '#layer0' : null)
  if (!texPath) return null
  return {
    type: 'mc', uvScale: 16, sprite: true,
    textures: [{
      name: texDisplayName(texPath),
      url: rawUrl(api, packName, texPath, fileRoot, false),
      mcmetaUrl: packMcmetaUrl(api, packName, texPath, fileRoot),
    }],
    elements: [{ faces: { sprite: { tex: 0, uv: [0, 0, 16, 16], rotation: 0, mirror: false } }, el: spriteEl || null }],
  }
}

/* bbmodel → 布局（无效贴图项过滤但保持索引对齐：faces.texture 引用原始数组下标） */
export function buildBbLayout(json) {
  json = (json && typeof json === 'object') ? json : {}
  const uvScale = Number.isFinite(+json.resolution) && +json.resolution > 0 ? +json.resolution : 16
  const raw = Array.isArray(json.textures) ? json.textures : []
  const texList = []
  const indexMap = raw.map(tex => {
    if (tex && typeof tex.source === 'string' && tex.source.startsWith('data:')) {
      texList.push({ name: tex.name || ('texture ' + texList.length), url: tex.source })
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
      const ti = indexMap[+face.texture]
      if (ti == null || ti < 0) continue
      const uv = parseUv(face.uv) || defaultFaceUv(key, from, to, uvScale) || [0, 0, uvScale, uvScale]
      out[key] = { tex: ti, uv, rotation: normFaceRotation(face.rotation), mirror: uv[2] < uv[0] }
    }
    if (Object.keys(out).length) outElements.push({ faces: out, el })
  }
  return { type: 'bb', uvScale, textures: texList, elements: outElements }
}

/* ── 模型编辑联动（uv-view 编辑 → 3D 实时更新 + 导出）──────────
   layout.elements[i].el 持有原始 element 引用（与 parts / bbmodel json 中的对象同一引用），
   编辑写回原始 element 后按引用从 activeElementMeshes 定位 mesh 重映射几何 UV；
   material3d 的渲染循环逐帧执行 → 变更下一帧即生效（实时预览）。 */

const activeElementMeshes = new Map()   /* 原始 element → mesh（当前展示模型） */
let activeExportModel = null            /* 导出信息：{ type:'mc', parts, filename } | { type:'bb', json, filename } */

/* 展示成功后绑定：收集 mesh.userData.mcElement → mesh 映射 + 导出信息（bindActiveModel 也可供测试注入） */
export function bindActiveModel(group, exportModel) {
  activeElementMeshes.clear()
  activeExportModel = exportModel || null
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
  const tex = (src && typeof src === 'object' && typeof src.texture === 'string') ? src.texture : undefined
  f = tex != null ? { texture: tex } : {}
  el.faces[faceKey] = f
  return f
}

function remapMeshFaceUv(mesh, el) {
  applyFaceUvs(
    mesh.geometry, el.faces,
    mesh.userData.uvScale || 16,
    parseVec3(el.from, [0, 0, 0]), parseVec3(el.to, [16, 16, 16]),
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

/* 贴图替换：dataURL → 更新 layout 中引用 texIndex 的所有面材质（含 sprite 单材质面） */
export async function updateModelTexture(texIndex, dataUrl, layout) {
  const lay = layout || lastLayout
  if (!lay || !Array.isArray(lay.elements)) return false
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return false
  let tex = null
  try {
    tex = await new THREE.TextureLoader().loadAsync(dataUrl)
  } catch { return false }
  if (!tex) return false
  applyTexParams(tex)
  let touched = 0
  for (const layEl of lay.elements) {
    const mesh = (layEl && layEl.el) ? activeElementMeshes.get(layEl.el) : null
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
        if (swapFaceTexture(mat, tex)) touched++
      } else if (mi == null && mesh.material && !Array.isArray(mesh.material)) {
        if (swapFaceTexture(mesh.material, tex)) touched++
      }
    }
  }
  return touched > 0
}

/* UV 视图 hover/选中 → 3D 视口对应面 emissive 高亮 */
let highlightedFace = null   /* { element, faceKey, mat } */

export function highlightModelFace(element, faceKey, on) {
  if (highlightedFace) {
    try { if (highlightedFace.mat.emissive) highlightedFace.mat.emissive.setHex(0x000000) } catch {}
    highlightedFace = null
  }
  if (!on) return true
  const mesh = activeElementMeshes.get(element)
  if (!mesh) return false
  const mi = MAT_INDEX[faceKey]
  const mat = (mi != null && Array.isArray(mesh.material))
    ? mesh.material[mi]
    : ((mi == null && mesh.material && !Array.isArray(mesh.material)) ? mesh.material : null)
  if (!mat || (mat.userData && mat.userData.shared)) return false
  try {
    if (!mat.emissive) return false
    mat.emissive.setHex(0x2e4a8f)
    highlightedFace = { element, faceKey, mat }
    return true
  } catch { return false }
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
    for (const k in (p.textures || {})) if (textures[k] == null) textures[k] = p.textures[k]
    for (const el of (p.elements || [])) elements.push(el)
  }
  if (!elements.length) return null
  return { filename: m.filename || 'model.json', json: { textures, elements } }
}

/* 最近一次成功展示的模型布局（无模型 / 已被清除时为 null） */
export function getLastModelLayout() { return lastLayout }

/* 模型成功展示后广播（uv-view 浮窗监听以自动刷新；无 DOM 环境安全跳过） */
function notifyModelShown(layout) {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mcmodel:shown', { detail: { layout } }))
    }
  } catch {}
}

/* ── 对外入口 ─────────────────────────────────────── */

/* 获取 Blockbench .bbmodel JSON（供缩略图离屏渲染复用） */
export async function fetchBbModelJson(id) {
  const data = await fetchOkData('/api/blockbench/models/' + encodeURIComponent(id))
  const json = data && data.json
  return (json && typeof json === 'object') ? json : null
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
      sub = buildModelGroup(part.elements, mcMatFor(part.textures, api, packName, fileRoot), 16)
      partLayout = buildMcLayout(part.elements, part.textures, api, packName, fileRoot)
    } else {
      /* sprite 合成 element（mesh 挂引用 → 贴图替换联动；UV 编辑不适用） */
      const spriteEl = { faces: { sprite: { texture: (part.textures && part.textures.layer0 != null) ? '#layer0' : undefined } } }
      sub = buildItemSpriteGroup(part.textures, api, packName, fileRoot)
      if (sub && sub.children[0]) sub.children[0].userData.mcElement = spriteEl
      noElements = true
      partLayout = buildSpriteLayout(part.textures, api, packName, spriteEl, fileRoot)
    }
    if (!sub || !sub.children.length) continue
    if (part.transform) { applyItemTransformation(sub, part.transform); anyTransform = true }
    if (!layout && partLayout) layout = partLayout
    subs.push(sub)
  }
  if (!subs.length) return { shown: false, noElements }
  /* 单部件无变换：直接展示（保持既有层级契约，children[0] 即 Mesh）；
     多部件/带变换：外层合并 Group——transformation 在内层子 Group 上，
     不被视口归一化（showCustomModel 重设 position/scale）覆盖 */
  let group
  if (subs.length === 1 && !anyTransform) group = subs[0]
  else { group = new THREE.Group(); for (const s of subs) group.add(s) }
  const shown = showCustomModel(group)
  if (shown) {
    lastLayout = layout
    notifyModelShown(layout)
    bindActiveModel(group, { type: 'mc', parts, filename: rel.split('/').pop() || 'model.json' })
  }
  return { shown, noElements }
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
      const spriteEl = { faces: { sprite: { texture: (part.textures && part.textures.layer0 != null) ? '#layer0' : undefined } } }
      lay = buildSpriteLayout(part.textures, api, packName, spriteEl, fileRoot)
    }
    if (!lay || !Array.isArray(lay.textures)) continue
    for (const tx of lay.textures) {
      if (tx && typeof tx.name === 'string' && !seen.has(tx.name)) seen.set(tx.name, tx.url)
    }
  }
  return [...seen].map(([name, url]) => ({ name, url }))
}

/* Blockbench .bbmodel → 3D 视口；返回 { shown } */
export async function viewBbModelInViewport({ id }) {
  const data = await fetchOkData('/api/blockbench/models/' + encodeURIComponent(id))
  const json = data && data.json
  if (!json || typeof json !== 'object' || !Array.isArray(json.elements) || !json.elements.length) {
    return { shown: false }
  }
  const uvScale = Number.isFinite(+json.resolution) && +json.resolution > 0 ? +json.resolution : 16
  const group = buildModelGroup(json.elements, bbMatFor(json.textures, 'bbm:' + id), uvScale)
  if (!group.children.length) return { shown: false }
  const shown = showCustomModel(group)
  if (shown) {
    lastLayout = buildBbLayout(json)
    notifyModelShown(lastLayout)
    bindActiveModel(group, { type: 'bb', json, filename: (id || 'model') + '.bbmodel' })
  }
  return { shown }
}

export function isViewportVisible() { return hasVisibleViewport() }
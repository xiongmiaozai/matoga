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
import { showCustomModel, showCustomModelPair, hasVisibleViewport, applyPbrMapsToModelMaterial } from './material3d.js'

import { apiUrl, fetchJson, fetchOkData, rawUrl, texCacheKey } from './mcv/utils.js'
import { TEX_REF_EXT_RE, expandTextureAliases, isSpecialTexPath, resolveTextureRef, spriteTexKey, texPathForRef, texUrlToRef, writeMcTexRef } from './mcv/tex-refs.js'
import { FACE_KEYS, MAT_INDEX, MAX_ELEMENTS, PLACEHOLDER_MAT, applyFaceUvs, buildModelGroup, defaultFaceUv, expandElementFaces, normFaceRotation, parseUv, parseVec3 } from './mcv/geometry.js'
import { animatedTexs, attachPackTexture, loadAnimMetaCached } from './mcv/anim.js'
import { applyTexParams } from './mcv/anim.js'
/* fileUrl / joinPath 内联（与 utils.js 同实现）：避免 import utils.js 触发 core.js 的
   DOM 依赖，保持本模块在 node 单测（NR_M3D_STUB）环境下可加载 */
const MAX_PARENT_DEPTH = 8
const MAX_ITEM_DEF_DEPTH = 12
const MAX_ITEM_DEF_REFS = 16
const texCache = new Map()   /* key → Promise<Texture|null> */

/* 最近一次成功展示的模型 UV 布局（uv-view 浮窗数据源） */
let lastLayout = null

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
  'assets/minecraft/models/item/template_shulker_box.json': {},
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

/* 模板模型文件名判定（template_*）：vanilla 约定模板自身不定义 textures，由子模型注入 */
export function isTemplateModelName(rel) {
  if (typeof rel !== 'string') return false
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  return name.startsWith('template_')
}

/* 模板模型（template_*）直接预览时 textures 全空 → 所有面回退灰色占位。借用同级目录下
   引用该模板为 parent 的子模型的 textures，让模板也能显示真实贴图。仅包模式生效
   （fileRoot 模式无列目录接口）；最多探测 60 个候选 .json，命中首个含贴图的子模型即止 */
export async function borrowTemplateTextures(api, packName, rel, fileRoot) {
  if (fileRoot || typeof api !== 'string' || typeof packName !== 'string' || !packName) return null
  const li = rel.lastIndexOf('/')
  if (li < 0) return null
  const dir = rel.slice(0, li)
  const selfName = rel.slice(li + 1)
  const m = rel.match(/^assets\/([^/]+)\/models\/(.+)\.json$/)
  if (!m) return null
  const withNs = m[1] + ':' + m[2]
  const noNs = m[2]
  let entries
  try {
    entries = await fetchOkData(`${api}/${encodeURIComponent(packName)}/entries?dir=${encodeURIComponent(dir)}`)
  } catch { return null }
  const files = (entries && Array.isArray(entries.files)) ? entries.files : []
  const candidates = files.map(f => f && f.name).filter(n =>
    typeof n === 'string' && n.endsWith('.json') && n !== selfName && !n.startsWith('template_'))
  for (const name of candidates.slice(0, 60)) {
    const childRel = dir + '/' + name
    let child
    try { child = await fetchJson(rawUrl(api, packName, childRel, fileRoot, true)) } catch { continue }
    if (!child || typeof child !== 'object' || typeof child.parent !== 'string') continue
    const cp = child.parent
    const cpNoNs = cp.includes(':') ? cp.slice(cp.indexOf(':') + 1) : cp
    if (cp !== withNs && cp !== noNs && cpNoNs !== withNs && cpNoNs !== noNs) continue
    const ct = (child.textures && typeof child.textures === 'object') ? child.textures : null
    if (ct && Object.keys(ct).length) return ct
  }
  return null
}

/* 统一模型资产解析入口：rel 为 models/ 路径或 items/ 定义路径。
    返回 { parts: [{ elements, textures, transform }] }（多 parts 仅出现在 composite）；
    模型文件不存在 / 非法 → parts 空（shown:false 语义） */
export async function resolveMcModelAsset(api, packName, rel, fileRoot) {
  if (!isItemDefPath(rel)) {
    try {
      let { elements, textures } = await resolveMcModel(api, packName, rel, 0, fileRoot)
      /* 模板模型贴图借用：有几何体 + textures 全空 + 文件名 template_* → 借子模型 textures */
      if (elements.length && !Object.keys(textures).length && isTemplateModelName(rel)) {
        const borrowed = await borrowTemplateTextures(api, packName, rel, fileRoot)
        if (borrowed) textures = expandTextureAliases(borrowed)
      }
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
export function mcMatFor(textures, api, packName, fileRoot, fallbackRoot, overrideUrl) {
  return (key, face) => {
    if (!face || typeof face !== 'object' || typeof face.texture !== 'string') return null
    const texPath = resolveTextureRef(textures, face.texture)
    if (!texPath) return PLACEHOLDER_MAT
    const ck = overrideUrl ? 'ov:' + overrideUrl : texCacheKey(api, packName, texPath, fileRoot)
    const url = overrideUrl || rawUrl(api, packName, texPath, fileRoot, false)
    const metaPromise = loadAnimMetaCached(ck + ':mcmeta', packMcmetaUrl(api, packName, texPath, fileRoot))
    const mat = makeModelMaterial(null)
    if (!overrideUrl && !isSpecialTexPath(texPath)) {
      const dot = texPath.lastIndexOf('.')
      if (dot >= 0) {
        const base = texPath.slice(0, dot), ext = texPath.slice(dot)
        applyPbrMapsToModelMaterial(mat, rawUrl(api, packName, base + '_n' + ext, fileRoot, false), rawUrl(api, packName, base + '_s' + ext, fileRoot, false))
      }
    }
    mat.userData.texReady = loadTextureCached(ck, url).then(async tex => {
      if (mat.userData.replaced) return
      if (tex) {
        await attachPackTexture(tex, metaPromise)
        if (mat.userData.replaced) return
        mat.map = tex; mat.needsUpdate = true
        return
      }
      if (!overrideUrl && fallbackRoot) {
        const fbCk = texCacheKey(api, packName, texPath, fallbackRoot)
        const fbUrl = rawUrl(api, packName, texPath, fallbackRoot, false)
        const fbTex = await loadTextureCached(fbCk, fbUrl)
        if (mat.userData.replaced || !fbTex) { if (!fbTex) mat.userData.texFailed = true; return }
        await attachPackTexture(fbTex, loadAnimMetaCached(fbCk + ':mcmeta', packMcmetaUrl(api, packName, texPath, fallbackRoot)))
        if (mat.userData.replaced) return
        mat.map = fbTex; mat.needsUpdate = true
        return
      }
      mat.userData.texFailed = true
    })
    return mat
  }
}

/* sprite 回退贴图键选择：优先 layer0（item/generated），缺失时回退 particle
   （shulker_box 等特殊渲染方块模型链仅含 particle 键，无 layer0 → 原先无法识别贴图） */
/* item/generated 类模型（无 elements）：layer0 贴图竖直 sprite 平面 */
export function buildItemSpriteGroup(textures, api, packName, fileRoot) {
  const texPath = resolveTextureRef(textures, spriteTexKey(textures))
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
  const texIndexOf = (texPath) => {
    if (!texIndex.has(texPath)) {
      texIndex.set(texPath, texList.length)
      texList.push({
        name: texDisplayName(texPath),
        url: rawUrl(api, packName, texPath, fileRoot, false),
        mcmetaUrl: packMcmetaUrl(api, packName, texPath, fileRoot),
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
  textures = (textures && typeof textures === 'object') ? textures : {}
  const texPath = resolveTextureRef(textures, spriteTexKey(textures))
  if (!texPath) return null
  return {
    type: 'mc', uvScale: 16, sprite: true,
    textures: [{
      name: texDisplayName(texPath),
      url: rawUrl(api, packName, texPath, fileRoot, false),
      mcmetaUrl: packMcmetaUrl(api, packName, texPath, fileRoot),
    }],
    texPaths: [texPath],
    elements: [{ faces: { sprite: { tex: 0, uv: [0, 0, 16, 16], rotation: 0, mirror: false } }, el: spriteEl || null }],
  }
}

/* bbmodel → 布局（无效贴图项过滤但保持索引对齐：faces.texture 引用原始数组下标）。
    texOrigin：原始 json.textures 下标 → 布局贴图索引（-1 无效项），供 UV 编辑器
    把替换后的内嵌贴图（dataURL）写回原始 bbmodel JSON 保存 */
export function buildBbLayout(json) {
  json = (json && typeof json === 'object') ? json : {}
  const uvScale = Number.isFinite(+json.resolution) && +json.resolution > 0 ? +json.resolution : 16
  const raw = Array.isArray(json.textures) ? json.textures : []
  const texList = []
  const texOrigin = raw.map(tex => {
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

const activeElementMeshes = new Map()   /* 原始 element → mesh（当前展示模型） */
let activeExportModel = null            /* 导出信息：{ type:'mc', parts, filename } | { type:'bb', json, filename } */

/* 展示成功后绑定：收集 mesh.userData.mcElement → mesh 映射 + 导出信息（bindActiveModel 也可供测试注入）；
    exportModel.ctx = { api, packName } 模型包上下文（mc 包模式传入，替换贴图时用于
    判断能否把新贴图转成标准 MC 引用；im/bb 等无包上下文不传 → 一律扩展引用形式） */
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
    其他 → 扩展引用），导出/保存即持久化，重新打开模型自动加载 */
export async function updateModelTexture(texIndex, texUrl, layout) {
  const lay = layout || lastLayout
  if (!lay || !Array.isArray(lay.elements)) return false
  if (typeof texUrl !== 'string' || !(texUrl.startsWith('data:') || /^https?:\/\//i.test(texUrl) || texUrl.startsWith('/'))) return false
  let tex = null
  try {
    tex = await new THREE.TextureLoader().loadAsync(texUrl)
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
  writeBackTexRef(texIndex, texUrl, lay)
  return touched > 0
}

/* 移除材质：清空 layout 中引用 texIndex 的所有面材质贴图（面变纯色；含 sprite 单材质面）。
    引用同步写回空值（重新打开模型 → 面灰色） */
export function clearModelTexture(texIndex, layout) {
  const lay = layout || lastLayout
  if (!lay || !Array.isArray(lay.elements)) return false
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
        if (clearFaceTexture(mat)) touched++
      } else if (mi == null && mesh.material && !Array.isArray(mesh.material)) {
        if (clearFaceTexture(mesh.material)) touched++
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
          .then(blob => (blob ? new Promise((resolve) => {
            const rd = new FileReader()
            rd.onload = () => resolve(String(rd.result))
            rd.onerror = () => resolve(null)
            rd.readAsDataURL(blob)
          }) : null))
          .then(dataUrl => { if (dataUrl) m.json.textures[rawIdx].source = dataUrl })
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


/* 获取导入模型 JSON（data/imported-models，可能是 .bbmodel 或 MC .json；供缩略图/视口复用） */
export async function fetchImportedModelJson(id) {
  const data = await fetchOkData('/api/imported-models/' + encodeURIComponent(id))
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
      const spriteEl = { faces: { sprite: { texture: spriteTexKey(part.textures) || undefined } } }
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
    notifyModelShown(lastLayout)
    bindActiveModel(group, { type: 'mc', parts, filename: rel.split('/').pop() || 'model.json', ctx: { api, packName } })
  }
  return { shown, noElements }
}


async function buildMcGroupFromRel(fileRoot, rel, texRoot, overrideUrl) {
  const texSource = texRoot || fileRoot
  const fbRoot = (texRoot && !overrideUrl) ? fileRoot : undefined
  const { parts } = await resolveMcModelAsset(undefined, undefined, rel, fileRoot)
  let layout = null
  const subs = []
  let anyTransform = false
  for (const part of parts) {
    let sub = null
    let partLayout = null
    if (part.elements.length) {
      sub = buildModelGroup(part.elements, mcMatFor(part.textures, undefined, undefined, texSource, fbRoot, overrideUrl), 16)
      partLayout = buildMcLayout(part.elements, part.textures, undefined, undefined, texSource)
    } else {
      const spriteEl = { faces: { sprite: { texture: spriteTexKey(part.textures) || undefined } } }
      sub = buildItemSpriteGroup(part.textures, undefined, undefined, texSource)
      if (sub && sub.children[0]) sub.children[0].userData.mcElement = spriteEl
      partLayout = buildSpriteLayout(part.textures, undefined, undefined, spriteEl, texSource)
    }
    if (!sub || !sub.children.length) continue
    if (part.transform) { applyItemTransformation(sub, part.transform); anyTransform = true }
    if (!layout && partLayout) layout = partLayout
    subs.push(sub)
  }
  if (!subs.length) return null
  let group
  if (subs.length === 1 && !anyTransform) group = subs[0]
  else { group = new THREE.Group(); for (const s of subs) group.add(s) }
  return { group, layout, parts, filename: rel.split('/').pop() || 'model.json' }
}

export async function viewMcModelPairInViewport({ left, right, isStale }) {
  const [lr, rr] = await Promise.all([
    left ? buildMcGroupFromRel(left.fileRoot, left.rel).catch(() => null) : Promise.resolve(null),
    right ? buildMcGroupFromRel(right.fileRoot, right.rel).catch(() => null) : Promise.resolve(null),
  ])
  if (isStale && isStale()) return { shown: false }
  if (!lr && !rr) return { shown: false }
  const shown = showCustomModelPair(lr && lr.group, rr && rr.group)
  if (shown) {
    lastLayout = (lr && lr.layout) || (rr && rr.layout)
    notifyModelShown(lastLayout)
    if (lr) bindActiveModel(lr.group, { type: 'mc', parts: lr.parts, filename: lr.filename })
    else if (rr) bindActiveModel(rr.group, { type: 'mc', parts: rr.parts, filename: rr.filename })
  }
  return { shown }
}

/* 贴图效果对比：左=左模型+左贴图，右=右模型+右贴图（模型或贴图缺失回退左侧）。
   右侧展示替换后模型与贴图的组合效果；左侧模型缺失时两侧几何均取右侧模型 */
export async function viewMcModelTexCompareInViewport({ left, right, rightRoot, leftTexUrl, rightTexUrl, isStale }) {
  const rGeo = right || left
  const [lr, rr] = await Promise.all([
    left ? buildMcGroupFromRel(left.fileRoot, left.rel, null, leftTexUrl).catch(() => null) : Promise.resolve(null),
    rGeo ? buildMcGroupFromRel(rGeo.fileRoot, rGeo.rel, rGeo === right ? rightRoot : rGeo.fileRoot, rightTexUrl).catch(() => null) : Promise.resolve(null),
  ])
  if (isStale && isStale()) return { shown: false }
  if (!lr && !rr) return { shown: false }
  const shown = showCustomModelPair(lr && lr.group, rr && rr.group)
  if (shown) {
    lastLayout = (lr && lr.layout) || (rr && rr.layout)
    notifyModelShown(lastLayout)
    if (lr) bindActiveModel(lr.group, { type: 'mc', parts: lr.parts, filename: lr.filename })
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
  const json = await fetchImportedModelJson(id)
  if (!json || typeof json !== 'object') return { shown: false }
  const isBb = !!(json.meta && (json.meta.format === 'bbmodel' || json.meta.model_format))
  if (isBb) {
    if (!Array.isArray(json.elements) || !json.elements.length) return { shown: false }
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
  /* MC .json：自包含 elements（导入文件无包上下文，贴图引用按命名空间解析，缺失回退占位） */
  if (!Array.isArray(json.elements) || !json.elements.length) return { shown: false }
  const textures = (json.textures && typeof json.textures === 'object') ? json.textures : {}
  const group = buildModelGroup(json.elements, mcMatFor(textures, undefined, undefined), 16)
  if (!group.children.length) return { shown: false }
  const shown = showCustomModel(group)
  if (shown) {
    const parts = [{ elements: json.elements, textures }]
    lastLayout = buildMcLayout(json.elements, textures, undefined, undefined)
    notifyModelShown(lastLayout)
    bindActiveModel(group, { type: 'mc', parts, filename: (id || 'model') + '.json' })
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
  let textures = (model.textures && typeof model.textures === 'object') ? model.textures : {}
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
  if (!group || !group.children.length) return { shown: false }
  const shown = showCustomModel(group)
  if (shown) {
    lastLayout = layout
    notifyModelShown(layout)
    bindActiveModel(group, { type: 'mc', parts: [{ elements: elements || [], textures, transform: null }], filename: (id || 'custom') + '.json', ctx: { api, packName } })
  }
  return { shown }
}

export function isViewportVisible() { return hasVisibleViewport() }

// 兼容既有导入路径：以下导出已迁至子模块
export { buildModelGroup, defaultFaceUv } from './mcv/geometry.js'
export { getModelTexAnims, applyTexAnimFrame, animFrameIndexAt, parseAnimMeta } from './mcv/anim.js'
export { texUrlToRef, writeMcTexRef, texPathForRef, textureAssetPath } from './mcv/tex-refs.js'
export { resolveTextureRef, expandTextureAliases, spriteTexKey } from './mcv/tex-refs.js'


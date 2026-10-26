/**
 * matoga - 材质 3D 视口：textures
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */

import * as THREE from 'three'
import { showCustomModel, showCustomModelPair, hasVisibleViewport, applyPbrMapsToModelMaterial } from '../material3d.js'
import { apiUrl, fetchJson, fetchOkData, rawUrl, texCacheKey } from './utils.js'
import { TEX_REF_EXT_RE, expandTextureAliases, isSpecialTexPath, resolveTextureRef, spriteTexKey, texPathForRef, texUrlToRef, writeMcTexRef } from './tex-refs.js'
import { FACE_KEYS, MAT_INDEX, MAX_ELEMENTS, PLACEHOLDER_MAT, applyFaceUvs, buildModelGroup, defaultFaceUv, expandElementFaces, normFaceRotation, parseUv, parseVec3 } from './geometry.js'
import { animatedTexs, attachPackTexture, loadAnimMetaCached } from './anim.js'
import { applyTexParams } from './anim.js'

export const texCache = new Map()   /* key → Promise<Texture|null> */


export function makeModelMaterial(tex) {
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.9, metalness: 0.0, alphaTest: 0.5 })
  if (tex) m.map = applyTexParams(tex)
  return m
}

export function loadTextureCached(key, url) {
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
export function packMcmetaUrl(api, packName, texPath, fileRoot) {
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

export function texDisplayName(texPath) {
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


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

// 公共门面：子模块的导出在此重新导出，保持既有导入路径（'./mc-model-viewer.js'）可用
export { parentModelPath, resolveMcModel, resolveItemDefRefs, isItemDefPath, isTemplateModelName, borrowTemplateTextures, resolveMcModelAsset, applyItemTransformation } from './mcv/model-resolve.js'
export { mcMatFor, buildItemSpriteGroup, bbMatFor } from './mcv/textures.js'
export { buildMcLayout, buildSpriteLayout, buildBbLayout, getLastModelLayout, resolveModelTexList } from './mcv/layout.js'
export { bindActiveModel, updateModelFaceUv, updateModelFaceRotation, updateModelTexture, clearModelTexture, highlightModelFace, exportActiveModelJson } from './mcv/face-edit.js'
export { fetchImportedModelJson, viewMcModelInViewport, viewMcModelPairInViewport, viewMcModelTexCompareInViewport, viewImportedModelInViewport, viewCustomModelInViewport, isViewportVisible, rerenderLastMcModel } from './mcv/view.js'
export { buildModelGroup, defaultFaceUv } from './mcv/geometry.js'
export { getModelTexAnims, applyTexAnimFrame, animFrameIndexAt, parseAnimMeta, attachTextureAnimOnly, unloadTextureAnim } from './mcv/anim.js'
export { getMcBiomes, getCurrentBiome, setCurrentBiome, sampleTintForTexture } from './mcv/biome.js'
export { texUrlToRef, writeMcTexRef, texPathForRef, textureAssetPath, resolveTextureRef, expandTextureAliases, spriteTexKey } from './mcv/tex-refs.js'


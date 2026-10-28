/**
 * matoga - 模型资产缩略图（离屏 three.js 渲染）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 为总资产库的模型类资产生成 3D 预览缩略图（与贴图缩略图 thumb-loader.js 同一架构：
 * 前端生成 → POST 上传 → 后端缓存 → GET 提供）：
 *  1. 复用 mc-model-viewer 的模型解析/构建（parent 链合并 + 内置 vanilla 基类回退、
 *     UV 重映射、包内贴图加载），构建出的 THREE.Group 不进 3D 视口，而是在离屏
 *     240×240（2x DPI → 480×480）WebGLRenderer 渲染；
 *  2. 相机取景按包围球自动定距（r / sin(fov/2)，任意比例不裁切恰满画面；item/generated
 *     sprite 模型取正面），透明背景 PNG；
 *  3. 贴图就绪事件驱动等待（材质 userData.texReady promise，超时渲染但不缓存半成品）；
 *  4. 动画贴图模型（.png.mcmeta）多帧缩略图：沿动画周期采样 2-8 帧（~10fps，
 *     按帧号组合签名去重——低帧率动画不存储重复帧）上传，后端按帧存储
 *     （frame 参数读取），卡片 <img> 定时轮换 src 循环播放；
 *  5. 渲染任务串行排队（共享单个离屏 S.renderer），模型 fetch 与贴图等待在队列外并行；
 *  6. IntersectionObserver 懒加载：卡片进入视口才触发（模型可能数以百计）；
 *  7. 缓存键为虚拟路径（packmodel:... / bb:...），staleness 用模型源 mtime。
 */

import * as THREE from 'three'
import {
  resolveMcModelAsset, mcMatFor, bbMatFor, buildModelGroup, buildItemSpriteGroup,
  applyItemTransformation, fetchImportedModelJson, getModelTexAnims,
  applyTexAnimFrame, animFrameIndexAt,
} from './mc-model-viewer.js'
import { S } from './mthumb/state.js'


/* 对外接口：原文件即从本模块导出，保持导入路径不变。 */
export { ensureModelThumb } from './mthumb/ensure.js'
export { waitForTextures } from './mthumb/render.js'
export { frameModelCamera, animFramePlan } from './mthumb/camera.js'
export { observeModelThumbs } from './mthumb/observer.js'

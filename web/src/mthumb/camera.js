/**
 * matoga - 模型缩略图：相机取景
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 model-thumb.js 按职责搬出，逻辑未改。
 */
import {
  resolveMcModelAsset, mcMatFor, bbMatFor, buildModelGroup, buildItemSpriteGroup,
  applyItemTransformation, fetchImportedModelJson, getModelTexAnims,
  applyTexAnimFrame, animFrameIndexAt,
} from '../mc-model-viewer.js'
import { ANIM_FPS, ANIM_MAX_FRAMES, ISO_DIR, SPRITE_DIR } from './constants.js'
import * as THREE from 'three'

export function frameModelCamera(camera, group, sprite) {
  const sphere = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere())
  const radius = Math.max(sphere.radius, 1e-3) || 1
  const dist = (radius / Math.sin(camera.fov * Math.PI / 360)) * 1.12
  camera.position.copy(sphere.center).addScaledVector(sprite ? SPRITE_DIR : ISO_DIR, dist)
  camera.lookAt(sphere.center)
  return camera
}

/* 动画模型多帧采样：帧数与延迟（~10fps，2-8 帧封顶控制缓存体积）。
    周期 T 取所有动画贴图中最长 totalSec——各贴图按同一时间轴对齐取帧号，
    多贴图不同周期的组合在 T 上不一定各自整循环，但每帧视觉状态均为合法采样。
    采样时刻按「帧号组合签名」去重：低帧率动画（command_block 4 帧/2s）的相邻
    均匀采样点常落在同一视觉帧，重复帧不重复存储/轮播（delay = T/去重帧数，
    单贴图 frametime 均匀时保持精确时序；多贴图组合为近似平均） */

export function animFramePlan(anims) {
  if (!anims.length) return null
  const T = anims.reduce((m, a) => Math.max(m, a.anim.totalSec || 0.1), 0.1)
  const n = Math.min(ANIM_MAX_FRAMES, Math.max(2, Math.round(T * ANIM_FPS)))
  const seen = new Set()
  const ts = []
  for (let i = 0; i < n; i++) {
    const t = (i * T) / n
    const sig = anims.map(({ anim }) => animFrameIndexAt(anim, t)).join(',')
    if (seen.has(sig)) continue
    seen.add(sig)
    ts.push(t)
  }
  /* 全部采样点同一视觉帧（理论边界）：按静态处理 */
  if (ts.length < 2) return null
  return { T, n: ts.length, ts, delay: Math.max(50, Math.round(T / ts.length * 1000)) }
}

/* 渲染缩略图：静态模型单帧；动画模型沿时间轴采样 n 帧（每帧同步设置全部动画
    贴图的采样窗口后 render，替代旧「rAF 推进到的随机相位帧」）。complete 为
    贴图就绪标记（partial 渲染结果不进后端缓存） */

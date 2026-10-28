/**
 * matoga - 模型缩略图：常量与缓存
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 model-thumb.js 按职责搬出，逻辑未改。
 */
import * as THREE from 'three'

export const THUMB_SIZE = 240
export const THUMB_DPR = 2              /* 高 DPI：drawing buffer 480×480，卡片高分屏不糊 */
export const TEX_WAIT_TIMEOUT = 1200    /* 事件驱动等待（无轮询 CPU 开销），慢网络下放宽上限 */

export const memCache = new Map()      /* 虚拟路径 → thumbUrl */
export const generating = new Map()    /* 虚拟路径 → Promise<thumbUrl|null> */
export const watched = new WeakMap()   /* 缩略图容器元素 → item（rebuild 重建 DOM 后自动失效） */






export const ISO_DIR = new THREE.Vector3(0.55, 0.5, -0.55).normalize()
export const SPRITE_DIR = new THREE.Vector3(0.12, 0.08, 1).normalize()


export const ANIM_FPS = 10
export const ANIM_MAX_FRAMES = 8


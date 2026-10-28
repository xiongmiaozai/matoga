/**
 * matoga - 材质 3D 视口：运行时状态
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 迁出。集中保存视口的可变状态，供各子模块共享读写
 * （ESM 的 import 绑定不可重新赋值，故用单一可变对象 S 承载）。
 */
import * as THREE from 'three'

export const S = {
  /* ── 渲染器 / 容器 ── */
  isWebGL2: false,
  scene: null,
  camera: null,
  renderer: null,
  animationId: 0,
  pmrem: null,
  envTexture: null,
  pmremTexture: null,
  container: null,
  initialized: false,
  hosts: new Set(),
  hostObserver: null,
  containerResizeObserver: null,
  currentGeo: 'cube',
  _hostReevalRAF: null,
  _resizeRAF: null,

  /* ── 内置预览 mesh ── */
  meshLeft: null,
  meshRight: null,
  labelLeft: null,
  labelRight: null,
  groundMesh: null,
  gridHelper: null,
  lightGroup: null,

  /* 自定义模型（MC .json / .bbmodel）托管容器，非空时内置预览 mesh 隐藏 */
  customModelGroup: null,

  /* ── 材质参数 ── */
  emissiveIntensity: 1.0,
  normalScale: 1.0,
  materialFormat: 'labpbr',
  formatDetectCallback: null,
  heightDetectCallback: null,
  sourceSide: 'dual',
  parallaxScale: 0.05,
  parallaxSteps: 32.0,
  parallaxMode: 2.0,
  parallaxAdaptive: 1.0,
  parallaxEnabled: true,
  parallaxShadow: 0.0,
  _lightDirTmp: new THREE.Vector3(),

  /* ── 光照 ── */
  currentLightPreset: 'studio',
  customLightConfig: null,

  /* ── 环境 ── */
  currentEnvMode: 'custom',
  groundVisible: false,
  envIntensity: 0.5,
  hdrTexture: null,
  hdrTextureOriginal: null,
  hdrTextureRotated: null,
  hdrRotation: 0,
  hdrUsage: 'both',
  hdrInfo: null,
  hdrRotateTimer: null,

  /* ── 程序化天空 ── */
  skyMesh: null,
  skyEnvTexture: null,
  skySunLight: null,
  skyTurbidity: 3,
  skyRayleigh: 2.5,
  skyMieCoefficient: 0.005,
  skyMieDirectionalG: 0.8,
  skySunElevation: 15,
  skySunAzimuth: 180,
  skyTintHex: 0xa0c0ff,
  skyBakeTimer: null,
  _skyTint: new THREE.Color(),

  /* ── 透明度 / 物理材质 ── */
  opacityMode: 'auto',
  opacityValue: 1.0,
  transmissionValue: 0.0,
  iorValue: 1.5,
  clearcoatValue: 0.0,
  textureFilter: 'nearest',
  mipmapsEnabled: true,
  anisotropyLevel: 4,
  alignOfficial: false,
  maxAnisotropy: 1,

  /* ── 相机 / 轨道 ── */
  rotX: 0, rotY: 0, targetRotX: 0, targetRotY: 0,
  isDragging: false, lastX: 0, lastY: 0,
  camDist: 3, targetCamDist: 3,
  autoRotate: true,
  camPanX: 0, camPanY: 0, targetPanX: 0, targetPanY: 0,
  dragMode: null,

  /* ── 自由飞行相机 ── */
  freeCamMode: false,
  flyPos: new THREE.Vector3(0, 0.5, 3),
  flyYaw: 0, flyPitch: 0,
  flyKeys: Object.create(null),
  _flyForward: new THREE.Vector3(),
  _flyRight: new THREE.Vector3(),
  _flyMove: new THREE.Vector3(),
  lastFrameTime: 0,
}

export const FLY_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'])
export const FLY_SPEED = 3
export const FLY_BOOST = 2.5

/* ── 光照预设表（纯数据，见 material3d/light-presets.js 迁入前先留在此处） ── */

/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 3D 材质预览：灯光预设
 *
 * 从 material3d.js 原样搬出，纯常量，无依赖。
 */

export const LIGHT_PRESETS = {
  studio: {
    name: '工作室',
    ambient: { color: 0xffffff, intensity: 0.25 },
    lights: [
      { color: 0xffffff, intensity: 1.2, pos: [3, 3, 4] },
      { color: 0xffffff, intensity: 0.8, pos: [-3, 2, 3] },
      { color: 0xccddff, intensity: 0.5, pos: [0, -3, 2] }
    ],
    env: {
      colors: ['#4a5a7a', '#2a2a4e', '#1a1a2e'],
      light: { color: 'rgba(255,240,200,0.98)', x: 128, y: 50, r: 30 }
    },
    bg: 0x1a1a2e
  },
  outdoor: {
    name: '户外阳光',
    ambient: { color: 0x88aacc, intensity: 0.4 },
    lights: [
      { color: 0xffffee, intensity: 2.5, pos: [4, 5, 2] },
      { color: 0x88aacc, intensity: 0.8, pos: [-4, 3, 3] },
      { color: 0xaaccff, intensity: 0.5, pos: [0, -2, 4] }
    ],
    env: { colors: ['#87ceeb', '#4682b4', '#2a3a5a'], light: { color: 'rgba(255,255,220,1.0)', x: 200, y: 30, r: 45 } },
    bg: 0x2a3a5a
  },
  soft: {
    name: '柔和均匀',
    ambient: { color: 0xffffff, intensity: 0.5 },
    lights: [
      { color: 0xffffff, intensity: 0.7, pos: [3, 2, 4] },
      { color: 0xffffff, intensity: 0.7, pos: [-3, 2, 4] },
      { color: 0xffffff, intensity: 0.5, pos: [0, -3, 3] },
      { color: 0xffffff, intensity: 0.5, pos: [0, 3, -3] }
    ],
    env: { colors: ['#606080', '#404060', '#303050'], light: null },
    bg: 0x303050
  },
  warm: {
    name: '暖光',
    ambient: { color: 0xffaa66, intensity: 0.3 },
    lights: [
      { color: 0xffaa66, intensity: 1.5, pos: [3, 2, 4] },
      { color: 0xffcc88, intensity: 0.8, pos: [-3, 3, 3] },
      { color: 0xff8844, intensity: 0.4, pos: [0, -2, 2] }
    ],
    env: { colors: ['#5a3a2a', '#3a2a1a', '#2a1a0a'], light: { color: 'rgba(255,180,100,0.9)', x: 128, y: 60, r: 35 } },
    bg: 0x2a1a0a
  },
  cool: {
    name: '冷光',
    ambient: { color: 0x66aaff, intensity: 0.3 },
    lights: [
      { color: 0x88ccff, intensity: 1.5, pos: [3, 3, 4] },
      { color: 0x4488ff, intensity: 0.8, pos: [-3, 2, 3] },
      { color: 0x66aaff, intensity: 0.4, pos: [0, -2, 2] }
    ],
    env: { colors: ['#2a3a5a', '#1a2a4a', '#0a1a3a'], light: { color: 'rgba(150,200,255,0.9)', x: 128, y: 50, r: 35 } },
    bg: 0x0a1a3a
  }
}

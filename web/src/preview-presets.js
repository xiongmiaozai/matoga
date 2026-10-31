/**
 * matoga - 预览面板：可复用常量与纯函数
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 preview-panel.js 的 initPreviewPanel 闭包中提取。这些定义只依赖
 * $() 与自身，不触碰闭包状态，提到模块级后可被直接复用与单测。
 */
import { $ } from './core.js'

export const hexToNum = hex => parseInt(hex.slice(1), 16)

export const numToHex = n => '#' + (n & 0xffffff).toString(16).padStart(6, '0')

/* 天空预设参数表（程序化天空与 HDR 预设共用） */
export const SKY_PRESETS = {
  clear: { elevation: 60, azimuth: 180, turbidity: 2, rayleigh: 2.5, mie: 0.004, mieG: 0.8, tint: '#a0c8ff' },
  partly: { elevation: 35, azimuth: 200, turbidity: 5, rayleigh: 2, mie: 0.008, mieG: 0.82, tint: '#b0c8e8' },
  overcast: { elevation: 20, azimuth: 180, turbidity: 18, rayleigh: 1.5, mie: 0.01, mieG: 0.85, tint: '#c0c4cc' },
  dawn: { elevation: 6, azimuth: 90, turbidity: 6, rayleigh: 2, mie: 0.01, mieG: 0.85, tint: '#ffc8a0' },
  dusk: { elevation: 5, azimuth: 270, turbidity: 7, rayleigh: 2, mie: 0.01, mieG: 0.85, tint: '#ffb090' },
  night: { elevation: -5, azimuth: 180, turbidity: 3, rayleigh: 0.3, mie: 0.003, mieG: 0.7, tint: '#2a3a5a' },
  noon: { elevation: 75, azimuth: 180, turbidity: 2, rayleigh: 1.2, mie: 0.003, mieG: 0.75, tint: '#c0d8ff' },
  sunset: { elevation: 4, azimuth: 270, turbidity: 8, rayleigh: 2, mie: 0.01, mieG: 0.85, tint: '#ffd0a0' }
}

/* 自定义材质预设收集的滑条 id 列表 */
export const MAT_PRESET_INPUTS = [
  'm3dMetalness',
  'm3dRoughness',
  'm3dNormal',
  'm3dEmissive',
  'm3dOpacity',
  'm3dTransmission',
  'm3dIOR',
  'm3dClearcoat'
]

/* 把某滑条 input 绑定到一个回调（回调收到值字符串与元素） */
export const bindInput = (id, fn) => {
  const el = $(id)
  if (el) el.addEventListener('input', e => fn(e.target.value, el))
}

/**
 * matoga - 工作区：核心调用桥
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 workspace.js 抽出。原先子模块（ws/layout.js、ws/presets.js）反向
 * import 主文件取这个函数，形成 workspace.js ↔ 子模块 的循环依赖；
 * 移到这里后子模块只依赖它，主文件也从这里取。
 */
export const call = (m, p, b) => window.matogaCore.call(m, p, b)

let _renderBar = () => {}

/** 主文件注入工作区栏渲染器，避免子模块反向 import 主文件形成循环依赖。 */
export function setWorkspaceBarRenderer(fn) {
  if (typeof fn === 'function') _renderBar = fn
}

export function renderWorkspaceBarVia() { _renderBar() }

/**
 * matoga - 节点画布：属性控件（共享状态）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 widgets.js 原样搬出。_hooks 与 _evalScheduled 被多个子模块读写，
 * 而 ESM 导入绑定只读（对导入的 let 赋值会抛 "Assignment to constant variable"），
 * 故挂在 S 上。三个包装函数（evaluate/_markDirty/toast）也放在这里统一导出。
 */
export const S = {
  hooks: { evaluate: () => {}, markDirty: () => {}, toast: () => {} },
  evalScheduled: false,
}

/** Inject editor callbacks (evaluate / markDirty / toast). */
export function setWidgetHooks(hooks) {
  S.hooks = { ...S.hooks, ...hooks }
}

export const evaluate = (...args) => S.hooks.evaluate(...args)
export const _markDirty = (...args) => S.hooks.markDirty(...args)
export const toast = (...args) => S.hooks.toast(...args)

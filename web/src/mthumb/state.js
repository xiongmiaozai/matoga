/**
 * matoga - 模型缩略图：共享状态
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 这三个值会被多个子模块重新赋值，而 ESM 导入绑定只读（对导入的 let 赋值会抛
 * "Assignment to constant variable"），因此挂在 S 对象上，读写都走属性访问。
 */
export const S = {
  renderer: null,   // 离屏 WebGLRenderer（首次 getRenderer 时创建）
  chain: Promise.resolve(), // 串行队列（渲染任务依次排队）
  io: null,         // IntersectionObserver 单例
}

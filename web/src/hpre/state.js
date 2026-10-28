/**
 * matoga - HDRI 预设面板：共享状态
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 这些状态被多个子模块读写，而 ESM 的导入绑定只读（对导入的 let 赋值会抛
 * "Assignment to constant variable"），因此统一挂在 S 对象上，读写都走属性访问。
 */
export const S = {
  previewWorker: null,
  previewWorkerSeq: 0,
  previewWorkerCallbacks: new Map(),
  currentSelectedPath: null,
  thumbQueue: [],
  activeThumbCount: 0,
  thumbTotal: 0,
  thumbLoaded: 0,
  previewState: null,
  previewRenderer: null,
  previewYaw: 0,
  previewAutoExposure: 1,
  previewKeyBound: false,
}

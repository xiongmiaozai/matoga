/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 中文本地化词条。
 *
 * 词条按域拆到 ./zh/ 下的分片，这里只负责合并导出：
 * 导入方仍然 `import zh from './locales/zh.js'`，导出形状与原单文件一致。
 */

import common from './zh/common.js'
import assets from './zh/assets.js'
import compare from './zh/compare.js'
import nodecanvas from './zh/nodecanvas.js'
import preview from './zh/preview.js'

export default {
  ...common,
  ...assets,
  ...compare,
  ...nodecanvas,
  ...preview,
}

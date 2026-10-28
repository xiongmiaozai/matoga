/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 英文本地化词条。
 *
 * 词条按域拆到 ./en/ 下的分片，这里只负责合并导出：
 * 导入方仍然 `import en from './locales/en.js'`，导出形状与原单文件一致。
 */

import common from './en/common.js'
import assets from './en/assets.js'
import compare from './en/compare.js'
import nodecanvas from './en/nodecanvas.js'
import preview from './en/preview.js'

export default {
  ...common,
  ...assets,
  ...compare,
  ...nodecanvas,
  ...preview,
}

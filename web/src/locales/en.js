/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */
// 语言包入口：按域拆分的词条合并为一个对象。
import common from './en/common.js'
import assets from './en/assets.js'
import compare from './en/compare.js'
import nodecanvas from './en/nodecanvas.js'
import preview from './en/preview.js'

export default { ...common, ...assets, ...compare, ...nodecanvas, ...preview }

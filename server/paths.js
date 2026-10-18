/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const path = require('path')

const PKG = !!process.pkg

const RES_ROOT = path.join(__dirname, '..')

const DATA_ROOT = PKG ? path.dirname(process.execPath) : path.join(__dirname, '..')

module.exports = { PKG, RES_ROOT, DATA_ROOT }
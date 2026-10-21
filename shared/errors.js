/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const CODES = {
  ERR_INVALID_PARAM: 'ERR_INVALID_PARAM',
  ERR_PATH_DENIED: 'ERR_PATH_DENIED',
  ERR_FS_NOT_FOUND: 'ERR_FS_NOT_FOUND',
  ERR_FS: 'ERR_FS',
  ERR_ALREADY_EXISTS: 'ERR_ALREADY_EXISTS',
  ERR_MC_NOT_ZIP: 'ERR_MC_NOT_ZIP',
  ERR_MC_BAD_MCMETA: 'ERR_MC_BAD_MCMETA',
  ERR_CANCELLED: 'ERR_CANCELLED',
  ERR_LAN_FORBIDDEN: 'ERR_LAN_FORBIDDEN',
  ERR_UNAUTHORIZED: 'ERR_UNAUTHORIZED',
  ERR_UNKNOWN: 'ERR_UNKNOWN'
}

class AppError extends Error {
  constructor(code, msg) {
    super(msg || code)
    this.name = 'AppError'
    this.code = CODES[code] ? code : ERR_UNKNOWN
  }
}

const ERR_UNKNOWN = CODES.ERR_UNKNOWN

module.exports = { CODES, AppError, ERR_UNKNOWN }
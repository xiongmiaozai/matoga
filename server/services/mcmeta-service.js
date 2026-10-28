/**
 * matoga - 资源包元数据服务（门面）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 按职责拆入 mcs/ 子模块，此处只做 re-export，保持既有 require 路径不变。
 *
 * 分层：consts/zip/mcmeta/packs-lite（无内部依赖）→ shared（共享纯函数）
 *       → analyze/models/packs（解析）→ textures/aggregate（聚合）→ browse（浏览）
 */

const consts_ = require('./mcs/consts')
const mcmeta_ = require('./mcs/mcmeta')
const models_ = require('./mcs/models')
const packs_ = require('./mcs/packs')
const textures_ = require('./mcs/textures')
const aggregate_ = require('./mcs/aggregate')
const browse_ = require('./mcs/browse')
const analyze_ = require('./mcs/analyze')
const zip_ = require('./mcs/zip')
const shared_ = require('./mcs/shared')

module.exports = {
  PACK_FORMAT_VERSIONS: consts_.PACK_FORMAT_VERSIONS,
  formatToVersions: consts_.formatToVersions,
  ZIP_EXTS: consts_.ZIP_EXTS,
  parseMcmetaText: mcmeta_.parseMcmetaText,
  analyzePack: models_.analyzePack,
  listOfficialPacks: packs_.listOfficialPacks,
  renamePack: packs_.renamePack,
  suggestName: packs_.suggestName,
  validPackName: packs_.validPackName,
  listPackTextures: textures_.listPackTextures,
  listPackTexGroups: aggregate_.listPackTexGroups,
  listPackModelGroups: aggregate_.listPackModelGroups,
  listPackEntries: browse_.listPackEntries,
  readPackFile: browse_.readPackFile,
  normalizeZipBrowseName: browse_.normalizeZipBrowseName,
  resolveDirPack: analyze_.resolveDirPack,
  parseZipCentralDirectory: zip_.parseZipCentralDirectory,
  statPack: shared_.statPack,
}

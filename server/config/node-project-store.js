/**
 * matoga - 节点项目存储（门面）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 按职责拆入 nps/ 子模块，此处只做 re-export，保持既有 require 路径不变。
 *
 * 目录结构：data/node-projects/<id>.mtgp/{meta.json,graph.json,textures/,thumb.jpg}
 */

const consts = require('./nps/consts')
const fsUtils = require('./nps/fs-utils')
const meta = require('./nps/meta')
const crud = require('./nps/crud')

module.exports = {
  DIR: consts.DIR, FORMAT: consts.FORMAT, VERSION: consts.VERSION,
  list: meta.list, save: crud.save, load: crud.load, remove: crud.remove, rename: crud.rename,
  exists: meta.exists, thumbPath: crud.thumbPath,
  sanitizeName: fsUtils.sanitizeName, projectDir: fsUtils.projectDir,
}

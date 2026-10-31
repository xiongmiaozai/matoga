/**
 * matoga - 原子写入工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * atomicWrite(file, data)：直接写入 data（data 已是字符串/Buffer）
 * atomicWriteJson(file, obj)：JSON.stringify 后原子写入
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + crypto.randomUUID() + '.tmp'
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

function atomicWriteJson(file, obj) {
  atomicWrite(file, JSON.stringify(obj, null, 2))
}

async function atomicWriteAsync(file, data) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.' + crypto.randomUUID() + '.tmp'
  await fs.promises.writeFile(tmp, data)
  await fs.promises.rename(tmp, file)
}

async function atomicWriteJsonAsync(file, obj) {
  await atomicWriteAsync(file, JSON.stringify(obj, null, 2))
}

module.exports = { atomicWrite, atomicWriteJson, atomicWriteAsync, atomicWriteJsonAsync }
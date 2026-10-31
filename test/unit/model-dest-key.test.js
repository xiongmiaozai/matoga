/**
 * 上传模型目标 key 计算单测（web/src/model-dest-key.js）：
 * 回归防护 —— 上传 .bbmodel 时保留原扩展名，避免内容写入 .json 路径导致 3D 预览解析失败。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')

const MOD_URL = pathToFileURL(require('node:path').resolve(__dirname, '../../web/src/model-dest-key.js')).href

test('setup: 加载 model-dest-key 模块', async () => {
  const m = await import(MOD_URL)
  globalThis.__mdk = m
  assert.equal(typeof m.modelDestKey, 'function')
})

test('modelDestKey: 同扩展名保持不变（.json 上传到 .json key）', () => {
  const { modelDestKey } = globalThis.__mdk
  assert.equal(
    modelDestKey('assets/minecraft/models/block/stone.json', '/tmp/abc/stone.json'),
    'assets/minecraft/models/block/stone.json'
  )
})

test('modelDestKey: .bbmodel 上传替换 .json 扩展名', () => {
  const { modelDestKey } = globalThis.__mdk
  assert.equal(
    modelDestKey('assets/minecraft/models/block/stone.json', '/tmp/abc/my.bbmodel'),
    'assets/minecraft/models/block/stone.bbmodel'
  )
})

test('modelDestKey: .json 上传到 .bbmodel key 反向替换', () => {
  const { modelDestKey } = globalThis.__mdk
  assert.equal(
    modelDestKey('assets/minecraft/models/block/stone.bbmodel', '/tmp/abc/stone.json'),
    'assets/minecraft/models/block/stone.json'
  )
})

test('modelDestKey: 扩展名大小写不敏感（.BBMODEL）', () => {
  const { modelDestKey } = globalThis.__mdk
  assert.equal(
    modelDestKey('assets/minecraft/models/block/stone.JSON', '/tmp/abc/x.BBMODEL'),
    'assets/minecraft/models/block/stone.bbmodel'
  )
})

test('modelDestKey: 上传文件无扩展名时保持原 key', () => {
  const { modelDestKey } = globalThis.__mdk
  assert.equal(
    modelDestKey('assets/minecraft/models/block/stone.json', '/tmp/abc/noext'),
    'assets/minecraft/models/block/stone.json'
  )
})

test('modelDestKey: key 无扩展名时追加上传扩展名', () => {
  const { modelDestKey } = globalThis.__mdk
  assert.equal(modelDestKey('items/stone', '/tmp/abc/x.bbmodel'), 'items/stone.bbmodel')
})
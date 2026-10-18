const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const store = require('../../server/config/config-store')

const FILE = store.FILE
let backup = null
let existed = false

test('setup: 备份真实配置', () => {
  existed = fs.existsSync(FILE)
  if (existed) backup = fs.readFileSync(FILE)
  try { fs.unlinkSync(FILE) } catch {}
})

test('get: 无配置文件时返回 schema 默认值', () => {
  const cfg = store.get()
  assert.equal(cfg.locale, 'zh')
  assert.equal(cfg.theme, 'light')
  assert.equal(cfg.recursive, false)
  assert.equal(cfg.hash, false)
  assert.equal(cfg.onlyMissing, false)
  assert.equal(cfg.ignoreSys, true)
  assert.equal(cfg.ignoreCustom, '')
  assert.equal(cfg.viewMode, 'all')
  assert.equal(cfg.sortKey, 'status')
  assert.equal(cfg.sortDir, 'asc')
  assert.equal(cfg.statusFilter, 'all')
})

test('get: hdriPresetPath 和 mcPacksPath 有默认值', () => {
  const cfg = store.get()
  assert.ok(cfg.hdriPresetPath && cfg.hdriPresetPath.length > 0)
  assert.ok(cfg.mcPacksPath && cfg.mcPacksPath.length > 0)
  assert.ok(cfg.hdriPresetPath.includes('HDRI'))
})

test('put: 写入 patch 后 get 可读回', async () => {
  await store.put({ theme: 'dark', locale: 'en' })
  const cfg = store.get()
  assert.equal(cfg.theme, 'dark')
  assert.equal(cfg.locale, 'en')
})

test('put: 保留未修改的字段', async () => {
  await store.put({ theme: 'dark' })
  await store.put({ locale: 'en' })
  const cfg = store.get()
  assert.equal(cfg.theme, 'dark')
  assert.equal(cfg.locale, 'en')
})

test('put: windowBounds 被剥离', async () => {
  await store.put({ windowBounds: { x: 100, y: 200 } })
  const cfg = store.get()
  assert.equal(cfg.windowBounds, undefined)
})

test('put: 未知字段被保留（宽松 schema）', async () => {
  await store.put({ customField: 'hello' })
  const cfg = store.get()
  assert.equal(cfg.customField, 'hello')
})

test('put: null/undefined patch 不破坏配置', async () => {
  await store.put({ theme: 'dark' })
  await store.put(null)
  const cfg = store.get()
  assert.equal(cfg.theme, 'dark')
})

test('put: 串行化写入不冲突', async () => {
  const writes = []
  for (let i = 0; i < 10; i++) writes.push(store.put({ sortKey: 'k' + i }))
  await Promise.all(writes)
  const cfg = store.get()
  assert.ok(cfg.sortKey.startsWith('k'))
})

test('clear: 重置为空对象', async () => {
  await store.put({ theme: 'dark', locale: 'en' })
  await store.clear()
  const cfg = store.get()
  assert.equal(cfg.theme, 'light')
  assert.equal(cfg.locale, 'zh')
})

test('get: 损坏的 JSON 返回默认值', async () => {
  await store.clear()
  fs.writeFileSync(FILE, '{ broken json')
  const cfg = store.get()
  assert.equal(cfg.theme, 'light')
  assert.equal(cfg.locale, 'zh')
})

test('teardown: 恢复真实配置', () => {
  try { fs.unlinkSync(FILE) } catch {}
  if (existed && backup) fs.writeFileSync(FILE, backup)
})
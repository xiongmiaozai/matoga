const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const store = require('../../server/config/workspace-store')

const { DIR, INDEX_FILE, LEGACY_FILE, LEGACY_BAK } = store
const BACKUP_DIR = DIR + '.testbak'
const BACKUP_LEGACY = LEGACY_FILE + '.testbak'
const BACKUP_BAK = LEGACY_BAK + '.testbak'

function clean() {
  try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
  try { fs.rmSync(LEGACY_FILE, { force: true }) } catch {}
  try { fs.rmSync(LEGACY_BAK, { force: true }) } catch {}
}

test('setup: 备份真实工作区数据', () => {
  try { fs.rmSync(BACKUP_DIR, { recursive: true, force: true }) } catch {}
  try { fs.rmSync(BACKUP_LEGACY, { force: true }) } catch {}
  try { fs.rmSync(BACKUP_BAK, { force: true }) } catch {}
  if (fs.existsSync(DIR)) fs.renameSync(DIR, BACKUP_DIR)
  if (fs.existsSync(LEGACY_FILE)) fs.renameSync(LEGACY_FILE, BACKUP_LEGACY)
  if (fs.existsSync(LEGACY_BAK)) fs.renameSync(LEGACY_BAK, BACKUP_BAK)
  clean()
})

test('get: 空状态返回空 presets', () => {
  clean()
  const data = store.get()
  assert.deepEqual(data.presets, {})
  assert.equal(data.active, null)
})

test('savePreset + get: 读回', async () => {
  clean()
  await store.savePreset('A', { root: { type: 'row' } })
  const data = store.get()
  assert.ok(data.presets.A)
  assert.deepEqual(data.presets.A.config, { root: { type: 'row' } })
  assert.equal(data.presets.A.builtin, undefined)
  assert.ok(typeof data.presets.A.updatedAt === 'number')
})

test('savePreset: 中文与空格名', async () => {
  clean()
  await store.savePreset('节点编辑 02', { v: 1 })
  const data = store.get()
  assert.ok(data.presets['节点编辑 02'])
})

test('savePreset: 含非法字符的名可保存读回', async () => {
  clean()
  await store.savePreset('a/b:c*d', { v: 1 })
  const data = store.get()
  assert.ok(data.presets['a/b:c*d'])
})

test('savePreset: 同名覆盖', async () => {
  clean()
  await store.savePreset('A', { v: 1 })
  await store.savePreset('A', { v: 2 })
  const data = store.get()
  assert.equal(data.presets.A.config.v, 2)
})

test('savePreset: 串行化写入不冲突', async () => {
  clean()
  const writes = []
  for (let i = 0; i < 10; i++) writes.push(store.savePreset('p' + i, { i }))
  await Promise.all(writes)
  const data = store.get()
  assert.equal(Object.keys(data.presets).length, 10)
})

test('deletePreset: 删除预设', async () => {
  clean()
  await store.savePreset('A', { v: 1 })
  await store.deletePreset('A')
  const data = store.get()
  assert.equal(data.presets.A, undefined)
})

test('deletePreset: 旧数据含 builtin 标志也可删除', async () => {
  clean()
  await store.savePreset('固定', { v: 1 })
  const idx = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
  const fn = idx.items['固定']
  fs.writeFileSync(path.join(DIR, fn), JSON.stringify({ name: '固定', config: { v: 1 }, builtin: true, updatedAt: 1 }))
  await store.deletePreset('固定')
  const data = store.get()
  assert.equal(data.presets['固定'], undefined)
})

test('renamePreset: 重命名', async () => {
  clean()
  await store.savePreset('旧', { v: 1 })
  await store.renamePreset('旧', '新')
  const data = store.get()
  assert.equal(data.presets['旧'], undefined)
  assert.ok(data.presets['新'])
  assert.equal(data.presets['新'].config.v, 1)
})

test('renamePreset: 目标名已存在则覆盖且无孤儿文件', async () => {
  clean()
  await store.savePreset('A', { v: 1 })
  await store.savePreset('B', { v: 2 })
  await store.renamePreset('A', 'B')
  const data = store.get()
  assert.deepEqual(Object.keys(data.presets), ['B'])
  assert.equal(data.presets.B.config.v, 1)
  const files = fs.readdirSync(DIR).filter(f => f !== 'index.json')
  assert.equal(files.length, 1)
})

test('renamePreset: active 跟随更新', async () => {
  clean()
  await store.savePreset('A', { v: 1 })
  await store.setActive('A')
  await store.renamePreset('A', 'B')
  assert.equal(store.get().active, 'B')
})

test('setActive: 设置激活预设', async () => {
  clean()
  await store.savePreset('A', { v: 1 })
  await store.setActive('A')
  assert.equal(store.get().active, 'A')
  await store.setActive(null)
  assert.equal(store.get().active, null)
})

test('get: 损坏的单个 preset 文件被跳过', async () => {
  clean()
  await store.savePreset('好', { v: 1 })
  await store.savePreset('坏', { v: 2 })
  const idx = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
  fs.writeFileSync(path.join(DIR, idx.items['坏']), '{ broken')
  const data = store.get()
  assert.ok(data.presets['好'])
  assert.equal(data.presets['坏'], undefined)
})

test('get: 损坏的 index.json 返回空', () => {
  clean()
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(INDEX_FILE, '{ broken')
  const data = store.get()
  assert.deepEqual(data.presets, {})
  assert.equal(data.active, null)
})

test('migrate: 旧单文件迁移到多文件', () => {
  clean()
  const legacy = {
    active: 'A',
    presets: {
      'A': { config: { x: 1 }, builtin: false, updatedAt: 123 },
      'B': { config: { y: 2 } }
    }
  }
  fs.writeFileSync(LEGACY_FILE, JSON.stringify(legacy))
  store.migrateIfNeeded()
  assert.ok(fs.existsSync(DIR))
  assert.ok(!fs.existsSync(LEGACY_FILE))
  assert.ok(fs.existsSync(LEGACY_BAK))
  const data = store.get()
  assert.deepEqual(Object.keys(data.presets).sort(), ['A', 'B'])
  assert.equal(data.active, 'A')
  assert.deepEqual(data.presets.A.config, { x: 1 })
  assert.equal(data.presets.A.builtin, undefined)
})

test('文件名冲突: "a/b" 和 "a_b" 共存', async () => {
  clean()
  await store.savePreset('a/b', { v: 1 })
  await store.savePreset('a_b', { v: 2 })
  const data = store.get()
  assert.deepEqual(Object.keys(data.presets).sort(), ['a/b', 'a_b'])
  assert.equal(data.presets['a/b'].config.v, 1)
  assert.equal(data.presets['a_b'].config.v, 2)
})

test('teardown: 恢复真实工作区数据', () => {
  clean()
  if (fs.existsSync(BACKUP_DIR)) fs.renameSync(BACKUP_DIR, DIR)
  if (fs.existsSync(BACKUP_LEGACY)) fs.renameSync(BACKUP_LEGACY, LEGACY_FILE)
  if (fs.existsSync(BACKUP_BAK)) fs.renameSync(BACKUP_BAK, LEGACY_BAK)
})
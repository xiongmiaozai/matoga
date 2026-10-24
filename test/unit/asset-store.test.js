const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const store = require('../../server/config/asset-store')

const FAV_FILE = store.FAV_FILE
const RECENT_FILE = store.RECENT_FILE
let favBackup = null, favExisted = false
let recBackup = null, recExisted = false

test('setup: 备份真实 favorites/recent', () => {
  favExisted = fs.existsSync(FAV_FILE)
  if (favExisted) favBackup = fs.readFileSync(FAV_FILE)
  recExisted = fs.existsSync(RECENT_FILE)
  if (recExisted) recBackup = fs.readFileSync(RECENT_FILE)
  try { fs.unlinkSync(FAV_FILE) } catch {}
  try { fs.unlinkSync(RECENT_FILE) } catch {}
})

test('get: 无文件时返回空列表', () => {
  const d = store.get()
  assert.deepEqual(d.favorites, [])
  assert.deepEqual(d.recent, [])
})

const goodItem = { key: 'tex:/a.png', name: 'a', type: 'tex', path: '/a.png', mtime: 100, thumb: '/t' }
const presetItem = { key: 'preset:metal', name: '金属', type: 'preset', path: null, color: '#ccc' }
const hdriItem = { key: 'hdri:/b.hdr', name: 'b', type: 'hdri', path: '/b.hdr' }
const mcItem = { key: 'mc:/c.png', name: 'c', type: 'mc', path: '/c.png' }
const officialItem = { key: 'official:/packs/1.21', name: '1.21', type: 'official', path: '/packs/1.21', badge: '1.21 – 1.21.1' }

test('setFavorites: 写入后可读回', async () => {
  await store.setFavorites([goodItem, presetItem])
  const d = store.get()
  assert.equal(d.favorites.length, 2)
  assert.equal(d.favorites[0].key, 'tex:/a.png')
  assert.equal(d.favorites[1].color, '#ccc')
})

test('setFavorites: 剔除无效项', async () => {
  await store.setFavorites([
    goodItem,
    { key: '', type: 'tex' },
    { key: 'bad', type: 'unknown' },
    { key: 'noColon', type: 'tex' },
    null,
    { key: 'tex:/b.png', type: 'tex', name: 123 },
  ])
  const d = store.get()
  assert.equal(d.favorites.length, 2)
  assert.equal(d.favorites[1].name, '')
})

test('setFavorites: type 与 key 前缀不一致时拒绝', async () => {
  await store.setFavorites([
    { key: 'tex:/x.png', type: 'hdri', name: 'x' },
    { key: 'hdri:/y.hdr', type: 'tex', name: 'y' },
  ])
  const d = store.get()
  assert.equal(d.favorites.length, 0)
})

test('setFavorites: key 缺少 type 前缀时自动推断', async () => {
  await store.setFavorites([
    { key: 'tex:/auto.png', name: 'auto' },
  ])
  const d = store.get()
  assert.equal(d.favorites.length, 1)
  assert.equal(d.favorites[0].type, 'tex')
})

test('setFavorites: 按 key 去重', async () => {
  await store.setFavorites([goodItem, goodItem, { ...goodItem, name: 'dup' }])
  const d = store.get()
  assert.equal(d.favorites.length, 1)
})

test('setFavorites: 超过上限截断', async () => {
  const many = []
  for (let i = 0; i < store.MAX_FAV + 10; i++) many.push({ key: 'tex:' + i, type: 'tex', name: 'n' + i })
  await store.setFavorites(many)
  const d = store.get()
  assert.equal(d.favorites.length, store.MAX_FAV)
})

test('setRecent: 独立保存且受上限约束', async () => {
  const many = []
  for (let i = 0; i < store.MAX_RECENT + 5; i++) many.push({ key: 'hdri:' + i, type: 'hdri', name: 'h' + i })
  await store.setRecent(many)
  const d = store.get()
  assert.equal(d.recent.length, store.MAX_RECENT)
  assert.equal(d.recent[0].type, 'hdri')
})

test('setFavorites/setRecent: 分文件存储互不干扰', async () => {
  await store.setFavorites([goodItem])
  await store.setRecent([hdriItem])
  assert.ok(fs.existsSync(FAV_FILE))
  assert.ok(fs.existsSync(RECENT_FILE))
  const favRaw = JSON.parse(fs.readFileSync(FAV_FILE, 'utf8'))
  const recRaw = JSON.parse(fs.readFileSync(RECENT_FILE, 'utf8'))
  assert.ok(favRaw.favorites)
  assert.ok(!favRaw.recent)
  assert.ok(recRaw.recent)
  assert.ok(!recRaw.favorites)
})

test('setFavorites/setRecent: 串行化不冲突', async () => {
  const writes = []
  for (let i = 0; i < 10; i++) writes.push(store.setFavorites([{ key: 'tex:' + i, type: 'tex', name: 'n' + i }]))
  await Promise.all(writes)
  const d = store.get()
  assert.equal(d.favorites.length, 1)
  assert.ok(d.favorites[0].key.startsWith('tex:'))
})

test('getFavorites/getRecent: 独立读取方法', async () => {
  await store.setFavorites([goodItem, presetItem])
  await store.setRecent([hdriItem])
  assert.equal(store.getFavorites().length, 2)
  assert.equal(store.getRecent().length, 1)
})

test('detectType: 从 key 提取类型', () => {
  assert.equal(store.detectType('tex:/a.png'), 'tex')
  assert.equal(store.detectType('hdri:/b.hdr'), 'hdri')
  assert.equal(store.detectType('mc:/c.png'), 'mc')
  assert.equal(store.detectType('official:/p/1.21'), 'official')
  assert.equal(store.detectType('preset:metal'), 'preset')
  assert.equal(store.detectType('bad:/x'), null)
  assert.equal(store.detectType('noColon'), null)
  assert.equal(store.detectType(''), null)
  assert.equal(store.detectType(null), null)
})

test('isValidKey: 校验 key 格式', () => {
  assert.equal(store.isValidKey('tex:/a.png'), true)
  assert.equal(store.isValidKey('preset:metal'), true)
  assert.equal(store.isValidKey('official:/p/1.21'), true)
  assert.equal(store.isValidKey('bad:/x'), false)
  assert.equal(store.isValidKey('noColon'), false)
  assert.equal(store.isValidKey(''), false)
})

test('classifyByType: 按类型分组', () => {
  const groups = store.classifyByType([
    goodItem, presetItem, hdriItem, mcItem, officialItem,
    { key: 'tex:/d.png', type: 'tex', name: 'd' },
    null, { key: 'bad', type: 'x' },
  ])
  assert.equal(groups.tex.length, 2)
  assert.equal(groups.hdri.length, 1)
  assert.equal(groups.mc.length, 1)
  assert.equal(groups.official.length, 1)
  assert.equal(groups.preset.length, 1)
})

test('getByType: 按分类查询收藏与最近', async () => {
  await store.setFavorites([goodItem, presetItem, hdriItem])
  await store.setRecent([goodItem, mcItem])
  const texOnly = store.getByType('tex')
  assert.equal(texOnly.favorites.length, 1)
  assert.equal(texOnly.recent.length, 1)
  const hdriOnly = store.getByType('hdri')
  assert.equal(hdriOnly.favorites.length, 1)
  assert.equal(hdriOnly.recent.length, 0)
  const invalid = store.getByType('unknown')
  assert.deepEqual(invalid.favorites, [])
  assert.deepEqual(invalid.recent, [])
})

test('get: 损坏 JSON 返回空列表', async () => {
  await store.setFavorites([goodItem])
  await store.setRecent([hdriItem])
  fs.writeFileSync(FAV_FILE, '{ broken')
  fs.writeFileSync(RECENT_FILE, '{ broken')
  const d = store.get()
  assert.deepEqual(d.favorites, [])
  assert.deepEqual(d.recent, [])
})

test('sanitize: 保留 role 与 color 可选字段', async () => {
  await store.setFavorites([{ key: 'tex:/r.png', type: 'tex', name: 'r', role: 'normal', color: '#fff' }])
  const d = store.get()
  assert.equal(d.favorites[0].role, 'normal')
  assert.equal(d.favorites[0].color, '#fff')
})

test('sanitize: official 类型保留 badge 版本徽标', async () => {
  await store.setFavorites([officialItem])
  const d = store.get()
  assert.equal(d.favorites.length, 1)
  assert.equal(d.favorites[0].type, 'official')
  assert.equal(d.favorites[0].badge, '1.21 – 1.21.1')
})

test('VALID_TYPES: 包含八种类型', () => {
  assert.ok(store.VALID_TYPES.has('tex'))
  assert.ok(store.VALID_TYPES.has('hdri'))
  assert.ok(store.VALID_TYPES.has('mc'))
  assert.ok(store.VALID_TYPES.has('official'))
  assert.ok(store.VALID_TYPES.has('model'))
  assert.ok(store.VALID_TYPES.has('preset'))
  assert.ok(store.VALID_TYPES.has('project'))
  assert.ok(store.VALID_TYPES.has('craft'))
  assert.equal(store.VALID_TYPES.size, 8)
})

test('model 类型: key 前缀识别 / 收藏持久化 / 分类分组', async () => {
  assert.equal(store.detectType('model:bb:abc123'), 'model')
  assert.equal(store.detectType('model:packmodel:mc:MyPack/assets/minecraft/models/block/stone.json'), 'model')
  assert.equal(store.isValidKey('model:bb:abc123'), true)
  const modelItem = { key: 'model:packmodel:official:26.3-Fabric/assets/minecraft/models/item/stick.json', name: 'stick.json', type: 'model', path: 'packmodel:official:26.3-Fabric/assets/minecraft/models/item/stick.json', badge: 'item' }
  await store.setFavorites([modelItem])
  await store.setRecent([modelItem])
  const d = store.get()
  assert.equal(d.favorites.length, 1)
  assert.equal(d.favorites[0].type, 'model')
  assert.equal(d.favorites[0].badge, 'item')
  assert.equal(store.getByType('model').favorites.length, 1)
  const groups = store.classifyByType([modelItem])
  assert.equal(groups.model.length, 1)
})

test('teardown: 恢复真实 favorites/recent', () => {
  try { fs.unlinkSync(FAV_FILE) } catch {}
  try { fs.unlinkSync(RECENT_FILE) } catch {}
  if (favExisted && favBackup) fs.writeFileSync(FAV_FILE, favBackup)
  if (recExisted && recBackup) fs.writeFileSync(RECENT_FILE, recBackup)
})
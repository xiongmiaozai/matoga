/**
 * 导入模型服务单测（server/services/imported-model-service.js）：
 * - 专属目录 data/imported-models（与自定义模型目录分离）
 * - 每模型一个专属子目录 <id>/model.<ext>（bbmodel / json）
 * - 旧扁平 <id>.json 惰性迁移到子目录
 * 隔离：MATOGA_DATA_ROOT 指向临时目录（每测试文件独立进程）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'matoga-imported-'))
process.env.MATOGA_DATA_ROOT = TMP

const svc = require('../../server/services/imported-model-service')

test.after(() => { fs.rmSync(TMP, { recursive: true, force: true }) })

test('专属目录：DATA_ROOT/data/imported-models', () => {
  assert.ok(svc.IMPORTED_MODELS_DIR.startsWith(TMP), '目录应落在隔离 DATA_ROOT 下')
  assert.ok(svc.IMPORTED_MODELS_DIR.endsWith(path.join('data', 'imported-models')))
})

test('saveModel(.bbmodel) → <id>/model.bbmodel；list/load/delete', async () => {
  const data = JSON.stringify({ meta: { format: 'bbmodel' }, elements: [{ name: 'cube' }] })
  const r = await svc.saveModel({ name: 'My Cube', data })
  assert.ok(r.id)
  assert.equal(r.ext, 'bbmodel')
  assert.ok(fs.existsSync(path.join(svc.IMPORTED_MODELS_DIR, r.id, 'model.bbmodel')), '每模型独立子目录')

  const list = await svc.listModels()
  const found = list.find(m => m.id === r.id)
  assert.ok(found, 'listModels 应包含新导入模型')
  assert.equal(found.ext, 'bbmodel')

  const { json } = await svc.loadModel(r.id)
  assert.equal(json.elements[0].name, 'cube')

  await svc.deleteModel(r.id)
  assert.ok(!fs.existsSync(path.join(svc.IMPORTED_MODELS_DIR, r.id)), '删除应移除整个专属子目录')
})

test('saveModel(MC .json) → <id>/model.json', async () => {
  const r = await svc.saveModel({ name: 'mcblock', data: JSON.stringify({ parent: 'block/cube_all', textures: {} }) })
  assert.equal(r.ext, 'json')
  assert.ok(fs.existsSync(path.join(svc.IMPORTED_MODELS_DIR, r.id, 'model.json')))
  await svc.deleteModel(r.id)
})

test('旧扁平 <id>.json 惰性迁移到 <id>/model.json', async () => {
  fs.mkdirSync(svc.IMPORTED_MODELS_DIR, { recursive: true })
  fs.writeFileSync(path.join(svc.IMPORTED_MODELS_DIR, 'legacy-imp.json'), '{"elements":[{"name":"l"}]}')
  const list = await svc.listModels()
  assert.ok(list.find(m => m.id === 'legacy-imp'))
  assert.ok(fs.existsSync(path.join(svc.IMPORTED_MODELS_DIR, 'legacy-imp', 'model.json')), '迁移后落到子目录')
  assert.ok(!fs.existsSync(path.join(svc.IMPORTED_MODELS_DIR, 'legacy-imp.json')), '旧扁平文件应已移走')
  await svc.deleteModel('legacy-imp')
})

test('loadModel 缺失 → 抛 ENOENT', async () => {
  await assert.rejects(() => svc.loadModel('nope-does-not-exist'), /not found/)
})
test('deleteModel / loadModel 非法 id（路径穿越）→ 抛 ERR_INVALID_PARAM', async () => {
  await assert.rejects(() => svc.deleteModel('../..'), (e) => e.code === 'ERR_INVALID_PARAM')
  await assert.rejects(() => svc.deleteModel('a/b'), (e) => e.code === 'ERR_INVALID_PARAM')
  await assert.rejects(() => svc.loadModel('..'), (e) => e.code === 'ERR_INVALID_PARAM')
})

test('deleteModel 幂等：删除不存在的合法 id 不报错', async () => {
  const r = await svc.deleteModel('never-saved-id')
  assert.equal(r.id, 'never-saved-id')
})
test('saveModel 非法 id（路径穿越）→ 抛 ERR_INVALID_PARAM', async () => {
  await assert.rejects(() => svc.saveModel({ id: '../..', name: 'x', data: '{}' }), (e) => e.code === 'ERR_INVALID_PARAM')
  await assert.rejects(() => svc.saveModel({ id: 'a/b', name: 'x', data: '{}' }), (e) => e.code === 'ERR_INVALID_PARAM')
})

test('saveModel data 为 null/undefined → 抛 ERR_INVALID_PARAM', async () => {
  await assert.rejects(() => svc.saveModel({ name: 'x', data: null }), (e) => e.code === 'ERR_INVALID_PARAM')
  await assert.rejects(() => svc.saveModel({ name: 'x', data: undefined }), (e) => e.code === 'ERR_INVALID_PARAM')
})
/**
 * 模型存储子目录单测：
 * - custom-model-service：data/custom-models/<id>/model.json
 * - 旧扁平文件惰性迁移
 * 隔离：MATOGA_DATA_ROOT 指向临时目录。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'matoga-mstore-'))
process.env.MATOGA_DATA_ROOT = TMP

const cm = require('../../server/services/custom-model-service')

test.after(() => { fs.rmSync(TMP, { recursive: true, force: true }) })

test('cm: 专属目录 + createModel → <id>/model.json；list/load/update/delete', async () => {
  assert.ok(cm.CUSTOM_MODELS_DIR.endsWith(path.join('data', 'custom-models')))
  const r = await cm.createModel({ template: 'cube_all', name: 'Stone' })
  assert.ok(r.id)
  assert.ok(fs.existsSync(path.join(cm.CUSTOM_MODELS_DIR, r.id, 'model.json')), '每模型独立子目录')
  const list = await cm.listModels()
  assert.ok(list.find(m => m.id === r.id))
  const { json } = await cm.loadModel(r.id)
  assert.equal(json.name, 'stone')
  assert.ok(json.model, '自定义模型记录应含 model 字段')
  await cm.updateModel(r.id, { name: 'Stone2' })
  const { json: j2 } = await cm.loadModel(r.id)
  assert.equal(j2.name, 'Stone2')
  await cm.deleteModel(r.id)
  assert.ok(!fs.existsSync(path.join(cm.CUSTOM_MODELS_DIR, r.id)))
})

test('cm: 旧扁平 <id>.json 惰性迁移到子目录', async () => {
  fs.mkdirSync(cm.CUSTOM_MODELS_DIR, { recursive: true })
  fs.writeFileSync(path.join(cm.CUSTOM_MODELS_DIR, 'legacy-cm.json'), JSON.stringify({ name: 'legacy', model: { elements: [] } }))
  const list = await cm.listModels()
  assert.ok(list.find(m => m.id === 'legacy-cm'))
  assert.ok(fs.existsSync(path.join(cm.CUSTOM_MODELS_DIR, 'legacy-cm', 'model.json')))
  assert.ok(!fs.existsSync(path.join(cm.CUSTOM_MODELS_DIR, 'legacy-cm.json')))
  await cm.deleteModel('legacy-cm')
})
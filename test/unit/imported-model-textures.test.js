/**
 * 导入模型贴图单测（server/services/imported-model-service.js 贴图部分）：
 * - saveTexture / saveTextures / listTextures / deleteTexture
 * - 路径穿越防御、非法扩展名、非 dataURL 拒绝
 * - loadModel 返回 texDir
 * - saveModel 一次性传入 textures
 * 隔离：MATOGA_DATA_ROOT 指向临时目录。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'matoga-imptex-'))
process.env.MATOGA_DATA_ROOT = TMP

const svc = require('../../server/services/imported-model-service')

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

const PNG_DATAURL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const TEX_REL = 'assets/minecraft/textures/block/stone.png'

test('saveTexture → <id>/assets/.../stone.png；listTextures 命中', async () => {
  const m = await svc.saveModel({ name: 'texdemo', data: '{"elements":[]}' })
  const r = await svc.saveTexture(m.id, TEX_REL, PNG_DATAURL)
  assert.equal(r.path, TEX_REL)
  assert.ok(r.size > 0)
  const full = path.join(svc.importedDir(), m.id, TEX_REL)
  assert.ok(fs.existsSync(full), '贴图应落到 <id>/assets/... 下')

  const list = await svc.listTextures(m.id)
  const found = list.find(t => t.path === TEX_REL)
  assert.ok(found, 'listTextures 应列出已写入贴图')
  assert.equal(found.size, r.size)
  await svc.deleteModel(m.id)
})

test('saveTextures 批量写入；非法项跳过、合法项保留', async () => {
  const m = await svc.saveModel({ name: 'batch', data: '{}' })
  const r = await svc.saveTextures(m.id, {
    'assets/minecraft/textures/block/a.png': PNG_DATAURL,
    'assets/minecraft/textures/block/b.png': PNG_DATAURL,
    '../evil.png': PNG_DATAURL /* 穿越 → 跳过 */,
    'assets/minecraft/textures/block/c.txt': PNG_DATAURL /* 非法扩展 → 跳过 */
  })
  assert.equal(r.count, 2)
  const list = await svc.listTextures(m.id)
  assert.equal(list.length, 2)
  await svc.deleteModel(m.id)
})

test('saveTexture 路径穿越 → ERR_INVALID_PARAM', async () => {
  const m = await svc.saveModel({ name: 'sec', data: '{}' })
  await assert.rejects(
    () => svc.saveTexture(m.id, '../escape.png', PNG_DATAURL),
    e => e.code === 'ERR_INVALID_PARAM'
  )
  await assert.rejects(
    () => svc.saveTexture(m.id, 'textures/x.png', PNG_DATAURL),
    e => e.code === 'ERR_INVALID_PARAM'
  )
  await svc.deleteModel(m.id)
})

test('saveTexture 非 dataURL → ERR_INVALID_PARAM', async () => {
  const m = await svc.saveModel({ name: 'dataurl', data: '{}' })
  await assert.rejects(
    () => svc.saveTexture(m.id, TEX_REL, 'not-a-data-url'),
    e => e.code === 'ERR_INVALID_PARAM'
  )
  await svc.deleteModel(m.id)
})

test('deleteTexture 删除单张；listTextures 不再包含', async () => {
  const m = await svc.saveModel({ name: 'del', data: '{}' })
  await svc.saveTexture(m.id, TEX_REL, PNG_DATAURL)
  await svc.deleteTexture(m.id, TEX_REL)
  const list = await svc.listTextures(m.id)
  assert.ok(!list.find(t => t.path === TEX_REL))
  await svc.deleteModel(m.id)
})

test('loadModel 返回 texDir（模型专属子目录）', async () => {
  const m = await svc.saveModel({ name: 'texdir', data: '{"elements":[]}' })
  const loaded = await svc.loadModel(m.id)
  assert.ok(typeof loaded.texDir === 'string')
  assert.ok(loaded.texDir.endsWith(m.id), 'texDir 应为 <id> 子目录')
  await svc.deleteModel(m.id)
})

test('saveModel 一次性传入 textures → texCount 返回', async () => {
  const r = await svc.saveModel({
    name: 'onetime',
    data: JSON.stringify({ textures: { all: 'minecraft:block/stone' } }),
    textures: { 'assets/minecraft/textures/block/stone.png': PNG_DATAURL }
  })
  assert.equal(r.texCount, 1)
  const list = await svc.listTextures(r.id)
  assert.equal(list.length, 1)
  await svc.deleteModel(r.id)
})

test('listTextures 无贴图模型 → 空数组', async () => {
  const m = await svc.saveModel({ name: 'empty', data: '{}' })
  const list = await svc.listTextures(m.id)
  assert.deepEqual(list, [])
  await svc.deleteModel(m.id)
})

test('deleteModel 递归删除贴图', async () => {
  const m = await svc.saveModel({ name: 'rmtex', data: '{}' })
  await svc.saveTexture(m.id, TEX_REL, PNG_DATAURL)
  await svc.deleteModel(m.id)
  assert.ok(!fs.existsSync(path.join(svc.importedDir(), m.id)), '删除模型应连同贴图移除')
})

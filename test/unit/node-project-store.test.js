const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const store = require('../../server/config/node-project-store')

const DIR = store.DIR
let backup = null
let existed = false

test('setup: 备份真实 node-projects 目录', () => {
  existed = fs.existsSync(DIR)
  if (existed) {
    backup = DIR + '.test-bak'
    fs.renameSync(DIR, backup)
  }
})

test('sanitizeName: 过滤非法名称', () => {
  assert.equal(store.sanitizeName('  我的 工程 '), '我的 工程')
  assert.equal(store.sanitizeName('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j')
  assert.equal(store.sanitizeName(''), null)
  assert.equal(store.sanitizeName(null), null)
  assert.equal(store.sanitizeName('.'.repeat(120)), null)
})

test('save: 新建项目生成 .mtgp 目录结构', async () => {
  const graph = {
    nodes: [
      { id: 'n1', type: 'texture', pos: [0, 0], widgets_values: { tex: '@tex/0-a.png' } },
      { id: 'n2', type: 'mix', pos: [100, 0], widgets_values: {} },
    ],
    links: [['e1', 'n1', 'tex', 'n2', 'a']],
  }
  const id = await store.save({
    name: '测试工程 <A>',
    graph,
    thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    textures: [
      { name: 'a.png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' },
    ],
  })
  assert.match(id, /^p[A-Za-z0-9_-]+$/)
  const dir = store.projectDir(id)
  assert.ok(fs.existsSync(path.join(dir, 'project.json')))
  assert.ok(fs.existsSync(path.join(dir, 'thumbnail.png')))
  assert.ok(fs.existsSync(path.join(dir, 'textures', '0-a.png')))
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'))
  assert.equal(doc.format, 'matoga-node-project')
  assert.equal(doc.meta.name, '测试工程 _A_')
  assert.equal(doc.meta.textureCount, 1)
  assert.equal(doc.graph.nodes.length, 2)
})

test('list: 返回项目元信息（含 dir）', async () => {
  const list = store.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].nodeCount, 2)
  assert.equal(list[0].edgeCount, 1)
  assert.equal(list[0].textureCount, 1)
  assert.ok(list[0].hasThumb)
  assert.ok(list[0].dir.endsWith('.mtgp'))
})

test('load: 读取工程与贴图映射', async () => {
  const list = store.list()
  const p = store.load(list[0].id)
  assert.equal(p.graph.nodes.length, 2)
  assert.equal(p.textures.length, 1)
  assert.equal(p.textures[0].file, '0-a.png')
  assert.ok(p.textures[0].exists)
  assert.ok(p.textures[0].fullPath.endsWith(path.join('textures', '0-a.png')))
  assert.equal(p.name, '测试工程 _A_')
})

test('save: 更新已存在项目（覆盖贴图）', async () => {
  const list = store.list()
  const id = list[0].id
  await store.save({
    id,
    name: '更新后的工程',
    graph: { nodes: [{ id: 'n1', type: 'color', widgets_values: {} }], links: [] },
    textures: [],
  })
  const p = store.load(id)
  assert.equal(p.name, '更新后的工程')
  assert.equal(p.textures.length, 0)
  const list2 = store.list()
  assert.equal(list2.length, 1)
  assert.equal(list2[0].id, id)
})

test('save: 非法参数抛错', async () => {
  await assert.rejects(async () => store.save({ name: '', graph: { nodes: [] } }), /invalid project name/)
  await assert.rejects(async () => store.save({ name: 'x', graph: null }), /invalid graph/)
  await assert.rejects(async () => store.save({ id: '不合法的 id!', name: 'x', graph: { nodes: [] } }), /invalid project id/)
  await assert.rejects(async () => store.save({ id: 'pnoexist', name: 'x', graph: { nodes: [] } }), /project not found/)
})

test('rename: 重命名项目', async () => {
  const list = store.list()
  const r = await store.rename(list[0].id, '新名字')
  assert.equal(r.name, '新名字')
  assert.equal(store.load(list[0].id).name, '新名字')
  await assert.rejects(async () => store.rename(list[0].id, ''), /invalid project name/)
})

test('remove: 删除项目目录', async () => {
  const list = store.list()
  const id = list[0].id
  await store.remove(id)
  assert.equal(store.exists(id), false)
  assert.equal(store.list().length, 0)
  await assert.rejects(async () => store.remove(id), /project not found/)
})

test('teardown: 恢复真实 node-projects 目录', () => {
  fs.rmSync(DIR, { recursive: true, force: true })
  if (existed) fs.renameSync(backup, DIR)
})
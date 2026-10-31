/**
 * 面板清单 API 单测（/api/panels）：
 * - 返回 level / parent / group / zIndex 层级字段
 * - zIndex = 100 + level*100 + order
 * - tree 按 parent 构建树，groups 按 group 聚合
 * - 缺省值：level=0 / parent=null / group=null / order=999
 * - 面板按 order 升序排列
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { createApp } = require('../../server/app')

async function withServer(fn) {
  const server = http.createServer(createApp())
  await new Promise(r => server.listen(0, r))
  const port = server.address().port
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise(r => server.close(r))
  }
}

test('GET /api/panels: 返回 ok 及层级字段', async () => {
  await withServer(async base => {
    const res = await fetch(base + '/api/panels')
    const json = await res.json()
    assert.equal(res.status, 200)
    assert.equal(json.ok, true)
    assert.ok(Array.isArray(json.panels))
    assert.ok(json.panels.length >= 12)
    for (const p of json.panels) {
      assert.equal(typeof p.level, 'number', p.id + ' level 应为 number')
      assert.ok(p.parent === null || typeof p.parent === 'string', p.id + ' parent 应为 null|string')
      assert.ok(p.group === null || typeof p.group === 'string', p.id + ' group 应为 null|string')
      assert.equal(typeof p.zIndex, 'number', p.id + ' zIndex 应为 number')
    }
  })
})

test('zIndex = 100 + level*100 + order', async () => {
  await withServer(async base => {
    const json = await (await fetch(base + '/api/panels')).json()
    for (const p of json.panels) {
      assert.equal(p.zIndex, 100 + p.level * 100 + p.order, p.id + ' zIndex 公式')
    }
  })
})

test('已知面板的 level / group 取值正确', async () => {
  await withServer(async base => {
    const json = await (await fetch(base + '/api/panels')).json()
    const byId = new Map(json.panels.map(p => [p.id, p]))
    const expect = {
      folderCard: { level: 0, group: 'sidebar' },
      categoryFilter: { level: 0, group: 'workspace' },
      compare: { level: 0, group: 'workspace' },
      modelCategory: { level: 0, group: 'workspace' },
      preview: { level: 0, group: 'sidebar' },
      material3d: { level: 0, group: 'sidebar' },
      nodeCanvas: { level: 10, group: 'node' },
      nodeLibrary: { level: 20, group: 'node' },
      nodeRel: { level: 20, group: 'node' },
      nodePreview: { level: 20, group: 'node' },
      assetLibrary: { level: 20, group: 'asset' },
      uvEditor: { level: 10, group: 'editor' }
    }
    for (const [id, exp] of Object.entries(expect)) {
      const p = byId.get(id)
      assert.ok(p, '缺少面板 ' + id)
      assert.equal(p.level, exp.level, id + ' level')
      assert.equal(p.group, exp.group, id + ' group')
    }
  })
})

test('浮层面板 zIndex 高于常驻面板，防止遮挡', async () => {
  await withServer(async base => {
    const json = await (await fetch(base + '/api/panels')).json()
    const byId = new Map(json.panels.map(p => [p.id, p]))
    const nodeCanvas = byId.get('nodeCanvas').zIndex
    const nodeLibrary = byId.get('nodeLibrary').zIndex
    const compare = byId.get('compare').zIndex
    assert.ok(nodeLibrary > compare, '浮层 nodeLibrary 应高于常驻 compare')
    assert.ok(nodeLibrary > nodeCanvas, '浮层 nodeLibrary 应高于全屏底板 nodeCanvas')
    assert.ok(nodeCanvas > compare, '全屏底板 nodeCanvas 应高于常驻 compare')
  })
})

test('panels 按 order 升序排列', async () => {
  await withServer(async base => {
    const json = await (await fetch(base + '/api/panels')).json()
    for (let i = 1; i < json.panels.length; i++) {
      const a = json.panels[i - 1],
        b = json.panels[i]
      assert.ok(a.order < b.order || (a.order === b.order && a.id <= b.id), '顺序错乱于 ' + a.id + ' → ' + b.id)
    }
  })
})

test('tree: parent 全 null 时顶级节点数等于面板数', async () => {
  await withServer(async base => {
    const json = await (await fetch(base + '/api/panels')).json()
    assert.ok(Array.isArray(json.tree))
    const allParentNull = json.panels.every(p => p.parent === null)
    if (allParentNull) {
      assert.equal(json.tree.length, json.panels.length, '无父子关系时顶级节点应等于面板数')
    }
    for (const node of json.tree) {
      assert.ok(Array.isArray(node.children), 'tree 节点应含 children 数组')
    }
  })
})

test('groups: 按 group 聚合面板 id', async () => {
  await withServer(async base => {
    const json = await (await fetch(base + '/api/panels')).json()
    assert.ok(json.groups && typeof json.groups === 'object')
    assert.ok(Array.isArray(json.groups.node), '应有 node 分组')
    assert.ok(json.groups.node.includes('nodeCanvas'), 'node 分组应含 nodeCanvas')
    assert.ok(json.groups.node.includes('nodeLibrary'), 'node 分组应含 nodeLibrary')
    assert.ok(Array.isArray(json.groups.workspace), '应有 workspace 分组')
    assert.ok(json.groups.workspace.includes('compare'), 'workspace 分组应含 compare')
  })
})

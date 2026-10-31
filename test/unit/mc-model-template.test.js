/**
 * 模板模型贴图借用单测（borrowTemplateTextures / resolveMcModelAsset 集成）：
 * - template_* 模型自身无 textures，直接预览时贴图全灰 → 借同级子模型 textures 渲染
 * - mock globalThis.fetch 模拟包 entries 接口 + raw 模型 JSON，无需真实服务
 * 运行于 NR_M3D_STUB=1（material3d stub，three 从 node_modules 解析）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

process.env.NR_M3D_STUB = '1'
register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))

function fakeRes(json, ok = true) {
  return { ok, json: async () => json, status: ok ? 200 : 404 }
}

test('setup: 加载 mc-model-viewer（material3d stub 模式）', async () => {
  const m = await import('../../web/src/mc-model-viewer.js')
  globalThis.__mcm = m
  assert.equal(typeof m.borrowTemplateTextures, 'function')
  assert.equal(typeof m.isTemplateModelName, 'function')
  assert.equal(typeof m.texturesHasConcreteRef, 'function')
  assert.equal(typeof m.resolveMcModelAsset, 'function')
})

test('isTemplateModelName: template_ 前缀判定', () => {
  const { isTemplateModelName } = globalThis.__mcm
  assert.equal(isTemplateModelName('assets/minecraft/models/block/template_wall_sign.json'), true)
  assert.equal(isTemplateModelName('assets/minecraft/models/block/template_sign_rot_0.json'), true)
  assert.equal(isTemplateModelName('assets/minecraft/models/block/oak_wall_sign.json'), false)
  assert.equal(isTemplateModelName('assets/minecraft/models/block/cube.json'), false)
  assert.equal(isTemplateModelName(''), false)
  assert.equal(isTemplateModelName(null), false)
})

test('texturesHasConcreteRef: 含具体贴图引用判定', () => {
  const { texturesHasConcreteRef } = globalThis.__mcm
  assert.equal(texturesHasConcreteRef({ all: 'minecraft:block/stone' }), true)
  assert.equal(texturesHasConcreteRef({ fan: 'minecraft:block/brain_coral_fan' }), true)
  assert.equal(texturesHasConcreteRef({ particle: '#fan' }), false, '仅 # 变量引用 → false')
  assert.equal(texturesHasConcreteRef({ particle: '#all', side: '#all' }), false)
  assert.equal(texturesHasConcreteRef({}), false, '空表 → false')
  assert.equal(texturesHasConcreteRef(null), false)
  assert.equal(texturesHasConcreteRef({ all: '', side: '#' }), false, '空串/# 单字符 → false')
  assert.equal(texturesHasConcreteRef({ particle: '#fan', fan: 'minecraft:block/brain_coral_fan' }), true, '混入具体引用 → true')
})

test('borrowTemplateTextures: 非法参数返回 null', async () => {
  const { borrowTemplateTextures } = globalThis.__mcm
  assert.equal(await borrowTemplateTextures(undefined, undefined, 'assets/minecraft/models/block/template_wall_sign.json'), null)
  assert.equal(await borrowTemplateTextures('/api/mc-official', '', 'assets/minecraft/models/block/template_wall_sign.json'), null)
  assert.equal(await borrowTemplateTextures('/api/mc-official', 'p', 'not-a-model-path'), null)
})

test('borrowTemplateTextures: fileRoot 模式经 compare/scan 借用子模型 textures', async () => {
  const { borrowTemplateTextures } = globalThis.__mcm
  const real = globalThis.fetch
  globalThis.fetch = async (url) => {
    const s = String(url)
    if (s.includes('/api/compare/scan')) return fakeRes({ ok: true, data: { entries: [{ name: 'brain_coral_fan.json' }, { name: 'coral_wall_fan.json' }] } })
    if (s.includes('brain_coral_fan.json')) return fakeRes({ parent: 'minecraft:block/coral_fan', textures: { fan: 'minecraft:block/brain_coral_fan' } })
    return fakeRes(null, false)
  }
  try {
    const r = await borrowTemplateTextures(undefined, undefined, 'assets/minecraft/models/block/coral_fan.json', '/fake/root')
    assert.deepEqual(r, { fan: 'minecraft:block/brain_coral_fan' })
  } finally { globalThis.fetch = real }
})

test('borrowTemplateTextures: 子模型在候选 60 名外仍能命中（按父名优先排序）', async () => {
  const { borrowTemplateTextures } = globalThis.__mcm
  const real = globalThis.fetch
  /* 模拟 block/ 目录：100 个 acacia_* 前置 + brain_coral_fan 排第 101 */
  const entries = []
  for (let i = 0; i < 100; i++) entries.push({ name: 'acacia_block_' + i + '.json' })
  entries.push({ name: 'brain_coral_fan.json' })
  globalThis.fetch = async (url) => {
    const s = String(url)
    if (s.includes('/api/compare/scan')) return fakeRes({ ok: true, data: { entries } })
    if (s.includes('brain_coral_fan.json')) return fakeRes({ parent: 'minecraft:block/coral_fan', textures: { fan: 'minecraft:block/brain_coral_fan' } })
    return fakeRes(null, false)
  }
  try {
    const r = await borrowTemplateTextures(undefined, undefined, 'assets/minecraft/models/block/coral_fan.json', '/fake/root')
    assert.deepEqual(r, { fan: 'minecraft:block/brain_coral_fan' }, 'brain_coral_fan 含 "coral_fan" 优先排序，排第 101 仍命中')
  } finally { globalThis.fetch = real }
})

test('borrowTemplateTextures: 包模式借用子模型 textures（parent 带命名空间）', async () => {
  const { borrowTemplateTextures } = globalThis.__mcm
  const real = globalThis.fetch
  globalThis.fetch = async (url) => {
    const s = String(url)
    if (s.includes('/entries?')) {
      return fakeRes({ ok: true, data: { files: [
        { name: 'oak_wall_sign.json' },
        { name: 'template_wall_sign.json' },
        { name: 'acacia_wall_sign.json' },
      ] } })
    }
    if (s.includes('oak_wall_sign.json')) {
      return fakeRes({ parent: 'minecraft:block/template_wall_sign', textures: { all: 'minecraft:block/oak_sign', particle: 'minecraft:block/oak_planks' } })
    }
    return fakeRes(null, false)
  }
  try {
    const r = await borrowTemplateTextures('/api/mc-official', 'MyPack', 'assets/minecraft/models/block/template_wall_sign.json')
    assert.deepEqual(r, { all: 'minecraft:block/oak_sign', particle: 'minecraft:block/oak_planks' })
  } finally { globalThis.fetch = real }
})

test('borrowTemplateTextures: parent 不带命名空间亦匹配', async () => {
  const { borrowTemplateTextures } = globalThis.__mcm
  const real = globalThis.fetch
  globalThis.fetch = async (url) => {
    const s = String(url)
    if (s.includes('/entries?')) return fakeRes({ ok: true, data: { files: [{ name: 'oak_wall_sign.json' }] } })
    if (s.includes('oak_wall_sign.json')) return fakeRes({ parent: 'block/template_wall_sign', textures: { all: 'block/oak_sign' } })
    return fakeRes(null, false)
  }
  try {
    const r = await borrowTemplateTextures('/api/mc-official', 'MyPack', 'assets/minecraft/models/block/template_wall_sign.json')
    assert.deepEqual(r, { all: 'block/oak_sign' })
  } finally { globalThis.fetch = real }
})

test('borrowTemplateTextures: parent 不匹配 / 无 textures 的子模型跳过', async () => {
  const { borrowTemplateTextures } = globalThis.__mcm
  const real = globalThis.fetch
  let oakFetched = false
  globalThis.fetch = async (url) => {
    const s = String(url)
    if (s.includes('/entries?')) return fakeRes({ ok: true, data: { files: [
      { name: 'cube.json' },
      { name: 'oak_wall_sign.json' },
    ] } })
    if (s.includes('cube.json')) return fakeRes({ parent: 'block/block', textures: { all: 'block/stone' } })
    if (s.includes('oak_wall_sign.json')) { oakFetched = true; return fakeRes({ parent: 'minecraft:block/template_wall_sign' }) }
    return fakeRes(null, false)
  }
  try {
    const r = await borrowTemplateTextures('/api/mc-official', 'MyPack', 'assets/minecraft/models/block/template_wall_sign.json')
    assert.equal(r, null, 'cube parent 不匹配跳过；oak 无 textures 跳过 → null')
    assert.equal(oakFetched, true)
  } finally { globalThis.fetch = real }
})

test('borrowTemplateTextures: entries 接口失败返回 null', async () => {

  const { borrowTemplateTextures } = globalThis.__mcm
  const real = globalThis.fetch
  globalThis.fetch = async () => fakeRes(null, false)
  try {
    const r = await borrowTemplateTextures('/api/mc-official', 'MyPack', 'assets/minecraft/models/block/template_wall_sign.json')
    assert.equal(r, null)
  } finally { globalThis.fetch = real }
})

test('resolveMcModelAsset: 模板模型借用子模型贴图（端到端）', async () => {
  const { resolveMcModelAsset } = globalThis.__mcm
  const real = globalThis.fetch
  globalThis.fetch = async (url) => {
    const s = String(url)
    if (s.includes('template_wall_sign.json')) {
      return fakeRes({ parent: 'block/block', ambientocclusion: false, elements: [{
        from: [0, 4.33333, 0.33333], to: [16, 12.33333, 1.66667],
        faces: { north: { uv: [0, 8, 12, 14], texture: '#all' }, south: { uv: [0, 1, 12, 7], texture: '#all' } },
      }] })
    }
    if (s.includes('block/block.json')) return fakeRes(null, false)
    if (s.includes('/entries?')) return fakeRes({ ok: true, data: { files: [{ name: 'oak_wall_sign.json' }] } })
    if (s.includes('oak_wall_sign.json')) return fakeRes({ parent: 'minecraft:block/template_wall_sign', textures: { all: 'minecraft:block/oak_sign', particle: 'minecraft:block/oak_planks' } })
    return fakeRes(null, false)
  }
  try {
    const { parts } = await resolveMcModelAsset('/api/mc-official', 'MyPack', 'assets/minecraft/models/block/template_wall_sign.json')
    assert.equal(parts.length, 1)
    const tx = parts[0].textures
    assert.equal(tx.all, 'minecraft:block/oak_sign', '借用子模型 all 贴图')
    assert.equal(tx.particle, 'minecraft:block/oak_planks')
    assert.equal(tx.north, 'minecraft:block/oak_sign', 'expandTextureAliases 展开 all → 六方向')
    assert.equal(tx.up, 'minecraft:block/oak_sign')
    assert.ok(parts[0].elements.length > 0, '几何体保留')
  } finally { globalThis.fetch = real }
})

test('resolveMcModelAsset: 有具体贴图的模型不触发借用', async () => {
  const { resolveMcModelAsset } = globalThis.__mcm
  const real = globalThis.fetch
  let entriesCalled = false
  globalThis.fetch = async (url) => {
    const s = String(url)
    if (s.includes('/entries?')) { entriesCalled = true; return fakeRes({ ok: true, data: { files: [] } }) }
    if (s.includes('oak_wall_sign.json')) return fakeRes({ parent: 'minecraft:block/template_wall_sign', textures: { all: 'minecraft:block/oak_sign' } })
    if (s.includes('block/block.json')) return fakeRes(null, false)
    return fakeRes(null, false)
  }
  try {
    const { parts } = await resolveMcModelAsset('/api/mc-official', 'MyPack', 'assets/minecraft/models/block/oak_wall_sign.json')
    assert.equal(parts.length, 1)
    assert.equal(entriesCalled, false, '已有具体贴图引用不查 entries')
  } finally { globalThis.fetch = real }
})

test('resolveMcModelAsset: coral_fan 父模板（textures 仅 # 变量引用）借用子模型贴图', async () => {
  const { resolveMcModelAsset } = globalThis.__mcm
  const real = globalThis.fetch
  globalThis.fetch = async (url) => {
    const s = String(url)
    if (s.includes('/entries?')) return fakeRes({ ok: true, data: { files: [
      { name: 'brain_coral_fan.json' },
      { name: 'coral_wall_fan.json' },
    ] } })
    if (s.includes('%2Fcoral_fan.json')) {
      return fakeRes({
        ambientocclusion: false,
        textures: { particle: '#fan' },
        elements: [{
          from: [8, 0, 0], to: [24, 0, 16],
          faces: { up: { uv: [0, 0, 16, 16], texture: '#fan' }, down: { uv: [0, 16, 16, 0], texture: '#fan' } }
        }]
      })
    }
    if (s.includes('brain_coral_fan.json')) return fakeRes({ parent: 'minecraft:block/coral_fan', textures: { fan: 'minecraft:block/brain_coral_fan' } })
    return fakeRes(null, false)
  }

  try {
    const { parts } = await resolveMcModelAsset('/api/mc-official', 'MyPack', 'assets/minecraft/models/block/coral_fan.json')
    assert.equal(parts.length, 1)
    const tx = parts[0].textures
    assert.equal(tx.fan, 'minecraft:block/brain_coral_fan', '借用 brain_coral_fan 子模型的 fan 贴图')
    assert.ok(parts[0].elements.length > 0, '几何体保留')
  } finally { globalThis.fetch = real }
})

test('resolveMcModelAsset: 模板模型无子模型时 textures 仍空（不崩溃）', async () => {
  const { resolveMcModelAsset } = globalThis.__mcm
  const real = globalThis.fetch
  globalThis.fetch = async (url) => {
    const s = String(url)
    if (s.includes('template_wall_sign.json')) return fakeRes({ parent: 'block/block', elements: [{ from: [0, 4, 0], to: [16, 12, 1], faces: { north: { texture: '#all' } } }] })
    if (s.includes('block/block.json')) return fakeRes(null, false)
    if (s.includes('/entries?')) return fakeRes({ ok: true, data: { files: [] } })
    return fakeRes(null, false)
  }
  try {
    const { parts } = await resolveMcModelAsset('/api/mc-official', 'MyPack', 'assets/minecraft/models/block/template_wall_sign.json')
    assert.equal(parts.length, 1)
    assert.equal(Object.keys(parts[0].textures).length, 0, '无子模型 → textures 仍空')
  } finally { globalThis.fetch = real }
})
test('hasUnresolvedTexRefs: elements 引用未定义 #变量检测', () => {
  const { hasUnresolvedTexRefs } = globalThis.__mcm
  const els = [{ faces: { north: { texture: '#plant' }, south: { texture: '#flowerpot' } } }]
  assert.equal(hasUnresolvedTexRefs(els, { flowerpot: 'block/flower_pot' }), true, '#plant 未定义 → true')
  assert.equal(hasUnresolvedTexRefs(els, { plant: 'block/cornflower', flowerpot: 'block/flower_pot' }), false, '均已定义 → false')
  assert.equal(hasUnresolvedTexRefs([{ faces: { north: { texture: 'block/stone' } } }], {}), false, '具体引用不触发')
  assert.equal(hasUnresolvedTexRefs([], { plant: 'x' }), false, '无 elements → false')
  assert.equal(hasUnresolvedTexRefs(null, {}), false)
})

test('resolveMcModelAsset: flower_pot_cross 混合模板借用子模型补 #plant（保留具体引用）', async () => {
  const { resolveMcModelAsset } = globalThis.__mcm
  const real = globalThis.fetch
  globalThis.fetch = async (url) => {
    const s = String(url)
    if (s.includes('flower_pot_cross.json') && !s.includes('potted_')) {
      return fakeRes({
        ambientocclusion: false,
        textures: { particle: 'block/flower_pot', flowerpot: 'block/flower_pot', dirt: 'block/dirt' },
        elements: [
          { from: [6, 0, 6], to: [10, 4, 10], faces: { up: { uv: [6, 6, 10, 10], texture: '#dirt' } } },
          { from: [2.6, 4, 8], to: [13.4, 16, 8], faces: { north: { uv: [0, 0, 16, 16], texture: '#plant' }, south: { uv: [0, 0, 16, 16], texture: '#plant' } } }
        ]
      })
    }
    if (s.includes('/entries?')) return fakeRes({ ok: true, data: { files: [{ name: 'potted_cornflower.json' }] } })
    if (s.includes('potted_cornflower.json')) return fakeRes({ parent: 'minecraft:block/flower_pot_cross', textures: { plant: 'minecraft:block/cornflower' } })
    return fakeRes(null, false)
  }
  try {
    const { parts } = await resolveMcModelAsset('/api/mc-official', 'MyPack', 'assets/minecraft/models/block/flower_pot_cross.json')
    assert.equal(parts.length, 1)
    const tx = parts[0].textures
    assert.equal(tx.plant, 'minecraft:block/cornflower', '借用子模型补全 #plant 贴图')
    assert.equal(tx.flowerpot, 'block/flower_pot', '保留原具体引用 flowerpot')
    assert.equal(tx.dirt, 'block/dirt', '保留原具体引用 dirt')
    assert.ok(parts[0].elements.length > 0, '几何体保留')
  } finally { globalThis.fetch = real }
})
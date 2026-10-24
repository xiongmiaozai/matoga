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

test('borrowTemplateTextures: fileRoot 模式 / 非法参数返回 null', async () => {
  const { borrowTemplateTextures } = globalThis.__mcm
  assert.equal(await borrowTemplateTextures('/api/mc-official', 'p', 'assets/minecraft/models/block/template_wall_sign.json', '/root'), null)
  assert.equal(await borrowTemplateTextures(undefined, undefined, 'assets/minecraft/models/block/template_wall_sign.json'), null)
  assert.equal(await borrowTemplateTextures('/api/mc-official', '', 'assets/minecraft/models/block/template_wall_sign.json'), null)
  assert.equal(await borrowTemplateTextures('/api/mc-official', 'p', 'not-a-model-path'), null)
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

test('resolveMcModelAsset: 非模板模型不触发借用', async () => {
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
    assert.equal(entriesCalled, false, '非 template_ 文件名不查 entries')
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
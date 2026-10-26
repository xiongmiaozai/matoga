/**
 * MC 生物群系染色单测（mc-model-viewer tintindex / tints 部分）：
 * - getMcBiomes / getCurrentBiome / setCurrentBiome：生物群系状态
 * - resolveItemDefRefs：1.21.4+ item 定义 tints 透传（model / composite）
 * 运行于 NR_M3D_STUB=1（material3d 替换为 no-op）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')

const { pathToFileURL } = require('node:url')

process.env.NR_M3D_STUB = '1'
register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))

test('setup: 加载 mc-model-viewer 染色 API（material3d stub 模式）', async () => {
  const m = await import('../../web/src/mc-model-viewer.js')
  globalThis.__mcmTint = m
  assert.equal(typeof m.getMcBiomes, 'function')
  assert.equal(typeof m.getCurrentBiome, 'function')
  assert.equal(typeof m.setCurrentBiome, 'function')
  assert.equal(typeof m.resolveItemDefRefs, 'function')
  assert.equal(typeof m.rerenderLastMcModel, 'function')
  assert.equal(typeof m.sampleTintForTexture, 'function')
})

test('getMcBiomes: 返回生物群系列表（首项 plains，含 desert）', () => {
  const { getMcBiomes } = globalThis.__mcmTint
  const biomes = getMcBiomes()
  assert.ok(Array.isArray(biomes) && biomes.length >= 10)
  assert.equal(biomes[0].id, 'plains')
  const desert = biomes.find(b => b.id === 'desert')
  assert.ok(desert, 'desert 存在')
  assert.equal(desert.temperature, 2.0)
  assert.equal(desert.downfall, 0.0)
})

test('getCurrentBiome / setCurrentBiome: 默认 plains，可切换，未知 id 不变', () => {
  const { getCurrentBiome, setCurrentBiome } = globalThis.__mcmTint
  assert.equal(getCurrentBiome().id, 'plains')
  setCurrentBiome('jungle')
  assert.equal(getCurrentBiome().id, 'jungle')
  assert.equal(getCurrentBiome().temperature, 0.95)
  setCurrentBiome('snowy')
  assert.equal(getCurrentBiome().id, 'snowy')
  assert.equal(getCurrentBiome().temperature, 0.0)
  setCurrentBiome('plains')
  assert.equal(getCurrentBiome().id, 'plains')
  setCurrentBiome('不存在的id')
  assert.equal(getCurrentBiome().id, 'plains')
})

test('resolveItemDefRefs: model 节点透传 tints', () => {
  const { resolveItemDefRefs } = globalThis.__mcmTint
  const node = {
    type: 'minecraft:model',
    model: 'minecraft:item/grass_block',
    tints: [{ type: 'minecraft:grass', downfall: 1.0, temperature: 0.5 }]
  }
  const out = resolveItemDefRefs(node)
  assert.equal(out.length, 1)
  assert.equal(out[0].model, 'minecraft:item/grass_block')
  assert.deepEqual(out[0].tints, [{ type: 'minecraft:grass', downfall: 1.0, temperature: 0.5 }])
})

test('resolveItemDefRefs: model 节点无 tints → tints 为 null', () => {
  const { resolveItemDefRefs } = globalThis.__mcmTint
  const out = resolveItemDefRefs({ type: 'model', model: 'minecraft:item/stone' })
  assert.equal(out.length, 1)
  assert.equal(out[0].tints, null)
})

test('resolveItemDefRefs: composite 收集各子 model 的 tints', () => {
  const { resolveItemDefRefs } = globalThis.__mcmTint
  const node = {
    type: 'minecraft:composite',
    models: [
      { type: 'model', model: 'a', tints: [{ type: 'minecraft:grass' }] },
      { type: 'model', model: 'b' }
    ]
  }
  const out = resolveItemDefRefs(node)
  assert.equal(out.length, 2)
  assert.equal(out[0].model, 'a')
  assert.deepEqual(out[0].tints, [{ type: 'minecraft:grass' }])
  assert.equal(out[1].model, 'b')
  assert.equal(out[1].tints, null)
})
test('sampleTintForTexture: 不染色贴图 / 无效路径返回 null', async () => {
  const { sampleTintForTexture } = globalThis.__mcmTint
  assert.equal(await sampleTintForTexture(null), null)
  assert.equal(await sampleTintForTexture(''), null)
  assert.equal(await sampleTintForTexture('/x/assets/minecraft/textures/block/stone.png'), null)
  assert.equal(await sampleTintForTexture('/tmp/grass_block_top.png'), null)
})

test('sampleTintForTexture: 染色贴图名匹配白名单（colormap 不可达返回 null 不抛）', async () => {
  const { sampleTintForTexture } = globalThis.__mcmTint
  const base = '/x/assets/minecraft/textures/block/'
  for (const name of ['grass_block_top', 'short_grass', 'tall_grass_bottom', 'large_fern_top', 'seagrass', 'tall_dry_grass', 'oak_leaves', 'vine', 'lily_pad', 'leaf_litter', 'bamboo_small_leaves', 'sugar_cane']) {
    const r = await sampleTintForTexture(base + name + '.png')
    assert.equal(r, null, name + ' 应返回 null（无 colormap）')
  }
})
test('sampleTintForTexture: constant tint（水/熔岩）返回固定色', async () => {
  const { sampleTintForTexture } = globalThis.__mcmTint
  const base = '/x/assets/minecraft/textures/block/'
  const water = await sampleTintForTexture(base + 'water_still.png')
  assert.ok(water, 'water_still 应返回染色色')
  assert.equal(Math.round(water.r * 255), 0x3f)
  assert.equal(Math.round(water.g * 255), 0x76)
  assert.equal(Math.round(water.b * 255), 0xe4)
  const lava = await sampleTintForTexture(base + 'lava_flow.png')
  assert.ok(lava, 'lava_flow 应返回染色色')
  assert.equal(Math.round(lava.r * 255), 0xfe)
  assert.equal(Math.round(lava.g * 255), 0xa1)
  assert.equal(Math.round(lava.b * 255), 0x00)
})
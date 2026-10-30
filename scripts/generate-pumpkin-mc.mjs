import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const PACK_ROOT = 'mc-packs/Pumpkin-Realistic-Model'
const ASSETS = join(PACK_ROOT, 'assets/minecraft')
const BLOCKSTATES = join(ASSETS, 'blockstates')
const MODELS_BLOCK = join(ASSETS, 'models/block')
const MODELS_ITEM = join(ASSETS, 'models/item')
const TEXTURES_BLOCK = join(ASSETS, 'textures/block')

const TAU = Math.PI * 2
const CX = 8, CZ = 8

function octagonPanels({ y0, y1, radius, thickness, texture, uvTop, uvBottom, uvSide }) {
  const W = 2 * radius * Math.tan(Math.PI / 8)
  const elements = []
  const angles = [0, 45, 90, 135, 180, 225, 270, 315]
  for (const angle of angles) {
    const from = [CX - W / 2, y0, CZ + radius - thickness / 2]
    const to = [CX + W / 2, y1, CZ + radius + thickness / 2]
    const face = {
      north: { uv: uvSide, texture: `#${texture}` },
      south: { uv: uvSide, texture: `#${texture}` },
      east: { uv: uvSide, texture: `#${texture}` },
      west: { uv: uvSide, texture: `#${texture}` },
      up: { uv: uvTop, texture: `#${texture}` },
      down: { uv: uvBottom, texture: `#${texture}` },
    }
    const el = { from, to, faces: face }
    if (angle !== 0) el.rotation = { origin: [CX, 8, CZ], axis: 'y', angle }
    elements.push(el)
  }
  return elements
}

function capDisc({ y, yTop, radius, thickness, texture, uv, up = true }) {
  const W = 2 * radius * Math.tan(Math.PI / 8)
  const elements = []
  const angles = [0, 45, 90, 135, 180, 225, 270, 315]
  for (const angle of angles) {
    const from = [CX - W / 2, y, CZ + radius - thickness / 2]
    const to = [CX + W / 2, yTop, CZ + radius + thickness / 2]
    const face = {
      north: { uv: [0, 0, 0, 0], texture: `#${texture}` },
      south: { uv: [0, 0, 0, 0], texture: `#${texture}` },
      east: { uv: [0, 0, 0, 0], texture: `#${texture}` },
      west: { uv: [0, 0, 0, 0], texture: `#${texture}` },
      up: { uv, texture: `#${texture}` },
      down: { uv, texture: `#${texture}` },
    }
    const el = { from, to, faces: face }
    if (angle !== 0) el.rotation = { origin: [CX, 8, CZ], axis: 'y', angle }
    elements.push(el)
  }
  return elements
}

function buildPumpkinModel() {
  const elements = []

  const bottom = octagonPanels({
    y0: 0, y1: 4, radius: 4.6, thickness: 0.5,
    texture: 'side',
    uvTop: [0, 0, 16, 16], uvBottom: [0, 0, 16, 16], uvSide: [0, 8, 16, 16],
  })
  const middle = octagonPanels({
    y0: 4, y1: 11, radius: 6.2, thickness: 0.5,
    texture: 'side',
    uvTop: [0, 0, 16, 16], uvBottom: [0, 0, 16, 16], uvSide: [0, 0, 16, 16],
  })
  const top = octagonPanels({
    y0: 11, y1: 13.5, radius: 5.0, thickness: 0.5,
    texture: 'side',
    uvTop: [0, 0, 16, 16], uvBottom: [0, 0, 16, 16], uvSide: [0, 0, 16, 8],
  })

  elements.push(...bottom, ...middle, ...top)

  const topCap = capDisc({
    y: 13.2, yTop: 13.4, radius: 5.0, thickness: 0.5,
    texture: 'top', uv: [3, 3, 13, 13],
  })
  elements.push(...topCap)

  const bottomCap = capDisc({
    y: 0.0, yTop: 0.2, radius: 4.6, thickness: 0.5,
    texture: 'bottom', uv: [3, 3, 13, 13],
  })
  elements.push(...bottomCap)

  const stem = {
    from: [7.0, 13.4, 7.0],
    to: [9.0, 15.6, 9.0],
    faces: {
      north: { uv: [7, 4, 9, 12], texture: '#stem' },
      south: { uv: [7, 4, 9, 12], texture: '#stem' },
      east: { uv: [7, 4, 9, 12], texture: '#stem' },
      west: { uv: [7, 4, 9, 12], texture: '#stem' },
      up: { uv: [7, 7, 9, 9], texture: '#stem' },
      down: { uv: [7, 7, 9, 9], texture: '#stem' },
    },
  }
  elements.push(stem)

  return {
    textures: {
      particle: 'minecraft:block/pumpkin_side',
      side: 'minecraft:block/pumpkin_side',
      top: 'minecraft:block/pumpkin_top',
      bottom: 'minecraft:block/pumpkin_top',
      stem: 'minecraft:block/pumpkin_stem',
    },
    elements,
    gui_light: 'front',
    display: {
      thirdperson_righthand: { rotation: [10, -45, 0], translation: [0, 1.5, 0], scale: [0.375, 0.375, 0.375] },
      firstperson_righthand: { rotation: [0, -45, 0], scale: [0.4, 0.4, 0.4] },
      ground: { translation: [0, 3, 0], scale: [0.25, 0.25, 0.25] },
      gui: { rotation: [30, 225, 0], translation: [0, 1, 0], scale: [0.5, 0.5, 0.5] },
      fixed: { rotation: [0, 180, 0], scale: [0.5, 0.5, 0.5] },
    },
  }
}

function buildCarvedModel() {
  const base = buildPumpkinModel()
  base.textures.side = 'minecraft:block/carved_pumpkin_side'
  base.textures.particle = 'minecraft:block/carved_pumpkin_side'
  base.textures.front = 'minecraft:block/carved_pumpkin_front'
  const frontPanel = {
    from: [6.8, 4.0, 12.0],
    to: [9.2, 11.0, 12.4],
    faces: {
      north: { uv: [0, 0, 16, 16], texture: '#front' },
      south: { uv: [0, 0, 16, 16], texture: '#front' },
      up: { uv: [0, 0, 0, 0], texture: '#front' },
      down: { uv: [0, 0, 0, 0], texture: '#front' },
      east: { uv: [0, 0, 0, 0], texture: '#front' },
      west: { uv: [0, 0, 0, 0], texture: '#front' },
    },
  }
  base.elements.push(frontPanel)
  return base
}

function writeJSON(path, obj) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(obj, null, 2), 'utf8')
}

const pumpkinModel = buildPumpkinModel()
const carvedModel = buildCarvedModel()

writeJSON(join(MODELS_BLOCK, 'pumpkin.json'), pumpkinModel)
writeJSON(join(MODELS_BLOCK, 'carved_pumpkin.json'), carvedModel)
writeJSON(join(MODELS_BLOCK, 'jack_o_lantern.json'), { ...carvedModel, textures: { ...carvedModel.textures, side: 'minecraft:block/jack_o_lantern_side', front: 'minecraft:block/jack_o_lantern_front', particle: 'minecraft:block/jack_o_lantern_side' } })

writeJSON(join(BLOCKSTATES, 'pumpkin.json'), { variants: { '': { model: 'minecraft:block/pumpkin' } } })
writeJSON(join(BLOCKSTATES, 'carved_pumpkin.json'), {
  variants: {
    'facing=north': { model: 'minecraft:block/carved_pumpkin' },
    'facing=south': { model: 'minecraft:block/carved_pumpkin', y: 180 },
    'facing=west': { model: 'minecraft:block/carved_pumpkin', y: 270 },
    'facing=east': { model: 'minecraft:block/carved_pumpkin', y: 90 },
  },
})
writeJSON(join(BLOCKSTATES, 'jack_o_lantern.json'), {
  variants: {
    'facing=north': { model: 'minecraft:block/jack_o_lantern' },
    'facing=south': { model: 'minecraft:block/jack_o_lantern', y: 180 },
    'facing=west': { model: 'minecraft:block/jack_o_lantern', y: 270 },
    'facing=east': { model: 'minecraft:block/jack_o_lantern', y: 90 },
  },
})

writeJSON(join(MODELS_ITEM, 'pumpkin.json'), { parent: 'minecraft:block/pumpkin' })
writeJSON(join(MODELS_ITEM, 'carved_pumpkin.json'), { parent: 'minecraft:block/carved_pumpkin' })
writeJSON(join(MODELS_ITEM, 'jack_o_lantern.json'), { parent: 'minecraft:block/jack_o_lantern' })

writeJSON(join(PACK_ROOT, 'pack.mcmeta'), {
  pack: { pack_format: 34, description: 'Pumpkin Realistic Model §6- §rmatoga' },
})

const count = pumpkinModel.elements.length
console.log(`资源包已生成: ${PACK_ROOT}`)
console.log(`南瓜主体 elements: ${count} 个 cuboid (3层八棱柱 + 顶/底盖 + 茎)`)
console.log('包含: pumpkin / carved_pumpkin / jack_o_lantern (方块+物品+blockstate)')
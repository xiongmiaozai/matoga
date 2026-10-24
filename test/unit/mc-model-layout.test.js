/**
 * UV 贴图布局单测（mc-model-viewer 的 buildMcLayout / buildSpriteLayout / buildBbLayout）：
 * - buildMcLayout：#引用解析 → 贴图去重、uv 缺省全幅、rotation 归一化、mirror 标记、faces.all 展开
 * - buildSpriteLayout：layer0 → 单贴图 sprite 面；无 layer0 → null；particle 回退（shulker_box）
 * - buildBbLayout：无效贴图过滤但索引对齐、resolution uvScale、uv 缺省全幅
 * 运行于 NR_M3D_STUB=1（material3d 替换为 no-op，three 从 node_modules 解析）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')
process.env.NR_M3D_STUB = '1'
register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))

test('setup: 加载 mc-model-viewer（material3d stub 模式）', async () => {
  const m = await import('../../web/src/mc-model-viewer.js')
  globalThis.__mcml = m
  assert.equal(typeof m.buildMcLayout, 'function')
  assert.equal(typeof m.buildSpriteLayout, 'function')
  assert.equal(typeof m.spriteTexKey, 'function')
  assert.equal(typeof m.buildBbLayout, 'function')
  assert.equal(typeof m.getLastModelLayout, 'function')
  assert.equal(m.getLastModelLayout(), null, '初始无布局')
})

test('buildMcLayout: #引用解析 + 贴图去重 + 面记录', () => {
  const { buildMcLayout } = globalThis.__mcml
  const textures = { side: 'minecraft:block/oak', top: 'block/stone' }
  const layout = buildMcLayout([
    {
      from: [0, 0, 0], to: [16, 16, 16],
      faces: {
        north: { texture: '#side', uv: [0, 0, 8, 8] },
        south: { texture: '#side', uv: [8, 8, 16, 16] },
        up: { texture: '#top' },
      },
    },
  ], textures, '/api/mc-packs', 'MyPack')
  assert.equal(layout.type, 'mc')
  assert.equal(layout.uvScale, 16)
  /* 两个引用 → 两张贴图（去重后；FACE_KEYS 遍历序 up 先于 south/north → stone 为 0） */
  assert.equal(layout.textures.length, 2)
  assert.equal(layout.textures[0].name, 'block/stone')
  assert.ok(layout.textures[0].url.includes('/api/mc-packs/MyPack/raw'))
  assert.ok(layout.textures[0].url.includes('stone.png'))
  assert.equal(layout.textures[1].name, 'block/oak')
  const el = layout.elements[0]
  /* north/south 同贴图（索引一致） */
  assert.equal(el.faces.north.tex, 1)
  assert.equal(el.faces.south.tex, 1)
  assert.equal(el.faces.up.tex, 0)
  /* uv 缺省 → 全幅 [0,0,16,16] */
  assert.deepEqual(el.faces.up.uv, [0, 0, 16, 16])
  assert.deepEqual(el.faces.north.uv, [0, 0, 8, 8])
  assert.equal(el.faces.north.rotation, 0)
  assert.equal(el.faces.north.mirror, false)
})

test('buildMcLayout: rotation 归一化 + mirror 标记', () => {
  const { buildMcLayout } = globalThis.__mcml
  const layout = buildMcLayout([
    {
      from: [0, 0, 0], to: [8, 8, 8],
      faces: {
        north: { texture: 'minecraft:block/stone', uv: [0, 0, 16, 16], rotation: 450 },
        south: { texture: 'minecraft:block/stone', uv: [16, 0, 0, 12], rotation: -90 },
        east: { texture: 'minecraft:block/stone', uv: [0, 0, 16, 16], rotation: 'x' },
      },
    },
  ], {}, '/api/mc-packs', 'MyPack')
  const f = layout.elements[0].faces
  assert.equal(f.north.rotation, 90, '450° → 90°')
  assert.equal(f.south.rotation, 270, '-90° → 270°')
  assert.equal(f.east.rotation, 0, '非数字 rotation → 0')
  assert.equal(f.south.mirror, true, 'uv[2] < uv[0] → mirror')
  assert.equal(f.north.mirror, false)
  /* 直接字符串贴图引用（非 #）也可解析 */
  assert.equal(f.north.tex, 0)
})

test('buildMcLayout: faces.all 展开 + 引用缺失面跳过 + 无效元素跳过', () => {
  const { buildMcLayout } = globalThis.__mcml
  const layout = buildMcLayout([
    { faces: { all: { texture: 'minecraft:block/stone', uv: [0, 0, 16, 16] } } },
    { faces: { north: { texture: '#missing_ref' } } },   /* 引用解析失败 → 无有效面，元素跳过 */
    null,
    'bad',
  ], { all: 'minecraft:block/stone' }, '/api/mc-packs', 'MyPack')
  assert.equal(layout.elements.length, 1)
  const el0 = layout.elements[0].faces
  for (const k of ['east', 'west', 'up', 'down', 'south', 'north']) {
    assert.equal(el0[k].tex, 0, `all 展开 → ${k} 面引用贴图 0`)
  }
})

test('buildSpriteLayout: layer0 → 单贴图 sprite 面；无 layer0 → null', () => {
  const { buildSpriteLayout } = globalThis.__mcml
  const layout = buildSpriteLayout({ layer0: 'minecraft:item/stick' }, '/api/mc-packs', 'MyPack')
  assert.ok(layout)
  assert.equal(layout.sprite, true)
  assert.equal(layout.type, 'mc')
  assert.equal(layout.textures.length, 1)
  assert.equal(layout.textures[0].name, 'item/stick')
  assert.ok(layout.textures[0].url.includes('stick.png'))
  const f = layout.elements[0].faces.sprite
  assert.deepEqual(f.uv, [0, 0, 16, 16])
  assert.equal(f.tex, 0)
  assert.equal(buildSpriteLayout({}, '/api/mc-packs', 'MyPack'), null)
  assert.equal(buildSpriteLayout(null, '/api/mc-packs', 'MyPack'), null)
})

test('spriteTexKey: layer0 优先，缺失时回退 particle，均无 → null', () => {
  const { spriteTexKey } = globalThis.__mcml
  assert.equal(spriteTexKey({ layer0: 'minecraft:item/stick' }), '#layer0')
  assert.equal(spriteTexKey({ particle: 'minecraft:block/stone' }), '#particle')
  /* layer0 + particle 同时存在：layer0 优先（item/generated 契约） */
  assert.equal(spriteTexKey({ layer0: 'a', particle: 'b' }), '#layer0')
  assert.equal(spriteTexKey({}), null)
  assert.equal(spriteTexKey(null), null)
  assert.equal(spriteTexKey(undefined), null)
})

test('buildSpriteLayout: particle 回退（shulker_box 模型链仅含 particle 键）', () => {
  const { buildSpriteLayout } = globalThis.__mcml
  /* vanilla models/item/yellow_shulker_box.json 合并后：无 layer0，仅 particle → block/yellow_shulker_box */
  const layout = buildSpriteLayout({ particle: 'minecraft:block/yellow_shulker_box' }, '/api/mc-packs', 'MyPack')
  assert.ok(layout, 'particle 键应触发 sprite 回退（原先返回 null → 贴图无法识别）')
  assert.equal(layout.sprite, true)
  assert.equal(layout.textures.length, 1)
  assert.equal(layout.textures[0].name, 'block/yellow_shulker_box')
  assert.ok(layout.textures[0].url.includes('yellow_shulker_box.png'))
  /* layer0 仍优先于 particle */
  const l2 = buildSpriteLayout({ layer0: 'minecraft:item/stick', particle: 'minecraft:block/stone' }, '/api/mc-packs', 'MyPack')
  assert.equal(l2.textures[0].name, 'item/stick')
})

test('buildBbLayout: 索引对齐（无效贴图过滤）+ resolution uvScale + uv 缺省', () => {
  const { buildBbLayout } = globalThis.__mcml
  const DATA = 'data:image/png;base64,AAAA'
  const json = {
    resolution: 32,
    textures: [
      { name: 'invalid', source: 'http://example.com/x.png' },   /* 非 dataURL → 剔除 */
      { name: 'main', source: DATA },
      { id: 7, source: DATA },                                    /* 无 name → 兜底命名 */
    ],
    elements: [
      {
        from: [0, 0, 0], to: [16, 16, 16],
        faces: {
          north: { texture: 2, uv: [0, 0, 32, 32] },   /* 原始索引 2 → 映射后 1 */
          south: { texture: 0, uv: [0, 0, 16, 16] },   /* 原始索引 0 无效（被剔除）→ 跳过 */
          up: { texture: 1 },                          /* 原始索引 1 → 映射后 0；uv 缺省全幅 */
        },
      },
    ],
  }
  const layout = buildBbLayout(json)
  assert.equal(layout.type, 'bb')
  assert.equal(layout.uvScale, 32)
  assert.equal(layout.textures.length, 2, '无效贴图剔除')
  assert.equal(layout.textures[0].name, 'main')
  assert.equal(layout.textures[1].name, 'texture 1', '无 name 兜底')
  assert.equal(layout.textures[1].url, DATA)
  const f = layout.elements[0].faces
  assert.equal(f.north.tex, 1, '原始索引 2 → 剔除后的 1')
  assert.equal(f.north.mirror, false)
  assert.ok(!f.south, '引用无效贴图的面被跳过')
  assert.equal(f.up.tex, 0, '原始索引 1 → 剔除后的 0')
  assert.deepEqual(f.up.uv, [0, 0, 32, 32], 'uv 缺省 → resolution 全幅')
})

test('buildBbLayout: resolution 缺省 16 / 空输入', () => {
  const { buildBbLayout } = globalThis.__mcml
  const layout = buildBbLayout({ textures: [{ name: 't', source: 'data:image/png;base64,B' }], elements: [{ faces: { north: { texture: 0 } } }] })
  assert.equal(layout.uvScale, 16)
  assert.deepEqual(layout.elements[0].faces.north.uv, [0, 0, 16, 16])
  assert.equal(buildBbLayout({}).elements.length, 0)
  assert.equal(buildBbLayout(null).elements.length, 0)
})
test('buildMcLayout: 无 uv 的面按元素尺寸计算默认 UV（蛋糕模型）', () => {
  const { buildMcLayout } = globalThis.__mcml
  /* vanilla block/cake.json：主体 [1,0,1]→[15,8,15]，六面均无 uv */
  const layout = buildMcLayout([
    {
      from: [1, 0, 1], to: [15, 8, 15],
      faces: {
        down: { texture: '#bottom' },
        up: { texture: '#top' },
        north: { texture: '#side' },
        south: { texture: '#side' },
        west: { texture: '#side' },
        east: { texture: '#side' },
      },
    },
  ], { bottom: 'block/cake_bottom', top: 'block/cake_top', side: 'block/cake_side' }, '/api/mc-packs', 'P')
  const f = layout.elements[0].faces
  assert.deepEqual(f.up.uv, [1, 1, 15, 15], 'up → cake_top 中央 14×14')
  assert.deepEqual(f.down.uv, [1, 1, 15, 15])
  assert.deepEqual(f.south.uv, [1, 8, 15, 16], 'side → u 1-15 / v 8-16（cake_side 下半）')
  assert.deepEqual(f.north.uv, [1, 8, 15, 16])
  assert.deepEqual(f.west.uv, [1, 8, 15, 16])
  assert.deepEqual(f.east.uv, [1, 8, 15, 16])
  assert.equal(f.up.mirror, false)
})

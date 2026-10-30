/**
 * MC 模型 3D 视口渲染器单测（mc-model-viewer 纯逻辑部分）：
 * - parentModelPath / textureAssetPath：引用 → 包内路径（带 ns / 省略 ns 默认 minecraft）
 * - resolveTextureRef：#引用链解析与防环
 * - buildModelGroup：elements → BoxGeometry 数量 / 尺寸 / 位置 / UV 重映射 / 旋转 origin 修正 / 隐藏面
 * - item sprite 回退（无 elements + layer0）由 viewMcModelInViewport 分支，此处不覆盖网络路径
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
  globalThis.__mcm = m
  assert.equal(typeof m.buildModelGroup, 'function')
  assert.equal(typeof m.parentModelPath, 'function')
  assert.equal(typeof m.textureAssetPath, 'function')
  assert.equal(typeof m.resolveTextureRef, 'function')
})

test('parentModelPath: 引用 → 包内模型路径', () => {
  const { parentModelPath } = globalThis.__mcm
  assert.equal(parentModelPath('minecraft:block/cube'), 'assets/minecraft/models/block/cube.json')
  assert.equal(parentModelPath('block/cube'), 'assets/minecraft/models/block/cube.json')
  assert.equal(parentModelPath('item/generated'), 'assets/minecraft/models/item/generated.json')
  assert.equal(parentModelPath('custom:thing/base'), 'assets/custom/models/thing/base.json')
  assert.equal(parentModelPath(''), null)
  assert.equal(parentModelPath(null), null)
  assert.equal(parentModelPath('minecraft:'), null)
})

test('textureAssetPath: 引用 → 包内贴图路径', () => {
  const { textureAssetPath } = globalThis.__mcm
  assert.equal(textureAssetPath('minecraft:block/stone'), 'assets/minecraft/textures/block/stone.png')
  assert.equal(textureAssetPath('block/stone'), 'assets/minecraft/textures/block/stone.png')
  assert.equal(textureAssetPath('item/stick'), 'assets/minecraft/textures/item/stick.png')
  assert.equal(textureAssetPath(''), null)
  assert.equal(textureAssetPath(null), null)
})

test('resolveTextureRef: #引用链解析与防环', () => {
  const { resolveTextureRef } = globalThis.__mcm
  const textures = { all: '#side', side: 'minecraft:block/oak', top: 'block/stone' }
  assert.equal(resolveTextureRef(textures, '#all'), 'assets/minecraft/textures/block/oak.png')
  assert.equal(resolveTextureRef(textures, '#top'), 'assets/minecraft/textures/block/stone.png')
  assert.equal(resolveTextureRef(textures, 'minecraft:item/stick'), 'assets/minecraft/textures/item/stick.png')
  /* 自环 a → b → a 不死循环 */
  const cyclic = { a: '#b', b: '#a' }
  assert.equal(resolveTextureRef(cyclic, '#a'), null)
  assert.equal(resolveTextureRef(textures, '#missing'), null)
  assert.equal(resolveTextureRef(textures, ''), null)
})

test('textureAssetPath: 引用已带图片扩展名时不重复追加', () => {
  const { textureAssetPath } = globalThis.__mcm
  assert.equal(textureAssetPath('block/stone.png'), 'assets/minecraft/textures/block/stone.png', '不产生 stone.png.png')
  assert.equal(textureAssetPath('minecraft:block/photo.jpg'), 'assets/minecraft/textures/block/photo.jpg')
  assert.equal(textureAssetPath('block/anim.webp'), 'assets/minecraft/textures/block/anim.webp')

  assert.equal(textureAssetPath('block/stone'), 'assets/minecraft/textures/block/stone.png', '无扩展名仍补 .png')
})

test('resolveTextureRef: 断链方向键别名回退（社区包 faces 引用 #up 而表内仅 top 等）', () => {
  const { resolveTextureRef } = globalThis.__mcm
  /* up/down ↔ top/bottom 互转 */
  const tb = { top: 'custom:t', bottom: 'custom:b' }
  assert.equal(resolveTextureRef(tb, '#up'), 'assets/custom/textures/t.png')
  assert.equal(resolveTextureRef(tb, '#down'), 'assets/custom/textures/b.png')
  const ud = { up: 'custom:u', down: 'custom:d' }
  assert.equal(resolveTextureRef(ud, '#top'), 'assets/custom/textures/u.png')
  assert.equal(resolveTextureRef(ud, '#bottom'), 'assets/custom/textures/d.png')
  /* 水平方向 → side → all 逐级回退 */
  assert.equal(resolveTextureRef({ all: 'custom:a' }, '#north'), 'assets/custom/textures/a.png')
  assert.equal(resolveTextureRef({ side: 'custom:s' }, '#east'), 'assets/custom/textures/s.png')
  assert.equal(resolveTextureRef({ all: 'custom:a' }, '#side'), 'assets/custom/textures/a.png')
  /* 已定义键优先（回退不影响显式定义）；空值键视为缺失走回退 */
  assert.equal(resolveTextureRef({ up: 'custom:u', top: 'custom:t' }, '#up'), 'assets/custom/textures/u.png')
  assert.equal(resolveTextureRef({ up: null, top: 'custom:t' }, '#up'), 'assets/custom/textures/t.png')
  /* 回退链防环：up→top→up 不死循环 */
  assert.equal(resolveTextureRef({ up: '#top', top: '#up' }, '#up'), null)
  assert.equal(resolveTextureRef({}, '#up'), null)
  assert.equal(resolveTextureRef(null, '#up'), null)
})

test('buildModelGroup: elements 数量 / 尺寸 / 位置 / UV 重映射', () => {
  const { buildModelGroup } = globalThis.__mcm
  const THREE = require('three')
  const group = buildModelGroup([
    {
      from: [0, 0, 0], to: [16, 16, 16],
      faces: { all: { texture: '#all', uv: [0, 0, 16, 16] } },
    },
  ], () => new THREE.MeshBasicMaterial(), 16)
  assert.equal(group.children.length, 1)
  const mesh = group.children[0]
  assert.equal(mesh.geometry.parameters.width, 1, '16 像素 → 1 单位')
  assert.equal(mesh.geometry.parameters.height, 1)
  /* 元素中心 (8,8,8) → 归一化 (0,0,0) */
  assert.equal(mesh.position.x, 0); assert.equal(mesh.position.y, 0); assert.equal(mesh.position.z, 0)
  /* south 面（材质索引 4）UV：全幅 0-16 → 0-1 */
  const uv = mesh.geometry.attributes.uv
  const i = 4 * 4
  assert.equal(uv.getX(i + 0), 0); assert.equal(uv.getY(i + 0), 1)   // 左上
  assert.equal(uv.getX(i + 1), 1); assert.equal(uv.getY(i + 1), 1)   // 右上
  assert.equal(uv.getX(i + 2), 0); assert.equal(uv.getY(i + 2), 0)   // 左下
  assert.equal(uv.getX(i + 3), 1); assert.equal(uv.getY(i + 3), 0)   // 右下
  /* 部分区域 UV：[4,4,12,12]/16 → u 0.25-0.75, v 0.75-0.25 */
  const g2 = buildModelGroup([
    { from: [0, 0, 0], to: [8, 8, 8], faces: { north: { texture: '#t', uv: [4, 4, 12, 12] } } },
  ], () => new THREE.MeshBasicMaterial(), 16)
  const uv2 = g2.children[0].geometry.attributes.uv
  const j = 5 * 4  /* north = -z = 材质索引 5 */
  assert.equal(uv2.getX(j + 0), 0.25); assert.equal(uv2.getY(j + 0), 0.75)
  assert.equal(uv2.getX(j + 1), 0.75); assert.equal(uv2.getY(j + 1), 0.75)
  assert.equal(uv2.getX(j + 2), 0.25); assert.equal(uv2.getY(j + 2), 0.25)
})

test('buildModelGroup: 隐藏面材质 + 旋转绕 origin 修正位置', () => {
  const { buildModelGroup } = globalThis.__mcm
  const THREE = require('three')
  const mats = []
  const group = buildModelGroup([
    {
      from: [4, 4, 4], to: [12, 12, 12],
      rotation: { origin: [8, 8, 8], axis: 'y', angle: 45 },
      faces: { up: { texture: '#t' }, down: { texture: '#t' } },  /* 仅上下两面 → 其余隐藏 */
    },
  ], (key, face) => {
    if (!face) return null
    const m = new THREE.MeshBasicMaterial(); mats.push(m); return m
  }, 16)
  const mesh = group.children[0]
  assert.equal(mesh.material.length, 6, 'BoxGeometry 六面材质数组')
  assert.equal(mesh.material[2], mats[0], 'up（+y 索引 2）为可见材质')
  assert.ok(mesh.material[0].visible === false, 'east 未定义 → 隐藏材质')
  /* 绕 (8,8,8)（归一化原点）转 45°：元素中心 (8,8,8) → 原点，位置不变 */
  assert.equal(mesh.position.x, 0); assert.equal(mesh.position.y, 0); assert.equal(mesh.position.z, 0)
  assert.ok(Math.abs(mesh.rotation.y - Math.PI / 4) < 1e-9)

  /* 绕非中心 origin 旋转：中心 (8,8,8) 绕 origin (0,0,8) 转 90°（y 轴）→ 中心到 (0,0,0)? 计算：off=(8,0,0) 转y90 → (0,0,-8) → position = origin+off = (0,0,0) 归一化 (-0.5,0,0) */
  const g2 = buildModelGroup([
    { from: [0, 0, 0], to: [16, 16, 16], rotation: { origin: [0, 0, 8], axis: 'y', angle: 90 }, faces: { all: { texture: '#t' } } },
  ], () => new THREE.MeshBasicMaterial(), 16)
  const m2 = g2.children[0]
  /* 归一化：origin (0,0,8)-8)/16 = (-0.5,0,0)；中心 (0,0,0)；off = (0.5,0,0) 绕 y 转 90°（逆时针）→ (0,0,-0.5)… three y 轴旋转：x' = x cosθ + z sinθ, z' = -x sinθ + z cosθ → (0.5,0,0)→(0,0,-0.5) → position = (-0.5,0,0)+(0,0,-0.5) = (-0.5,0,-0.5) */
  assert.ok(Math.abs(m2.position.x + 0.5) < 1e-9, 'x = -0.5')
  assert.ok(Math.abs(m2.position.z + 0.5) < 1e-9, 'z = -0.5')
  assert.ok(Math.abs(m2.position.y) < 1e-9)
})

test('buildModelGroup: bbmodel 欧拉旋转与 resolution UV 缩放', () => {
  const { buildModelGroup } = globalThis.__mcm
  const THREE = require('three')
  const group = buildModelGroup([
    {
      name: 'cube1', from: [0, 0, 0], to: [16, 16, 16], origin: [8, 8, 8], rotation: [0, 90, 0],
      faces: { north: { uv: [0, 0, 32, 32], texture: 0 } },
    },
  ], () => new THREE.MeshBasicMaterial(), 32)
  const mesh = group.children[0]
  assert.ok(Math.abs(mesh.rotation.y - Math.PI / 2) < 1e-9, '欧拉 y=90°')
  assert.equal(mesh.rotation.x, 0); assert.equal(mesh.rotation.z, 0)
  /* uv 0-32 / resolution 32 → 0-1 */
  const uv = mesh.geometry.attributes.uv
  const j = 5 * 4
  assert.equal(uv.getX(j + 0), 0); assert.equal(uv.getY(j + 0), 1)
  assert.equal(uv.getX(j + 1), 1); assert.equal(uv.getY(j + 1), 1)
})

test('buildModelGroup: 空输入 / 超上限截断 / 坐标字符串兼容', () => {
  const { buildModelGroup } = globalThis.__mcm
  const THREE = require('three')
  const mat = () => new THREE.MeshBasicMaterial()
  assert.equal(buildModelGroup(null, mat, 16).children.length, 0)
  assert.equal(buildModelGroup([], mat, 16).children.length, 0)
  assert.equal(buildModelGroup(new Array(5000).fill({ from: [0, 0, 0], to: [1, 1, 1] }), mat, 16).children.length, 4096, 'MAX_ELEMENTS 截断')
  /* 老格式字符串坐标 */
  const g = buildModelGroup([{ from: '0,0,0', to: '16,16,16', faces: { all: { texture: '#t' } } }], mat, 16)
  assert.equal(g.children.length, 1)
})
test('defaultFaceUv: vanilla 默认 UV 规则（蛋糕模型场景）', () => {
  const { defaultFaceUv } = globalThis.__mcm
  assert.equal(typeof defaultFaceUv, 'function')
  /* 蛋糕主体 [1,0,1]→[15,8,15]：up 取 cake_top 中央 14×14，side 取下半 8 像素 */
  const from = [1, 0, 1], to = [15, 8, 15]
  assert.deepEqual(defaultFaceUv('up', from, to), [1, 1, 15, 15])
  assert.deepEqual(defaultFaceUv('down', from, to), [1, 1, 15, 15])
  assert.deepEqual(defaultFaceUv('south', from, to), [1, 8, 15, 16])
  assert.deepEqual(defaultFaceUv('north', from, to), [1, 8, 15, 16], 'north 水平翻转：16-15 → 16-1')
  assert.deepEqual(defaultFaceUv('west', from, to), [1, 8, 15, 16])
  assert.deepEqual(defaultFaceUv('east', from, to), [1, 8, 15, 16])
  /* uvScale 换算（bbmodel resolution 32） */
  assert.deepEqual(defaultFaceUv('up', from, to, 32), [2, 2, 30, 30])
  /* 非法输入 */
  assert.equal(defaultFaceUv('up', null, to), null)
  assert.equal(defaultFaceUv('up', ['a', 0, 1], to), null)
  assert.equal(defaultFaceUv('sideways', from, to), null)
})

test('buildModelGroup: faces 无 uv 时应用默认 UV（蛋糕整模型）', () => {
  const { buildModelGroup } = globalThis.__mcm
  const THREE = require('three')
  /* vanilla block/cake.json 原样数据：faces 全部无 uv */
  const group = buildModelGroup([
    {
      from: [1, 0, 1], to: [15, 8, 15],
      faces: {
        down: { texture: '#bottom', cullface: 'down' },
        up: { texture: '#top' },
        north: { texture: '#side' },
        south: { texture: '#side' },
        west: { texture: '#side' },
        east: { texture: '#side' },
      },
    },
  ], () => new THREE.MeshBasicMaterial(), 16)
  const mesh = group.children[0]
  const uv = mesh.geometry.attributes.uv
  /* up（MAT_INDEX=2）：默认 [1,1,15,15] → 归一化 u 1/16~15/16，v 顶点 y = 1-1/16 ~ 1-15/16 */
  const up = 2 * 4
  assert.equal(uv.getX(up + 0), 1 / 16); assert.equal(uv.getY(up + 0), 1 - 1 / 16)
  assert.equal(uv.getX(up + 1), 15 / 16); assert.equal(uv.getY(up + 1), 1 - 1 / 16)
  assert.equal(uv.getX(up + 2), 1 / 16); assert.equal(uv.getY(up + 2), 1 - 15 / 16)
  assert.equal(uv.getX(up + 3), 15 / 16); assert.equal(uv.getY(up + 3), 1 - 15 / 16)
  /* south（MAT_INDEX=4）：默认 [1,8,15,16] → v 下半 8~16 */
  const so = 4 * 4
  assert.equal(uv.getX(so + 0), 1 / 16); assert.equal(uv.getY(so + 0), 1 - 8 / 16)
  assert.equal(uv.getX(so + 1), 15 / 16); assert.equal(uv.getY(so + 3), 1 - 16 / 16)
  /* 显式 uv 仍优先于默认（不受影响） */
  const g2 = buildModelGroup([
    { from: [1, 0, 1], to: [15, 8, 15], faces: { up: { texture: '#t', uv: [0, 0, 16, 16] } } },
  ], () => new THREE.MeshBasicMaterial(), 16)
  const uv2 = g2.children[0].geometry.attributes.uv
  assert.equal(uv2.getX(2 * 4), 0); assert.equal(uv2.getY(2 * 4), 1)
})
test('isPartsEmptyModel: 空方块（air 类）判定', () => {
  const { isPartsEmptyModel } = globalThis.__mcm
  assert.equal(typeof isPartsEmptyModel, 'function')
  /* 文件不存在/非法 → parts 空 → 非空模型（属加载失败语义） */
  assert.equal(isPartsEmptyModel([]), false)
  assert.equal(isPartsEmptyModel(null), false)
  /* air：单 part 无 elements 无 textures → 空模型 */
  assert.equal(isPartsEmptyModel([{ elements: [], textures: {} }]), true)
  assert.equal(isPartsEmptyModel([{ elements: [], textures: null }]), true)
  /* 有 elements → 非空 */
  assert.equal(isPartsEmptyModel([{ elements: [{ from: [0, 0, 0], to: [16, 16, 16] }], textures: {} }]), false)
  /* 有 textures（item sprite layer0）→ 非空（可回退 sprite 展示） */
  assert.equal(isPartsEmptyModel([{ elements: [], textures: { layer0: 'minecraft:item/stick' } }]), false)
  /* composite 多 part：全部空才算空模型 */
  assert.equal(isPartsEmptyModel([{ elements: [], textures: {} }, { elements: [], textures: {} }]), true)
  assert.equal(isPartsEmptyModel([{ elements: [], textures: {} }, { elements: [], textures: { layer0: 'x' } }]), false)
})

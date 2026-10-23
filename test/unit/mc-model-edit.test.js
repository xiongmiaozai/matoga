/**
 * 模型编辑联动单测（mc-model-viewer 编辑 API）：
 * - bindActiveModel：mesh.userData.mcElement → mesh 映射收集
 * - updateModelFaceUv：原始 element face.uv 写回 + mesh 几何 UV 重映射
 *   （含 "all" 展开面 / 默认 UV 面的显式化）
 * - updateModelFaceRotation：rotation 写回 + 重映射
 * - updateModelTexture：参数校验（非 dataURL / 无绑定 → false）
 * - highlightModelFace：面材质 emissive 高亮 / 清除
 * - exportActiveModelJson：mc 烘焙导出（textures+elements）与 bbmodel 完整导出
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

let m = null

test('setup: 加载 mc-model-viewer（编辑 API 可用）', async () => {
  m = await import('../../web/src/mc-model-viewer.js')
  assert.equal(typeof m.bindActiveModel, 'function')
  assert.equal(typeof m.updateModelFaceUv, 'function')
  assert.equal(typeof m.updateModelFaceRotation, 'function')
  assert.equal(typeof m.updateModelTexture, 'function')
  assert.equal(typeof m.highlightModelFace, 'function')
  assert.equal(typeof m.exportActiveModelJson, 'function')
})

function makeModel() {
  const THREE = require('three')
  const el = {
    from: [0, 0, 0], to: [16, 16, 16],
    faces: { north: { texture: '#side', uv: [0, 0, 8, 8] } },
  }
  const group = m.buildModelGroup([el], () => new THREE.MeshStandardMaterial(), 16)
  const mesh = group.children[0]
  assert.ok(mesh.userData.mcElement === el, 'mesh 挂载原始 element 引用')
  assert.equal(mesh.userData.uvScale, 16)
  const parts = [{ elements: [el], textures: { side: 'minecraft:block/stone' } }]
  m.bindActiveModel(group, { type: 'mc', parts, filename: 'stone.json' })
  return { el, group, mesh, parts }
}

test('updateModelFaceUv: element 写回 + 几何 UV 重映射', () => {
  const { el, mesh } = makeModel()
  const ok = m.updateModelFaceUv(el, 'north', [2, 2, 10, 10])
  assert.equal(ok, true)
  assert.deepEqual(el.faces.north.uv, [2, 2, 10, 10], '原始 element face.uv 写回')
  /* north 面（材质索引 5）四顶点 UV：u 2/16..10/16，v 1-2/16..1-10/16（MC v 向下 → THREE v 向上） */
  const uvAttr = mesh.geometry.attributes.uv
  const i = 5 * 4
  assert.equal(uvAttr.getX(i + 0), 2 / 16); assert.equal(uvAttr.getY(i + 0), 1 - 2 / 16)   // 左上
  assert.equal(uvAttr.getX(i + 1), 10 / 16); assert.equal(uvAttr.getY(i + 1), 1 - 2 / 16)  // 右上
  assert.equal(uvAttr.getX(i + 2), 2 / 16); assert.equal(uvAttr.getY(i + 2), 1 - 10 / 16) // 左下
  assert.equal(uvAttr.getX(i + 3), 10 / 16); assert.equal(uvAttr.getY(i + 3), 1 - 10 / 16)
})

test('updateModelFaceUv: 无 uv 的面（默认 UV）编辑 → 显式 face 落成', () => {
  const THREE = require('three')
  const el = {
    from: [0, 0, 0], to: [16, 16, 16],
    faces: { north: { texture: '#side' } },   /* 无 uv：vanilla 默认 UV */
  }
  const group = m.buildModelGroup([el], () => new THREE.MeshStandardMaterial(), 16)
  m.bindActiveModel(group, { type: 'mc', parts: [{ elements: [el], textures: { side: 'x' } }], filename: 'a.json' })
  assert.equal(m.updateModelFaceUv(el, 'north', [1, 1, 9, 9]), true)
  assert.deepEqual(el.faces.north.uv, [1, 1, 9, 9], '编辑后落成显式 uv')
  assert.equal(el.faces.north.texture, '#side', 'texture 引用保留')
})

test('updateModelFaceUv: "all" 展开面编辑 → 显式 face 创建（texture 引用继承）', () => {
  const THREE = require('three')
  const el = { faces: { all: { texture: 'minecraft:block/stone', uv: [0, 0, 16, 16] } } }
  const group = m.buildModelGroup([el], () => new THREE.MeshStandardMaterial(), 16)
  m.bindActiveModel(group, { type: 'mc', parts: [{ elements: [el], textures: {} }], filename: 'a.json' })
  assert.equal(el.faces.north, undefined, '初始无显式 north')
  assert.equal(m.updateModelFaceUv(el, 'north', [4, 4, 8, 8]), true)
  assert.equal(typeof el.faces.north, 'object', '显式 north face 创建')
  assert.equal(el.faces.north.texture, 'minecraft:block/stone', 'texture 从 all 展开继承')
  assert.deepEqual(el.faces.north.uv, [4, 4, 8, 8])
})

test('updateModelFaceRotation: 旋转写回 + 归一化', () => {
  const { el } = makeModel()
  assert.equal(m.updateModelFaceRotation(el, 'north', 90), true)
  assert.equal(el.faces.north.rotation, 90)
  assert.equal(m.updateModelFaceRotation(el, 'north', 450), true)
  assert.equal(el.faces.north.rotation, 90, '450° → 90°')
  assert.equal(m.updateModelFaceRotation(el, 'north', -90), true)
  assert.equal(el.faces.north.rotation, 270, '-90° → 270°')
})

test('updateModelFaceUv/Rotation: 未绑定 element → false', () => {
  const foreign = { faces: { north: { texture: '#x' } } }
  assert.equal(m.updateModelFaceUv(foreign, 'north', [0, 0, 1, 1]), false)
  assert.equal(m.updateModelFaceRotation(foreign, 'north', 90), false)
  /* 非法 uv 值 */
  const { el } = makeModel()
  assert.equal(m.updateModelFaceUv(el, 'north', [0, 0, 1]), false)
  assert.equal(m.updateModelFaceUv(el, 'north', [0, 0, 1, 'x']), false)
})

test('updateModelTexture: 参数校验 → false（非 dataURL / 无布局）', async () => {
  const { el } = makeModel()
  const layout = { elements: [{ faces: { north: { tex: 0 } }, el }] }
  assert.equal(await m.updateModelTexture(0, 'http://example.com/x.png', layout), false, '非 dataURL')
  assert.equal(await m.updateModelTexture(0, 'data:image/png;base64,AAAA', null), false, '无布局')
  assert.equal(await m.updateModelTexture(0, 'data:image/png;base64,AAAA', { elements: [] }), false, '无绑定面')
})

test('highlightModelFace: emissive 高亮 / 清除', () => {
  const { el, mesh } = makeModel()
  assert.equal(m.highlightModelFace(el, 'north', true), true)
  const mat = mesh.material[5]
  assert.equal(mat.emissive.getHex(), 0x2e4a8f, '高亮色')
  assert.equal(m.highlightModelFace(el, 'north', false), true)
  assert.equal(mat.emissive.getHex(), 0x000000, '清除还原')
})

test('exportActiveModelJson: mc 烘焙导出（textures + elements，含编辑写回）', () => {
  const { el } = makeModel()
  m.updateModelFaceUv(el, 'north', [3, 3, 11, 11])
  const r = m.exportActiveModelJson()
  assert.ok(r, '导出成功')
  assert.equal(r.filename, 'stone.json')
  assert.deepEqual(r.json.textures, { side: 'minecraft:block/stone' })
  assert.equal(r.json.elements.length, 1)
  assert.deepEqual(r.json.elements[0].faces.north.uv, [3, 3, 11, 11], '编辑结果包含在导出中')
})

test('exportActiveModelJson: bbmodel 完整导出 / 无绑定 → null', () => {
  const THREE = require('three')
  const json = {
    resolution: 16,
    textures: [{ name: 't', source: 'data:image/png;base64,B' }],
    elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: 0, uv: [0, 0, 16, 16] } } }],
  }
  const group = m.buildModelGroup(json.elements, () => new THREE.MeshStandardMaterial(), 16)
  m.bindActiveModel(group, { type: 'bb', json, filename: 'my.bbmodel' })
  const r = m.exportActiveModelJson()
  assert.equal(r.filename, 'my.bbmodel')
  assert.equal(r.json, json, 'bbmodel 原样导出（引用共享，编辑直接生效）')
  m.updateModelFaceUv(json.elements[0], 'north', [2, 2, 6, 6])
  assert.deepEqual(r.json.elements[0].faces.north.uv, [2, 2, 6, 6], '导出对象即编辑目标')
  m.bindActiveModel(null, null)
  assert.equal(m.exportActiveModelJson(), null, '解绑后导出 null')
})
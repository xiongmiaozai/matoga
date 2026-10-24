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

/* ── 智能贴图引用（替换贴图 → 模型 JSON 持久化）────────── */

/* three ImageLoader 经 document.createElementNS('img') 加载：data:/站内 URL 成功、外部 http 失败。
    async：await fn 完成后才恢复（期间异步多次加载都需要 document） */
async function withImgDoc(fn) {
  const prevDoc = globalThis.document
  globalThis.document = {
    createElementNS: () => {
      const listeners = {}
      const img = {
        complete: false, naturalWidth: 16, naturalHeight: 16,
        addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb) },
        removeEventListener() {},
        set src(v) {
          this._src = v
          const ok = /^data:|^\/api\//.test(v)
          setTimeout(() => {
            this.complete = true
            for (const cb of (listeners[ok ? 'load' : 'error'] || [])) cb.call(this, { target: this })
          }, 0)
        },
        get src() { return this._src || '' },
      }
      return img
    },
  }
  try { return await fn() } finally { if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc }
}

function makeTexModel(ctx) {
  const THREE = require('three')
  const el = {
    from: [0, 0, 0], to: [16, 16, 16],
    faces: { north: { texture: '#side', uv: [0, 0, 8, 8] } },
  }
  const group = m.buildModelGroup([el], () => new THREE.MeshStandardMaterial(), 16)
  const parts = [{ elements: [el], textures: { side: 'minecraft:block/stone' } }]
  m.bindActiveModel(group, { type: 'mc', parts, filename: 'stone.json', ctx })
  const layout = m.buildMcLayout([el], parts[0].textures, undefined, undefined)
  return { el, group, parts, layout }
}

test('扩展贴图引用：resolveTextureRef / texPathForRef', () => {
  const T = {
    side: 'data:image/png;base64,AA', up: 'file:/abs/path/stone.png',
    down: '/api/file/raw?path=%2Fx.png', north: 'minecraft:block/oak',
  }
  assert.equal(m.resolveTextureRef(T, '#side'), 'data:image/png;base64,AA')
  assert.equal(m.resolveTextureRef(T, '#up'), 'file:/abs/path/stone.png')
  assert.equal(m.resolveTextureRef(T, '#down'), '/api/file/raw?path=%2Fx.png')
  assert.equal(m.resolveTextureRef(T, '#north'), 'assets/minecraft/textures/block/oak.png')
  assert.equal(m.texPathForRef('file:/a/b.png'), 'file:/a/b.png')
  assert.equal(m.texPathForRef('block/oak'), 'assets/minecraft/textures/block/oak.png')
})

test('texUrlToRef: 智能引用转换（dataURL / file / 同包标准引用 / 跨包 URL / LAN 包装剥离）', () => {
  assert.equal(m.texUrlToRef(''), '', '空串 = 移除')
  assert.equal(m.texUrlToRef('data:image/png;base64,A'), 'data:image/png;base64,A', 'dataURL 原样')
  assert.equal(m.texUrlToRef('https://x.com/a.png'), 'https://x.com/a.png', '外部 URL 原样')
  assert.equal(m.texUrlToRef('/api/file/raw?path=' + encodeURIComponent('/packs/stone.png')), 'file:/packs/stone.png', '磁盘路径 → file: 引用')
  const packUrl = '/api/mc-packs/vanilla/raw?path=' + encodeURIComponent('assets/minecraft/textures/block/stone.png')
  assert.equal(m.texUrlToRef(packUrl, { api: '/api/mc-packs', packName: 'vanilla' }), 'minecraft:block/stone', '同包 → 标准 MC 引用')
  assert.equal(m.texUrlToRef(packUrl, { api: '/api/mc-packs', packName: 'other' }), packUrl, '跨包 → 保留站内 URL')
  assert.equal(m.texUrlToRef(packUrl), packUrl, '无上下文 → 保留站内 URL')
  assert.equal(m.texUrlToRef('http://192.168.1.5:3000/tok' + packUrl, { api: '/api/mc-packs', packName: 'vanilla' }), 'minecraft:block/stone', 'LAN 包装剥离后仍识别')
})

test('writeMcTexRef: 直接键 / #互引链 / 空键（移除后恢复）写回', () => {
  const T = { side: 'minecraft:block/stone', all: 'minecraft:block/stone', alias: '#side', other: 'minecraft:block/dirt' }
  const n = m.writeMcTexRef(T, 'assets/minecraft/textures/block/stone.png', 'file:/new.png')
  assert.equal(n, 2, 'side/all 直接命中（alias 互引保留）')
  assert.equal(T.side, 'file:/new.png')
  assert.equal(T.all, 'file:/new.png')
  assert.equal(T.alias, '#side', '互引链保留（指向已更新的 side）')
  assert.equal(T.other, 'minecraft:block/dirt', '未命中键不受影响')
  assert.equal(m.writeMcTexRef(T, 'file:/new.png', ''), 2, '移除 → 空引用')
  assert.equal(T.side, '')
  assert.equal(m.writeMcTexRef(T, '', 'data:image/png;base64,B'), 2, '空键 → 恢复替换')
  assert.equal(T.side, 'data:image/png;base64,B')
})

test('buildMcLayout: texPaths（标准 + 扩展引用混合）+ 扩展引用 URL 直通', () => {
  const elements = [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: '#side' }, up: { texture: '#top' } } }]
  const textures = { side: 'minecraft:block/stone', top: 'data:image/png;base64,AA' }
  const lay = m.buildMcLayout(elements, textures, undefined, undefined)
  /* FACE_KEYS 顺序 east/west/up/... → up(#top, data) 先入布局 */
  assert.deepEqual(lay.texPaths, ['data:image/png;base64,AA', 'assets/minecraft/textures/block/stone.png'])
  assert.equal(lay.textures[0].url, 'data:image/png;base64,AA', 'dataURL 直通可加载')
  assert.equal(lay.textures[0].mcmetaUrl, null, '扩展引用无动画元数据')
  assert.equal(lay.textures[0].name, 'data', '显示名')
  assert.equal(lay.textures[1].url, 'undefined/undefined/raw?path=assets%2Fminecraft%2Ftextures%2Fblock%2Fstone.png', '标准引用按上下文构造')
})

test('updateModelTexture: dataURL 替换 → 引用写回 + 导出持久化 + 连续替换', async () => {
  await withImgDoc(async () => {
    const { parts, layout } = makeTexModel()
    assert.equal(await m.updateModelTexture(0, 'data:image/png;base64,ZZZ', layout), true)
    assert.equal(parts[0].textures.side, 'data:image/png;base64,ZZZ', '引用写回（data: 扩展形式）')
    assert.equal(layout.texPaths[0], 'data:image/png;base64,ZZZ', 'texPaths 同步（连续替换基准更新）')
    assert.equal(await m.updateModelTexture(0, '/api/file/raw?path=%2Fmy%2Ftex.png', layout), true)
    assert.equal(parts[0].textures.side, 'file:/my/tex.png', '连续替换：data → file 引用')
    const r = m.exportActiveModelJson()
    assert.equal(r.json.textures.side, 'file:/my/tex.png', '导出 JSON 持久化（后续导入复用）')
  })
})

test('updateModelTexture: 同包贴图 → 标准 MC 引用写回（MC 兼容）', async () => {
  await withImgDoc(async () => {
    const { parts, layout } = makeTexModel({ api: '/api/mc-packs', packName: 'vanilla' })
    const url = '/api/mc-packs/vanilla/raw?path=' + encodeURIComponent('assets/minecraft/textures/block/iron.png')
    assert.equal(await m.updateModelTexture(0, url, layout), true)
    assert.equal(parts[0].textures.side, 'minecraft:block/iron', '同包 → 标准 MC 引用')
    assert.equal(layout.texPaths[0], 'assets/minecraft/textures/block/iron.png')
    /* 重新构建布局（模拟重新打开模型）：标准引用解析回包内路径，URL 可加载 */
    const rel = m.buildMcLayout(parts[0].elements, parts[0].textures, '/api/mc-packs', 'vanilla')
    assert.equal(rel.textures[0].url, url, '重新打开按上下文解析 → 新贴图 URL')
  })
})

test('updateModelTexture: 跨包贴图 → 站内 URL 引用写回（重新打开可加载）', async () => {
  await withImgDoc(async () => {
    const { parts, layout } = makeTexModel({ api: '/api/mc-packs', packName: 'vanilla' })
    const url = '/api/mc-official/official/raw?path=' + encodeURIComponent('assets/minecraft/textures/block/gold.png')
    assert.equal(await m.updateModelTexture(0, url, layout), true)
    assert.equal(parts[0].textures.side, url, '跨包 → 保留站内 URL 引用')
    const rel = m.buildMcLayout(parts[0].elements, parts[0].textures, undefined, undefined)
    assert.equal(rel.textures[0].url, url, '无上下文重新打开 → URL 直通可加载')
  })
})

test('clearModelTexture: 移除 → 引用置空 + 再替换恢复', async () => {
  await withImgDoc(async () => {
    const { parts, layout } = makeTexModel()
    assert.equal(m.clearModelTexture(0, layout), true)
    assert.equal(parts[0].textures.side, '', '引用置空（重新打开 → 面灰色）')
    assert.equal(await m.updateModelTexture(0, 'data:image/png;base64,R', layout), true)
    assert.equal(parts[0].textures.side, 'data:image/png;base64,R', '移除后再替换 → 恢复')
  })
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
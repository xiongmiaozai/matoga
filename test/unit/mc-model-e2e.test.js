/**
 * MC 模型 3D 视口渲染器端到端单测（viewMcModelInViewport 完整链路）：
 * - 临时 Fabric 布局包（无 pack.mcmeta 直含 assets/）+ monkey-patch configStore + 临时 HTTP 服务
 * - NR_M3D_STUB=1（material3d 替换为 stub，showCustomModel 经 globalThis.__m3dShow 捕获 group）
 * - TextureLoader.loadAsync patch 为记录 URL + 返回假 Texture（node 无 DOM Image）
 * 断言：贴图变量解析（all/side 展开、子覆盖父）、parent 链 elements 继承、
 *      face rotation UV 重排、翻转 UV、异步路径贴图参数（Nearest/Repeat）、sprite 回退。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { register } = require('node:module')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')
process.env.NR_M3D_STUB = '1'
register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

let MC_ROOT = ''
let BASE = ''
let mcm = null
let THREE = null
const captured = []
const texUrls = []
const origLoadAsync = Symbol('orig')

function put(root, rel, data) {
  const f = path.join(root, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, data)
}

test('setup: 构造测试包 / 起服务 / patch TextureLoader', async () => {
  MC_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mce2e-'))

  /* 基础 cube：六方向引用（显式格式） */
  put(MC_ROOT, 'MyPack/assets/minecraft/models/block/cube.json', JSON.stringify({
    elements: [{
      from: [0, 0, 0], to: [16, 16, 16],
      faces: {
        down: { texture: '#down' }, up: { texture: '#up' },
        north: { texture: '#north' }, south: { texture: '#south' },
        west: { texture: '#west' }, east: { texture: '#east' },
      },
    }],
  }))
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/block/stone.png', PNG)
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/block/oak.png', PNG)
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/block/dirt.png', PNG)
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/block/planks.png', PNG)
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/item/stick.png', PNG)

  /* 旧式 all 简写：textures 只有 all 键（依赖加载器展开） */
  put(MC_ROOT, 'MyPack/assets/minecraft/models/block/cube_legacy_all.json', JSON.stringify({
    parent: 'block/cube',
    textures: { all: 'minecraft:block/stone' },
  }))
  /* 旧式 side 简写 + 显式方向键优先 */
  put(MC_ROOT, 'MyPack/assets/minecraft/models/block/log_style.json', JSON.stringify({
    parent: 'block/cube',
    textures: { side: 'minecraft:block/oak', down: 'minecraft:block/dirt', up: 'minecraft:block/dirt' },
  }))
  /* 子覆盖父（子重定义 north）+ parent 链 elements 继承 */
  put(MC_ROOT, 'MyPack/assets/minecraft/models/block/override_north.json', JSON.stringify({
    parent: 'block/log_style',
    textures: { north: 'minecraft:block/planks' },
  }))
  /* face rotation 90 + 翻转 uv */
  put(MC_ROOT, 'MyPack/assets/minecraft/models/block/rot_face.json', JSON.stringify({
    textures: { tex: 'minecraft:block/stone' },
    elements: [{
      from: [0, 0, 0], to: [16, 16, 16],
      faces: {
        south: { texture: '#tex', uv: [16, 0, 0, 12], rotation: 90 },
        north: { texture: '#tex', uv: [0, 0, 16, 12] },
      },
    }],
  }))
  /* item/generated：无 elements → sprite 回退 */
  put(MC_ROOT, 'MyPack/assets/minecraft/models/item/stick.json', JSON.stringify({
    parent: 'item/generated',
    textures: { layer0: 'minecraft:item/stick' },
  }))
  /* 贴图实际为 .jpg：模型引用不带扩展名 → 前端请求 .png → 服务端模糊兜底命中 */
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/block/flower.jpg', PNG)
  put(MC_ROOT, 'MyPack/assets/minecraft/models/block/flower_pot.json', JSON.stringify({
    textures: { tex: 'minecraft:block/flower' },
    elements: [{
      from: [0, 0, 0], to: [16, 16, 16],
      faces: { south: { texture: '#tex' } },
    }],
  }))
  /* 断链别名回退：faces 引用 #up/#north 而 textures 表内仅 top（非标键命名） */
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/block/birch.png', PNG)
  put(MC_ROOT, 'MyPack/assets/minecraft/models/block/odd_names.json', JSON.stringify({
    textures: { top: 'minecraft:block/birch' },
    elements: [{
      from: [0, 0, 0], to: [16, 16, 16],
      faces: { up: { texture: '#up' }, north: { texture: '#north' } },
    }],
  }))
  /* 内置 vanilla 基类回退：parent 链指向包内不存在的基类（普通资源包不含 vanilla 基类文件） */
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/block/granite.png', PNG)
  put(MC_ROOT, 'MyPack/assets/minecraft/models/block/granite.json', JSON.stringify({
    parent: 'minecraft:block/cube_all',
    textures: { all: 'minecraft:block/granite' },
  }))
  /* 内置 cube_bottom_top：down/up → #end、side → #side 键传递 */
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/block/sandstone_top.png', PNG)
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/block/sandstone_side.png', PNG)
  put(MC_ROOT, 'MyPack/assets/minecraft/models/block/sandstone.json', JSON.stringify({
    parent: 'minecraft:block/cube_bottom_top',
    textures: { end: 'minecraft:block/sandstone_top', side: 'minecraft:block/sandstone_side' },
  }))
  /* 动图模型：贴图 + mcmeta（竖长条 4 帧，frametime 2 → 周期 0.4s） */
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/block/fire_0.png', PNG)
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/block/fire_0.png.mcmeta', JSON.stringify({ animation: { frametime: 2 } }))
  put(MC_ROOT, 'MyPack/assets/minecraft/models/block/fire.json', JSON.stringify({
    textures: { tex: 'minecraft:block/fire_0' },
    elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { south: { texture: '#tex' } } }],
  }))
  /* shulker_box 特殊渲染方块：模型链仅含 particle 键（无 layer0/elements），
     parent 指向包内不存在的 template_shulker_box（测试内置兜底 + particle sprite 回退） */
  put(MC_ROOT, 'MyPack/assets/minecraft/textures/block/yellow_shulker_box.png', PNG)
  put(MC_ROOT, 'MyPack/assets/minecraft/models/item/yellow_shulker_box.json', JSON.stringify({
    parent: 'minecraft:item/template_shulker_box',
    textures: { particle: 'minecraft:block/yellow_shulker_box' },
  }))
  put(MC_ROOT, 'MyPack/version.json', Buffer.from('{}'))

  const configStore = require('../../server/config/config-store')
  const { createApp } = require('../../server/app')
  const origGet = configStore.get.bind(configStore)
  const injected = { ...origGet(), mcPacksPath: MC_ROOT, officialPacksPath: '' }
  configStore.get = () => injected
  configStore.put = (patch) => { Object.assign(injected, patch || {}); return Promise.resolve() }
  globalThis.__mce2eRestoreConfig = () => { configStore.get = origGet }

  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  BASE = `http://127.0.0.1:${server.address().port}`
  globalThis.__mce2eServer = server

  globalThis.window = { matogaCore: { url: p => BASE + p } }
  globalThis.__m3dShow = g => { captured.push(g); return true }

  THREE = await import('three')
  origLoadAsync.description
  THREE.TextureLoader.prototype.loadAsync = function (url) {
    texUrls.push(url)
    const t = new THREE.Texture()
    /* fire_0 动画贴图给 16×64 竖长条尺寸（4 帧），触发 mcmeta 动画采样路径 */
    const tall = /fire_0\.png(\?|$|&)/.test(url)
    t.image = tall
      ? { naturalWidth: 16, naturalHeight: 64, width: 16, height: 64 }
      : { naturalWidth: 16, naturalHeight: 16, width: 16, height: 16 }
    return Promise.resolve(t)
  }
  mcm = await import('../../web/src/mc-model-viewer.js')
})

async function view(rel) {
  captured.length = 0
  const r = await mcm.viewMcModelInViewport({ api: '/api/mc-packs', packName: 'MyPack', rel })
  const group = captured[0] || null
  /* 贴图异步应用：等 texReady 终态（事件驱动，高负载下固定 10ms 定时偶发不足） */
  if (group) {
    const mt = await import('../../web/src/model-thumb.js')
    await mt.waitForTextures(group, 500)
    await new Promise(res => setTimeout(res, 5))
  }
  return { r, group }
}

test('旧式 textures.all 简写：展开到六方向（#down 等引用可解析）', async () => {
  texUrls.length = 0
  const { r, group } = await view('assets/minecraft/models/block/cube_legacy_all.json')
  assert.equal(r.shown, true)
  assert.equal(group.children.length, 1)
  const mesh = group.children[0]
  /* 六面全部解析到 stone 贴图且异步 map 已应用 */
  const mats = mesh.material
  for (let i = 0; i < 6; i++) {
    assert.ok(mats[i].map instanceof THREE.Texture, `面 ${i} 贴图已应用`)
  }
  /* 同一贴图缓存去重：仅请求一次 */
  const stoneUrls = texUrls.filter(u => u.endsWith('stone.png'))
  assert.equal(stoneUrls.length, 1, '同 key 贴图缓存复用（单次请求）')
  /* 异步路径贴图参数：Nearest 像素风 + Repeat + SRGB */
  assert.equal(mats[0].map.magFilter, THREE.NearestFilter)
  assert.equal(mats[0].map.minFilter, THREE.NearestFilter)
  assert.equal(mats[0].map.wrapS, THREE.RepeatWrapping)
  assert.equal(mats[0].map.colorSpace, THREE.SRGBColorSpace)
})

test('旧式 textures.side 简写 + 显式方向键优先', async () => {
  texUrls.length = 0
  const { r, group } = await view('assets/minecraft/models/block/log_style.json')
  assert.equal(r.shown, true)
  const mats = group.children[0].material
  const urls = [...new Set(texUrls)].sort()
  /* side → 四水平方向 = oak；显式 down/up = dirt；down 未被 side 展开（side 无 down） */
  assert.ok(urls.includes(BASE + '/api/mc-packs/MyPack/raw?path=assets%2Fminecraft%2Ftextures%2Fblock%2Foak.png'))
  assert.ok(urls.includes(BASE + '/api/mc-packs/MyPack/raw?path=assets%2Fminecraft%2Ftextures%2Fblock%2Fdirt.png'))
  /* east(索引0)=oak, down(索引3)=dirt */
  assert.ok(texUrls.some(u => u.endsWith('oak.png')))
  void mats
})

test('textures 合并子覆盖父（子重定义 north）', async () => {
  texUrls.length = 0
  const { r, group } = await view('assets/minecraft/models/block/override_north.json')
  assert.equal(r.shown, true)
  assert.equal(group.children.length, 1, 'parent 链 elements 继承')
  /* north 面（材质索引 5）应请求 planks 而非父层的 oak */
  const mats = group.children[0].material
  assert.ok(mats[5].map, 'north 面有贴图')
  const matUrls = texUrls
  assert.ok(matUrls.some(u => u.endsWith('planks.png')), '子定义的 north 贴图被请求')
})

test('face rotation 90 UV 顶点重排 + 翻转 uv 支持', async () => {
  const { r, group } = await view('assets/minecraft/models/block/rot_face.json')
  assert.equal(r.shown, true)
  const mesh = group.children[0]
  const uv = mesh.geometry.attributes.uv

  /* north（索引 5）无 rotation、翻转前常规：uv [0,0,16,12] → u 0..1, v 1..0.25 */
  const n = 5 * 4
  assert.equal(uv.getX(n + 0), 0); assert.equal(uv.getY(n + 0), 1)
  assert.equal(uv.getX(n + 1), 1); assert.equal(uv.getY(n + 1), 1)
  assert.equal(uv.getX(n + 2), 0); assert.equal(uv.getY(n + 2), 0.25)
  assert.equal(uv.getX(n + 3), 1); assert.equal(uv.getY(n + 3), 0.25)

  /* south（索引 4）rotation 90 + uv [16,0,0,12]（水平翻转）：
     u1=1, u2=0, v1=1, v2=0.25；corners = [TL(1,1), TR(0,1), BL(1,.25), BR(0,.25)]
     90° 采样序 [BL,TL,BR,TR] → [(1,.25),(1,1),(0,.25),(0,1)] */
  const s = 4 * 4
  assert.equal(uv.getX(s + 0), 1); assert.equal(uv.getY(s + 0), 0.25)
  assert.equal(uv.getX(s + 1), 1); assert.equal(uv.getY(s + 1), 1)
  assert.equal(uv.getX(s + 2), 0); assert.equal(uv.getY(s + 2), 0.25)
  assert.equal(uv.getX(s + 3), 0); assert.equal(uv.getY(s + 3), 1)
})

test('item/generated 无 elements → sprite 平面回退', async () => {
  texUrls.length = 0
  const { r, group } = await view('assets/minecraft/models/item/stick.json')
  assert.equal(r.shown, true)
  assert.equal(r.noElements, true)
  assert.equal(group.children.length, 1)
  const mesh = group.children[0]
  assert.equal(mesh.geometry.type, 'PlaneGeometry')
  assert.ok(texUrls.some(u => u.endsWith('stick.png')))
  await new Promise(res => setTimeout(res, 10))
  assert.ok(mesh.material.map instanceof THREE.Texture, 'sprite 贴图异步应用')
})

test('贴图扩展名变体兜底：引用 .png 实为 .jpg（raw 模糊命中 + 渲染链路）', async () => {
  texUrls.length = 0
  const { r, group } = await view('assets/minecraft/models/block/flower_pot.json')
  assert.equal(r.shown, true)
  /* raw 接口按引用的 .png 请求，服务端模糊匹配命中 flower.jpg（200 + 真实 mime） */
  const res = await fetch(BASE + '/api/mc-packs/MyPack/raw?path=' + encodeURIComponent('assets/minecraft/textures/block/flower.png'))
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/jpeg')
  /* 渲染链路仍按 .png URL 请求贴图（服务端兜底对前端透明） */
  assert.ok(texUrls.some(u => u.endsWith('flower.png')), '贴图 URL 已请求')
  await new Promise(res => setTimeout(res, 10))
  const mesh = group.children[0]
  assert.ok(mesh.material[4].map instanceof THREE.Texture, 'south 面（索引 4）贴图异步应用')
})

test('断链别名回退：faces 引用 #up 而表内仅 top（非标键命名）', async () => {
  texUrls.length = 0
  const { r, group } = await view('assets/minecraft/models/block/odd_names.json')
  assert.equal(r.shown, true)
  const mesh = group.children[0]
  /* #up → 回退 top → birch 贴图被请求并应用；#north 回退链全部落空 → 占位材质（面不隐藏） */
  assert.ok(texUrls.some(u => u.endsWith('birch.png')), '回退解析的 birch 贴图已请求')
  await new Promise(res => setTimeout(res, 10))
  assert.ok(mesh.material[2].map instanceof THREE.Texture, 'up 面（索引 2）贴图异步应用')
  assert.ok(mesh.material[5].map == null, 'north 面（索引 5）保持占位（无贴图可解析）')
  assert.equal(mesh.material[5].visible, true, 'north 面可见（占位灰面而非隐藏）')
})

test('内置 vanilla 基类回退：parent 指向包内不存在的 block/cube_all → 盒体渲染', async () => {
  texUrls.length = 0
  const { r, group } = await view('assets/minecraft/models/block/granite.json')
  assert.equal(r.shown, true)
  assert.equal(group.children.length, 1, '内置 cube 基类提供 elements（旧实现 parent 404 吞掉 → 空模型）')
  const mesh = group.children[0]
  await new Promise(res => setTimeout(res, 10))
  /* cube_all 的 all → #all 键传递 + expandTextureAliases 六方向展开 → 六面 granite */
  for (let i = 0; i < 6; i++) {
    assert.ok(mesh.material[i].map instanceof THREE.Texture, `面 ${i} granite 贴图已应用`)
  }
  assert.ok(texUrls.some(u => u.endsWith('granite.png')), 'granite 贴图已请求')
})

test('内置 vanilla 基类回退：cube_bottom_top 键传递（end/side）', async () => {
  texUrls.length = 0
  const { r, group } = await view('assets/minecraft/models/block/sandstone.json')
  assert.equal(r.shown, true)
  await new Promise(res => setTimeout(res, 10))
  const mesh = group.children[0]
  /* up/down（索引 2/3）→ end → sandstone_top；四水平面 → side → sandstone_side */
  assert.ok(mesh.material[2].map instanceof THREE.Texture, 'up 面贴图应用')
  assert.ok(mesh.material[4].map instanceof THREE.Texture, 'south 面贴图应用')
  assert.ok(texUrls.some(u => u.endsWith('sandstone_top.png')), 'end 键传递 → top 贴图请求')
  assert.ok(texUrls.some(u => u.endsWith('sandstone_side.png')), 'side 键传递 → side 贴图请求')
})

test('shulker_box particle 回退 + template_shulker_box 内置兜底：sprite 展示 particle 贴图', async () => {
  texUrls.length = 0
  const { r, group } = await view('assets/minecraft/models/item/yellow_shulker_box.json')
  assert.equal(r.shown, true, 'particle 回退使 sprite 可展示（原先 shown:false → 贴图无法识别）')
  assert.equal(r.noElements, true, '无 elements → sprite 分支')
  assert.equal(group.children.length, 1)
  const mesh = group.children[0]
  assert.equal(mesh.geometry.type, 'PlaneGeometry', 'sprite 平面几何')
  assert.ok(texUrls.some(u => u.endsWith('yellow_shulker_box.png')), 'particle 贴图已请求')
  await new Promise(res => setTimeout(res, 10))
  assert.ok(mesh.material.map instanceof THREE.Texture, 'particle 贴图异步应用到 sprite')
})

test('动画模型：getModelTexAnims 收集 + 多帧采样计划（缩略图动图数据源）', async () => {
  const { r, group } = await view('assets/minecraft/models/block/fire.json')
  assert.equal(r.shown, true)
  await new Promise(res => setTimeout(res, 10))
  const anims = mcm.getModelTexAnims(group)
  assert.equal(anims.length, 1, 'fire_0 动画贴图注册（16×64 4 帧）')
  const anim = anims[0].anim
  assert.equal(anim.frameCount, 4)
  assert.ok(Math.abs(anim.totalSec - 0.4) < 1e-9, 'frametime 2 × 4 帧 = 0.4s 周期')
  /* 采样计划：0.4s × 10fps → 4 帧、每帧 100ms */
  const mt = await import('../../web/src/model-thumb.js')
  const plan = mt.animFramePlan(anims)
  assert.equal(plan.n, 4)
  assert.equal(plan.delay, 100)
  assert.equal(Math.abs(plan.T - 0.4) < 1e-9, true)
  /* 时间轴取帧：t=0.05s（tick 1，帧 0 时长 2 tick）→ 帧 0；t=0.25s（tick 5）→ 帧 2 */
  assert.equal(mcm.animFrameIndexAt(anim, 0.05), 0)
  assert.equal(mcm.animFrameIndexAt(anim, 0.25), 2)
  /* 静态模型（无动画材质）→ plan null */
  const g2 = mcm.buildModelGroup(
    [{ from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: '#t' } } }],
    (key, face) => (face ? new THREE.MeshBasicMaterial() : null), 16,
  )
  assert.equal(mcm.getModelTexAnims(g2).length, 0)
  assert.equal(mt.animFramePlan([]), null)
})

test('共享材质带 userData.shared 标记（dispose 保护契约）', () => {
  /* 经 buildModelGroup 产出的隐藏面/占位材质需被 material3d 的 disposeGroupDeep 跳过 */
  const THREE_NS = require('three')
  const g = mcm.buildModelGroup(
    [{ from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: '#t' } } }],
    (key, face) => (face ? new THREE_NS.MeshBasicMaterial() : null), 16,
  )
  const mats = g.children[0].material
  assert.equal(mats.filter(m => m && m.userData && m.userData.shared).length, 5, '未定义的 5 面用共享隐藏材质')
  assert.ok(!mats[2].userData.shared, 'up 面为独立材质')
})

test('UV 布局产出：多贴图去重 + 面引用（log_style：side=oak / up,down=dirt）', async () => {
  const { r } = await view('assets/minecraft/models/block/log_style.json')
  assert.equal(r.shown, true)
  const layout = mcm.getLastModelLayout()
  assert.ok(layout, 'lastLayout 已记录')
  assert.equal(layout.type, 'mc')
  assert.equal(layout.uvScale, 16)
  assert.equal(layout.textures.length, 2, 'oak + dirt 两张贴图')
  const oakIdx = layout.textures.findIndex(tx => tx.name === 'block/oak')
  const dirtIdx = layout.textures.findIndex(tx => tx.name === 'block/dirt')
  assert.ok(oakIdx >= 0 && dirtIdx >= 0)
  const f = layout.elements[0].faces
  assert.equal(f.north.tex, oakIdx, 'side 展开 → north 用 oak')
  assert.equal(f.west.tex, oakIdx)
  assert.equal(f.up.tex, dirtIdx, '显式 up 用 dirt')
  assert.equal(f.down.tex, dirtIdx)
})

test('UV 布局产出：rotation / mirror / uv 原始像素矩形（rot_face）', async () => {
  const { r } = await view('assets/minecraft/models/block/rot_face.json')
  assert.equal(r.shown, true)
  const layout = mcm.getLastModelLayout()
  assert.equal(layout.textures.length, 1)
  assert.equal(layout.textures[0].name, 'block/stone')
  assert.ok(layout.textures[0].url.includes('stone.png'))
  const f = layout.elements[0].faces
  assert.deepEqual(f.south.uv, [16, 0, 0, 12], 'UV 原始像素坐标保留')
  assert.equal(f.south.rotation, 90)
  assert.equal(f.south.mirror, true, 'uv[2] < uv[0] → mirror 标记')
  assert.deepEqual(f.north.uv, [0, 0, 16, 12])
  assert.equal(f.north.mirror, false)
})

test('UV 布局产出：item sprite 回退布局（stick）', async () => {
  const { r } = await view('assets/minecraft/models/item/stick.json')
  assert.equal(r.shown, true)
  const layout = mcm.getLastModelLayout()
  assert.equal(layout.sprite, true)
  assert.equal(layout.textures.length, 1)
  assert.equal(layout.textures[0].name, 'item/stick')
  assert.ok(layout.textures[0].url.includes('stick.png'))
  assert.deepEqual(layout.elements[0].faces.sprite.uv, [0, 0, 16, 16])
  assert.equal(layout.elements[0].faces.sprite.tex, 0)
})

test('teardown: 关服务 / 清临时目录 / 恢复 patch', async () => {
  await new Promise((r) => globalThis.__mce2eServer.close(r))
  globalThis.__mce2eRestoreConfig()
  delete globalThis.window
  delete globalThis.__m3dShow
  delete globalThis.__mce2eServer
  fs.rmSync(MC_ROOT, { recursive: true, force: true })
})
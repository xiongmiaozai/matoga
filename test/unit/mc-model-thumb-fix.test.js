/**
 * 模型预览图修复专项单测（蛋糕 / 篝火 / 命令方块三案例的根因回归）：
 * - textures 沿 parent 链「原始表合并、最终展开一次」：子层 side 键不再覆盖父层
 *   显式方向键——command_block 式模型 north=#front / south=#back 保留（front/back
 *   贴图不丢失，预览图各面均有材质）；旧式 all/side 简写行为不变（回归）。
 * - ensureModelThumb 不再以 item.thumb 短路（收藏/最近项旧单帧 URL 锁定 stale 缓存
 *   的缺陷）：渲染失败时回退旧 thumb（不空白），成功时刷新 item.thumb。
 * - model-thumb-service：渲染器版本落后（v4 缓存 vs 当前版本）→ stale 强制重渲染。
 * 运行于 NR_M3D_STUB=1（material3d 替换为 no-op；WebGLRenderer 不触达）。
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
let mt = null
let THREE = null
const texUrls = []

function put(root, rel, data) {
  const f = path.join(root, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, data)
}

test('setup: 构造测试包 / 起服务 / patch TextureLoader', async () => {
  MC_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mcthumbfix-'))

  /* 方向性方块模板（父）：显式方向键 north=#front / south=#back / 其余 #side
     （复刻 vanilla template_command_block 的 textures 结构） */
  put(MC_ROOT, 'MyPack/assets/minecraft/models/block/template_directional.json', JSON.stringify({
    textures: {
      particle: '#back', down: '#side', up: '#side',
      north: '#front', east: '#side', south: '#back', west: '#side',
    },
    elements: [{
      from: [0, 0, 0], to: [16, 16, 16],
      faces: {
        down: { texture: '#down' }, up: { texture: '#up' },
        north: { texture: '#north' }, south: { texture: '#south' },
        west: { texture: '#west' }, east: { texture: '#east' },
      },
    }],
  }))
  /* 子模型（command_block 式）：仅提供 front/back/side 变量
     —— 旧实现逐层展开 side→四方向后合并，north/south 被覆盖成 #side，
     front/back 贴图从预览图消失 */
  put(MC_ROOT, 'MyPack/assets/minecraft/models/block/command_block.json', JSON.stringify({
    parent: 'block/template_directional',
    textures: {
      particle: '#back',
      back: 'minecraft:block/cb_back',
      front: 'minecraft:block/cb_front',
      side: 'minecraft:block/cb_side',
    },
  }))
  /* 子模型重定义方向键（沿用 e2e 语义：子键覆盖父键优先于 side 展开） */
  put(MC_ROOT, 'MyPack/assets/minecraft/models/block/override_front.json', JSON.stringify({
    parent: 'block/template_directional',
    textures: {
      particle: '#back', back: 'minecraft:block/cb_back', front: 'minecraft:block/cb_front',
      side: 'minecraft:block/cb_side', north: 'minecraft:block/cb_north_override',
    },
  }))
  /* 旧式 side 简写回归：子层 side 仍应展开到父层未显式定义的水平方向 */
  put(MC_ROOT, 'MyPack/assets/minecraft/models/block/plain_side.json', JSON.stringify({
    parent: 'block/template_directional',
    textures: { front: 'minecraft:block/cb_front', back: 'minecraft:block/cb_back', side: 'minecraft:block/cb_side' },
  }))
  for (const n of ['cb_front', 'cb_back', 'cb_side', 'cb_north_override']) {
    put(MC_ROOT, `MyPack/assets/minecraft/textures/block/${n}.png`, PNG)
  }

  const configStore = require('../../server/config/config-store')
  const { createApp } = require('../../server/app')
  const origGet = configStore.get.bind(configStore)
  const injected = { ...origGet(), mcPacksPath: MC_ROOT, officialPacksPath: '' }
  configStore.get = () => injected
  configStore.put = (patch) => { Object.assign(injected, patch || {}); return Promise.resolve() }
  globalThis.__mcThumbFixRestoreConfig = () => { configStore.get = origGet }

  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  BASE = `http://127.0.0.1:${server.address().port}`
  globalThis.__mcThumbFixServer = server

  globalThis.window = { matogaCore: { url: p => BASE + p } }
  globalThis.__m3dShow = g => true

  THREE = await import('three')
  THREE.TextureLoader.prototype.loadAsync = function (url) {
    texUrls.push(url)
    const t = new THREE.Texture()
    t.image = { naturalWidth: 16, naturalHeight: 16, width: 16, height: 16 }
    return Promise.resolve(t)
  }
  mcm = await import('../../web/src/mc-model-viewer.js')
  mt = await import('../../web/src/model-thumb.js')
})

test('command_block 式合并：子层 side 不覆盖父层显式方向键（front/back 贴图保留）', async () => {
  const { elements, textures } = await mcm.resolveMcModel('/api/mc-packs', 'MyPack', 'assets/minecraft/models/block/command_block.json')
  assert.equal(elements.length, 1, 'parent 链 elements 继承')
  /* 合并后方向键保持父模板语义：north=#front / south=#back（未被 side 展开键覆盖） */
  assert.equal(textures.north, '#front')
  assert.equal(textures.south, '#back')
  assert.equal(textures.east, '#side')
  assert.equal(textures.west, '#side')
  assert.equal(textures.up, '#side')
  assert.equal(textures.down, '#side')

  /* 落到面材质：north 面解析到 cb_front、south 面解析到 cb_back、其余 cb_side */
  texUrls.length = 0
  const group = mcm.buildModelGroup(elements, mcm.mcMatFor(textures, '/api/mc-packs', 'MyPack'), 16)
  await mt.waitForTextures(group, 500)
  const mats = group.children[0].material
  const faceTex = key => {
    const mat = mats[{ east: 0, west: 1, up: 2, down: 3, south: 4, north: 5 }[key]]
    assert.ok(mat && mat.map, `面 ${key} 有贴图`)
    return mat.map
  }
  /* 六面 map 均已应用（有材质的那面存在）；north 与 south 面 map 实例互不相同
     （front/back 不同贴图），且与侧面 map 实例互不相同 */
  const north = faceTex('north'), south = faceTex('south'), east = faceTex('east')
  assert.notEqual(north, south, 'north(front) 与 south(back) 使用不同贴图')
  assert.notEqual(north, east, 'north(front) 与侧面使用不同贴图')
  assert.notEqual(south, east, 'south(back) 与侧面使用不同贴图')
  /* 请求集合包含三张贴图（各一次：texCache 去重） */
  const uniq = [...new Set(texUrls)].filter(u => u.includes('cb_'))
  assert.equal(uniq.length, 3, 'front/back/side 三张贴图均被请求')
  assert.ok(uniq.some(u => u.endsWith('cb_front.png')), 'front 贴图被请求')
  assert.ok(uniq.some(u => u.endsWith('cb_back.png')), 'back 贴图被请求')
  assert.ok(uniq.some(u => u.endsWith('cb_side.png')), 'side 贴图被请求')
})

test('command_block 式合并：子层显式方向键仍最高优先', async () => {
  const { textures } = await mcm.resolveMcModel('/api/mc-packs', 'MyPack', 'assets/minecraft/models/block/override_front.json')
  assert.equal(textures.north, 'minecraft:block/cb_north_override', '子层显式 north 覆盖父层')
  assert.equal(textures.south, '#back', 'south 仍取父模板 #back')
})

test('旧式 side 简写回归：side 展开到未显式定义的水平方向', async () => {
  const { textures } = await mcm.resolveMcModel('/api/mc-packs', 'MyPack', 'assets/minecraft/models/block/plain_side.json')
  assert.equal(textures.north, '#front', '父层显式 north 不被 side 覆盖')
  assert.equal(textures.south, '#back', '父层显式 south 不被 side 覆盖')
  /* east/west 父模板已显式 #side（值相同）——展开 putIfAbsent 语义不改已定义键 */
  assert.equal(textures.east, '#side')
  assert.equal(textures.west, '#side')
})

test('ensureModelThumb: 渲染失败回退旧 item.thumb（不再以旧 URL 短路锁定缓存）', async () => {
  /* 模型不存在 → resolveMcModelAsset parts 空 → buildGroupFor 抛 'empty model'
     → generateModelThumb 返回 null → 回退旧 thumb URL（不空白） */
  const OLD = '/api/asset/model-thumb?key=' + encodeURIComponent('packmodel:mc:MyPack/assets/minecraft/models/block/missing.json')
  const item = {
    thumb: OLD,
    modelThumb: { kind: 'mc', api: '/api/mc-packs', packName: 'MyPack', rel: 'assets/minecraft/models/block/missing.json', path: 'packmodel:mc:MyPack/assets/minecraft/models/block/missing.json', mtime: 1 },
  }
  const anim = await mt.ensureModelThumb(item)
  assert.ok(anim && Array.isArray(anim.urls) && anim.urls.length === 1, '回退单帧旧图')
  assert.equal(anim.urls[0], OLD)
  assert.equal(anim.delay, 0)
})

test('ensureModelThumb: 无 item.thumb 且渲染失败 → null（不产出空 urls）', async () => {
  const item = {
    thumb: null,
    modelThumb: { kind: 'mc', api: '/api/mc-packs', packName: 'MyPack', rel: 'assets/minecraft/models/block/missing.json', path: 'packmodel:mc:MyPack/assets/minecraft/models/block/missing.json', mtime: 1 },
  }
  const anim = await mt.ensureModelThumb(item)
  assert.equal(anim, null)
})

test('model-thumb-service: 渲染器版本落后（v4 缓存）→ stale 强制重渲染', async () => {
  const svc = require('../../server/services/model-thumb-service')
  const KEY = 'test-unit-model-thumb-fix:v4'
  const PNG_BUF = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
  try { fs.unlinkSync(svc.pngPathFor(KEY)) } catch {}
  try { fs.unlinkSync(svc.metaPathFor(KEY)) } catch {}
  const DATA_URL = 'data:image/png;base64,' + PNG_BUF.toString('base64')
  await svc.saveThumb(KEY, 1000, DATA_URL)
  /* 手工降级 sidecar 为 v4（模拟旧渲染器缓存：mtime 一致但版本落后） */
  fs.writeFileSync(svc.metaPathFor(KEY), JSON.stringify({ mtime: 1000, renderer: 4, frameCount: 1, frameDelay: 0 }))
  const info = await svc.thumbInfo(KEY, 1000)
  assert.equal(info.exists, true)
  assert.equal(info.stale, true, '版本落后 → stale（重渲染覆盖旧坏图）')
  assert.equal(info.renderer, svc.RENDERER_VERSION)
  try { fs.unlinkSync(svc.pngPathFor(KEY)) } catch {}
  try { fs.unlinkSync(svc.metaPathFor(KEY)) } catch {}
})

test('animFramePlan: 低帧率动画采样去重（command_block 4 帧/2s → 4 帧而非 8 帧重复）', async () => {
  /* command_block 贴图动画：frametime 10（0.5s/帧）× 4 帧 = 2s 周期 */
  const anim = { texW: 16, texH: 64, frameW: 16, frameH: 16, frameCount: 4, totalSec: 2,
    timeline: [{ index: 0, ticks: 10 }, { index: 1, ticks: 10 }, { index: 2, ticks: 10 }, { index: 3, ticks: 10 }] }
  const plan = mt.animFramePlan([{ tex: {}, anim }])
  assert.ok(plan, '有采样计划')
  assert.equal(plan.n, 4, '去重后 4 帧（8 个均匀采样点成对落在同一视觉帧）')
  assert.equal(plan.delay, 500, 'delay = T/4 = 500ms（保持 vanilla 视觉时序）')
  assert.deepEqual(plan.ts, [0, 0.5, 1, 1.5], '采样时刻对齐视觉帧边界')
})

test('animFramePlan: 高帧率动画无去重损失（4 帧/0.4s → 4 帧 100ms）', async () => {
  const anim = { texW: 16, texH: 64, frameW: 16, frameH: 16, frameCount: 4, totalSec: 0.4,
    timeline: [{ index: 0, ticks: 2 }, { index: 1, ticks: 2 }, { index: 2, ticks: 2 }, { index: 3, ticks: 2 }] }
  const plan = mt.animFramePlan([{ tex: {}, anim }])
  assert.equal(plan.n, 4)
  assert.equal(plan.delay, 100)
})

test('teardown: 关服务 / 恢复工作区配置', async () => {
  if (globalThis.__mcThumbFixServer) await new Promise(r => globalThis.__mcThumbFixServer.close(r))
  if (globalThis.__mcThumbFixRestoreConfig) globalThis.__mcThumbFixRestoreConfig()
  fs.rmSync(MC_ROOT, { recursive: true, force: true })
})
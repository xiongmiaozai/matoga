/**
 * 模型缩略图生成算法单测（web/src/model-thumb.js 纯逻辑部分，NR_M3D_STUB=1）：
 * - waitForTextures：贴图就绪事件驱动等待——texReady promise 全 resolve → true；
 *   永不 resolve + 超时 → false（partial 不缓存）；texFailed 失败终态 → true；
 *   共享占位材质 / 无 promise 材质跳过；材质数组（BoxGeometry 六面）遍历
 * - frameModelCamera：包围球自动取景——距离 = r / sin(fov/2) × margin（任意比例不裁切）、
 *   等轴测方向为单位向量；sprite 模型正面视角
 * 运行于 NR_M3D_STUB=1（material3d 替换为 no-op；WebGLRenderer 惰性构造不触达）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')
process.env.NR_M3D_STUB = '1'
register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))

test('setup: 加载 model-thumb（material3d stub 模式）', async () => {
  const m = await import('../../web/src/model-thumb.js')
  globalThis.__mt = m
  globalThis.__THREE = await import('three')
  assert.equal(typeof m.waitForTextures, 'function')
  assert.equal(typeof m.frameModelCamera, 'function')
})

function mat(texReady, shared) {
  const THREE = globalThis.__THREE
  const m = new THREE.MeshBasicMaterial()
  if (texReady !== undefined) m.userData.texReady = texReady
  if (shared) m.userData.shared = true
  return m
}

function meshOf(material) {
  const THREE = globalThis.__THREE
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
}

test('waitForTextures: texReady 全部 resolve → true（就绪即返回）', async () => {
  const { waitForTextures } = globalThis.__mt
  const g = new globalThis.__THREE.Group()
  g.add(meshOf(mat(Promise.resolve())))
  g.add(meshOf(mat(Promise.resolve())))
  assert.equal(await waitForTextures(g, 200), true)
})

test('waitForTextures: 永不 resolve 的贴图 + 超时 → false（partial 不缓存）', async () => {
  const { waitForTextures } = globalThis.__mt
  const g = new globalThis.__THREE.Group()
  g.add(meshOf(mat(Promise.resolve())))
  g.add(meshOf(mat(new Promise(() => {}))))
  const t0 = Date.now()
  assert.equal(await waitForTextures(g, 60), false)
  assert.ok(Date.now() - t0 >= 55, '超时上限生效')
})

test('waitForTextures: texFailed 失败终态 → true（404 重试无益可缓存）', async () => {
  const { waitForTextures } = globalThis.__mt
  const m = mat(Promise.resolve())
  m.userData.texFailed = true
  const g = new globalThis.__THREE.Group()
  g.add(meshOf(m))
  assert.equal(await waitForTextures(g, 200), true)
})

test('waitForTextures: 共享材质跳过 / 无 promise 材质视为就绪 / 材质数组遍历', async () => {
  const { waitForTextures } = globalThis.__mt
  const THREE = globalThis.__THREE
  /* 共享占位材质（无 texReady）+ 普通材质数组（六面） */
  const g = new THREE.Group()
  g.add(meshOf(mat(undefined, true)))
  const multi = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [
    mat(Promise.resolve()), mat(undefined, true), mat(Promise.resolve()),
    mat(Promise.resolve()), mat(Promise.resolve()), mat(Promise.resolve()),
  ])
  g.add(multi)
  assert.equal(await waitForTextures(g, 200), true)
  /* 空 group / 无网格 → 就绪 */
  assert.equal(await waitForTextures(new THREE.Group(), 200), true)
})

test('frameModelCamera: 包围球自动取景（等轴测单位方向 + 精确距离）', async () => {
  const { frameModelCamera } = globalThis.__mt
  const THREE = globalThis.__THREE
  const g = new THREE.Group()
  g.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)))   /* 球心 (0,0,0)，半径 √3 */
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100)
  frameModelCamera(camera, g, false)
  const expectDist = (Math.sqrt(3) / Math.sin(35 * Math.PI / 360)) * 1.12
  assert.ok(Math.abs(camera.position.length() - expectDist) < 1e-6, '距离 = r / sin(fov/2) × 1.12')
  /* 等轴测方向为单位向量（旧 (0.55,0.5,0.55) 非归一化）；vanilla GUI 等效象限
     （north 面可见：front 特色面朝向观察者，z 分量为负） */
  const dir = camera.position.clone().normalize()
  const iso = new THREE.Vector3(0.55, 0.5, -0.55).normalize()
  assert.ok(Math.abs(dir.x - iso.x) < 1e-9 && Math.abs(dir.y - iso.y) < 1e-9 && Math.abs(dir.z - iso.z) < 1e-9)
  assert.ok(dir.z < 0, '相机位于 -z 半空间（north/front 面可见）')
})

test('frameModelCamera: 离心模型的球心为取景中心（lookAt 指向球心）', async () => {
  const { frameModelCamera } = globalThis.__mt
  const THREE = globalThis.__THREE
  const g = new THREE.Group()
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  m.position.set(10, 20, 30)   /* 远离原点：球心非 (0,0,0) */
  g.add(m)
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100)
  frameModelCamera(camera, g, false)
  const center = new THREE.Box3().setFromObject(g).getBoundingSphere(new THREE.Sphere()).center
  /* 相机 → 球心方向与视线方向一致（lookAt 球心） */
  const toCenter = center.clone().sub(camera.position).normalize()
  const view = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
  assert.ok(Math.abs(toCenter.dot(view) - 1) < 1e-9, 'lookAt 指向包围球球心')
})

test('frameModelCamera: sprite 正面视角（z 为主，避免侧看成线）', async () => {
  const { frameModelCamera } = globalThis.__mt
  const THREE = globalThis.__THREE
  const g = new THREE.Group()
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2)))   /* 球心 (0,0,0)，半径 0.6√2 */
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100)
  frameModelCamera(camera, g, true)
  const expectDist = (Math.sqrt(2) * 0.6 / Math.sin(35 * Math.PI / 360)) * 1.12
  assert.ok(Math.abs(camera.position.length() - expectDist) < 1e-6)
  const dir = camera.position.clone().normalize()
  assert.ok(dir.z > 0.97, '正面视角 z 分量主导')
})
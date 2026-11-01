/**
 * env-light 环境切换回归测试（Bug #2 / Bug #3）：
 * - Bug #2: clearHDREnv 在非 hdri 模式（如 sky）下不应破坏当前 sky 环境
 * - Bug #3: setEnvMode('custom') 从 hdri 切换时应释放 HDR 贴图资源并重置 environmentRotation
 * 通过 setHooks 注入 stub 状态，验证函数副作用。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const { pathToFileURL } = require('node:url')

register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))

/* env-light.createEnvTexture 用 document.createElement('canvas') 生成环境贴图 */
globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') {
      const ctx = {
        createLinearGradient: () => ({ addColorStop() {} }),
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {},
        fillStyle: '',
        getImageData: () => ({ data: new Uint8ClampedArray(0) }),
        putImageData() {}
      }
      return { width: 0, height: 0, getContext: () => ctx }
    }
    return {}
  }
}

function makeTex() {
  return { dispose() { this.disposed = true } }
}

async function loadEnvLight() {
  return await import('../../web/src/m3d/env-light.js')
}

function setupHooks(m, state) {
  const scene = {
    environment: null,
    background: null,
    environmentRotation: { set(x, y, z) { this.x = x; this.y = y; this.z = z }, x: 0, y: 0, z: 0 },
    environmentIntensity: 1,
    add() {}, remove() {}
  }
  const lightGroup = { children: [], add(c) { this.children.push(c) }, remove(c) { this.children = this.children.filter(x => x !== c) } }
  const hooks = {
    get_lightGroup: () => lightGroup,
    get_initialized: () => true,
    get_pmrem: () => ({ fromEquirectangular: () => ({ texture: makeTex(), dispose() {} }), fromScene: () => ({ texture: makeTex(), dispose() {} }), dispose() {} }),
    get_scene: () => scene,
    get_meshLeft: () => ({ material: { envMapIntensity: 1 } }),
    get_meshRight: () => ({ material: { envMapIntensity: 1 } }),
    get__skyTint: () => ({ setHex() {}, r: 1, g: 1, b: 1, set() {} }),
    get_currentLightPreset: () => 'studio',
    set_currentLightPreset: v => { state.currentLightPreset = v },
    get_customLightConfig: () => null,
    set_customLightConfig: v => { state.customLightConfig = v },
    get_currentEnvMode: () => state.currentEnvMode,
    set_currentEnvMode: v => { state.currentEnvMode = v },
    get_envTexture: () => state.envTexture,
    set_envTexture: v => { state.envTexture = v },
    get_pmremTexture: () => state.pmremTexture,
    set_pmremTexture: v => { state.pmremTexture = v },
    get_envIntensity: () => 0.5,
    set_envIntensity: () => {},
    get_skyMesh: () => state.skyMesh,
    set_skyMesh: v => { state.skyMesh = v },
    get_skySunElevation: () => 15, set_skySunElevation: () => {},
    get_skySunAzimuth: () => 180, set_skySunAzimuth: () => {},
    get_skyTurbidity: () => 3, set_skyTurbidity: () => {},
    get_skyRayleigh: () => 2.5, set_skyRayleigh: () => {},
    get_skyMieCoefficient: () => 0.005, set_skyMieCoefficient: () => {},
    get_skyMieDirectionalG: () => 0.8, set_skyMieDirectionalG: () => {},
    get_skyTintHex: () => 0xa0c0ff, set_skyTintHex: () => {},
    get_skySunLight: () => state.skySunLight,
    set_skySunLight: v => { state.skySunLight = v },
    get_skyEnvTexture: () => state.skyEnvTexture,
    set_skyEnvTexture: v => { state.skyEnvTexture = v },
    get_skyBakeTimer: () => null, set_skyBakeTimer: () => {},
    get_hdrTexture: () => state.hdrTexture,
    set_hdrTexture: v => { state.hdrTexture = v },
    get_hdrTextureOriginal: () => state.hdrTextureOriginal,
    set_hdrTextureOriginal: v => { state.hdrTextureOriginal = v },
    get_hdrRotation: () => 0, set_hdrRotation: () => {},
    get_hdrUsage: () => 'both', set_hdrUsage: () => {},
    get_hdrTextureRotated: () => state.hdrTextureRotated,
    set_hdrTextureRotated: v => { state.hdrTextureRotated = v },
    get_hdrInfo: () => state.hdrInfo,
    set_hdrInfo: v => { state.hdrInfo = v },
    get_hdrRotateTimer: () => null, set_hdrRotateTimer: () => {}
  }
  m.setHooks(hooks)
  return { scene, lightGroup }
}

test('Bug #2: clearHDREnv 在 sky 模式下不破坏 sky 环境', async () => {
  const m = await loadEnvLight()
  const state = { currentEnvMode: 'sky', skyMesh: { geometry: {}, material: {} }, skySunLight: { position: {} }, skyEnvTexture: makeTex() }
  const { scene, lightGroup } = setupHooks(m, state)
  const skyMeshBefore = state.skyMesh
  const skySunLightBefore = state.skySunLight
  m.clearHDREnv()
  assert.equal(state.skyMesh, skyMeshBefore, 'skyMesh 不应被移除')
  assert.equal(state.skySunLight, skySunLightBefore, 'skySunLight 不应被移除')
  assert.equal(state.currentEnvMode, 'sky', 'currentEnvMode 应保持 sky')
  assert.equal(scene.environment, null, 'environment 未被错误置 null')
})

test('Bug #3: setEnvMode 从 hdri 切到 custom 释放 HDR 资源', async () => {
  const m = await loadEnvLight()
  const hdrOrig = makeTex()
  const hdrRot = makeTex()
  const state = {
    currentEnvMode: 'hdri',
    hdrTextureOriginal: hdrOrig,
    hdrTextureRotated: hdrRot,
    hdrTexture: hdrOrig,
    hdrInfo: { width: 1024 },
    skyMesh: null,
    skySunLight: null,
    skyEnvTexture: null,
    envTexture: null,
    pmremTexture: null
  }
  const { scene } = setupHooks(m, state)
  m.setEnvMode('custom')
  assert.equal(hdrOrig.disposed, true, 'hdrTextureOriginal 应被 dispose')
  assert.equal(state.hdrTextureOriginal, null, 'hdrTextureOriginal 应置 null')
  assert.equal(hdrRot.disposed, true, 'hdrTextureRotated 应被 dispose')
  assert.equal(state.hdrTextureRotated, null, 'hdrTextureRotated 应置 null')
  assert.equal(scene.environmentRotation.x, 0, 'environmentRotation 应重置')
  assert.equal(scene.environmentRotation.y, 0, 'environmentRotation.y 应重置')
  assert.equal(state.currentEnvMode, 'custom', '应切到 custom')
})
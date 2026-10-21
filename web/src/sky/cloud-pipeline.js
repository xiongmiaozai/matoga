import * as THREE from 'three'
import { CloudRenderMaterial } from './cloud-render-shader.js'
import { ReprojectMaterial, UpsampleMaterial, GodRaysMaterial } from './cloud-temporal-shaders.js'

const FULLSCREEN_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export class CloudTemporalPipeline {
  constructor(renderer, params = {}) {
    this.renderer = renderer
    this.downscale = params.downscale ?? 2

    this.cloudMat = new CloudRenderMaterial(params)
    this.reprojectMat = new ReprojectMaterial()
    this.upsampleMat = new UpsampleMaterial()
    this.godRaysMat = new GodRaysMaterial()

    this.fsScene = new THREE.Scene()
    this.fsCamera = new THREE.Camera()
    this.fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null)
    this.fsQuad.frustumCulled = false
    this.fsScene.add(this.fsQuad)

    this.cloudScene = new THREE.Scene()
    this.cloudCamera = new THREE.PerspectiveCamera(60, 1, 1, 40000)
    this.cloudMesh = null

    this.blockFrame = 0
    this.prevViewRotInv = new THREE.Matrix3()
    this.currViewRot = new THREE.Matrix3()
    this.initialized = false

    this.cloudRT = null
    this.historyRT = null
    this.tempRT = null
    this.upsampledRT = null
    this.godRaysRT = null
    this.lowW = 1
    this.lowH = 1
  }

  setSize(w, h) {
    this.fullW = w
    this.fullH = h
    this.lowW = Math.max(2, Math.floor(w / this.downscale))
    this.lowH = Math.max(2, Math.floor(h / this.downscale))

    const makeRT = (rw, rh) => new THREE.WebGLRenderTarget(rw, rh, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false
    })

    if (this.cloudRT) this.cloudRT.dispose()
    if (this.historyRT) this.historyRT.dispose()
    if (this.tempRT) this.tempRT.dispose()
    if (this.upsampledRT) this.upsampledRT.dispose()
    if (this.godRaysRT) this.godRaysRT.dispose()

    this.cloudRT = makeRT(this.lowW, this.lowH)
    this.historyRT = makeRT(this.lowW, this.lowH)
    this.tempRT = makeRT(this.lowW, this.lowH)
    this.upsampledRT = makeRT(this.fullW, this.fullH)
    this.godRaysRT = makeRT(Math.floor(w / 2), Math.floor(h / 2))

    this.cloudMat.uniforms.uResolution.value.set(this.lowW, this.lowH)

    this.upsampleMat.uniforms.uLowRes.value.set(this.lowW, this.lowH)


    this.cloudCamera.aspect = w / h
    this.cloudCamera.updateProjectionMatrix()
  }

  setSkyGeometry(geometry) {
    if (this.cloudMesh) this.cloudScene.remove(this.cloudMesh)
    this.cloudMesh = new THREE.Mesh(geometry, this.cloudMat)
    this.cloudMesh.renderOrder = -1
    this.cloudMesh.frustumCulled = false
    this.cloudScene.add(this.cloudMesh)
  }

  setTextures(tex) {
    const u = this.cloudMat.uniforms
    u.uTexBase.value = tex.base
    u.uTexDetail.value = tex.detail
    u.uTexCurl.value = tex.curl
    u.uTexWeather.value = tex.weatherMap
    u.uTexBlueNoise.value = tex.blueNoise || null
  }

  getCloudTexture() {
    return this.upsampledRT.texture
  }

  render(camera, skyUniforms) {
    const u = this.cloudMat.uniforms

    u.uSunDir.value.copy(skyUniforms.uSunDir.value)
    u.uMoonDir.value.copy(skyUniforms.uMoonDir.value)
    u.uDayFactor.value = skyUniforms.uDayFactor.value
    u.uNightFactor.value = skyUniforms.uNightFactor.value
    u.uSunColor.value.copy(skyUniforms.uSunColor.value)
    u.uMoonBrightness.value = skyUniforms.uMoonBrightness.value
    u.uCloudLayerBottom.value.copy(skyUniforms.uCloudLayerBottom.value)
    u.uCloudLayer.value.copy(skyUniforms.uCloudLayer.value)
    u.uCloudCoverage.value = skyUniforms.uCloudCoverage.value
    u.uCloudType.value = skyUniforms.uCloudType.value
    u.uPrecipitation.value = skyUniforms.uPrecipitation.value
    u.uWindOffset.value.copy(skyUniforms.uWindOffset.value)
    u.uCloudAbsorption.value = skyUniforms.uCloudAbsorption.value
    u.uCloudG.value = skyUniforms.uCloudG.value
    u.uCloudPowder.value = skyUniforms.uCloudPowder.value
    u.uCloudAmbient.value = skyUniforms.uCloudAmbient.value
    u.uMoonG.value = skyUniforms.uMoonG.value
    u.uNoiseBaseScale.value = skyUniforms.uNoiseBaseScale.value
    u.uNoiseDetailScale.value = skyUniforms.uNoiseDetailScale.value
    u.uNoiseDetailStrength.value = skyUniforms.uNoiseDetailStrength.value
    u.uNoiseCurlScale.value = skyUniforms.uNoiseCurlScale.value
    u.uNoiseCurlAmp.value = skyUniforms.uNoiseCurlAmp.value
    u.uMaxStepsHorizon.value = skyUniforms.uMaxStepsHorizon.value
    u.uMaxStepsTop.value = skyUniforms.uMaxStepsTop.value
    u.uSkyRatioPenalty.value = skyUniforms.uSkyRatioPenalty.value
    u.uTime.value = skyUniforms.uTime.value
    u.uJitterAmp.value = skyUniforms.uJitterAmp.value
    u.uEnablePowder.value = skyUniforms.uEnablePowder.value
    u.uSingleLightSample.value = skyUniforms.uSingleLightSample.value
    u.uHalfMaxSteps.value = skyUniforms.uHalfMaxSteps.value

    u.uBlockFrame.value = this.blockFrame
    this.blockFrame = (this.blockFrame + 1) % 4

    u.uBlueNoiseOffset.value.set(
      (Math.random() * 7 + 1) * 0.1,
      (Math.random() * 11 + 3) * 0.1
    )

    this.cloudCamera.quaternion.copy(camera.quaternion)
    this.cloudCamera.position.copy(camera.position)
    this.cloudCamera.updateMatrixWorld()

    if (this.cloudMesh) {
      this.cloudMesh.position.copy(camera.position)
    }

    const oldTarget = this.renderer.getRenderTarget()
    const oldClear = new THREE.Color()
    this.renderer.getClearColor(oldClear)
    const oldAlpha = this.renderer.getClearAlpha()
    const oldAutoClear = this.renderer.autoClear

    this.renderer.setRenderTarget(this.cloudRT)
    this.renderer.setClearColor(new THREE.Color(0, 0, 0), 0)
    this.renderer.autoClear = true
    this.renderer.clear()
    this.renderer.render(this.cloudScene, this.cloudCamera)

    this.reprojectMat.uniforms.uTexNew.value = this.cloudRT.texture
    this.reprojectMat.uniforms.uTexHistory.value = this.historyRT.texture
    this.reprojectMat.uniforms.uCurrViewRot.value.copy(this.currViewRot)
    this.reprojectMat.uniforms.uPrevViewRotInv.value.copy(this.prevViewRotInv)
    this.reprojectMat.uniforms.uTanHalfFov.value = Math.tan((camera.fov * Math.PI / 180) * 0.5)
    this.reprojectMat.uniforms.uAspect.value = camera.aspect

    this.fsQuad.material = this.reprojectMat
    this.renderer.setRenderTarget(this.tempRT)
    this.renderer.autoClear = false
    this.renderer.render(this.fsScene, this.fsCamera)

    const swap = this.historyRT
    this.historyRT = this.tempRT
    this.tempRT = swap

    this.upsampleMat.uniforms.uTexCloud.value = this.historyRT.texture
    this.fsQuad.material = this.upsampleMat
    this.renderer.setRenderTarget(this.upsampledRT)
    this.renderer.autoClear = true
    this.renderer.render(this.fsScene, this.fsCamera)

    const sunDir = skyUniforms.uSunDir.value
    const sunScreenPos = new THREE.Vector3(sunDir.x, sunDir.y, sunDir.z)
    sunScreenPos.project(camera)
    this.godRaysMat.uniforms.uTexCloud.value = this.upsampledRT.texture
    this.godRaysMat.uniforms.uSunScreenPos.value.set(sunScreenPos.x * 0.5 + 0.5, sunScreenPos.y * 0.5 + 0.5)
    this.godRaysMat.uniforms.uSunColor.value.copy(skyUniforms.uSunColor.value)
    this.godRaysMat.uniforms.uSunColor.value.multiplyScalar(skyUniforms.uSunIntensity.value)
    this.fsQuad.material = this.godRaysMat
    this.renderer.setRenderTarget(this.godRaysRT)
    this.renderer.autoClear = true
    this.renderer.render(this.fsScene, this.fsCamera)

    this.renderer.setRenderTarget(oldTarget)
    this.renderer.setClearColor(oldClear, oldAlpha)
    this.renderer.autoClear = oldAutoClear

    this.currViewRot.setFromMatrix4(this.cloudCamera.matrixWorld)
    this.prevViewRotInv.setFromMatrix4(this.cloudCamera.matrixWorldInverse)
  }

  getGodRaysTexture() {
    return this.godRaysRT ? this.godRaysRT.texture : null
  }

  dispose() {
    if (this.cloudRT) this.cloudRT.dispose()
    if (this.historyRT) this.historyRT.dispose()
    if (this.tempRT) this.tempRT.dispose()
    if (this.upsampledRT) this.upsampledRT.dispose()
    if (this.godRaysRT) this.godRaysRT.dispose()
    this.cloudMat.dispose()
    this.reprojectMat.dispose()
    this.upsampleMat.dispose()
    this.godRaysMat.dispose()
  }
}
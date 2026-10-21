import * as THREE from 'three'
import { Astronomy } from './astronomy.mjs'
import { WeatherManager } from './weather.mjs'
import { SkyCompositeMaterial } from './sky-shader.js'
import { CloudTemporalPipeline } from './cloud-pipeline.js'
import {
  genBaseTexture,
  genDetailTexture,
  genCurlTexture,
  genWeatherMap,
  genStarTexture,
  genMilkyWay,
  genBlueNoise
} from './noise-textures.mjs'

const el = {}
const cache = {}
function $(id) {
  if (!cache[id]) cache[id] = document.getElementById(id)
  return cache[id]
}

let renderer, scene, camera, skyMat, skyMesh, cloudPipeline
let astro = null
let weather = null
let clock = null

const BASE_SIZE = 128

function toTex3D(data, size, channels) {
  const tex = new THREE.Data3DTexture(data, size, size, size)
  tex.format = channels === 4 ? THREE.RGBAFormat : THREE.RGBFormat
  tex.type = THREE.UnsignedByteType
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

function toTex2D(data, size, channels) {
  const tex = new THREE.DataTexture(data, size, size)
  tex.format = channels === 4 ? THREE.RGBAFormat : THREE.RGBFormat
  tex.type = THREE.UnsignedByteType
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

function buildTextures() {
  console.time('sky.textures')
  const base = toTex3D(genBaseTexture(BASE_SIZE).data, BASE_SIZE, 4)
  const detail = toTex3D(genDetailTexture(64).data, 64, 3)
  const curl = toTex2D(genCurlTexture(128).data, 128, 3)
  const weatherMap = toTex2D(genWeatherMap(256).data, 256, 4)
  const stars = toTex2D(genStarTexture(512).data, 512, 4)
  const milky = toTex2D(genMilkyWay(256).data, 256, 4)
  const blueNoise = toTex2D(genBlueNoise(256).data, 256, 3)
  console.timeEnd('sky.textures')
  return { base, detail, curl, weatherMap, stars, milky, blueNoise }
}

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.setSize(window.innerWidth, window.innerHeight)
  document.getElementById('app').appendChild(renderer.domElement)

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 40000)
  camera.position.set(0, 0, 0)

  const tex = buildTextures()

  skyMat = new SkyCompositeMaterial()
  skyMat.uniforms.uTexWeather.value = tex.weatherMap
  skyMat.uniforms.uTexStars.value = tex.stars
  skyMat.uniforms.uTexMilky.value = tex.milky

  cloudPipeline = new CloudTemporalPipeline(renderer, { downscale: 2 })
  cloudPipeline.setSize(window.innerWidth, window.innerHeight)
  cloudPipeline.setTextures(tex)

  const geo = new THREE.SphereGeometry(10000, 48, 24)
  cloudPipeline.setSkyGeometry(geo)

  skyMesh = new THREE.Mesh(geo, skyMat)
  skyMesh.renderOrder = -1
  skyMesh.frustumCulled = false
  scene.add(skyMesh)

  astro = new Astronomy({ latitude: 30, tzHours: 8 })
  weather = new WeatherManager({ preset: 'cloudy', blendSec: 8 })
  clock = new THREE.Clock()

  window.addEventListener('resize', onResize)
  renderer.setAnimationLoop(animate)

  bindPanel()
  syncSlidersToUniform()
}

/* ---------- 输入控制（轨道相机） ---------- */
let yaw = -0.4, pitch = 0.12
let dragging = false, lastX = 0, lastY = 0
window.addEventListener('mousedown', (e) => {
  dragging = true; lastX = e.clientX; lastY = e.clientY
  window.addEventListener('mouseup', () => { dragging = false }, { once: true })
})
window.addEventListener('mousemove', (e) => {
  if (!dragging) return
  const dx = e.clientX - lastX, dy = e.clientY - lastY
  lastX = e.clientX; lastY = e.clientY
  yaw -= dx * 0.005
  pitch = Math.max(-1.4, Math.min(1.4, pitch - dy * 0.004))
})
window.addEventListener('wheel', (e) => {
  e.preventDefault()
  camera.position.y = Math.max(0, Math.min(8000, camera.position.y + e.deltaY * 4))
}, { passive: false })

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  cloudPipeline.setSize(window.innerWidth, window.innerHeight)
}

/* ---------- 参数面板绑定 ---------- */
function bindSlider(id, valId, fmt, apply) {
  const s = $(id)
  s.addEventListener('input', () => {
    const v = parseFloat(s.value)
    $(valId).textContent = fmt(v)
    if (apply) apply(v)
  })
}

function bindPanel() {
  bindSlider('slDayTime', 'vDayTime', (v) => v.toFixed(3))
  bindSlider('slLat', 'vLat', (v) => v.toFixed(0))
  bindSlider('slLon', 'vLon', (v) => v.toFixed(0))
  bindSlider('slBlend', 'vBlend', (v) => v.toFixed(1))
  bindSlider('slCoverage', 'vCov', (v) => v.toFixed(2),
    (v) => weather.override({ coverage: v }))
  bindSlider('slType', 'vType', (v) => v.toFixed(2),
    (v) => weather.override({ cloudType: v }))
  bindSlider('slPrecip', 'vPrecip', (v) => v.toFixed(2),
    (v) => weather.override({ precipitation: v }))
  bindSlider('slWind', 'vWind', (v) => v.toFixed(2),
    (v) => weather.override({ windSpeed: v }))
  bindSlider('slWindDir', 'vWindDir', (v) => v.toFixed(0),
    () => pushWindDir())
  bindSlider('slAbs', 'vAbs', (v) => v.toFixed(2), (v) => { skyMat.uniforms.uCloudAbsorption.value = v })
  bindSlider('slG', 'vG', (v) => v.toFixed(2), (v) => { skyMat.uniforms.uCloudG.value = v })
  bindSlider('slPowder', 'vPowder', (v) => v.toFixed(2), (v) => { skyMat.uniforms.uCloudPowder.value = v })
  bindSlider('slAmb', 'vAmb', (v) => v.toFixed(2), (v) => { skyMat.uniforms.uCloudAmbient.value = v })
  bindSlider('slMoonB', 'vMoonB', (v) => v.toFixed(2), (v) => { skyMat.uniforms.uMoonBrightness.value = v })
  bindSlider('slSunI', 'vSunI', (v) => v.toFixed(2), (v) => { skyMat.uniforms.uSunIntensity.value = v })

  document.querySelectorAll('[data-weather]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-weather]').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      setWeatherPreset(btn.dataset.weather)
    })
  })

  $('chkDrift').addEventListener('change', (e) => { weather.randomDrift = e.target.checked })

  $('btnSimple').addEventListener('click', () => setAlgo('simple'))
  $('btnNOAA').addEventListener('click', () => setAlgo('noaa'))

  $('chkPowderOff').addEventListener('change', (e) => {
    skyMat.uniforms.uEnablePowder.value = !e.target.checked
    refreshQualityLabel()
  })
  $('chkHalfSteps').addEventListener('change', (e) => {
    skyMat.uniforms.uHalfMaxSteps.value = e.target.checked
    refreshQualityLabel()
  })
  $('chkSingleLight').addEventListener('change', (e) => {
    skyMat.uniforms.uSingleLightSample.value = e.target.checked
    refreshQualityLabel()
  })
  $('chkHalfRes').addEventListener('change', (e) => { refreshQualityLabel() })

  $('ckHorizon').addEventListener('input', (e) => {
    skyMat.uniforms.uHorizonColor.value.set(e.target.value)
  })
  $('ckSun').addEventListener('input', (e) => {
    skyMat.uniforms.uSunColor.value.set(e.target.value)
  })
}

function setWeatherPreset(type) {
  weather.setWeather(type, parseFloat($('slBlend').value))
  const snap = weather.snapshot()
  $('slCoverage').value = snap.coverage
  $('slType').value = snap.cloudType
  $('slPrecip').value = snap.precipitation
  $('slWind').value = snap.windSpeed
  $('vCov').textContent = snap.coverage.toFixed(2)
  $('vType').textContent = snap.cloudType.toFixed(2)
  $('vPrecip').textContent = snap.precipitation.toFixed(2)
  $('vWind').textContent = snap.windSpeed.toFixed(2)
}

function pushWindDir() {
  const ang = parseFloat($('slWindDir').value) * Math.PI / 180
  weather.override({
    windDir: { x: Math.sin(ang), y: Math.cos(ang) }
  })
}

function setAlgo(algo) {
  astro.algorithm = algo
  $('btnSimple').classList.toggle('active', algo === 'simple')
  $('btnNOAA').classList.toggle('active', algo === 'noaa')
}

function syncSlidersToUniform() {
  const u = skyMat.uniforms
  u.uCloudCoverage.value = weather.current.coverage
  u.uCloudType.value = weather.current.cloudType * 2
  u.uPrecipitation.value = weather.current.precipitation
  u.uCloudAbsorption.value = parseFloat($('slAbs').value)
  u.uCloudG.value = parseFloat($('slG').value)
  u.uCloudPowder.value = parseFloat($('slPowder').value)
  u.uCloudAmbient.value = parseFloat($('slAmb').value)
  u.uMoonBrightness.value = parseFloat($('slMoonB').value)
  u.uSunIntensity.value = parseFloat($('slSunI').value)
}

function refreshQualityLabel() {
  const off = skyMat.uniforms.uEnablePowder.value === false
  const half = skyMat.uniforms.uHalfMaxSteps.value === true
  const single = skyMat.uniforms.uSingleLightSample.value === true
  const halfRes = $('chkHalfRes').checked
  const label = !off && !half && !single && !halfRes ? 'Q0'
    : (halfRes ? 'Q2' : 'Q1')
  $('statQ').textContent = label
}

/* ---------- 渲染循环 ---------- */
function animate() {
  const dt = Math.min(clock.getDelta(), 0.1)
  const t = clock.elapsedTime

  camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'))

  const sky = astro.compute(parseFloat($('slDayTime').value), {
    latitude: parseFloat($('slLat').value),
    longitude: parseFloat($('slLon').value),
    algorithm: astro.algorithm
  })
  const w = weather.update(dt)

  const u = skyMat.uniforms
  u.uSunDir.value.set(sky.sunDir.x, sky.sunDir.y, sky.sunDir.z)
  u.uMoonDir.value.set(sky.moonDir.x, sky.moonDir.y, sky.moonDir.z)
  u.uMoonPhase.value = sky.moonPhase
  u.uDayFactor.value = sky.dayFactor
  u.uNightFactor.value = sky.nightFactor
  u.uTime.value = t

  const camPos = camera.position
  u.uCloudLayerBottom.value.set(camPos.x, Math.max(camPos.y, 0), camPos.z)
  u.uCloudCoverage.value = w.coverage
  u.uCloudType.value = w.cloudType
  u.uPrecipitation.value = w.precipitation
  u.uWindOffset.value.set(w.windOffsetX, w.windOffsetY)
  $('statSteps').textContent = '64/128'

  skyMesh.position.copy(camPos)

  const start = performance.now()

  cloudPipeline.render(camera, skyMat.uniforms)
  u.uTexCloud.value = cloudPipeline.getCloudTexture()
  u.uTexGodRays.value = cloudPipeline.getGodRaysTexture()

  renderer.render(scene, camera)

  const elapsed = performance.now() - start
  $('statFrame').textContent = elapsed.toFixed(1)
  $('statCloud').textContent = elapsed.toFixed(1)
}

init()
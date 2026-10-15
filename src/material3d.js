import * as THREE from '../node_modules/three/build/three.module.js'
import { fileUrl, isImageFile } from './utils.js'
import { HDRLoader } from './hdr-loader.js'

let scene, camera, renderer, animationId, pmrem, envTexture

function showLoading(text) { const el = document.getElementById('m3dLoading'); if (!el) return; const t = el.querySelector('.m3d-loading-text'); if (t && text) t.textContent = text; el.classList.add('show') }
function hideLoading() { const el = document.getElementById('m3dLoading'); if (el) el.classList.remove('show') }
function setLoadingProgress(pct) { const el = document.getElementById('m3dLoading'); if (!el) return; const f = el.querySelector('.m3d-loading-fill'); if (f) f.style.width = Math.round(pct * 100) + '%' }
let meshLeft, meshRight, labelLeft, labelRight
let groundMesh, gridHelper, lightGroup
let container = null
let initialized = false
let currentGeo = 'sphere'
let emissiveIntensity = 1.0
let normalScale = 1.0
let materialFormat = 'auto'
let formatDetectCallback = null
let heightDetectCallback = null
let sourceSide = 'dual'
let parallaxScale = 0.05
let parallaxSteps = 32.0
let currentLightPreset = 'studio'
let groundVisible = true
let envIntensity = 1.0
let hdrTexture = null
let opacityMode = 'auto'
let opacityValue = 1.0
let transmissionValue = 0.0
let iorValue = 1.5
let clearcoatValue = 0.0

let rotX = 0, rotY = 0, targetRotX = 0, targetRotY = 0
let isDragging = false, lastX = 0, lastY = 0
let camDist = 3, targetCamDist = 3
let autoRotate = true

const LIGHT_PRESETS = {
  studio: {
    name: '工作室',
    ambient: { color: 0xffffff, intensity: 0.25 },
    lights: [
      { color: 0xffffff, intensity: 1.2, pos: [3, 3, 4] },
      { color: 0xffffff, intensity: 0.8, pos: [-3, 2, 3] },
      { color: 0xccddff, intensity: 0.5, pos: [0, -3, 2] },
    ],
    env: { colors: ['#4a5a7a', '#2a2a4e', '#1a1a2e'], light: { color: 'rgba(255,240,200,0.98)', x: 128, y: 50, r: 30 } },
    bg: 0x1a1a2e
  },
  outdoor: {
    name: '户外阳光',
    ambient: { color: 0x88aacc, intensity: 0.4 },
    lights: [
      { color: 0xffffee, intensity: 2.5, pos: [4, 5, 2] },
      { color: 0x88aacc, intensity: 0.8, pos: [-4, 3, 3] },
      { color: 0xaaccff, intensity: 0.5, pos: [0, -2, 4] },
    ],
    env: { colors: ['#87ceeb', '#4682b4', '#2a3a5a'], light: { color: 'rgba(255,255,220,1.0)', x: 200, y: 30, r: 45 } },
    bg: 0x2a3a5a
  },
  soft: {
    name: '柔和均匀',
    ambient: { color: 0xffffff, intensity: 0.5 },
    lights: [
      { color: 0xffffff, intensity: 0.7, pos: [3, 2, 4] },
      { color: 0xffffff, intensity: 0.7, pos: [-3, 2, 4] },
      { color: 0xffffff, intensity: 0.5, pos: [0, -3, 3] },
      { color: 0xffffff, intensity: 0.5, pos: [0, 3, -3] },
    ],
    env: { colors: ['#606080', '#404060', '#303050'], light: null },
    bg: 0x303050
  },
  warm: {
    name: '暖光',
    ambient: { color: 0xffaa66, intensity: 0.3 },
    lights: [
      { color: 0xffaa66, intensity: 1.5, pos: [3, 2, 4] },
      { color: 0xffcc88, intensity: 0.8, pos: [-3, 3, 3] },
      { color: 0xff8844, intensity: 0.4, pos: [0, -2, 2] },
    ],
    env: { colors: ['#5a3a2a', '#3a2a1a', '#2a1a0a'], light: { color: 'rgba(255,180,100,0.9)', x: 128, y: 60, r: 35 } },
    bg: 0x2a1a0a
  },
  cool: {
    name: '冷光',
    ambient: { color: 0x66aaff, intensity: 0.3 },
    lights: [
      { color: 0x88ccff, intensity: 1.5, pos: [3, 3, 4] },
      { color: 0x4488ff, intensity: 0.8, pos: [-3, 2, 3] },
      { color: 0x66aaff, intensity: 0.4, pos: [0, -2, 2] },
    ],
    env: { colors: ['#2a3a5a', '#1a2a4a', '#0a1a3a'], light: { color: 'rgba(150,200,255,0.9)', x: 128, y: 50, r: 35 } },
    bg: 0x0a1a3a
  }
}

function scaleUV(geometry, su, sv) {
  const uv = geometry.attributes.uv
  if (!uv) return geometry
  for (let i = 0; i < uv.count; i++) { uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv) }
  uv.needsUpdate = true
  return geometry
}

const geometries = {
  sphere: () => scaleUV(new THREE.SphereGeometry(1, 64, 64), 4.0, 1.25),
  cube: () => new THREE.BoxGeometry(1.4, 1.4, 1.4),
  plane: () => new THREE.PlaneGeometry(1.6, 1.6),
  torus: () => scaleUV(new THREE.TorusGeometry(0.8, 0.3, 32, 64), 3.0, 1.0),
  cylinder: () => scaleUV(new THREE.CylinderGeometry(0.7, 0.7, 1.6, 48), 2.75, 1.0),
  capsule: () => scaleUV(new THREE.CapsuleGeometry(0.6, 1.0, 16, 32), 2.5, 1.25)
}

function createEnvTexture(presetKey) {
  const preset = LIGHT_PRESETS[presetKey] || LIGHT_PRESETS.studio
  const env = preset.env
  const canvas = document.createElement('canvas')
  canvas.width = 256; canvas.height = 256
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const grad = ctx.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, env.colors[0]); grad.addColorStop(0.5, env.colors[1]); grad.addColorStop(1, env.colors[2])
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 256, 256)
  if (env.light) { ctx.fillStyle = env.light.color; ctx.beginPath(); ctx.arc(env.light.x, env.light.y, env.light.r, 0, Math.PI * 2); ctx.fill() }
  const tex = new THREE.CanvasTexture(canvas)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function applyLightPreset(presetKey) {
  if (!initialized || !LIGHT_PRESETS[presetKey]) return
  currentLightPreset = presetKey
  const preset = LIGHT_PRESETS[presetKey]
  if (lightGroup) { while (lightGroup.children.length) lightGroup.remove(lightGroup.children[0]) }
  const ambient = new THREE.AmbientLight(preset.ambient.color, preset.ambient.intensity)
  lightGroup.add(ambient)
  for (const l of preset.lights) {
    const dir = new THREE.DirectionalLight(l.color, l.intensity)
    dir.position.set(l.pos[0], l.pos[1], l.pos[2])
    dir.castShadow = true
    dir.shadow.mapSize.set(1024, 1024)
    dir.shadow.camera.left = -3; dir.shadow.camera.right = 3
    dir.shadow.camera.top = 3; dir.shadow.camera.bottom = -3
    dir.shadow.camera.near = 0.1; dir.shadow.camera.far = 15
    lightGroup.add(dir)
  }
  if (hdrTexture) {
    scene.environment = hdrTexture
  } else {
    if (envTexture) envTexture.dispose()
    envTexture = createEnvTexture(presetKey)
    scene.environment = pmrem.fromEquirectangular(envTexture).texture
  }
  scene.background = new THREE.Color(preset.bg)
  for (const m of [meshLeft, meshRight]) { if (m) m.material.envMapIntensity = envIntensity }
}

function imgW(img) { return img.naturalWidth || img.width }
function imgH(img) { return img.naturalHeight || img.height }

function extractChannel(image, channelIndex, invert) {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    let v = data[i + channelIndex]
    if (invert) v = 255 - v
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

function detectFormat(image) {
  const canvas = document.createElement('canvas')
  const w = Math.min(image.naturalWidth, 64), h = Math.min(image.naturalHeight, 64)
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  let alphaNon255 = 0, blueHigh = 0, total = 0
  for (let i = 0; i < data.length; i += 4) { total++; if (data[i + 3] < 250) alphaNon255++; if (data[i + 2] > 64) blueHigh++ }
  const alphaRatio = alphaNon255 / total, blueRatio = blueHigh / total
  if (alphaRatio > 0.05 || blueRatio > 0.5) return 'labpbr'
  return 'old'
}

function extractRoughness(image) {
  const c = document.createElement('canvas'); c.width = image.naturalWidth; c.height = image.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, c.width, c.height), d = imageData.data
  for (let i = 0; i < d.length; i += 4) { const r = 255 - d[i]; d[i] = r; d[i + 1] = r; d[i + 2] = r; d[i + 3] = 255 }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex
}

function extractMetalness(image) {
  const c = document.createElement('canvas'); c.width = image.naturalWidth; c.height = image.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, c.width, c.height), d = imageData.data
  for (let i = 0; i < d.length; i += 4) { const v = d[i + 1]; d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255 }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex
}

function extractEmissive(specImage, mainImage) {
  const w = specImage.naturalWidth, h = specImage.naturalHeight
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(specImage, 0, 0)
  const specData = ctx.getImageData(0, 0, w, h).data
  let mainData = null
  if (mainImage) {
    const mc = document.createElement('canvas'); mc.width = w; mc.height = h
    const mctx = mc.getContext('2d', { willReadFrequently: true }); mctx.drawImage(mainImage, 0, 0, w, h)
    mainData = mctx.getImageData(0, 0, w, h).data
  }
  const imageData = ctx.createImageData(w, h), d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    let a = specData[i + 3]; if (a === 255) a = 0
    const mask = a / 254
    if (mainData) { d[i] = Math.round(mainData[i] * mask); d[i + 1] = Math.round(mainData[i + 1] * mask); d[i + 2] = Math.round(mainData[i + 2] * mask) }
    else { d[i] = d[i + 1] = d[i + 2] = Math.round(255 * mask) }
    d[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex
}

function reconstructNormal(image) {
  const c = document.createElement('canvas'); c.width = imgW(image); c.height = imgH(image)
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, c.width, c.height), d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    let nx = (d[i] / 255) * 2 - 1, ny = (d[i + 1] / 255) * 2 - 1
    const strength = d[i + 3] / 255
    nx *= strength; ny *= strength
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
    d[i] = Math.round((nx + 1) * 127.5); d[i + 1] = Math.round((ny + 1) * 127.5); d[i + 2] = Math.round((nz + 1) * 127.5); d[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex
}

function extractHeight(image) {
  const c = document.createElement('canvas'); c.width = imgW(image); c.height = imgH(image)
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, c.width, c.height), d = imageData.data
  let minA = 255, maxA = 0
  for (let i = 3; i < d.length; i += 4) { if (d[i] < minA) minA = d[i]; if (d[i] > maxA) maxA = d[i] }
  const range = maxA - minA
  if (range < 2) return null
  for (let i = 0; i < d.length; i += 4) { const v = Math.round((d[i + 3] - minA) / range * 255); d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255 }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex
}

function extractHeightFromNormal(image) {
  const w = imgW(image), h = imgH(image)
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
  const src = ctx.getImageData(0, 0, w, h).data
  const n = w * h
  const gx = new Float32Array(n), gy = new Float32Array(n)
  for (let i = 0; i < n; i++) { const j = i * 4; gx[i] = (src[j] - 128) / 127.5; gy[i] = (src[j + 1] - 128) / 127.5 }
  const hRow = new Float32Array(n)
  for (let y = 0; y < h; y++) { let acc = 0; const row = y * w; for (let x = 0; x < w; x++) { acc += gx[row + x]; hRow[row + x] = acc } }
  const hCol = new Float32Array(n)
  for (let x = 0; x < w; x++) { let acc = 0; for (let y = 0; y < h; y++) { acc += gy[y * w + x]; hCol[y * w + x] = acc } }
  let minH = Infinity, maxH = -Infinity
  const height = new Float32Array(n)
  for (let i = 0; i < n; i++) { height[i] = hRow[i] + hCol[i]; if (height[i] < minH) minH = height[i]; if (height[i] > maxH) maxH = height[i] }
  const range = maxH - minH
  if (range < 1e-4) return null
  const out = ctx.createImageData(w, h), od = out.data
  for (let i = 0; i < n; i++) { const v = Math.round((height[i] - minH) / range * 255); od[i * 4] = v; od[i * 4 + 1] = v; od[i * 4 + 2] = v; od[i * 4 + 3] = 255 }
  ctx.putImageData(out, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex
}

function createLabel(text, color) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 32
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = color; ctx.fillRect(0, 0, 128, 32)
  ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, 64, 16)
  const tex = new THREE.CanvasTexture(c)
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(0.6, 0.15, 1)
  return sprite
}

function parseIncludes(src) {
  const pattern = /#include <(\w+)>/g
  function replace(match, name) {
    const chunk = THREE.ShaderChunk[name]
    if (!chunk) return match
    return parseIncludes(chunk)
  }
  return src.replace(pattern, replace)
}

function applyOpacityMode(material) {
  const hasAlpha = material.userData.hasAlpha || false
  const hasSemiTrans = material.userData.hasSemiTrans || false
  const mode = opacityMode
  if (mode === 'cutout') {
    material.transparent = false
    material.alphaTest = hasAlpha ? 0.5 : 0
    material.transmission = 0
  } else if (mode === 'blend') {
    material.transparent = hasAlpha
    material.alphaTest = 0
    material.transmission = 0
  } else if (mode === 'glass') {
    material.transparent = true
    material.alphaTest = 0
    material.transmission = transmissionValue
    material.ior = iorValue
    material.thickness = 0.5
  } else {
    if (hasSemiTrans) {
      material.transparent = true
      material.alphaTest = 0
    } else if (hasAlpha) {
      material.transparent = false
      material.alphaTest = 0.5
    } else {
      material.transparent = false
      material.alphaTest = 0
    }
    material.transmission = 0
  }
  if (opacityValue < 1.0) {
    material.transparent = true
    material.opacity = opacityValue
  } else {
    material.opacity = 1.0
  }
  material.needsUpdate = true
}

function makeMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.1, envMapIntensity: 1.0, emissive: new THREE.Color(0x000000), emissiveIntensity: 1.0, transmission: 0.0, ior: 1.5, thickness: 0.5, clearcoat: 0.0, clearcoatRoughness: 0.0 })
  mat.userData.shaderRefs = null
  mat.onBeforeCompile = (shader) => {
    const prev = mat.userData.shaderRefs
    shader.uniforms.heightMap = { value: prev ? prev.heightMap.value : null }
    shader.uniforms.hasHeightMap = { value: prev ? prev.hasHeightMap.value : 0.0 }
    shader.uniforms.parallaxScale = { value: parallaxScale }
    shader.uniforms.parallaxSteps = { value: parallaxSteps }
    mat.userData.shaderRefs = shader.uniforms
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', 'uniform sampler2D heightMap;\nuniform float hasHeightMap;\nuniform float parallaxScale;\nuniform float parallaxSteps;\n#include <common>')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        vec2 parallaxUv;
        #if defined(USE_MAP)
          parallaxUv = vMapUv;
        #elif defined(USE_NORMALMAP)
          parallaxUv = vNormalMapUv;
        #elif defined(USE_ROUGHNESSMAP)
          parallaxUv = vRoughnessMapUv;
        #else
          parallaxUv = vec2(0.0);
        #endif
        if (parallaxScale > 0.0 && hasHeightMap > 0.5) {
          vec3 viewDir = normalize(vViewPosition);
          vec2 P;
          #if defined(USE_TANGENT)
            vec3 t = normalize( vTangent );
            vec3 n = normalize( vNormal );
            vec3 b = normalize( vBitangent );
            vec3 tView;
            tView.x = dot(t, viewDir);
            tView.y = dot(b, viewDir);
            tView.z = dot(n, viewDir);
            P = tView.xy / max(tView.z, 0.001) * parallaxScale;
          #else
            P = viewDir.xy / max(viewDir.z, 0.001) * parallaxScale;
          #endif
          float Plen = length(P);
          float maxOffset = 0.08;
          if (Plen > maxOffset) P *= maxOffset / Plen;
          float numLayers = parallaxSteps;
          float layerDepth = 1.0 / numLayers;
          float currentLayerDepth = 0.0;
          vec2 deltaTexCoords = P / numLayers;
          vec2 currentTexCoords = parallaxUv;
          float currentDepthValue = texture2D(heightMap, currentTexCoords).r;
          for (int i = 0; i < 64; i++) {
            if (currentLayerDepth >= currentDepthValue) break;
            currentTexCoords -= deltaTexCoords;
            currentDepthValue = texture2D(heightMap, currentTexCoords).r;
            currentLayerDepth += layerDepth;
          }
          vec2 prevTexCoords = currentTexCoords + deltaTexCoords;
          float beforeDepth = texture2D(heightMap, prevTexCoords).r - currentLayerDepth + layerDepth;
          float afterDepth = currentDepthValue - currentLayerDepth;
          float weight = afterDepth / (afterDepth - beforeDepth);
          parallaxUv = mix(currentTexCoords, prevTexCoords, weight);
        }`)
    shader.fragmentShader = parseIncludes(shader.fragmentShader)
    shader.fragmentShader = shader.fragmentShader
      .replace(/texture2D\(\s*map\s*,\s*vMapUv\s*\)/g, 'texture2D( map, parallaxUv )')
      .replace(/texture2D\(\s*normalMap\s*,\s*vNormalMapUv\s*\)/g, 'texture2D( normalMap, parallaxUv )')
      .replace(/texture2D\(\s*roughnessMap\s*,\s*vRoughnessMapUv\s*\)/g, 'texture2D( roughnessMap, parallaxUv )')
      .replace(/texture2D\(\s*metalnessMap\s*,\s*vMetalnessMapUv\s*\)/g, 'texture2D( metalnessMap, parallaxUv )')
      .replace(/texture2D\(\s*emissiveMap\s*,\s*vEmissiveMapUv\s*\)/g, 'texture2D( emissiveMap, parallaxUv )')
  }
  return mat
}

export function initMaterial3D(containerEl) {
  if (initialized) {
    if (containerEl !== container) { container.innerHTML = ''; container = containerEl; container.appendChild(renderer.domElement); handleResize() }
    return
  }
  container = containerEl
  const width = container.clientWidth || 300, height = container.clientHeight || 200
  scene = new THREE.Scene(); scene.background = new THREE.Color(LIGHT_PRESETS.studio.bg)
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100); camera.position.set(0, 0.5, camDist)
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(width, height); renderer.setPixelRatio(window.devicePixelRatio)
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.appendChild(renderer.domElement)
  pmrem = new THREE.PMREMGenerator(renderer)
  lightGroup = new THREE.Group(); scene.add(lightGroup)
  const geo = geometries.sphere()
  meshLeft = new THREE.Mesh(geo, makeMaterial()); meshLeft.castShadow = true; meshLeft.receiveShadow = true; scene.add(meshLeft)
  meshRight = new THREE.Mesh(geo.clone(), makeMaterial()); meshRight.castShadow = true; meshRight.receiveShadow = true; scene.add(meshRight)
  labelLeft = createLabel('左', '#2b6cff'); labelRight = createLabel('右', '#d97706')
  scene.add(labelLeft); scene.add(labelRight)
  const groundGeo = new THREE.PlaneGeometry(8, 8)
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3e, roughness: 0.8, metalness: 0.0 })
  groundMesh = new THREE.Mesh(groundGeo, groundMat); groundMesh.rotation.x = -Math.PI / 2; groundMesh.position.y = -1.3; groundMesh.receiveShadow = true; scene.add(groundMesh)
  gridHelper = new THREE.GridHelper(8, 32, 0x444466, 0x222244)
  gridHelper.position.y = -1.29; gridHelper.material.transparent = true; gridHelper.material.opacity = 0.3; scene.add(gridHelper)
  setupControls(); new ResizeObserver(handleResize).observe(container); animate(); initialized = true
  applyLightPreset('studio')
  applySourceSide()
}

function applySourceSide() {
  if (!initialized) return
  if (sourceSide === 'dual') {
    meshLeft.visible = true; meshRight.visible = true; meshLeft.position.x = -1.1; meshRight.position.x = 1.1
    meshLeft.scale.setScalar(0.75); meshRight.scale.setScalar(0.75)
    labelLeft.visible = true; labelRight.visible = true
    labelLeft.position.set(-1.1, -0.95, 0); labelRight.position.set(1.1, -0.95, 0)
  } else if (sourceSide === 'left') {
    meshLeft.visible = true; meshRight.visible = false; meshLeft.position.x = 0
    meshLeft.scale.setScalar(1.0)
    labelLeft.visible = false; labelRight.visible = false
  } else {
    meshLeft.visible = false; meshRight.visible = true; meshRight.position.x = 0
    meshRight.scale.setScalar(1.0)
    labelLeft.visible = false; labelRight.visible = false
  }
}

function setupControls() {
  const canvas = renderer.domElement; canvas.style.cursor = 'grab'
  canvas.addEventListener('mousedown', (e) => { isDragging = true; autoRotate = false; lastX = e.clientX; lastY = e.clientY; canvas.style.cursor = 'grabbing' })
  canvas.addEventListener('mousemove', (e) => { if (!isDragging) return; targetRotY += (e.clientX - lastX) * 0.01; targetRotX += (e.clientY - lastY) * 0.01; targetRotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, targetRotX)); lastX = e.clientX; lastY = e.clientY })
  window.addEventListener('mouseup', () => { if (isDragging) { isDragging = false; canvas.style.cursor = 'grab' } })
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); targetCamDist = Math.max(1.5, Math.min(8, targetCamDist + e.deltaY * 0.003)) }, { passive: false })
  canvas.addEventListener('dblclick', () => { autoRotate = !autoRotate; targetRotX = 0; targetRotY = 0 })
}

function handleResize() { if (!container || !renderer || !camera) return; const w = container.clientWidth, h = container.clientHeight; if (w > 0 && h > 0) { camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h) } }

function animate() {
  animationId = requestAnimationFrame(animate)
  if (autoRotate) targetRotY += 0.005
  rotX += (targetRotX - rotX) * 0.1; rotY += (targetRotY - rotY) * 0.1; camDist += (targetCamDist - camDist) * 0.1
  meshLeft.rotation.x = rotX; meshLeft.rotation.y = rotY
  meshRight.rotation.x = rotX; meshRight.rotation.y = rotY
  camera.position.z = camDist; renderer.render(scene, camera)
}

export function setGeometry(geoType) {
  if (!initialized || !geometries[geoType]) return
  currentGeo = geoType; meshLeft.geometry.dispose(); meshRight.geometry.dispose()
  meshLeft.geometry = geometries[geoType](); meshRight.geometry = geometries[geoType]()
}
export function setMetalness(val) { if (initialized) { meshLeft.material.metalness = val; meshRight.material.metalness = val } }
export function setRoughness(val) { if (initialized) { meshLeft.material.roughness = val; meshRight.material.roughness = val } }
export function setNormalScale(val) { normalScale = val; if (initialized) { meshLeft.material.normalScale.set(val, val); meshRight.material.normalScale.set(val, val) } }
export function setEmissiveIntensity(val) { emissiveIntensity = val; if (initialized) { meshLeft.material.emissiveIntensity = val; meshRight.material.emissiveIntensity = val } }
export function setMaterialFormat(fmt) { materialFormat = fmt }
export function setFormatDetectCallback(cb) { formatDetectCallback = cb }
export function setHeightDetectCallback(cb) { heightDetectCallback = cb }
export function setSourceSide(side) { sourceSide = side; applySourceSide() }
export function setParallaxScale(val) { parallaxScale = val; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m && m.userData.shaderRefs) m.userData.shaderRefs.parallaxScale.value = val } } }
export function setParallaxSteps(val) { parallaxSteps = val; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m && m.userData.shaderRefs) m.userData.shaderRefs.parallaxSteps.value = val } } }
export function setLightPreset(presetKey) { applyLightPreset(presetKey) }
export function setEnvIntensity(val) { envIntensity = val; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m) m.material.envMapIntensity = val } } }
export function setExposure(val) { if (initialized && renderer) renderer.toneMappingExposure = val }
export function toggleGround(visible) { groundVisible = visible; if (initialized) { if (groundMesh) groundMesh.visible = visible; if (gridHelper) gridHelper.visible = visible } }
export function setAutoRotate(on) { autoRotate = on }
export function setWireframe(on) { if (initialized) { meshLeft.material.wireframe = on; meshRight.material.wireframe = on } }
export function setOpacityMode(mode) { opacityMode = mode; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m) applyOpacityMode(m.material) } } }
export function setOpacity(val) { opacityValue = val; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m) applyOpacityMode(m.material) } } }
export function setTransmission(val) { transmissionValue = val; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m) { m.material.transmission = val; if (val > 0) { m.material.transparent = true; m.material.alphaTest = 0 } m.material.needsUpdate = true } } } }
export function setIOR(val) { iorValue = val; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m) m.material.ior = val } } }
export function setClearcoat(val) { clearcoatValue = val; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m) m.material.clearcoat = val } } }
export function screenshot() {
  if (!initialized || !renderer) return
  renderer.render(scene, camera)
  const url = renderer.domElement.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url; a.download = `material3d_${Date.now()}.png`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
}
export function toggleFullscreen() {
  if (!container) return
  container.classList.toggle('fullscreen')
  setTimeout(handleResize, 50)
}
export function loadHDREnv(filePath) {
  if (!initialized || !filePath) return
  const loader = new HDRLoader()
  loader.load(filePath, (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping
    if (hdrTexture) hdrTexture.dispose()
    if (envTexture) { envTexture.dispose(); envTexture = null }
    hdrTexture = tex
    scene.environment = tex
    scene.background = tex
    for (const m of [meshLeft, meshRight]) { if (m) m.material.envMapIntensity = envIntensity }
  })
}
export function clearHDREnv() {
  if (hdrTexture) { hdrTexture.dispose(); hdrTexture = null }
  applyLightPreset(currentLightPreset)
}

function disposeTexture(tex) { if (tex && tex.dispose) tex.dispose() }
function disposeAllMaterialTextures(m) { disposeTexture(m.map); disposeTexture(m.normalMap); disposeTexture(m.roughnessMap); disposeTexture(m.metalnessMap); disposeTexture(m.emissiveMap); if (m.userData.shaderRefs) { disposeTexture(m.userData.shaderRefs.heightMap.value); m.userData.shaderRefs.heightMap.value = null; m.userData.shaderRefs.hasHeightMap.value = 0.0 } m.map = null; m.normalMap = null; m.roughnessMap = null; m.metalnessMap = null; m.emissiveMap = null }

function applyTexturesToMesh(mesh, group, side) {
  const material = mesh.material
  disposeAllMaterialTextures(material)
  if (!group) { material.color.set(0x888888); material.emissive.set(0x000000); material.needsUpdate = true; return }

  const loader = new THREE.TextureLoader()
  const getEntry = (role) => { const e = group[side] && group[side][role]; return (e && !e.isDirectory && isImageFile(e.name)) ? e : null }
  const mainEntry = getEntry('main'), normalEntry = getEntry('normal'), specEntry = getEntry('specular')

  if (mainEntry) {
    loader.load(fileUrl(mainEntry.fullPath), (tex) => { tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; disposeTexture(material.map); material.map = tex; material.color.set(0xffffff); const mi = new Image(); mi.onload = () => { const w = Math.min(mi.naturalWidth, 64), h = Math.min(mi.naturalHeight, 64); const tc = document.createElement('canvas'); tc.width = w; tc.height = h; const tctx = tc.getContext('2d', { willReadFrequently: true }); tctx.drawImage(mi, 0, 0, w, h); const td = tctx.getImageData(0, 0, w, h).data; let hasAlpha = false, semiCount = 0, total = 0; for (let i = 3; i < td.length; i += 4) { total++; const a = td[i]; if (a < 250) hasAlpha = true; if (a > 5 && a < 250) semiCount++ } material.userData.hasAlpha = hasAlpha; material.userData.hasSemiTrans = semiCount / total > 0.02; applyOpacityMode(material) }; mi.src = fileUrl(mainEntry.fullPath); material.needsUpdate = true })
  } else { material.color.set(0x444466); material.userData.hasAlpha = false; material.userData.hasSemiTrans = false; applyOpacityMode(material) }

  if (normalEntry) {
    const nUrl = fileUrl(normalEntry.fullPath)
    const processNormal = (source) => {
      const sc = document.createElement('canvas'); sc.width = imgW(source); sc.height = imgH(source)
      const sctx = sc.getContext('2d', { willReadFrequently: true }); sctx.drawImage(source, 0, 0)
      const src = sc
      if (side === 'left') showLoading('处理法线贴图...')
      requestAnimationFrame(() => {
        setLoadingProgress(0.2)
        disposeTexture(material.normalMap); material.normalMap = reconstructNormal(src); material.normalScale.set(normalScale, normalScale)
        requestAnimationFrame(() => {
          setLoadingProgress(0.4)
          let heightTex = extractHeight(src); let hStatus = heightTex ? 'alpha' : false
          requestAnimationFrame(() => {
            setLoadingProgress(0.6)
            if (!heightTex) { heightTex = extractHeightFromNormal(src); hStatus = heightTex ? 'normal' : false }
            setLoadingProgress(0.9)
            if (material.userData.shaderRefs) { disposeTexture(material.userData.shaderRefs.heightMap.value); material.userData.shaderRefs.heightMap.value = heightTex; material.userData.shaderRefs.hasHeightMap.value = heightTex ? 1.0 : 0.0 }
            if (side === 'left' && heightDetectCallback) heightDetectCallback(hStatus)
            material.needsUpdate = true
            if (side === 'left') { setLoadingProgress(1.0); setTimeout(hideLoading, 200) }
          })
        })
      })
    }
    if (typeof createImageBitmap !== 'undefined') {
      fetch(nUrl).then(r => r.blob()).then(blob => createImageBitmap(blob)).then(bitmap => { processNormal(bitmap); if (bitmap.close) bitmap.close() }).catch(() => { const img = new Image(); img.onload = () => processNormal(img); img.src = nUrl })
    } else { const img = new Image(); img.onload = () => processNormal(img); img.src = nUrl }
  } else { if (side === 'left' && heightDetectCallback) heightDetectCallback(false) }

  if (specEntry) {
    const specImg = new Image(); specImg.onload = () => {
      let fmt = materialFormat
      if (fmt === 'auto') { fmt = detectFormat(specImg); if (formatDetectCallback) formatDetectCallback(fmt) }
      disposeTexture(material.roughnessMap); disposeTexture(material.metalnessMap); disposeTexture(material.emissiveMap)
      if (fmt === 'old') {
        material.roughnessMap = extractChannel(specImg, 0, true); material.metalnessMap = extractChannel(specImg, 1, false); material.emissiveMap = extractChannel(specImg, 2, false)
        material.emissive.set(0xffffff); material.emissiveIntensity = emissiveIntensity; material.needsUpdate = true
      } else {
        material.roughnessMap = extractRoughness(specImg); material.metalnessMap = extractMetalness(specImg)
        if (mainEntry) {
          const mainImg = new Image(); mainImg.onload = () => {
            disposeTexture(material.emissiveMap); material.emissiveMap = extractEmissive(specImg, mainImg)
            material.emissive.set(0xffffff); material.emissiveIntensity = emissiveIntensity; material.needsUpdate = true
          }; mainImg.src = fileUrl(mainEntry.fullPath)
        } else { material.emissive.set(0x000000) }
        material.needsUpdate = true
      }
    }; specImg.src = fileUrl(specEntry.fullPath)
  } else { material.emissive.set(0x000000) }
  material.needsUpdate = true
}

export function updateMaterial3D(group) {
  if (!initialized) return
  if (!group && heightDetectCallback) heightDetectCallback(false)
  applyTexturesToMesh(meshLeft, group, 'left')
  applyTexturesToMesh(meshRight, group, 'right')
}

export function clearMaterial3D() { updateMaterial3D(null) }

export function disposeMaterial3D() {
  if (animationId) cancelAnimationFrame(animationId)
  for (const m of [meshLeft, meshRight]) { if (m) { if (m.material) { disposeAllMaterialTextures(m.material); m.material.dispose() }; if (m.geometry) m.geometry.dispose() } }
  if (groundMesh) { groundMesh.geometry.dispose(); groundMesh.material.dispose() }
  if (gridHelper) { gridHelper.geometry.dispose(); gridHelper.material.dispose() }
  if (envTexture) envTexture.dispose()
  if (hdrTexture) hdrTexture.dispose()
  if (pmrem) pmrem.dispose(); if (renderer) renderer.dispose()
  initialized = false
}
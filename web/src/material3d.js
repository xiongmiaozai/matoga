/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import * as THREE from 'three'
import { S, FLY_KEYS, FLY_SPEED, FLY_BOOST } from './m3d/state.js'
import { fileUrl, isImageFile } from './utils.js'
import { HDRLoader } from './hdr-loader.js'
import { loadEnvTexture, extFromUrl } from './hdr-env-loader.js'
import { Sky } from './sky.js'
import { t as _t } from './i18n.js'




import { geometries } from './m3d/geometry.js'
import { applyHeightFilter, detectFormat, extractChannel, extractEmissive, extractHeight, extractHeightFromNormal, extractMetalness, extractRoughness, imgH, imgW, reconstructNormal } from './m3d/texture-extract.js'
import { hideLoading, setLoadingProgress, showLoading } from './m3d/loading.js'
import { LIGHT_PRESETS, applyCustomLightConfig, applyLightPreset, cloneLightConfig } from './m3d/lighting.js'
import { applyHDREnvMode, ensureRotatedTexture, scheduleSkyBake, setEnvMode, updateSkySunPosition } from './m3d/sky.js'
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
  const mode = S.opacityMode
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
    material.transmission = S.transmissionValue
    material.ior = S.iorValue
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
  if (S.opacityValue < 1.0) {
    material.transparent = true
    material.opacity = S.opacityValue
  } else {
    material.opacity = 1.0
  }
  material.needsUpdate = true
}

function applyTextureFilter(tex) {
  if (!tex) return
  if (S.alignOfficial) {
    tex.generateMipmaps = true
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestMipmapLinearFilter
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
    tex.anisotropy = Math.min(S.anisotropyLevel, S.maxAnisotropy)
    tex.needsUpdate = true
    return
  }
  const useMipmap = S.mipmapsEnabled && (S.textureFilter === 'trilinear' || S.textureFilter === 'anisotropic')
  tex.generateMipmaps = useMipmap
  if (S.textureFilter === 'nearest') {
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = useMipmap ? THREE.NearestMipmapNearestFilter : THREE.NearestFilter
  } else {
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = useMipmap ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
  }
  tex.anisotropy = (S.textureFilter === 'anisotropic' && useMipmap) ? Math.min(S.anisotropyLevel, S.maxAnisotropy) : 1
  tex.needsUpdate = true
}

function collectMaterialTextures(m) {
  const list = []
  if (m.map) list.push(m.map)
  if (m.normalMap) list.push(m.normalMap)
  if (m.roughnessMap) list.push(m.roughnessMap)
  if (m.metalnessMap) list.push(m.metalnessMap)
  if (m.emissiveMap) list.push(m.emissiveMap)
  if (m.userData.shaderRefs && m.userData.shaderRefs.heightMap && m.userData.shaderRefs.heightMap.value) list.push(m.userData.shaderRefs.heightMap.value)
  return list
}

function applyFilterToAllTextures() {
  if (!S.initialized) return
  for (const mesh of [S.meshLeft, S.meshRight]) {
    if (!mesh || !mesh.material) continue
    for (const tex of collectMaterialTextures(mesh.material)) applyTextureFilter(tex)
    mesh.material.needsUpdate = true
  }
}

function makeMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.1, envMapIntensity: 1.0, emissive: new THREE.Color(0x000000), emissiveIntensity: 1.0, transmission: 0.0, ior: 1.5, thickness: 0.5, clearcoat: 0.0, clearcoatRoughness: 0.0 })
  mat.userData.shaderRefs = null
  mat.userData.pendingHeightMap = null
  mat.onBeforeCompile = (shader) => {
    const prev = mat.userData.shaderRefs
    shader.uniforms.heightMap = { value: prev ? prev.heightMap.value : mat.userData.pendingHeightMap }
    shader.uniforms.hasHeightMap = { value: prev ? prev.hasHeightMap.value : (mat.userData.pendingHeightMap && S.parallaxEnabled ? 1.0 : 0.0) }
    shader.uniforms.parallaxScale = { value: S.parallaxScale }
    shader.uniforms.parallaxSteps = { value: S.parallaxSteps }
    shader.uniforms.parallaxMode = { value: S.parallaxMode }
    shader.uniforms.parallaxAdaptive = { value: S.parallaxAdaptive }
    shader.uniforms.parallaxShadow = { value: S.parallaxShadow }
    shader.uniforms.uHeightLightDir = { value: prev ? prev.uHeightLightDir.value : new THREE.Vector3(0, 1, 0) }
    shader.uniforms.uHeightTexSize = { value: prev ? prev.uHeightTexSize.value : (mat.userData.pendingHeightMap ? new THREE.Vector2(mat.userData.pendingHeightMap.image.width, mat.userData.pendingHeightMap.image.height) : new THREE.Vector2(256, 256)) }
    mat.userData.shaderRefs = shader.uniforms
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', 'uniform sampler2D heightMap;\nuniform vec2 uHeightTexSize;\nuniform vec3 uHeightLightDir;\nuniform float hasHeightMap;\nuniform float parallaxScale;\nuniform float parallaxSteps;\nuniform float parallaxMode;\nuniform float parallaxAdaptive;\nuniform float parallaxShadow;\n#include <common>')
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
        float parallaxShadowFactor = 1.0;
        if (abs(parallaxScale) > 0.0 && hasHeightMap > 0.5) {
          vec3 viewDir = normalize(vViewPosition);
          vec2 P;
          float viewDotN;
          vec3 tLight;
          #if defined(USE_TANGENT)
            vec3 t = normalize( vTangent );
            vec3 n = normalize( vNormal );
            vec3 b = normalize( vBitangent );
            vec3 tView;
            tView.x = dot(t, viewDir);
            tView.y = dot(b, viewDir);
            tView.z = dot(n, viewDir);
            tLight.x = dot(t, uHeightLightDir);
            tLight.y = dot(b, uHeightLightDir);
            tLight.z = dot(n, uHeightLightDir);
          #else
            vec3 n = normalize( vNormal );
            if ( !gl_FrontFacing ) n = -n;
            vec3 sp = -vViewPosition;
            vec3 dp1 = dFdx( sp );
            vec3 dp2 = dFdy( sp );
            vec2 duv1 = dFdx( parallaxUv );
            vec2 duv2 = dFdy( parallaxUv );
            vec3 dp2perp = cross( dp2, n );
            vec3 dp1perp = cross( n, dp1 );
            vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
            vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
            float invmax = inversesqrt( max( dot(T, T), dot(B, B) ) + 1e-8 );
            vec3 tView;
            tView.x = dot( T * invmax, viewDir );
            tView.y = dot( B * invmax, viewDir );
            tView.z = dot( n, viewDir );
            tLight.x = dot( T * invmax, uHeightLightDir );
            tLight.y = dot( B * invmax, uHeightLightDir );
            tLight.z = dot( n, uHeightLightDir );
          #endif
          viewDotN = clamp(abs(tView.z), 0.0, 1.0);
          P = tView.xy / max(abs(tView.z), 0.05) * parallaxScale;
          float Plen = length(P);
          P *= 1.0 / (1.0 + max(Plen - 0.1, 0.0) * 4.0);
          float uvFade = 1.0;
          ${S.isWebGL2 ? 'uvFade = 1.0 - smoothstep(0.15, 0.45, length(fwidth(parallaxUv)));' : ''}
          P *= uvFade;
          P *= smoothstep(0.0, 0.2, viewDotN);
          float hMip = 0.0;
          ${S.isWebGL2 ? 'hMip = log2(max(max(fwidth(parallaxUv.x) * uHeightTexSize.x, fwidth(parallaxUv.y) * uHeightTexSize.y), 1.0));' : ''}
          if (parallaxMode < 0.5) {
            float height = ${S.isWebGL2 ? 'textureLod( heightMap, parallaxUv, hMip )' : 'texture2D( heightMap, parallaxUv )'}.r;
            parallaxUv = parallaxUv - P * height;
          } else {
            float numLayers = parallaxSteps;
            if (parallaxAdaptive > 0.5) {
              numLayers = mix(parallaxSteps, max(parallaxSteps * 0.3, 4.0), viewDotN);
            }
            numLayers = clamp(numLayers, 4.0, 64.0);
            float layerDepth = 1.0 / numLayers;
            float currentLayerDepth = 0.0;
            vec2 deltaTexCoords = P / numLayers;
            vec2 currentTexCoords = parallaxUv;
            float currentDepthValue = ${S.isWebGL2 ? 'textureLod( heightMap, currentTexCoords, hMip )' : 'texture2D( heightMap, currentTexCoords )'}.r;
            for (int i = 0; i < 64; i++) {
              if (currentLayerDepth >= currentDepthValue) break;
              currentTexCoords -= deltaTexCoords;
              currentDepthValue = ${S.isWebGL2 ? 'textureLod( heightMap, currentTexCoords, hMip )' : 'texture2D( heightMap, currentTexCoords )'}.r;
              currentLayerDepth += layerDepth;
            }
            if (parallaxMode < 1.5) {
              parallaxUv = currentTexCoords;
            } else if (parallaxMode < 2.5) {
              vec2 prevTexCoords = currentTexCoords + deltaTexCoords;
              float beforeDepth = ${S.isWebGL2 ? 'textureLod( heightMap, prevTexCoords, hMip )' : 'texture2D( heightMap, prevTexCoords )'}.r - currentLayerDepth + layerDepth;
              float afterDepth = currentDepthValue - currentLayerDepth;
              float weight = afterDepth / (afterDepth - beforeDepth);
              parallaxUv = mix(currentTexCoords, prevTexCoords, weight);
            } else {
              vec2 prevTexCoords = currentTexCoords + deltaTexCoords;
              float prevLayerDepth = currentLayerDepth - layerDepth;
              for (int j = 0; j < 5; j++) {
                deltaTexCoords *= 0.5;
                layerDepth *= 0.5;
                vec2 midTexCoords = prevTexCoords - deltaTexCoords;
                float midLayerDepth = prevLayerDepth + layerDepth;
                float midDepthValue = ${S.isWebGL2 ? 'textureLod( heightMap, midTexCoords, hMip )' : 'texture2D( heightMap, midTexCoords )'}.r;
                if (midLayerDepth < midDepthValue) {
                  prevTexCoords = midTexCoords;
                  prevLayerDepth = midLayerDepth;
                } else {
                  currentTexCoords = midTexCoords;
                  currentLayerDepth = midLayerDepth;
                }
              }
              parallaxUv = prevTexCoords;
            }
          }
          if (parallaxShadow > 0.0 && tLight.z > 0.01) {
            float numSS = 8.0;
            vec2 ssDelta = tLight.xy / max(abs(tLight.z), 0.05) * abs(parallaxScale) / numSS;
            float hRay = ${S.isWebGL2 ? 'textureLod( heightMap, parallaxUv, hMip )' : 'texture2D( heightMap, parallaxUv )'}.r;
            vec2 ssUv = parallaxUv;
            for (int i = 0; i < 8; i++) {
              ssUv += ssDelta;
              hRay += 1.0 / numSS;
              float hSurf = ${S.isWebGL2 ? 'textureLod( heightMap, ssUv, hMip )' : 'texture2D( heightMap, ssUv )'}.r;
              parallaxShadowFactor = min(parallaxShadowFactor, smoothstep(0.0, 0.06, hRay - hSurf));
            }
            parallaxShadowFactor = mix(1.0, parallaxShadowFactor, parallaxShadow);
          }
        }`)
      .replace('#include <lights_fragment_begin>', '#include <lights_fragment_begin>\n        reflectedLight.directDiffuse *= parallaxShadowFactor;')
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

function isHostVisible(el) {
  if (!el || !el.isConnected) return false
  const r = el.getBoundingClientRect()
  return r.width > 1 && r.height > 1
}

function findVisibleHost() {
  for (const h of S.hosts) { if (isHostVisible(h)) return h }
  return null
}

function activeHost() {
  return (S.renderer && S.renderer.domElement.parentElement) || null
}

function refreshHostHints() {
  const active = S.initialized ? activeHost() : null
  for (const h of S.hosts) {
    h.classList.toggle('m3d-host-active', h === active)
    const hint = h.querySelector('.m3d-host-empty')
    if (hint) hint.style.display = (S.initialized && h !== active) ? '' : 'none'
  }
}

function moveViewportWidgets(target) {
  document.querySelectorAll('.m3d-hud-bar, .m3d-params-overlay').forEach(w => {
    if (w.parentElement !== target) target.appendChild(w)
  })
}

function setContainer(el) {
  if (!el || el === S.container) { refreshHostHints(); return }
  S.container = el
  if (S.renderer) { el.appendChild(S.renderer.domElement); moveViewportWidgets(el); handleResize() }
  refreshHostHints()
}

export function activateMaterial3DHost(el) {
  if (!el || !S.hosts.has(el)) return
  if (!S.initialized) { initMaterial3D(el); return }
  setContainer(el)
}

function reevaluateActiveHost() {
  if (!S.initialized) return
  const active = activeHost()
  if (active && isHostVisible(active)) return
  const visible = findVisibleHost()
  if (visible) setContainer(visible)
}

function ensureHostObserver() {
  if (S.hostObserver) return S.hostObserver
  S.hostObserver = new IntersectionObserver((entries) => {
    if (!S.initialized) return
    for (const entry of entries) {
      if (entry.isIntersecting && isHostVisible(entry.target)) setContainer(entry.target)
    }
    reevaluateActiveHost()
  })
  return S.hostObserver
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    if (S._hostReevalRAF) return
    S._hostReevalRAF = requestAnimationFrame(() => {
      S._hostReevalRAF = 0
      reevaluateActiveHost()
    })
  })
}

export function registerMaterial3DHost(el) {
  if (!el || S.hosts.has(el)) return
  S.hosts.add(el)
  ensureHostObserver().observe(el)
  if (S.containerResizeObserver) S.containerResizeObserver.observe(el)
  el.addEventListener('pointerdown', () => { if (S.initialized) setContainer(el) }, true)
  if (S.initialized) {
    const active = activeHost()
    if ((!active || !isHostVisible(active)) && isHostVisible(el)) setContainer(el)
    else refreshHostHints()
  } else { refreshHostHints() }
}

export function initMaterial3D(containerEl) {
  registerMaterial3DHost(containerEl)
  if (S.initialized) {
    if (containerEl !== S.container) {
      const target = isHostVisible(containerEl) ? containerEl : (findVisibleHost() || containerEl)
      setContainer(target)
    } else { refreshHostHints() }
    return
  }
  S.container = isHostVisible(containerEl) ? containerEl : (findVisibleHost() || containerEl)
  const width = S.container.clientWidth || 300, height = S.container.clientHeight || 200
  S.scene = new THREE.Scene(); S.scene.background = new THREE.Color(LIGHT_PRESETS.studio.bg)
  S.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100); S.camera.position.set(0, 0.5, S.camDist)
  S.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  S.isWebGL2 = S.renderer.capabilities.isWebGL2
  S.maxAnisotropy = S.renderer.capabilities.getMaxAnisotropy() || 1
  S.renderer.setSize(width, height); S.renderer.setPixelRatio(window.devicePixelRatio)
  S.renderer.toneMapping = THREE.ACESFilmicToneMapping; S.renderer.toneMappingExposure = 2.2
  S.renderer.shadowMap.enabled = true; S.renderer.shadowMap.type = THREE.PCFShadowMap
  S.container.appendChild(S.renderer.domElement)
  S.pmrem = new THREE.PMREMGenerator(S.renderer)
  S.lightGroup = new THREE.Group(); S.scene.add(S.lightGroup)
  const geo = geometries[S.currentGeo]()
  S.meshLeft = new THREE.Mesh(geo, makeMaterial()); S.meshLeft.castShadow = true; S.meshLeft.receiveShadow = true; S.scene.add(S.meshLeft)
  S.meshRight = new THREE.Mesh(geo.clone(), makeMaterial()); S.meshRight.castShadow = true; S.meshRight.receiveShadow = true; S.scene.add(S.meshRight)
  S.labelLeft = createLabel(_t('common.left'), '#2b6cff'); S.labelRight = createLabel(_t('common.right'), '#d97706')
  S.scene.add(S.labelLeft); S.scene.add(S.labelRight)
  const groundGeo = new THREE.PlaneGeometry(8, 8)
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3e, roughness: 0.8, metalness: 0.0 })
  S.groundMesh = new THREE.Mesh(groundGeo, groundMat); S.groundMesh.rotation.x = -Math.PI / 2; S.groundMesh.position.y = -1.3; S.groundMesh.receiveShadow = true; S.groundMesh.visible = S.groundVisible; S.scene.add(S.groundMesh)
  S.gridHelper = new THREE.GridHelper(8, 32, 0x444466, 0x222244)
  S.gridHelper.position.y = -1.29; S.gridHelper.material.transparent = true; S.gridHelper.material.opacity = 0.3; S.gridHelper.visible = S.groundVisible; S.scene.add(S.gridHelper)
  setupControls()
  if (S.containerResizeObserver) S.containerResizeObserver.disconnect()
  S.containerResizeObserver = new ResizeObserver(handleResize)
  for (const h of S.hosts) S.containerResizeObserver.observe(h)
  S.lastFrameTime = performance.now()
  animate(); S.initialized = true
  moveViewportWidgets(S.container)
  refreshHostHints()
  applyLightPreset('studio')
  applySourceSide()
  document.dispatchEvent(new CustomEvent('material3d:ready'))
}

function applySourceSide() {
  if (!S.initialized) return
  if (S.customModelGroup) return

  if (S.sourceSide === 'dual') {
    S.meshLeft.visible = true; S.meshRight.visible = true; S.meshLeft.position.x = -1.1; S.meshRight.position.x = 1.1
    S.meshLeft.scale.setScalar(0.75); S.meshRight.scale.setScalar(0.75)
    S.labelLeft.visible = true; S.labelRight.visible = true
    S.labelLeft.position.set(-1.1, -0.95, 0); S.labelRight.position.set(1.1, -0.95, 0)
  } else if (S.sourceSide === 'left') {
    S.meshLeft.visible = true; S.meshRight.visible = false; S.meshLeft.position.x = 0
    S.meshLeft.scale.setScalar(1.0)
    S.labelLeft.visible = false; S.labelRight.visible = false
  } else {
    S.meshLeft.visible = false; S.meshRight.visible = true; S.meshRight.position.x = 0
    S.meshRight.scale.setScalar(1.0)
    S.labelLeft.visible = false; S.labelRight.visible = false
  }
}

function setupControls() {
  const canvas = S.renderer.domElement; canvas.style.cursor = 'grab'
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  canvas.addEventListener('mousedown', (e) => {
    S.isDragging = true; S.autoRotate = false; S.lastX = e.clientX; S.lastY = e.clientY
    if (S.freeCamMode) S.dragMode = 'look'
    else if (e.button === 0 && !e.shiftKey) S.dragMode = 'rotate'
    else S.dragMode = 'pan'
    canvas.style.cursor = 'grabbing'
    if (e.button === 1) e.preventDefault()
  })
  canvas.addEventListener('mousemove', (e) => {
    if (!S.isDragging) return
    const dx = e.clientX - S.lastX, dy = e.clientY - S.lastY
    S.lastX = e.clientX; S.lastY = e.clientY
    if (S.dragMode === 'look') {
      S.flyYaw -= dx * 0.005
      S.flyPitch = Math.max(-1.55, Math.min(1.55, S.flyPitch - dy * 0.005))
    } else if (S.dragMode === 'rotate') {
      S.targetRotY += dx * 0.01; S.targetRotX += dy * 0.01
      S.targetRotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, S.targetRotX))
    } else {
      const k = S.camDist * 0.0015
      S.targetPanX -= dx * k; S.targetPanY += dy * k
    }
  })
  window.addEventListener('mouseup', () => { if (S.isDragging) { S.isDragging = false; S.dragMode = null; canvas.style.cursor = S.freeCamMode ? 'crosshair' : 'grab' } })
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    if (S.freeCamMode) {
      S._flyForward.set(0, 0, -1).applyEuler(S.camera.rotation)
      S.flyPos.addScaledVector(S._flyForward, -e.deltaY * 0.01)
      clampFlyPos()
    } else {
      S.targetCamDist = Math.max(1.5, Math.min(8, S.targetCamDist + e.deltaY * 0.003))
    }
  }, { passive: false })
  canvas.addEventListener('dblclick', () => {
    if (S.freeCamMode) { resetFreeView(); return }
    S.autoRotate = !S.autoRotate; S.targetRotX = 0; S.targetRotY = 0; S.targetPanX = 0; S.targetPanY = 0
  })
  window.addEventListener('keydown', (e) => {
    if (!S.freeCamMode) return
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable)) return
    if (FLY_KEYS.has(e.code)) { S.flyKeys[e.code] = true; e.preventDefault() }
  })
  window.addEventListener('keyup', (e) => { delete S.flyKeys[e.code] })
  window.addEventListener('blur', () => { for (const k in S.flyKeys) delete S.flyKeys[k] })
}

function clampFlyPos() {
  S.flyPos.x = Math.max(-40, Math.min(40, S.flyPos.x))
  S.flyPos.y = Math.max(-20, Math.min(40, S.flyPos.y))
  S.flyPos.z = Math.max(-40, Math.min(40, S.flyPos.z))
}

function lookAtOrigin() {
  S._flyForward.set(0, 0, 0).sub(S.flyPos)
  if (S._flyForward.lengthSq() < 1e-8) S._flyForward.set(0, 0, -1)
  S._flyForward.normalize()
  S.flyPitch = Math.asin(Math.max(-1, Math.min(1, S._flyForward.y)))
  S.flyYaw = Math.atan2(-S._flyForward.x, -S._flyForward.z)
}

function resetFreeView() {
  S.flyPos.set(0, 0.5, 3)
  lookAtOrigin()
}

function updateFlyMovement(dt) {
  S._flyMove.set(0, 0, 0)
  S._flyForward.set(0, 0, -1).applyEuler(S.camera.rotation)
  S._flyRight.set(1, 0, 0).applyEuler(S.camera.rotation)
  if (S.flyKeys.KeyW || S.flyKeys.ArrowUp) S._flyMove.add(S._flyForward)
  if (S.flyKeys.KeyS || S.flyKeys.ArrowDown) S._flyMove.sub(S._flyForward)
  if (S.flyKeys.KeyD || S.flyKeys.ArrowRight) S._flyMove.add(S._flyRight)
  if (S.flyKeys.KeyA || S.flyKeys.ArrowLeft) S._flyMove.sub(S._flyRight)
  if (S.flyKeys.KeyE) S._flyMove.y += 1
  if (S.flyKeys.KeyQ) S._flyMove.y -= 1
  if (S._flyMove.lengthSq() > 0) {
    const speed = FLY_SPEED * ((S.flyKeys.ShiftLeft || S.flyKeys.ShiftRight) ? FLY_BOOST : 1)
    S._flyMove.normalize().multiplyScalar(speed * dt)
    S.flyPos.add(S._flyMove)
    clampFlyPos()
  }
}

function handleResize() {
  if (S._resizeRAF) return
  S._resizeRAF = requestAnimationFrame(() => {
    S._resizeRAF = 0
    if (!S.container || !S.renderer || !S.camera) return
    const w = S.container.clientWidth, h = S.container.clientHeight
    if (w > 0 && h > 0) { S.camera.aspect = w / h; S.camera.updateProjectionMatrix(); S.renderer.setSize(w, h) }
  })
}

function animate() {
  S.animationId = requestAnimationFrame(animate)
  if (!S.container || S.container.clientWidth < 2 || S.container.clientHeight < 2) { S.lastFrameTime = performance.now(); return }
  const now = performance.now()
  const dt = Math.min(0.05, Math.max(0, (now - S.lastFrameTime) / 1000))
  S.lastFrameTime = now

  if (S.freeCamMode) {
    S.camera.rotation.set(S.flyPitch, S.flyYaw, 0)
    updateFlyMovement(dt)
    S.camera.position.copy(S.flyPos)
  } else {
    if (S.autoRotate) S.targetRotY += 0.005
    S.rotX += (S.targetRotX - S.rotX) * 0.1; S.rotY += (S.targetRotY - S.rotY) * 0.1; S.camDist += (S.targetCamDist - S.camDist) * 0.1
    S.camPanX += (S.targetPanX - S.camPanX) * 0.18; S.camPanY += (S.targetPanY - S.camPanY) * 0.18
    S.meshLeft.rotation.x = S.rotX; S.meshLeft.rotation.y = S.rotY
    S.meshRight.rotation.x = S.rotX; S.meshRight.rotation.y = S.rotY
    if (S.customModelGroup) { S.customModelGroup.rotation.x = S.rotX; S.customModelGroup.rotation.y = S.rotY }
    S.camera.position.set(S.camPanX, 0.5 + S.camPanY, S.camDist)
    S.camera.rotation.set(0, 0, 0)
  }

  S.camera.updateMatrixWorld()
  if (S.parallaxShadow > 0.0) {
    let lDir = null
    if (S.skySunLight && S.currentEnvMode === 'sky') lDir = S.skySunLight.position
    else { for (const c of S.lightGroup.children) { if (c.isDirectionalLight) { lDir = c.position; break } } }
    if (lDir) {
      S._lightDirTmp.copy(lDir).normalize().transformDirection(S.camera.matrixWorldInverse)
      for (const m of [S.meshLeft, S.meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.uHeightLightDir.value.copy(S._lightDirTmp) }
    }
  }
  S.renderer.render(S.scene, S.camera)
}

export function setGeometry(geoType) {
  if (!S.initialized || !geometries[geoType]) return
  clearCustomModel()
  S.currentGeo = geoType; S.meshLeft.geometry.dispose(); S.meshRight.geometry.dispose()
  S.meshLeft.geometry = geometries[geoType](); S.meshRight.geometry = geometries[geoType]()
}
export function setMetalness(val) { if (S.initialized) { S.meshLeft.material.metalness = val; S.meshRight.material.metalness = val } }
export function setRoughness(val) { if (S.initialized) { S.meshLeft.material.roughness = val; S.meshRight.material.roughness = val } }
export function setNormalScale(val) { S.normalScale = val; if (S.initialized) { S.meshLeft.material.normalScale.set(val, val); S.meshRight.material.normalScale.set(val, val) } }
export function setEmissiveIntensity(val) { S.emissiveIntensity = val; if (S.initialized) { S.meshLeft.material.emissiveIntensity = val; S.meshRight.material.emissiveIntensity = val } }
export function setMaterialFormat(fmt) { S.materialFormat = fmt }
export function setFormatDetectCallback(cb) { S.formatDetectCallback = cb }
export function setHeightDetectCallback(cb) { S.heightDetectCallback = cb }
export function setSourceSide(side) { S.sourceSide = side; applySourceSide() }
export function setParallaxScale(val) { S.parallaxScale = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.parallaxScale.value = val } } }
export function setParallaxSteps(val) { S.parallaxSteps = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.parallaxSteps.value = val } } }
export function setParallaxMode(val) { S.parallaxMode = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.parallaxMode.value = val } } }
export function setParallaxAdaptive(val) { S.parallaxAdaptive = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.parallaxAdaptive.value = val } } }
export function setParallaxEnabled(on) { S.parallaxEnabled = on; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m && m.material && m.material.userData.shaderRefs) { const ht = m.material.userData.shaderRefs.heightMap.value; m.material.userData.shaderRefs.hasHeightMap.value = (ht && on) ? 1.0 : 0.0; if (ht) { ht.needsUpdate = true; m.material.needsUpdate = true } } } } }
export function setParallaxShadow(val) { S.parallaxShadow = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.parallaxShadow.value = val } } }
export function setLightPreset(presetKey) { applyLightPreset(presetKey); if (S.currentEnvMode !== 'custom') setEnvMode('custom') }
export function getCustomLightConfig() { return S.customLightConfig ? cloneLightConfig(S.customLightConfig) : null }
export function applyCustomLightConfigExport(config) { if (S.currentEnvMode !== 'custom') setEnvMode('custom'); applyCustomLightConfig(config) }
export function setEnvIntensity(val) { S.envIntensity = val; if (S.initialized) { if (S.scene) S.scene.environmentIntensity = val; for (const m of [S.meshLeft, S.meshRight]) { if (m) m.material.envMapIntensity = val } } }
export function setExposure(val) { if (S.initialized && S.renderer) S.renderer.toneMappingExposure = val }
export function toggleGround(visible) { S.groundVisible = visible; if (S.initialized) { if (S.groundMesh) S.groundMesh.visible = visible; if (S.gridHelper) S.gridHelper.visible = visible } }
export function setAutoRotate(on) { S.autoRotate = on }
export function isFreeCameraMode() { return S.freeCamMode }
export function setFreeCameraMode(on) {
  if (!S.initialized) return
  on = !!on
  if (S.freeCamMode === on) return
  S.freeCamMode = on
  if (S.freeCamMode) {
    S.flyPos.copy(S.camera.position)
    lookAtOrigin()
    S.camera.rotation.order = 'YXZ'
    S.autoRotate = false
    for (const k in S.flyKeys) delete S.flyKeys[k]
    S.renderer.domElement.style.cursor = 'crosshair'
  } else {
    S.camPanX = 0; S.camPanY = 0; S.targetPanX = 0; S.targetPanY = 0
    S.camera.rotation.set(0, 0, 0)
    S.renderer.domElement.style.cursor = 'grab'
  }
  document.dispatchEvent(new CustomEvent('material3d:freecam', { detail: { enabled: S.freeCamMode } }))
}
export function setWireframe(on) { if (S.initialized) { S.meshLeft.material.wireframe = on; S.meshRight.material.wireframe = on } }
export function setOpacityMode(mode) { S.opacityMode = mode; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m) applyOpacityMode(m.material) } } }
export function setOpacity(val) { S.opacityValue = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m) applyOpacityMode(m.material) } } }
export function setTransmission(val) { S.transmissionValue = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m) { m.material.transmission = val; if (val > 0) { m.material.transparent = true; m.material.alphaTest = 0 } m.material.needsUpdate = true } } } }
export function setIOR(val) { S.iorValue = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m) m.material.ior = val } } }
export function setClearcoat(val) { S.clearcoatValue = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m) m.material.clearcoat = val } } }
export function setTextureFilter(mode) { S.textureFilter = mode; applyFilterToAllTextures() }
export function setMipmapsEnabled(on) { S.mipmapsEnabled = on; applyFilterToAllTextures() }
export function setAnisotropyLevel(val) { S.anisotropyLevel = Math.max(1, Math.round(val)); applyFilterToAllTextures() }
export function setAlignOfficial(val) { S.alignOfficial = !!val; applyFilterToAllTextures() }
export function getMaxAnisotropy() { return S.maxAnisotropy }
export function screenshot() {
  if (!S.initialized || !S.renderer) return
  S.renderer.render(S.scene, S.camera)
  const url = S.renderer.domElement.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url; a.download = `material3d_${Date.now()}.png`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
}
export function toggleFullscreen() {
  if (!S.container) return
  S.container.classList.toggle('fullscreen')
  setTimeout(handleResize, 50)
}
export async function loadHDREnv(filePath) {
  if (!S.initialized || !filePath) return
  try {
    const tex = await loadEnvTexture(filePath, extFromUrl(filePath))
    tex.mapping = THREE.EquirectangularReflectionMapping
    if (S.hdrTextureOriginal) { S.hdrTextureOriginal.dispose(); S.hdrTextureOriginal = null }
    if (S.hdrTextureRotated) { S.hdrTextureRotated.dispose(); S.hdrTextureRotated = null }

    if (S.envTexture) { S.envTexture.dispose(); S.envTexture = null }
    S.hdrTextureOriginal = tex
    S.hdrTexture = tex
    S.hdrInfo = {
      width: tex.image.width || 0,
      height: tex.image.height || 0,
      format: tex._srcFormat || 'HDR (RGBE)',
      size: tex.image.data ? tex.image.data.byteLength : 0
    }
    ensureRotatedTexture()
    S.currentEnvMode = 'hdri'
    applyHDREnvMode()
    window.dispatchEvent(new CustomEvent('material3d:hdrLoaded', { detail: S.hdrInfo }))
  } catch (e) {
    window.dispatchEvent(new CustomEvent('material3d:hdrLoadFailed', { detail: { message: e.message } }))
  }
}
export function clearHDREnv() {
  if (S.hdrTextureOriginal) { S.hdrTextureOriginal.dispose(); S.hdrTextureOriginal = null }
  if (S.hdrTextureRotated) { S.hdrTextureRotated.dispose(); S.hdrTextureRotated = null }

  S.hdrTexture = null
  S.hdrInfo = null
  if (S.scene) S.scene.environmentRotation.set(0, 0, 0)
  if (S.currentEnvMode === 'hdri') setEnvMode('custom')
  else applyHDREnvMode()
}
export function getCurrentLightPreset() { return S.currentLightPreset }
export function getCurrentEnvMode() { return S.currentEnvMode }
export function setEnvModeExport(mode) { setEnvMode(mode) }
export function setHdrRotation(val) {
  S.hdrRotation = val
  if (S.hdrRotateTimer) clearTimeout(S.hdrRotateTimer)
  S.hdrRotateTimer = setTimeout(() => {
    S.hdrRotateTimer = null
    if (S.initialized && S.currentEnvMode === 'hdri') {
      ensureRotatedTexture()
      applyHDREnvMode()
    }
  }, 30)
}

export function setHdrUsage(mode) { if (!['both', 'env', 'bg'].includes(mode)) return; S.hdrUsage = mode; if (S.initialized && S.currentEnvMode === 'hdri') applyHDREnvMode() }
export function getHdrInfo() { return S.hdrInfo }
export function setSkyTurbidity(val) { S.skyTurbidity = val; if (S.initialized && S.currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }
export function setSkyRayleigh(val) { S.skyRayleigh = val; if (S.initialized && S.currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }
export function setSkyMieCoefficient(val) { S.skyMieCoefficient = val; if (S.initialized && S.currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }
export function setSkyMieDirectionalG(val) { S.skyMieDirectionalG = val; if (S.initialized && S.currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }
export function setSkySunElevation(val) { S.skySunElevation = val; if (S.initialized && S.currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }
export function setSkySunAzimuth(val) { S.skySunAzimuth = val; if (S.initialized && S.currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }

export function setSkyTint(hex) { const n = parseInt(hex.slice(1), 16); if (Number.isNaN(n)) return; S.skyTintHex = n; if (S.initialized && S.currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }

function disposeTexture(tex) { if (tex && tex.dispose) tex.dispose() }
function disposeAllMaterialTextures(m) { disposeTexture(m.map); disposeTexture(m.normalMap); disposeTexture(m.roughnessMap); disposeTexture(m.metalnessMap); disposeTexture(m.emissiveMap); if (m.userData.shaderRefs) { disposeTexture(m.userData.shaderRefs.heightMap.value); m.userData.shaderRefs.heightMap.value = null; m.userData.shaderRefs.hasHeightMap.value = 0.0 } disposeTexture(m.userData.pendingHeightMap); m.userData.pendingHeightMap = null; m.map = null; m.normalMap = null; m.roughnessMap = null; m.metalnessMap = null; m.emissiveMap = null }

function applyTexturesToMesh(mesh, group, side) {
  const material = mesh.material
  disposeAllMaterialTextures(material)
  if (!group) { material.color.set(0x888888); material.emissive.set(0x000000); material.needsUpdate = true; return }

  const loader = new THREE.TextureLoader()
  const getEntry = (role) => { const e = group[side] && group[side][role]; return (e && !e.isDirectory && isImageFile(e.name)) ? e : null }
  const mainEntry = getEntry('main'), normalEntry = getEntry('normal'), specEntry = getEntry('specular')

  if (mainEntry) {
    loader.load(fileUrl(mainEntry.fullPath), (tex) => { tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; disposeTexture(material.map); material.map = tex; applyTextureFilter(tex); material.color.set(0xffffff); const mi = new Image(); mi.onload = () => { const w = Math.min(mi.naturalWidth, 64), h = Math.min(mi.naturalHeight, 64); const tc = document.createElement('canvas'); tc.width = w; tc.height = h; const tctx = tc.getContext('2d', { willReadFrequently: true }); tctx.drawImage(mi, 0, 0, w, h); const td = tctx.getImageData(0, 0, w, h).data; let hasAlpha = false, semiCount = 0, total = 0; for (let i = 3; i < td.length; i += 4) { total++; const a = td[i]; if (a < 250) hasAlpha = true; if (a > 5 && a < 250) semiCount++ } material.userData.hasAlpha = hasAlpha; material.userData.hasSemiTrans = semiCount / total > 0.02; applyOpacityMode(material) }; mi.src = fileUrl(mainEntry.fullPath); material.needsUpdate = true })
  } else { material.color.set(0x444466); material.userData.hasAlpha = false; material.userData.hasSemiTrans = false; applyOpacityMode(material) }

  if (normalEntry) {
    const nUrl = fileUrl(normalEntry.fullPath)
    const processNormal = (source) => {
      const sc = document.createElement('canvas'); sc.width = imgW(source); sc.height = imgH(source)
      const sctx = sc.getContext('2d', { willReadFrequently: true }); sctx.drawImage(source, 0, 0)
      const src = sc
      if (side === 'left') showLoading(_t('m3d.loading'))
      if (side === 'left' && S.heightDetectCallback) S.heightDetectCallback('loading')
      requestAnimationFrame(() => {
        setLoadingProgress(0.2)
        disposeTexture(material.normalMap); material.normalMap = reconstructNormal(src); applyTextureFilter(material.normalMap); material.normalScale.set(S.normalScale, S.normalScale)
        requestAnimationFrame(() => {
          setLoadingProgress(0.4)
          let heightTex = extractHeight(src); let hStatus = heightTex ? 'alpha' : false
          if (!heightTex) { heightTex = extractHeightFromNormal(src); hStatus = heightTex ? 'normal' : false }
          setLoadingProgress(0.9)
          if (material.userData.shaderRefs) { disposeTexture(material.userData.shaderRefs.heightMap.value); material.userData.shaderRefs.heightMap.value = heightTex; material.userData.shaderRefs.hasHeightMap.value = (heightTex && S.parallaxEnabled) ? 1.0 : 0.0; if (heightTex) { applyHeightFilter(heightTex); material.userData.shaderRefs.uHeightTexSize.value.set(heightTex.image.width, heightTex.image.height) } }
          else { disposeTexture(material.userData.pendingHeightMap); material.userData.pendingHeightMap = heightTex }
          if (side === 'left' && S.heightDetectCallback) S.heightDetectCallback(hStatus)
          material.needsUpdate = true
          if (side === 'left') { setLoadingProgress(1.0); setTimeout(hideLoading, 200) }
        })
      })
    }
    if (typeof createImageBitmap !== 'undefined') {
      fetch(nUrl).then(r => r.blob()).then(blob => createImageBitmap(blob, { premultiplyAlpha: 'none' })).then(bitmap => { processNormal(bitmap); if (bitmap.close) bitmap.close() }).catch(() => { const img = new Image(); img.onload = () => processNormal(img); img.src = nUrl })
    } else { const img = new Image(); img.onload = () => processNormal(img); img.src = nUrl }
  } else { if (side === 'left' && S.heightDetectCallback) S.heightDetectCallback(false) }

  if (specEntry) {
    const specImg = new Image(); specImg.onload = () => {
      let fmt = S.materialFormat
      if (fmt === 'auto') { fmt = detectFormat(specImg); if (S.formatDetectCallback) S.formatDetectCallback(fmt) }
      disposeTexture(material.roughnessMap); disposeTexture(material.metalnessMap); disposeTexture(material.emissiveMap)
      if (fmt === 'old') {
        material.roughnessMap = extractChannel(specImg, 0, true); material.metalnessMap = extractChannel(specImg, 1, false); material.emissiveMap = extractChannel(specImg, 2, false); applyTextureFilter(material.roughnessMap); applyTextureFilter(material.metalnessMap); applyTextureFilter(material.emissiveMap)
        material.emissive.set(0xffffff); material.emissiveIntensity = S.emissiveIntensity; material.needsUpdate = true
      } else {
         material.roughnessMap = extractRoughness(specImg); material.metalnessMap = extractMetalness(specImg); applyTextureFilter(material.roughnessMap); applyTextureFilter(material.metalnessMap)
        if (mainEntry) {
          const mainImg = new Image(); mainImg.onload = () => {
             disposeTexture(material.emissiveMap); material.emissiveMap = extractEmissive(specImg, mainImg); applyTextureFilter(material.emissiveMap)
            material.emissive.set(0xffffff); material.emissiveIntensity = S.emissiveIntensity; material.needsUpdate = true
          }; mainImg.src = fileUrl(mainEntry.fullPath)
        } else { material.emissive.set(0x000000) }
        material.needsUpdate = true
      }
    }; specImg.src = fileUrl(specEntry.fullPath)
  } else { material.emissive.set(0x000000) }
  material.needsUpdate = true
}

export function updateMaterial3D(group) {
  if (!S.initialized) return
  if (group) clearCustomModel()
  if (!group && S.heightDetectCallback) S.heightDetectCallback(false)
  applyTexturesToMesh(S.meshLeft, group, 'left')
  applyTexturesToMesh(S.meshRight, group, 'right')
}

export function clearMaterial3D() { updateMaterial3D(null) }

/* ── 自定义模型（MC .json / .bbmodel）：3D 视口渲染通道 ──────────
   group 的内容需以自身原点为几何中心（缩放适配与贴地由本函数完成），
   wrapper 原点保持在模型中心，旋转（拖拽/自动旋转）围绕中心进行。 */
export function showCustomModel(group) {
  if (!S.initialized || !group) return false
  clearCustomModel()
  try {
    const box = new THREE.Box3().setFromObject(group)
    if (box.isEmpty()) return false
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    const scale = 2.0 / maxDim
    group.position.set(-center.x, -center.y, -center.z)
    group.scale.setScalar(scale)
    const wrapper = new THREE.Group()
    wrapper.add(group)
    /* 底面贴地（地面 y=-1.3）：wrapper 原点在缩放后模型中心 */
    const halfY = (size.y * scale) / 2
    wrapper.position.y = -1.28 + halfY
    S.meshLeft.visible = false; S.meshRight.visible = false
    S.labelLeft.visible = false; S.labelRight.visible = false
    S.customModelGroup = wrapper
    S.scene.add(wrapper)

    return true
  } catch { return false }
}

export function showCustomModelPair(leftGroup, rightGroup) {
  if (!S.initialized) return false
  if (!leftGroup && !rightGroup) return false
  clearCustomModel()
  try {
    const wrapper = new THREE.Group()
    let added = 0
    const place = (grp, x) => {
      if (!grp) return
      const box = new THREE.Box3().setFromObject(grp)
      if (box.isEmpty()) return
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z) || 1
      const scale = 1.5 / maxDim
      grp.position.set(-center.x, -center.y, -center.z)
      grp.scale.setScalar(scale)
      const sub = new THREE.Group()
      sub.add(grp)
      const halfY = (size.y * scale) / 2
      sub.position.set(x, -1.28 + halfY, 0)
      wrapper.add(sub)
      added++
    }
    place(leftGroup, -1.1)
    place(rightGroup, 1.1)
    if (added === 0) return false
    S.meshLeft.visible = false; S.meshRight.visible = false
    S.labelLeft.visible = true; S.labelRight.visible = true
    S.labelLeft.position.set(-1.1, -0.95, 0); S.labelRight.position.set(1.1, -0.95, 0)
    S.customModelGroup = wrapper
    S.scene.add(wrapper)

    return true
  } catch { return false }
}

export function clearCustomModel() {
  if (!S.customModelGroup) return
  S.scene.remove(S.customModelGroup)
  disposeGroupDeep(S.customModelGroup)
  S.customModelGroup = null
  if (S.initialized) applySourceSide()
}

export function isCustomModelActive() { return !!S.customModelGroup }

export function hasVisibleViewport() {
  if (!S.initialized) return false
  return !!findVisibleHost()
}

function disposeGroupDeep(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose()
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])
    /* userData.shared 标记的跨模型共享材质（隐藏面/占位）不 dispose */
    for (const m of mats) { if (!(m && m.userData && m.userData.shared)) m.dispose() }
  })
}

/* ════════════════════════════════════════════════════════════
   节点编辑器联动 API
   ════════════════════════════════════════════════════════════ */
export function isMaterial3DReady() { return S.initialized }
export function setBaseColor(rgb) {
  if (!S.initialized || !Array.isArray(rgb)) return
  const r = clamp01(rgb[0]), g = clamp01(rgb[1]), b = clamp01(rgb[2])
  S.meshLeft.material.color.setRGB(r, g, b)
  S.meshRight.material.color.setRGB(r, g, b)
  S.meshLeft.material.needsUpdate = S.meshRight.material.needsUpdate = true
}
export function setEmissiveColor(rgb) {
  if (!S.initialized || !Array.isArray(rgb)) return
  const r = clamp01(rgb[0]), g = clamp01(rgb[1]), b = clamp01(rgb[2])
  S.meshLeft.material.emissive.setRGB(r, g, b)
  S.meshRight.material.emissive.setRGB(r, g, b)
  S.meshLeft.material.needsUpdate = S.meshRight.material.needsUpdate = true
}
function clamp01(v) { return Math.max(0, Math.min(1, v)) }
export function setMainTextureFromUrl(url) {
  if (!S.initialized || !url) return
  const loader = new THREE.TextureLoader()
  for (const m of [S.meshLeft, S.meshRight]) {
    loader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      disposeTexture(m.material.map)
      m.material.map = tex
      applyTextureFilter(tex)
      m.material.needsUpdate = true
    })
  }
}
export function setNormalMapFromUrl(url) {
  if (!S.initialized || !url) return
  const loader = new THREE.TextureLoader()
  for (const m of [S.meshLeft, S.meshRight]) {
    loader.load(url, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      disposeTexture(m.material.normalMap)
      m.material.normalMap = tex
      m.material.normalScale.set(S.normalScale, S.normalScale)
      applyTextureFilter(tex)
      m.material.needsUpdate = true
    })
  }
}
export function clearMainTexture() {
  if (!S.initialized) return
  for (const m of [S.meshLeft, S.meshRight]) {
    disposeTexture(m.material.map); m.material.map = null; m.material.needsUpdate = true
  }
}
export function clearNormalMap() {
  if (!S.initialized) return
  for (const m of [S.meshLeft, S.meshRight]) {
    disposeTexture(m.material.normalMap); m.material.normalMap = null; m.material.needsUpdate = true
  }
}
/* 高光/镜面贴图（-s）：R 通道反转→粗糙度，G 通道→金属度（与 labpbr 格式一致） */
function applySpecTextureToMaterial(mat, url) {
  if (!mat || !url) return
  const specImg = new Image()
  specImg.crossOrigin = 'anonymous'
  specImg.onload = () => {
    disposeTexture(mat.roughnessMap); disposeTexture(mat.metalnessMap)
    mat.roughnessMap = extractRoughness(specImg)
    mat.metalnessMap = extractMetalness(specImg)
    applyTextureFilter(mat.roughnessMap); applyTextureFilter(mat.metalnessMap)
    mat.needsUpdate = true
  }
  specImg.src = url
}
function clearSpecTexture(mat) {
  if (!mat) return
  disposeTexture(mat.roughnessMap); disposeTexture(mat.metalnessMap)
  mat.roughnessMap = null; mat.metalnessMap = null; mat.needsUpdate = true
}
export function setSpecularFromUrl(url) {
  if (!S.initialized || !url) return
  for (const m of [S.meshLeft, S.meshRight]) applySpecTextureToMaterial(m.material, url)
}
export function clearSpecularTexture() {
  if (!S.initialized) return
  for (const m of [S.meshLeft, S.meshRight]) clearSpecTexture(m.material)
}

export function applyPbrMapsToModelMaterial(mat, normalUrl, specUrl) {
  if (!mat) return
  if (normalUrl) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (mat.userData.replaced) return
      disposeTexture(mat.normalMap)
      const nTex = reconstructNormal(img)
      nTex.magFilter = THREE.NearestFilter; nTex.minFilter = THREE.NearestFilter
      mat.normalMap = nTex
      if (mat.normalScale) mat.normalScale.set(1.0, 1.0)
      mat.needsUpdate = true
    }
    img.src = normalUrl
  }
  if (specUrl) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (mat.userData.replaced) return
      disposeTexture(mat.roughnessMap); disposeTexture(mat.metalnessMap)
      const rTex = extractRoughness(img)
      const mTex = extractMetalness(img)
      rTex.magFilter = THREE.NearestFilter; rTex.minFilter = THREE.NearestFilter
      mTex.magFilter = THREE.NearestFilter; mTex.minFilter = THREE.NearestFilter
      mat.roughnessMap = rTex
      mat.metalnessMap = mTex
      mat.needsUpdate = true
    }
    img.src = specUrl
  }
}
export function applyNodePBR(p) {
  if (!S.initialized || !p) return
  if (p.mainTextureUrl) clearCustomModel()
  if (p.baseColor) setBaseColor(p.baseColor)
  if (typeof p.roughness === 'number') setRoughness(clamp01(p.roughness))
  if (typeof p.metallic === 'number') setMetalness(clamp01(p.metallic))
  if (typeof p.normalScale === 'number') setNormalScale(p.normalScale)
  if (typeof p.envIntensity === 'number') setEnvIntensity(p.envIntensity)
  if (typeof p.exposure === 'number') setExposure(p.exposure)
  if (typeof p.opacity === 'number') setOpacity(p.opacity)
  if (p.emissive) setEmissiveColor(p.emissive)
  if (p.mainTextureUrl) setMainTextureFromUrl(p.mainTextureUrl)
  else if (p.mainTextureUrl === null) clearMainTexture()
  if (p.normalMapUrl) setNormalMapFromUrl(p.normalMapUrl)
  else if (p.normalMapUrl === null) clearNormalMap()
  if (p.specTextureUrl) setSpecularFromUrl(p.specTextureUrl)
  else if (p.specTextureUrl === null) clearSpecularTexture()
  if (p.lightPreset) setLightPreset(p.lightPreset)
  if (p.geometry) setGeometry(p.geometry)
}
export function applyNodePBRSide(p, side) {
  if (!S.initialized || !p) return
  if (p.mainTextureUrl) clearCustomModel()
  const mesh = side === 'left' ? S.meshLeft : S.meshRight
  if (!mesh) return
  const mat = mesh.material
  if (p.baseColor && Array.isArray(p.baseColor)) {
    mat.color.setRGB(clamp01(p.baseColor[0]), clamp01(p.baseColor[1]), clamp01(p.baseColor[2])); mat.needsUpdate = true
  }
  if (typeof p.roughness === 'number') mat.roughness = clamp01(p.roughness)
  if (typeof p.metallic === 'number') mat.metalness = clamp01(p.metallic)
  if (typeof p.normalScale === 'number') mat.normalScale.set(p.normalScale, p.normalScale)
  if (typeof p.opacity === 'number') { S.opacityValue = p.opacity; applyOpacityMode(mat) }
  if (p.emissive && Array.isArray(p.emissive)) {
    mat.emissive.setRGB(clamp01(p.emissive[0]), clamp01(p.emissive[1]), clamp01(p.emissive[2])); mat.needsUpdate = true
  }
  if (p.mainTextureUrl) {
    const loader = new THREE.TextureLoader()
    loader.load(p.mainTextureUrl, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      disposeTexture(mat.map); mat.map = tex; applyTextureFilter(tex); mat.needsUpdate = true
    })
  } else if (p.mainTextureUrl === null) { disposeTexture(mat.map); mat.map = null; mat.needsUpdate = true }
  if (p.normalMapUrl) {
    const loader = new THREE.TextureLoader()
    loader.load(p.normalMapUrl, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      disposeTexture(mat.normalMap); mat.normalMap = tex; mat.normalScale.set(S.normalScale, S.normalScale); applyTextureFilter(tex); mat.needsUpdate = true
    })
  } else if (p.normalMapUrl === null) { disposeTexture(mat.normalMap); mat.normalMap = null; mat.needsUpdate = true }
  if (p.specTextureUrl) {
    applySpecTextureToMaterial(mat, p.specTextureUrl)
  } else if (p.specTextureUrl === null) { clearSpecTexture(mat) }
  if (typeof p.envIntensity === 'number') setEnvIntensity(p.envIntensity)
  if (typeof p.exposure === 'number') setExposure(p.exposure)
  if (p.lightPreset) setLightPreset(p.lightPreset)
  if (p.geometry) setGeometry(p.geometry)
}
export function getMaterial3DInfo() {
  if (!S.initialized) return null
  const m = S.meshLeft.material
  return {
    color: [m.color.r, m.color.g, m.color.b],
    roughness: m.roughness, metalness: m.metalness,
    normalScale: S.normalScale, emissiveIntensity: S.emissiveIntensity, envIntensity: S.envIntensity,
    hasMap: !!m.map, hasNormalMap: !!m.normalMap
  }
}

export function disposeMaterial3D() {
  if (S.animationId) cancelAnimationFrame(S.animationId)
  if (S.skyBakeTimer) { clearTimeout(S.skyBakeTimer); S.skyBakeTimer = null }
  if (S.hdrRotateTimer) { clearTimeout(S.hdrRotateTimer); S.hdrRotateTimer = null }
  if (S.customModelGroup) { S.scene.remove(S.customModelGroup); disposeGroupDeep(S.customModelGroup); S.customModelGroup = null }
  for (const m of [S.meshLeft, S.meshRight]) { if (m) { if (m.material) { disposeAllMaterialTextures(m.material); m.material.dispose() }; if (m.geometry) m.geometry.dispose() } }
  if (S.groundMesh) { S.groundMesh.geometry.dispose(); S.groundMesh.material.dispose() }
  if (S.gridHelper) { S.gridHelper.geometry.dispose(); S.gridHelper.material.dispose() }
  if (S.envTexture) S.envTexture.dispose()
  if (S.pmremTexture) S.pmremTexture.dispose()
  if (S.hdrTextureOriginal) S.hdrTextureOriginal.dispose()
  if (S.hdrTextureRotated) S.hdrTextureRotated.dispose()
  if (S.skyEnvTexture) S.skyEnvTexture.dispose()
  if (S.skyMesh) { S.skyMesh.geometry.dispose(); S.skyMesh.material.dispose(); S.skyMesh = null }
  if (S.pmrem) S.pmrem.dispose(); if (S.renderer) S.renderer.dispose()
  S.initialized = false
}
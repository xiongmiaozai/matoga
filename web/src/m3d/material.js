/**
 * matoga - 材质 3D 视口：material
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */
import { S, FLY_KEYS, FLY_SPEED, FLY_BOOST } from './state.js'

export function createLabel(text, color) {
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

export function parseIncludes(src) {
  const pattern = /#include <(\w+)>/g
  function replace(match, name) {
    const chunk = THREE.ShaderChunk[name]
    if (!chunk) return match
    return parseIncludes(chunk)
  }
  return src.replace(pattern, replace)
}

export function applyOpacityMode(material) {
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

export function applyTextureFilter(tex) {
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

export function collectMaterialTextures(m) {
  const list = []
  if (m.map) list.push(m.map)
  if (m.normalMap) list.push(m.normalMap)
  if (m.roughnessMap) list.push(m.roughnessMap)
  if (m.metalnessMap) list.push(m.metalnessMap)
  if (m.emissiveMap) list.push(m.emissiveMap)
  if (m.userData.shaderRefs && m.userData.shaderRefs.heightMap && m.userData.shaderRefs.heightMap.value) list.push(m.userData.shaderRefs.heightMap.value)
  return list
}

export function applyFilterToAllTextures() {
  if (!S.initialized) return
  for (const mesh of [S.meshLeft, S.meshRight]) {
    if (!mesh || !mesh.material) continue
    for (const tex of collectMaterialTextures(mesh.material)) applyTextureFilter(tex)
    mesh.material.needsUpdate = true
  }
}

export function makeMaterial() {
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


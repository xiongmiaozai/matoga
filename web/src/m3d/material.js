/**
 * matoga - MC 模型：材质构建
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 按领域搬出（正文逐字未改）。
 * 职责：PBR 材质构建、shader include 解析
 */
import * as THREE from 'three'

/* 模块状态：只读用 getter；可写用 get/set 成对（§2.2） */
let _get_emissiveIntensity = () => undefined
let _get_parallaxEnabled = () => undefined
let _get_parallaxScale = () => undefined
let _get_parallaxSteps = () => undefined
let _get_parallaxMode = () => undefined
let _get_parallaxAdaptive = () => undefined
let _get_parallaxShadow = () => undefined
let _get_isWebGL2 = () => undefined

export function setHooks(h) {
  if (h.get_emissiveIntensity) _get_emissiveIntensity = h.get_emissiveIntensity
  if (h.get_parallaxEnabled) _get_parallaxEnabled = h.get_parallaxEnabled
  if (h.get_parallaxScale) _get_parallaxScale = h.get_parallaxScale
  if (h.get_parallaxSteps) _get_parallaxSteps = h.get_parallaxSteps
  if (h.get_parallaxMode) _get_parallaxMode = h.get_parallaxMode
  if (h.get_parallaxAdaptive) _get_parallaxAdaptive = h.get_parallaxAdaptive
  if (h.get_parallaxShadow) _get_parallaxShadow = h.get_parallaxShadow
  if (h.get_isWebGL2) _get_isWebGL2 = h.get_isWebGL2
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

export function makeMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x888888,
    roughness: 0.5,
    metalness: 0.1,
    envMapIntensity: 1.0,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: _get_emissiveIntensity(),
    transmission: 0.0,
    ior: 1.5,
    thickness: 0.5,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0
  })
  mat.userData.shaderRefs = null
  mat.userData.pendingHeightMap = null
  mat.onBeforeCompile = shader => {
    const prev = mat.userData.shaderRefs

    shader.uniforms.heightMap = { value: prev ? prev.heightMap.value : mat.userData.pendingHeightMap }
    shader.uniforms.hasHeightMap = {
      value: prev ? prev.hasHeightMap.value : mat.userData.pendingHeightMap && _get_parallaxEnabled() ? 1.0 : 0.0
    }
    shader.uniforms.parallaxScale = { value: _get_parallaxScale() }
    shader.uniforms.parallaxSteps = { value: _get_parallaxSteps() }
    shader.uniforms.parallaxMode = { value: _get_parallaxMode() }
    shader.uniforms.parallaxAdaptive = { value: _get_parallaxAdaptive() }
    shader.uniforms.parallaxShadow = { value: _get_parallaxShadow() }
    shader.uniforms.uHeightLightDir = { value: prev ? prev.uHeightLightDir.value : new THREE.Vector3(0, 1, 0) }
    shader.uniforms.uHeightTexSize = {
      value: prev
        ? prev.uHeightTexSize.value
        : mat.userData.pendingHeightMap
          ? new THREE.Vector2(mat.userData.pendingHeightMap.image.width, mat.userData.pendingHeightMap.image.height)
          : new THREE.Vector2(256, 256)
    }
    mat.userData.shaderRefs = shader.uniforms
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        'uniform sampler2D heightMap;\nuniform vec2 uHeightTexSize;\nuniform vec3 uHeightLightDir;\nuniform float hasHeightMap;\nuniform float parallaxScale;\nuniform float parallaxSteps;\nuniform float parallaxMode;\nuniform float parallaxAdaptive;\nuniform float parallaxShadow;\n#include <common>'
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
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

          P *= smoothstep(0.0, 0.2, viewDotN);
          float hMip = 0.0;

          if (parallaxMode < 0.5) {
            float height = ${_get_isWebGL2() ? 'textureLod( heightMap, parallaxUv, hMip )' : 'texture2D( heightMap, parallaxUv )'}.r;
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
            float currentDepthValue = ${_get_isWebGL2() ? 'textureLod( heightMap, currentTexCoords, hMip )' : 'texture2D( heightMap, currentTexCoords )'}.r;
            for (int i = 0; i < 64; i++) {
              if (currentLayerDepth >= currentDepthValue) break;
              currentTexCoords -= deltaTexCoords;
              currentDepthValue = ${_get_isWebGL2() ? 'textureLod( heightMap, currentTexCoords, hMip )' : 'texture2D( heightMap, currentTexCoords )'}.r;
              currentLayerDepth += layerDepth;
            }
            if (parallaxMode < 1.5) {
              parallaxUv = currentTexCoords;
            } else if (parallaxMode < 2.5) {
              vec2 prevTexCoords = currentTexCoords + deltaTexCoords;
              float beforeDepth = ${_get_isWebGL2() ? 'textureLod( heightMap, prevTexCoords, hMip )' : 'texture2D( heightMap, prevTexCoords )'}.r - currentLayerDepth + layerDepth;
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
                float midDepthValue = ${_get_isWebGL2() ? 'textureLod( heightMap, midTexCoords, hMip )' : 'texture2D( heightMap, midTexCoords )'}.r;
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
            float hRay = ${_get_isWebGL2() ? 'textureLod( heightMap, parallaxUv, hMip )' : 'texture2D( heightMap, parallaxUv )'}.r;
            vec2 ssUv = parallaxUv;
            for (int i = 0; i < 8; i++) {
              ssUv += ssDelta;
              hRay += 1.0 / numSS;
              float hSurf = ${_get_isWebGL2() ? 'textureLod( heightMap, ssUv, hMip )' : 'texture2D( heightMap, ssUv )'}.r;
              parallaxShadowFactor = min(parallaxShadowFactor, smoothstep(0.0, 0.06, hRay - hSurf));
            }
            parallaxShadowFactor = mix(1.0, parallaxShadowFactor, parallaxShadow);
          }
        }`
      )
      .replace(
        '#include <lights_fragment_begin>',
        '#include <lights_fragment_begin>\n        reflectedLight.directDiffuse *= parallaxShadowFactor;'
      )
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

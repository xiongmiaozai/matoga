/**
 * matoga - 材质 3D 视口：textures
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */
import { S, FLY_KEYS, FLY_SPEED, FLY_BOOST } from './state.js'
import { fileUrl, isImageFile } from '../utils.js'
import { t as _t } from '../i18n.js'
import { applyHeightFilter, detectFormat, extractChannel, extractEmissive, extractHeight, extractHeightFromNormal, extractMetalness, extractRoughness, imgH, imgW, reconstructNormal } from './texture-extract.js'
import { hideLoading, setLoadingProgress, showLoading } from './loading.js'
import { applyFilterToAllTextures, applyOpacityMode, applyTextureFilter, createLabel, makeMaterial } from './material.js'
import { clamp01, disposeAllMaterialTextures, disposeGroupDeep, disposeTexture } from './dispose-utils.js'

export function applySourceSide() {
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


export function applyTexturesToMesh(mesh, group, side) {
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
export function applySpecTextureToMaterial(mat, url) {
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
export function clearSpecTexture(mat) {
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


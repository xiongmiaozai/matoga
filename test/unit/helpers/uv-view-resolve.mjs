/* uv-view 单测专用模块 hook：
   - mc-model-viewer → getLastModelLayout 由 globalThis.__uvTestLayout 控制；
     编辑联动函数（updateModelFaceUv / updateModelFaceRotation / updateModelTexture /
     highlightModelFace / exportActiveModelJson）记录调用到 globalThis.__uvEditCalls 供断言
   - material3d → isCustomModelActive 由 globalThis.__uvTestActive 控制
   - i18n → t() 返回 key（带 n 参数时 key:n），onLocaleChange no-op
   floating-window.js 保持真实实现（配合 DOM stub 测完整窗口链路）。 */

const MCM_STUB = `
export function getLastModelLayout(){ return globalThis.__uvTestLayout || null }
export function isViewportVisible(){ return true }
export function parseAnimMeta(meta, texW, texH){
  const anim = (meta && typeof meta === 'object') ? meta.animation : null
  if (!anim || typeof anim !== 'object') return null
  const w = +texW || 0, h = +texH || 0
  if (w <= 0 || h <= 0) return null
  const fw = (anim.width > 0) ? Math.floor(anim.width) : w
  const fh = (anim.height > 0) ? Math.floor(anim.height) : fw
  if (fw <= 0 || fh <= 0 || fw > w || fh > h) return null
  const frameCount = Math.floor(h / fh)
  if (frameCount <= 1) return null
  return { texW: w, texH: h, frameW: fw, frameH: fh, frameCount, timeline: [], totalSec: 1 }
}
export function updateModelFaceUv(el, key, uv){
  globalThis.__uvEditCalls = globalThis.__uvEditCalls || []
  globalThis.__uvEditCalls.push({ fn: 'uv', el, key, uv: [...uv] })
  if (el && el.faces && typeof el.faces === 'object') {
    if (!el.faces[key] || typeof el.faces[key] !== 'object') el.faces[key] = {}
    el.faces[key].uv = [...uv]
  }
  return true
}
export function updateModelFaceRotation(el, key, rotation){
  globalThis.__uvEditCalls = globalThis.__uvEditCalls || []
  globalThis.__uvEditCalls.push({ fn: 'rot', el, key, rotation })
  if (el && el.faces && typeof el.faces === 'object') {
    if (!el.faces[key] || typeof el.faces[key] !== 'object') el.faces[key] = {}
    el.faces[key].rotation = rotation
  }
  return true
}
export async function updateModelTexture(texIndex, dataUrl, layout){
  globalThis.__uvEditCalls = globalThis.__uvEditCalls || []
  globalThis.__uvEditCalls.push({ fn: 'tex', texIndex, dataUrl })
  return true
}
export function highlightModelFace(el, key, on){
  globalThis.__uvHlCalls = globalThis.__uvHlCalls || []
  globalThis.__uvHlCalls.push({ el, key, on })
  return true
}
export function defaultFaceUv(key, from, to, uvScale){
  if (!Array.isArray(from) || !Array.isArray(to)) return null
  const fx = +from[0], fy = +from[1], fz = +from[2]
  const tx = +to[0], ty = +to[1], tz = +to[2]
  if (![fx, fy, fz, tx, ty, tz].every(Number.isFinite)) return null
  let uv
  switch (key) {
    case 'up': uv = [fx, fz, tx, tz]; break
    case 'down': uv = [fx, 16 - tz, tx, 16 - fz]; break
    case 'north': uv = [16 - tx, 16 - ty, 16 - fx, 16 - fy]; break
    case 'south': uv = [fx, 16 - ty, tx, 16 - fy]; break
    case 'east': uv = [16 - tz, 16 - ty, 16 - fz, 16 - fy]; break
    case 'west': uv = [fz, 16 - ty, tz, 16 - fy]; break
    default: return null
  }
  if (uvScale && uvScale !== 16) uv = uv.map(v => v * (uvScale / 16))
  return uv
}
export function exportActiveModelJson(){ return globalThis.__uvExportModel || null }
`

const M3D_STUB = `
export function isCustomModelActive(){ return !!globalThis.__uvTestActive }
`

const I18N_STUB = `
export function t(k, p){ return (p && p.n !== undefined) ? (k + ':' + p.n) : k }
export function onLocaleChange(){}
`

export async function load(url, context, next) {
  if (url.endsWith('/web/src/mc-model-viewer.js')) {
    return { shortCircuit: true, format: 'module', source: MCM_STUB }
  }
  if (url.endsWith('/web/src/material3d.js')) {
    return { shortCircuit: true, format: 'module', source: M3D_STUB }
  }
  if (url.endsWith('/web/src/i18n.js')) {
    return { shortCircuit: true, format: 'module', source: I18N_STUB }
  }
  return next(url, context)
}
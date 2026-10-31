import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')
const MAP = {
  three: path.join(ROOT, 'node_modules/three/build/three.module.js'),
  '/vendor/three/three.module.js': path.join(ROOT, 'node_modules/three/build/three.module.js'),
  'golden-layout': path.join(ROOT, 'node_modules/golden-layout/dist/index.js')
}

export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { shortCircuit: true, url: pathToFileURL(MAP[specifier]).href }
  return next(specifier, context)
}
/* 渲染层测试用（NR_M3D_STUB=1）：将依赖 WebGL 的 material3d 替换为 no-op 假模块 */
const M3D_STUB = `
export function initMaterial3D(){}
export function applyNodePBRSide(){}
export function isMaterial3DReady(){ return false }
export function updateMaterial3D(){}
export function showCustomModel(g){ const f = globalThis.__m3dShow; return f ? !!f(g) : false }
export function showCustomModelPair(l, r){ const f = globalThis.__m3dShowPair; return f ? !!f(l, r) : false }
export function clearCustomModel(){}
export function setModelEmptyHint(){}
export function isCustomModelActive(){ return false }
export function hasVisibleViewport(){ return false }
export function applyPbrMapsToModelMaterial(){}
export function makeMaterial(){ return { userData: {} } }
export function isParallaxEnabled(){ return false }
export function refreshMaterial3DTint(){}
export function setChannelView(){}
`

export async function load(url, context, next) {
  if (process.env.NR_M3D_STUB === '1' && url.endsWith('/web/src/material3d.js')) {
    return { shortCircuit: true, format: 'module', source: M3D_STUB }
  }
  return next(url, context)
}

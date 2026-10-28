/**
 * matoga - 模型缩略图：离屏渲染
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 model-thumb.js 按职责搬出，逻辑未改。
 */
import {
  resolveMcModelAsset, mcMatFor, bbMatFor, buildModelGroup, buildItemSpriteGroup,
  applyItemTransformation, fetchImportedModelJson, getModelTexAnims,
  applyTexAnimFrame, animFrameIndexAt,
} from '../mc-model-viewer.js'
import { S } from './state.js'
import { TEX_WAIT_TIMEOUT, THUMB_DPR, THUMB_SIZE } from './constants.js'
import { animFramePlan, frameModelCamera } from './camera.js'
import * as THREE from 'three'

export function getRenderer() {
  if (!S.renderer) {
    S.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    S.renderer.setPixelRatio(THUMB_DPR)
    S.renderer.setClearColor(0x000000, 0)
  }
  S.renderer.setSize(THUMB_SIZE, THUMB_SIZE)
  return S.renderer
}

/* 收集 group 内所有材质的贴图就绪 promise（mc-model-viewer 材质工厂挂 userData.texReady；
    共享占位/隐藏材质无贴图跳过；无 promise 的材质视为就绪） */
export function collectTexPromises(group) {
  const ps = []
  group.traverse(o => {
    if (!o.isMesh) return
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])
    for (const m of mats) {
      if (!m || (m.userData && m.userData.shared)) continue
      const p = m.userData && m.userData.texReady
      if (p && typeof p.then === 'function') ps.push(p)
    }
  })
  return ps
}

/* 事件驱动等待全部贴图就绪：await promise 集合（无轮询开销，就绪即返回），
    超时竞速返回 false（失败材质 texFailed 为终态视为就绪——404 重试无益可缓存；
    超时未决材质视为未完成为「partial」，渲染结果不进后端缓存下次重试） */
export async function waitForTextures(group, timeout = TEX_WAIT_TIMEOUT) {
  const ps = collectTexPromises(group)
  if (!ps.length) return true
  let allDone = false
  const all = Promise.all(ps).then(() => { allDone = true })
  await Promise.race([all, new Promise(r => setTimeout(r, timeout))])
  return allDone
}

/* 渲染临界区串行（共享同一离屏 S.renderer canvas）；模型 fetch 与贴图等待在队列外
    并行进行（数百模型的批量生成下，慢网络/慢贴图不再阻塞后续渲染任务） */
export function enqueueRender(task) {
  const p = S.chain.then(task)
  S.chain = p.catch(() => {})
  return p
}

export async function buildGroupFor(spec) {
  if (spec.kind === 'im') {
    const json = await fetchImportedModelJson(spec.id)
    if (!json || !Array.isArray(json.elements) || !json.elements.length) throw new Error('empty model')
    const isBb = !!(json.meta && (json.meta.format === 'bbmodel' || json.meta.model_format))
    const matFor = isBb
      ? bbMatFor(json.textures, 'bbm:' + spec.id)
      : mcMatFor((json.textures && typeof json.textures === 'object') ? json.textures : {}, undefined, undefined)
    const uvScale = isBb && Number.isFinite(+json.resolution) && +json.resolution > 0 ? +json.resolution : 16
    const group = buildModelGroup(json.elements, matFor, uvScale)
    if (!group.children.length) throw new Error('empty model group')
    return { group, sprite: false }
  }
  /* models/ 路径或 items/ 物品定义（1.21.4+）：统一经 resolveMcModelAsset，composite 多部件合并 */
  const { parts } = await resolveMcModelAsset(spec.api, spec.packName, spec.rel, spec.fileRoot)
  const group = new THREE.Group()
  let sprite = true
  for (const part of parts) {
    let sub = null
    if (part.elements.length) {
      sub = buildModelGroup(part.elements, mcMatFor(part.textures, spec.api, spec.packName, spec.fileRoot, undefined, undefined, part.tints), 16)
      sprite = false
    } else {
      sub = buildItemSpriteGroup(part.textures, spec.api, spec.packName)
    }
    if (sub && sub.children.length) {
      if (part.transform) applyItemTransformation(sub, part.transform)
      group.add(sub)
    }
  }
  if (!group.children.length) throw new Error('empty model')
  return { group, sprite }
}

/* 包围球自动取景：dist = r / sin(fov/2) × margin——模型整体投影必在视锥内（数学保证
    任意长宽比不裁切），margin 留少量边距。替代旧 maxDim×2.05 经验值：细长模型溢出、
    等轴测立方体对角超高被裁。等轴测方向向量归一化（旧 (0.55,0.5,0.55) 非单位长度，
    实际距离偏离标称值 ~9%）；方向取 vanilla GUI display [30,225,0] 等效象限
    （north+east+up 可见）——front=north 的方向性方块（命令方块/熔炉/南瓜等）
    特色面朝向观察者，替代旧 +z 方向（south 可见、north 背对相机，front 面永不可见）；
    sprite 竖直平面取正面视角避免侧看成线 */

export async function renderModelThumb(spec) {
  const { group, sprite } = await buildGroupFor(spec)
  try {
    const complete = await waitForTextures(group)
    return await enqueueRender(() => {
      const r = getRenderer()
      const scene = new THREE.Scene()
      scene.add(group)
      const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(3, 5, 4)
      const fill = new THREE.DirectionalLight(0xbcd4ff, 0.9); fill.position.set(-4, 1.5, -3)
      const amb = new THREE.AmbientLight(0xffffff, 0.55)
      scene.add(key, fill, amb)
      const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100)
      frameModelCamera(camera, group, sprite)
      const anims = complete ? getModelTexAnims(group) : []
      const plan = animFramePlan(anims)
      const frames = []
      const n = plan ? plan.n : 1
      for (let i = 0; i < n; i++) {
        if (plan) {
          const t = plan.ts[i]
          for (const { tex, anim } of anims) applyTexAnimFrame(tex, anim, animFrameIndexAt(anim, t))
        }
        r.render(scene, camera)
        frames.push(r.domElement.toDataURL('image/png'))
      }
      return { frames, delay: plan ? plan.delay : 0, complete }
    })
  } finally {
    disposeGroupDeep(group)
  }
}

/* 释放几何与非共享材质（贴图来自 texCache 共享缓存，不在此释放） */
export function disposeGroupDeep(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose()
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])
    for (const m of mats) { if (!(m && m.userData && m.userData.shared)) m.dispose() }
  })
}

export async function fetchJson(url, opts) {
  const res = await fetch(url, opts)
  const j = await res.json().catch(() => null)
  return (j && j.ok) ? j.data : null
}

/* 查询后端缓存 → 未命中则离屏渲染并上传；返回 { urls, delay }（静态单帧 delay=0），
    失败 null。贴图超时未就绪的「partial」渲染仅当次显示、不上传后端缓存——避免
    缺图灰面被 mtime 锁定为永久缓存；动画模型多帧（帧 0 = <md5>.png 兼容单帧路径） */

/* 缩略图容器内挂 <img>；多帧（动画模型）定时轮换 src（img 脱离 DOM 自清，避免泄漏） */
export function applyThumb(th, anim) {
  if (!th.isConnected || !anim) return
  const icon = th.querySelector('.ac-icon')
  if (icon) icon.remove()
  const old = th.querySelector('img')
  if (old) old.remove()
  const img = document.createElement('img')
  img.alt = ''
  img.src = anim.urls[0]
  th.appendChild(img)
  if (anim.urls.length > 1 && anim.delay > 0) {
    let i = 0
    const timer = setInterval(() => {
      if (!img.isConnected) { clearInterval(timer); return }
      i = (i + 1) % anim.urls.length
      img.src = anim.urls[i]
    }, anim.delay)
  }
}


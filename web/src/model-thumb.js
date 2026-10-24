/**
 * matoga - 模型资产缩略图（离屏 three.js 渲染）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 为总资产库的模型类资产生成 3D 预览缩略图（与贴图缩略图 thumb-loader.js 同一架构：
 * 前端生成 → POST 上传 → 后端缓存 → GET 提供）：
 *  1. 复用 mc-model-viewer 的模型解析/构建（parent 链合并 + 内置 vanilla 基类回退、
 *     UV 重映射、包内贴图加载），构建出的 THREE.Group 不进 3D 视口，而是在离屏
 *     240×240（2x DPI → 480×480）WebGLRenderer 渲染；
 *  2. 相机取景按包围球自动定距（r / sin(fov/2)，任意比例不裁切恰满画面；item/generated
 *     sprite 模型取正面），透明背景 PNG；
 *  3. 贴图就绪事件驱动等待（材质 userData.texReady promise，超时渲染但不缓存半成品）；
 *  4. 动画贴图模型（.png.mcmeta）多帧缩略图：沿动画周期采样 2-8 帧（~10fps，
 *     按帧号组合签名去重——低帧率动画不存储重复帧）上传，后端按帧存储
 *     （frame 参数读取），卡片 <img> 定时轮换 src 循环播放；
 *  5. 渲染任务串行排队（共享单个离屏 renderer），模型 fetch 与贴图等待在队列外并行；
 *  6. IntersectionObserver 懒加载：卡片进入视口才触发（模型可能数以百计）；
 *  7. 缓存键为虚拟路径（packmodel:... / bb:...），staleness 用模型源 mtime。
 */

import * as THREE from 'three'
import {
  resolveMcModelAsset, mcMatFor, bbMatFor, buildModelGroup, buildItemSpriteGroup,
  applyItemTransformation, fetchImportedModelJson, getModelTexAnims,
  applyTexAnimFrame, animFrameIndexAt,
} from './mc-model-viewer.js'

const THUMB_SIZE = 240
const THUMB_DPR = 2              /* 高 DPI：drawing buffer 480×480，卡片高分屏不糊 */
const TEX_WAIT_TIMEOUT = 1200    /* 事件驱动等待（无轮询 CPU 开销），慢网络下放宽上限 */

const memCache = new Map()      /* 虚拟路径 → thumbUrl */
const generating = new Map()    /* 虚拟路径 → Promise<thumbUrl|null> */
const watched = new WeakMap()   /* 缩略图容器元素 → item（rebuild 重建 DOM 后自动失效） */

let renderer = null
let chain = Promise.resolve()
let io = null

function getRenderer() {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(THUMB_DPR)
    renderer.setClearColor(0x000000, 0)
  }
  renderer.setSize(THUMB_SIZE, THUMB_SIZE)
  return renderer
}

/* 收集 group 内所有材质的贴图就绪 promise（mc-model-viewer 材质工厂挂 userData.texReady；
    共享占位/隐藏材质无贴图跳过；无 promise 的材质视为就绪） */
function collectTexPromises(group) {
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

/* 渲染临界区串行（共享同一离屏 renderer canvas）；模型 fetch 与贴图等待在队列外
    并行进行（数百模型的批量生成下，慢网络/慢贴图不再阻塞后续渲染任务） */
function enqueueRender(task) {
  const p = chain.then(task)
  chain = p.catch(() => {})
  return p
}

async function buildGroupFor(spec) {
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
      sub = buildModelGroup(part.elements, mcMatFor(part.textures, spec.api, spec.packName), 16)
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
const ISO_DIR = new THREE.Vector3(0.55, 0.5, -0.55).normalize()
const SPRITE_DIR = new THREE.Vector3(0.12, 0.08, 1).normalize()

export function frameModelCamera(camera, group, sprite) {
  const sphere = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere())
  const radius = Math.max(sphere.radius, 1e-3) || 1
  const dist = (radius / Math.sin(camera.fov * Math.PI / 360)) * 1.12
  camera.position.copy(sphere.center).addScaledVector(sprite ? SPRITE_DIR : ISO_DIR, dist)
  camera.lookAt(sphere.center)
  return camera
}

/* 动画模型多帧采样：帧数与延迟（~10fps，2-8 帧封顶控制缓存体积）。
    周期 T 取所有动画贴图中最长 totalSec——各贴图按同一时间轴对齐取帧号，
    多贴图不同周期的组合在 T 上不一定各自整循环，但每帧视觉状态均为合法采样。
    采样时刻按「帧号组合签名」去重：低帧率动画（command_block 4 帧/2s）的相邻
    均匀采样点常落在同一视觉帧，重复帧不重复存储/轮播（delay = T/去重帧数，
    单贴图 frametime 均匀时保持精确时序；多贴图组合为近似平均） */
const ANIM_FPS = 10
const ANIM_MAX_FRAMES = 8

export function animFramePlan(anims) {
  if (!anims.length) return null
  const T = anims.reduce((m, a) => Math.max(m, a.anim.totalSec || 0.1), 0.1)
  const n = Math.min(ANIM_MAX_FRAMES, Math.max(2, Math.round(T * ANIM_FPS)))
  const seen = new Set()
  const ts = []
  for (let i = 0; i < n; i++) {
    const t = (i * T) / n
    const sig = anims.map(({ anim }) => animFrameIndexAt(anim, t)).join(',')
    if (seen.has(sig)) continue
    seen.add(sig)
    ts.push(t)
  }
  /* 全部采样点同一视觉帧（理论边界）：按静态处理 */
  if (ts.length < 2) return null
  return { T, n: ts.length, ts, delay: Math.max(50, Math.round(T / ts.length * 1000)) }
}

/* 渲染缩略图：静态模型单帧；动画模型沿时间轴采样 n 帧（每帧同步设置全部动画
    贴图的采样窗口后 render，替代旧「rAF 推进到的随机相位帧」）。complete 为
    贴图就绪标记（partial 渲染结果不进后端缓存） */
async function renderModelThumb(spec) {
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
function disposeGroupDeep(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose()
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])
    for (const m of mats) { if (!(m && m.userData && m.userData.shared)) m.dispose() }
  })
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts)
  const j = await res.json().catch(() => null)
  return (j && j.ok) ? j.data : null
}

/* 查询后端缓存 → 未命中则离屏渲染并上传；返回 { urls, delay }（静态单帧 delay=0），
    失败 null。贴图超时未就绪的「partial」渲染仅当次显示、不上传后端缓存——避免
    缺图灰面被 mtime 锁定为永久缓存；动画模型多帧（帧 0 = <md5>.png 兼容单帧路径） */
async function generateModelThumb(spec) {
  const key = spec.path
  const noCache = !!spec.noCache
  if (!noCache) {
    try {
      const info = await fetchJson('/api/asset/model-thumb-info?key=' + encodeURIComponent(key) + '&mtime=' + (spec.mtime || 0))
      if (info && info.exists && !info.stale && info.thumbUrl) {
        const n = Number(info.frameCount) || 1
        const urls = []
        for (let i = 0; i < n; i++) urls.push(info.thumbUrl + (i ? '&frame=' + i : ''))
        return { urls, delay: Number(info.frameDelay) || 0 }
      }
    } catch {}
  }
  let out
  try { out = await renderModelThumb(spec) }
  catch { return null }
  if (!out || !out.frames || !out.frames.length) return null
  if (!noCache && out.complete) {
    try {
      const saved = await fetchJson('/api/asset/model-thumb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key, mtime: spec.mtime || 0,
          frames: out.frames.map((dataUrl, i) => ({ dataUrl, delay: i ? 0 : out.delay })),
        }),
      })
      if (saved && saved.thumbUrl) {
        const n = out.frames.length
        const urls = []
        for (let i = 0; i < n; i++) urls.push(saved.thumbUrl + (i ? '&frame=' + i : ''))
        return { urls, delay: out.delay }
      }
    } catch {}
  }
  return { urls: out.frames, delay: out.complete ? out.delay : 0 }
}

/* 对外：确保某模型资产的缩略图就绪（带内存级去重）；返回 { urls, delay } | null
    （item.thumb 兼容设为帧 0 URL，其他 UI 引用单图）。
    不以 item.thumb 短路：favorites/recent 持久化恢复的 thumb 是旧渲染的单帧 URL，
    短路会导致 stale 缓存永不重新校验（旧坏图被锁定）且动画模型退化为静态单帧；
    改为始终走缓存校验 + 按需重渲染，失败时回退旧 thumb（不至于空白） */
export function ensureModelThumb(item) {
  const spec = item && item.modelThumb
  if (!spec || typeof spec.path !== 'string') return Promise.resolve(null)
  if (memCache.has(spec.path)) return Promise.resolve(memCache.get(spec.path))
  if (!generating.has(spec.path)) {
    generating.set(spec.path, generateModelThumb(spec).then(anim => {
      if (anim) { memCache.set(spec.path, anim); item.thumb = anim.urls[0] }
      else if (item.thumb) anim = { urls: [item.thumb], delay: 0 }
      generating.delete(spec.path)
      return anim
    }).catch(() => { generating.delete(spec.path); return null }))
  }
  return generating.get(spec.path)
}

/* 缩略图容器内挂 <img>；多帧（动画模型）定时轮换 src（img 脱离 DOM 自清，避免泄漏） */
function applyThumb(th, anim) {
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

function getIO() {
  if (io) return io
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      const item = watched.get(e.target)
      io.unobserve(e.target)
      if (item) {
        ensureModelThumb(item).then(anim => { if (anim) applyThumb(e.target, anim) }).catch(() => {})
      }
    }
  }, { rootMargin: '200px' })
  return io
}

/* 对外：扫描容器内携带 _modelThumbItem 引用的缩略图占位，进入视口后懒加载生成 */
export function observeModelThumbs(root) {
  if (!root || !root.querySelectorAll) return
  for (const th of root.querySelectorAll('.ac-thumb')) {
    const item = th._modelThumbItem
    if (!item || !item.modelThumb) continue
    if (th.querySelector('img')) continue
    watched.set(th, item)
    getIO().observe(th)
  }
}
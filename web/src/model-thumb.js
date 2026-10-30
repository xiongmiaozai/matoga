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
  resolveMcModelAsset,
  mcMatFor,
  bbMatFor,
  buildModelGroup,
  buildItemSpriteGroup,
  applyItemTransformation,
  fetchImportedModelFull,
  getModelTexAnims,
  applyTexAnimFrame,
  animFrameIndexAt
} from './mc-model-viewer.js'

const THUMB_SIZE = 240
const THUMB_DPR = 2 /* 高 DPI：drawing buffer 480×480，卡片高分屏不糊 */
const TEX_WAIT_TIMEOUT = 1200 /* 事件驱动等待（无轮询 CPU 开销），慢网络下放宽上限 */

const memCache = new Map() /* 虚拟路径 → thumbUrl */
const generating = new Map() /* 虚拟路径 → Promise<thumbUrl|null> */
const watched = new WeakMap() /* 缩略图容器元素 → item（rebuild 重建 DOM 后自动失效） */

let io = null
let observerMargin = 400
const observingTargets = new Set()

/* 多离屏 renderer 并发渲染：WebGL 上下文数有上限（典型 16），6 路兼顾吞吐与安全；
    每路独立 chain 串行（同一路内 task 复用同一 renderer canvas，避免上下文切换/状态污染），
    路间轮询分配 → 吞吐近线性提升至 RENDER_CONCURRENCY 倍；
    可由设置面板运行时调节（applyThumbPerf），扩容追加 renderer，缩容仅限新任务分配 */
let RENDER_CONCURRENCY = 6
const renderers = []
const renderChains = new Array(RENDER_CONCURRENCY).fill(null).map(() => Promise.resolve())
let nextRenderSlot = 0

function ensureRenderers(target) {
  const n = target || RENDER_CONCURRENCY
  while (renderers.length < n) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    r.setPixelRatio(THUMB_DPR)
    r.setClearColor(0x000000, 0)
    r.setSize(THUMB_SIZE, THUMB_SIZE)
    renderers.push(r)
  }
}

/* 收集 group 内所有材质的贴图就绪 promise（mc-model-viewer 材质工厂挂 userData.texReady；
    共享占位/隐藏材质无贴图跳过；无 promise 的材质视为就绪） */
function collectTexPromises(group) {
  const ps = []
  group.traverse(o => {
    if (!o.isMesh) return
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
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
  const all = Promise.all(ps).then(() => {
    allDone = true
  })
  await Promise.race([all, new Promise(r => setTimeout(r, timeout))])
  return allDone
}

/* 渲染临界区多路并发：task 接收专属 renderer 参数，按槽轮询分配；
    模型 fetch 与贴图等待在队列外并行进行（数百模型的批量生成下，慢网络/慢贴图不再阻塞后续渲染任务） */
function enqueueRender(task) {
  ensureRenderers()
  const slot = nextRenderSlot
  nextRenderSlot = (nextRenderSlot + 1) % RENDER_CONCURRENCY
  const r = renderers[slot]
  const p = renderChains[slot].then(() => task(r))
  renderChains[slot] = p.catch(() => {})
  return p
}

async function buildGroupFor(spec) {
  if (spec.kind === 'im') {
    const { json, texRoot } = await fetchImportedModelFull(spec.id)
    if (!json || !Array.isArray(json.elements) || !json.elements.length) throw new Error('empty model')
    const isBb = !!(json.meta && (json.meta.format === 'bbmodel' || json.meta.model_format))
    const matFor = isBb
      ? bbMatFor(json.textures, 'bbm:' + spec.id, false)
      : mcMatFor(
          json.textures && typeof json.textures === 'object' ? json.textures : {},
          undefined,
          undefined,
          texRoot || undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          false
        )
    const uvScale = isBb && Number.isFinite(+json.resolution) && +json.resolution > 0 ? +json.resolution : 16
    const group = buildModelGroup(json.elements, matFor, uvScale)
    if (!group.children.length) throw new Error('empty model group')
    return { group, sprite: false }
  }
  /* models/ 路径或 items/ 物品定义（1.21.4+）：统一经 resolveMcModelAsset，composite 多部件合并。
     支持贴图根分离：模型几何从 fileRoot 解析，贴图从 texRoot 加载，失败回退到 fileRoot */
  const texSource = spec.texRoot || spec.fileRoot
  const fbRoot = spec.texRoot ? spec.fileRoot : undefined
  const { parts } = await resolveMcModelAsset(spec.api, spec.packName, spec.rel, spec.fileRoot)
  const group = new THREE.Group()
  let sprite = true
  for (const part of parts) {
    let sub = null
    if (part.elements.length) {
      sub = buildModelGroup(
        part.elements,
        mcMatFor(part.textures, spec.api, spec.packName, texSource, fbRoot, undefined, part.tints, undefined, false),
        16
      )
      sprite = false
    } else {
      sub = buildItemSpriteGroup(part.textures, spec.api, spec.packName, texSource, fbRoot, false)
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
  const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.12
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
  return { T, n: ts.length, ts, delay: Math.max(50, Math.round((T / ts.length) * 1000)) }
}

/* 异步 PNG 编码：toBlob 在浏览器内部线程编码、不阻塞主线程（滚动/点击保持响应），
    再用 FileReader 转 dataURL 上传；toBlob 不可用时回退同步 toDataURL */
function canvasToDataURL(canvas) {
  return new Promise(resolve => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(canvas.toDataURL('image/png'))
      return
    }
    canvas.toBlob(blob => {
      if (!blob) {
        resolve(canvas.toDataURL('image/png'))
        return
      }
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result)
      fr.onerror = () => resolve(canvas.toDataURL('image/png'))
      fr.readAsDataURL(blob)
    }, 'image/png')
  })
}

/* 渲染缩略图：静态模型单帧；动画模型沿时间轴采样 n 帧（每帧同步设置全部动画
    贴图的采样窗口后 render，替代旧「rAF 推进到的随机相位帧」）。complete 为
    贴图就绪标记（partial 渲染结果不进后端缓存） */
async function renderModelThumb(spec) {
  const { group, sprite } = await buildGroupFor(spec)

  try {
    const complete = await waitForTextures(group)
    return await enqueueRender(async (r) => {
      const scene = new THREE.Scene()
      scene.add(group)
      const key = new THREE.DirectionalLight(0xffffff, 2.4)
      key.position.set(3, 5, 4)
      const fill = new THREE.DirectionalLight(0xbcd4ff, 0.9)
      fill.position.set(-4, 1.5, -3)
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
        frames.push(await canvasToDataURL(r.domElement))
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
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    for (const m of mats) {
      if (!(m && m.userData && m.userData.shared)) m.dispose()
    }
  })
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts)
  const j = await res.json().catch(() => null)
  return j && j.ok ? j.data : null
}

/* 查询后端缓存 → 未命中则离屏渲染并上传；返回 { urls, delay }（静态单帧 delay=0），
    失败 null。贴图超时未就绪的「partial」渲染仅当次显示、不上传后端缓存——避免
    缺图灰面被 mtime 锁定为永久缓存；动画模型多帧（帧 0 = <md5>.png 兼容单帧路径） */
/* in-flight 并发上限：限制同时进行 buildGroupFor（fetch 模型/parent 链/贴图）的数量，
    避免 IntersectionObserver 批量触发时数十并发 fetch 打满浏览器同源连接池（上限 6）；
    本地服务走 keep-alive 连接复用，调大可让更多模型并行准备、减少滚动排队等待；
    可由设置面板运行时调节（applyThumbPerf），新值对后续任务即时生效 */
let MAX_INFLIGHT = 16
let inflight = 0
const inflightQueue = []
function acquireInflight() {
  if (inflight < MAX_INFLIGHT) { inflight++; return Promise.resolve() }
  return new Promise(r => inflightQueue.push(r))
}
function releaseInflight() {
  if (inflightQueue.length) inflightQueue.shift()()
  else inflight--
}

async function generateModelThumb(spec) {
  await acquireInflight()
  try {
    const key = spec.path
    const noCache = !!spec.noCache
    if (!noCache) {
      try {
        const info = await fetchJson(
          '/api/asset/model-thumb-info?key=' + encodeURIComponent(key) + '&mtime=' + (spec.mtime || 0)
        )
        if (info && info.exists && !info.stale && info.thumbUrl) {
          const n = Number(info.frameCount) || 1
          const urls = []
          for (let i = 0; i < n; i++) urls.push(info.thumbUrl + (i ? '&frame=' + i : ''))
          return { urls, delay: Number(info.frameDelay) || 0 }
        }
      } catch {}
    }
    let out
    try {
      out = await renderModelThumb(spec)
    } catch {
      return null
    }
    if (!out || !out.frames || !out.frames.length) return null
    if (!noCache && out.complete) {
      try {
        const saved = await fetchJson('/api/asset/model-thumb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key,
            mtime: spec.mtime || 0,
            frames: out.frames.map((dataUrl, i) => ({ dataUrl, delay: i ? 0 : out.delay }))
          })
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
  } finally {
    releaseInflight()
  }
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
    generating.set(
      spec.path,
      generateModelThumb(spec)
        .then(anim => {
          if (anim) {
            memCache.set(spec.path, anim)
            item.thumb = anim.urls[0]
          } else if (item.thumb) anim = { urls: [item.thumb], delay: 0 }
          generating.delete(spec.path)
          return anim
        })
        .catch(() => {
          generating.delete(spec.path)
          return null
        })
    )
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
      if (!img.isConnected) {
        clearInterval(timer)
        return
      }
      i = (i + 1) % anim.urls.length
      img.src = anim.urls[i]
    }, anim.delay)
  }
}

function getIO() {
  if (io) return io
  io = new IntersectionObserver(
    entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const item = watched.get(e.target)
        io.unobserve(e.target)
        observingTargets.delete(e.target)
        if (item) {
          ensureModelThumb(item)
            .then(anim => {
              if (anim) applyThumb(e.target, anim)
            })
            .catch(() => {})
        }
      }
    },
    { rootMargin: observerMargin + 'px' }
  )
  return io
}

/* 重建 IntersectionObserver（rootMargin 变更后）：断开旧 observer，对尚未加载图片的
    占位元素用新 margin 重新 observe；已挂载 img 的跳过（避免重复生成） */
function rebuildIO() {
  if (!io) return
  io.disconnect()
  io = null
  for (const th of observingTargets) {
    if (th.querySelector('img')) continue
    getIO().observe(th)
  }
}

function clampInt(v, lo, hi, fallback) {
  const n = typeof v === 'number' ? v : parseInt(v, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

/* 运行时应用缩略图性能参数（来自 config-store，设置面板调用 + 启动时调用）：
    - thumbRenderConcurrency：扩容追加 renderer/chain，缩容仅限新任务分配到低槽位
    - thumbMaxInflight：直接赋值，对后续 acquireInflight 即时生效
    - thumbObserverMargin：变更后重建 IntersectionObserver */
export function applyThumbPerf(opts) {
  if (!opts) return
  const rc = clampInt(opts.thumbRenderConcurrency, 1, 16, RENDER_CONCURRENCY)
  const mi = clampInt(opts.thumbMaxInflight, 1, 64, MAX_INFLIGHT)
  const om = clampInt(opts.thumbObserverMargin, 0, 2000, observerMargin)
  if (rc !== RENDER_CONCURRENCY) {
    if (rc > renderers.length) ensureRenderers(rc)
    while (renderChains.length < rc) renderChains.push(Promise.resolve())
    RENDER_CONCURRENCY = rc
  }
  MAX_INFLIGHT = mi
  if (om !== observerMargin) {
    observerMargin = om
    rebuildIO()
  }
}

/* 对外：扫描容器内携带 _modelThumbItem 引用的缩略图占位，进入视口后懒加载生成 */
export function observeModelThumbs(root) {
  if (!root || !root.querySelectorAll) return
  for (const th of root.querySelectorAll('.ac-thumb')) {
    const item = th._modelThumbItem
    if (!item || !item.modelThumb) continue
    if (th.querySelector('img')) continue
    watched.set(th, item)
    observingTargets.add(th)
    getIO().observe(th)
  }
}
/* 后台空闲预热：在 requestIdleCallback 时间片内逐个为容器中尚未缓存的模型生成缩略图，
    命中后端缓存的秒过、未命中的渲染并存盘；不阻塞 UI、不抢 IntersectionObserver 的
    可见优先级。同一容器只预热一次（dataset 标记去重），showMore 等重渲染时新内容
    由 observeModelThumbs 处理、prefetch 由后续调用覆盖 */
export function prefetchModelThumbs(root) {
  if (!root || !root.querySelectorAll) return
  if (root.dataset && root.dataset.thumbPrefetched) return
  if (root.dataset) root.dataset.thumbPrefetched = '1'
  const items = []
  for (const th of root.querySelectorAll('.ac-thumb')) {
    const item = th._modelThumbItem
    if (item && item.modelThumb && !memCache.has(item.modelThumb.path)) items.push(item)
  }
  if (!items.length) return
  const schedule =
    typeof requestIdleCallback === 'function'
      ? fn => requestIdleCallback(fn, { timeout: 3000 })
      : fn => setTimeout(fn, 50)
  let i = 0
  const next = () => {
    if (i >= items.length) return
    const item = items[i++]
    ensureModelThumb(item).finally(() => schedule(next))
  }
  schedule(next)
}

/**
 * matoga - 模型缩略图缓存服务
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 模型资产是虚拟路径（packmodel:<source>:<pack>/<rel> / im:<id> / cm:<id>），无磁盘文件可 stat，
 * 与 thumb-service（真实文件路径 → data/thumbs/*.jpg）不同：键 = md5(虚拟路径)，
 * staleness 用前端传入的模型源 mtime（/api/asset/model 与 imported listModels 已返回）
 * 与 sidecar <md5>.json 中记录的 mtime 对比。
 *
 * 动画模型多帧：POST 可带 frames 数组（帧 0 写 <md5>.png 保持单帧路径兼容，
 * 帧 i≥1 写 <md5>.f<i>.png）；sidecar 记录 frameCount / frameDelay，
 * GET /api/asset/model-thumb?key=&frame=i 取对应帧，前端定时轮换播放。
 *
 * 渲染器版本（RENDERER_VERSION）：前端渲染算法修正后，旧缓存即使 mtime 不变也
 * 判定 stale 强制重渲染：
 *   v1 — face 无 uv 时整张贴图拉伸（蛋糕等 vanilla 模型渲染错误）
 *   v2 — face 无 uv 按 vanilla 规则计算默认 UV（mc-model-viewer defaultFaceUv）
 *   v3 — 贴图就绪事件驱动等待（旧 700ms 轮询超时按缺图渲染并缓存半成品）；
 *        包围球自动取景（旧 maxDim×2.05 经验值：细长模型溢出、立方体对角裁切）；
 *        2x DPI（480×480）输出
 *   v4 — 动画模型多帧缩略图（旧算法为 rAF 随机相位单帧快照）；parent 断链回退
 *        内置 vanilla 基类（cube / cube_all / cube_bottom_top / block / generated / handheld）
 *   v5 — 等轴测视角对齐 vanilla GUI（north 面可见：方向性方块 front 特色面朝向
 *        观察者）；textures 沿 parent 链改为原始表合并（command_block 等子层 side
 *        键不再覆盖父层显式方向键，front/back 贴图不再丢失）
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_ROOT } = require('../paths')

const MODEL_THUMB_DIR = path.join(DATA_ROOT, 'data', 'model-thumbs')
/* 缩略图按模型类型分离专属子目录：导入模型 / 自定义模型 / 材质包内模型
   各自独立缓存，互不共用（key 前缀 → 目录）。misc 为兜底（未知前缀）。 */
const THUMB_KIND_DIRS = {
  imported: path.join(MODEL_THUMB_DIR, 'imported'),
  custom: path.join(MODEL_THUMB_DIR, 'custom'),
  mc: path.join(MODEL_THUMB_DIR, 'mc'),
  misc: MODEL_THUMB_DIR,
}
const MAX_DATA_URL = 5 * 1024 * 1024
const MAX_FRAMES = 8
const RENDERER_VERSION = 5

function kindFor(key) {
  const s = String(key || '')

  if (s.startsWith('im:')) return 'imported'
  if (s.startsWith('cm:')) return 'custom'
  if (s.startsWith('packmodel:')) return 'mc'
  return 'misc'
}

function dirFor(key) {
  return THUMB_KIND_DIRS[kindFor(key)] || MODEL_THUMB_DIR
}

function hashFor(key) {
  return crypto.createHash('md5').update(String(key)).digest('hex')
}

function pngPathFor(key, frame = 0) {
  const h = hashFor(key)
  const d = dirFor(key)
  return frame > 0 ? path.join(d, `${h}.f${frame}.png`) : path.join(d, h + '.png')
}

function metaPathFor(key) {
  return path.join(dirFor(key), hashFor(key) + '.json')
}

function parseFrameParam(v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n < MAX_FRAMES ? Math.floor(n) : 0
}

/* 查询缓存：exists = png + sidecar 均存在（多帧以帧 0 为准）；
    stale = 缓存 mtime 早于当前源 mtime，或缓存渲染器版本落后（渲染算法升级后旧图失效）。
    frameCount / frameDelay 供前端轮播（单帧为 1 / 0） */
async function thumbInfo(key, mtime) {
  const png = pngPathFor(key), meta = metaPathFor(key)
  let exists = false, stale = true, cachedMtime = 0, frameCount = 1, frameDelay = 0
  try {
    const raw = await fs.promises.readFile(meta, 'utf8')
    const j = JSON.parse(raw)
    cachedMtime = Number(j && j.mtime) || 0
    await fs.promises.access(png)
    exists = true
    const outdated = !j || typeof j.renderer !== 'number' || j.renderer < RENDERER_VERSION
    stale = outdated || cachedMtime < (Number(mtime) || 0)
    if (Number.isFinite(j && j.frameCount) && j.frameCount > 1) frameCount = Math.min(MAX_FRAMES, Math.floor(j.frameCount))
    if (Number.isFinite(j && j.frameDelay) && j.frameDelay > 0) frameDelay = Math.floor(j.frameDelay)
  } catch {}
  const thumbUrl = '/api/asset/model-thumb?key=' + encodeURIComponent(key)
  return { exists, stale, cachedMtime, renderer: RENDERER_VERSION, frameCount, frameDelay, thumbUrl }
}

/* 保存：单帧 { dataUrl } 或多帧 { frames: [{ dataUrl, delay }] }（帧 0 的 delay 为
    整组帧间隔 ms）。帧数多于旧缓存时补写、少于时清多余旧帧文件 */
async function saveThumb(key, mtime, payload) {
  if (typeof payload === 'string') payload = { dataUrl: payload }
  if (!payload || typeof payload !== 'object') return { success: false, error: 'invalid payload' }
  const frames = Array.isArray(payload.frames) && payload.frames.length
    ? payload.frames.slice(0, MAX_FRAMES)
    : [{ dataUrl: payload.dataUrl, delay: 0 }]
  if (!frames.length) return { success: false, error: 'invalid payload' }
  const items = []
  for (const f of frames) {
    if (typeof f.dataUrl !== 'string' || !f.dataUrl.startsWith('data:image/')) {
      return { success: false, error: 'invalid dataUrl' }
    }
    const base64 = f.dataUrl.slice(f.dataUrl.indexOf(',') + 1)
    if (!base64 || base64.length > MAX_DATA_URL) return { success: false, error: 'invalid thumb data' }
    items.push(base64)
  }
  const frameDelay = Math.max(0, Math.floor(Number(frames[0] && frames[0].delay) || 0))
  await fs.promises.mkdir(dirFor(key), { recursive: true })
  /* 帧数减少时清除多余旧帧（sidecar 先读后写，读失败视为单帧旧缓存） */
  try {
    const oldMeta = JSON.parse(await fs.promises.readFile(metaPathFor(key), 'utf8'))
    const oldCount = Math.min(MAX_FRAMES, Number(oldMeta && oldMeta.frameCount) || 1)
    for (let i = oldCount - 1; i >= frames.length; i--) {
      if (i > 0) await fs.promises.unlink(pngPathFor(key, i)).catch(() => {})
    }
  } catch {}
  const writes = items.map((base64, i) => fs.promises.writeFile(pngPathFor(key, i), Buffer.from(base64, 'base64')))
  writes.push(fs.promises.writeFile(metaPathFor(key), JSON.stringify({
    mtime: Number(mtime) || 0, renderer: RENDERER_VERSION,
    frameCount: frames.length, frameDelay,
  })))
  await Promise.all(writes)
  const thumbUrl = '/api/asset/model-thumb?key=' + encodeURIComponent(key)
  return { success: true, thumbUrl, frameCount: frames.length, frameDelay }
}

async function sendThumb(res, key, frame = 0) {
  const png = pngPathFor(key, parseFrameParam(frame))
  await fs.promises.access(png)
  res.sendFile(png, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ ok: false, code: 'ERR_FS_NOT_FOUND', msg: 'model thumb not generated yet' })
    }
  })
}

function invalidate(key) {
  if (!key) return
  try {
    for (let i = 0; i < MAX_FRAMES; i++) fs.promises.unlink(pngPathFor(key, i)).catch(() => {})
    fs.promises.unlink(metaPathFor(key)).catch(() => {})
  } catch {}
}

module.exports = { thumbInfo, saveThumb, sendThumb, invalidate, pngPathFor, metaPathFor, kindFor, dirFor, MODEL_THUMB_DIR, THUMB_KIND_DIRS, RENDERER_VERSION }
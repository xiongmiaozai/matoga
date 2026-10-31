/**
 * matoga - MC 模型：几何与动画工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：item 变换矩阵应用、贴图动画元数据解析、动画帧索引、官方包定位。
 */

import { fetchOkData } from '../mcv/paths.js'

/* 常量由主文件注入（文档 §5.1：常量不搬，避免主文件引用消失） */
let _get_TICKS_PER_SEC = () => undefined

export function setHooks(h) {
  if (h.get_TICKS_PER_SEC) _get_TICKS_PER_SEC = h.get_TICKS_PER_SEC
}

export function applyItemTransformation(group, tr) {
  if (!group || !tr || typeof tr !== 'object') return group
  const t = Array.isArray(tr.translation) ? tr.translation : null
  if (t && t.length >= 3 && t.every(n => Number.isFinite(+n))) {
    group.position.set(+t[0], +t[1], +t[2])
  }
  const toQuat = q => {
    if (!Array.isArray(q) || q.length < 4 || !q.every(n => Number.isFinite(+n))) return null
    return new THREE.Quaternion(+q[0], +q[1], +q[2], +q[3]).normalize()
  }
  const lq = toQuat(tr.left_rotation)
  if (lq) group.quaternion.copy(lq)
  const s = Array.isArray(tr.scale) ? tr.scale : null
  const rq = toQuat(tr.right_rotation)
  if (s && s.length >= 3 && s.every(n => Number.isFinite(+n))) {
    group.scale.set(+s[0], +s[1], +s[2])
    if (rq) {
      const inner = new THREE.Group()
      inner.quaternion.copy(rq)
      for (const c of [...group.children]) inner.add(c)
      group.add(inner)
    }
    if (+s[0] < 0 || +s[1] < 0 || +s[2] < 0) {
      group.traverse(o => {
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
        for (const m of mats) {
          if (m && !(m.userData && m.userData.shared)) m.side = THREE.DoubleSide
        }
      })
    }
  }
  return group
}

export function getOfficialPack() {
  if (officialPackCache) return Promise.resolve(officialPackCache)
  if (officialPackLoading) return officialPackLoading
  officialPackLoading = fetchOkData('/api/mc-official/list')
    .then(data => {
      const packs = Array.isArray(data) ? data : (data && data.packs) || []
      officialPackCache = packs.length && packs[0].name ? { api: '/api/mc-official', packName: packs[0].name } : null
      officialPackLoading = null
      return officialPackCache
    })
    .catch(() => {
      officialPackCache = null
      officialPackLoading = null
      return null
    })
  return officialPackLoading
}

export function parseAnimMeta(meta, texW, texH) {
  const anim = meta && typeof meta === 'object' ? meta.animation : null
  if (!anim || typeof anim !== 'object') return null
  const w = Number.isFinite(+texW) ? +texW : 0
  const h = Number.isFinite(+texH) ? +texH : 0
  if (w <= 0 || h <= 0) return null
  const fw = Number.isFinite(+anim.width) && +anim.width > 0 ? Math.floor(+anim.width) : w
  const fh = Number.isFinite(+anim.height) && +anim.height > 0 ? Math.floor(+anim.height) : fw
  if (fw <= 0 || fh <= 0 || fw > w || fh > h) return null
  const frameCount = Math.floor(h / fh)
  if (frameCount <= 1) return null
  const defaultTicks = Math.max(1, Math.round(Number.isFinite(+anim.frametime) ? +anim.frametime : 1))
  const timeline = []
  if (Array.isArray(anim.frames)) {
    for (const f of anim.frames) {
      let index = -1,
        ticks = defaultTicks
      if (typeof f === 'number' && Number.isFinite(f)) index = Math.floor(f)
      else if (f && typeof f === 'object' && Number.isFinite(+f.index)) {
        index = Math.floor(+f.index)
        if (Number.isFinite(+f.time) && +f.time > 0) ticks = Math.max(1, Math.round(+f.time))
      }
      if (index < 0 || index >= frameCount) continue
      timeline.push({ index, ticks })
    }
  }
  if (!timeline.length) for (let i = 0; i < frameCount; i++) timeline.push({ index: i, ticks: defaultTicks })
  const totalTicks = timeline.reduce((s, f) => s + f.ticks, 0)
  return { texW: w, texH: h, frameW: fw, frameH: fh, frameCount, timeline, totalSec: totalTicks / _get_TICKS_PER_SEC() }
}

export function animFrameIndexAt(anim, tSec) {
  const tl = anim && anim.timeline
  if (!tl || !tl.length) return 0
  const totalSec = anim.totalSec
  const t = totalSec > 0 ? tSec % totalSec : 0
  const tick = Math.max(0, Math.floor(t * _get_TICKS_PER_SEC()))
  let acc = 0
  for (const f of tl) {
    acc += f.ticks
    if (tick < acc) return f.index
  }
  return tl[tl.length - 1].index
}

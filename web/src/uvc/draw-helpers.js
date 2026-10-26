/**
 * matoga - UV 编辑器绘制辅助
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出，逻辑未改；ctx 改为显式参数。
 */

/** 棋盘格底（贴图缺失/透明区域用） */
export function drawCheckerboard(ctx, W, H, size) {
  const s = Math.max(4, size)
  ctx.fillStyle = '#3a3a44'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#2e2e36'
  for (let y = 0; y < H; y += s) {
    for (let x = ((y / s) % 2) * s; x < W; x += s * 2) {
      ctx.fillRect(x, y, Math.min(s, W - x), Math.min(s, H - y))
    }
  }
}

/** 贴图缺失标识（红底斜线） */
export function drawMissing(ctx, W, H) {
  ctx.fillStyle = 'rgba(120,32,32,.25)'
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = 'rgba(230,74,74,.5)'
  ctx.lineWidth = 2
  ctx.beginPath()
  const step = Math.max(12, W / 8)
  for (let p = -H; p < W; p += step) {
    ctx.moveTo(p, 0); ctx.lineTo(p + H, H)
  }
  ctx.stroke()
}

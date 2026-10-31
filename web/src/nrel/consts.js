/**
 * matoga - 节点关系窗口：consts
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 node-rel.js 按职责搬出，逻辑未改。
 */
export const NS = 'http://www.w3.org/2000/svg'

/* ── 布局度量 ─────────────────────────────── */
export const M = {
  nodeW: 176,
  nodeH: 40,
  rowGap: 12,
  colGap: 72,
  rootGap: 36,
  pad: 28
}
export const ROW = M.nodeH + M.rowGap
export const COL = M.nodeW + M.colGap

export function viewEl() {
  return document.getElementById('nodeRelView')
}

/* ── SVG 渲染 ────────────────────────────── */
export function el(tag, attrs) {
  const e = document.createElementNS(NS, tag)
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k])
  return e
}
export function trunc(s, n) {
  const arr = Array.from(s || '')
  return arr.length <= n ? s || '' : arr.slice(0, n - 1).join('') + '…'
}

export function cssEsc(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"')
}

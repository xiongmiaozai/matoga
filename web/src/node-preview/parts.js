/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

export function viewEl(){ return document.getElementById('nodePreviewView') }

/* ── 工具 ───────────────────────────────── */
export function truncStr(v, n){
  const s = String(v)
  const arr = Array.from(s)
  return arr.length <= n ? s : arr.slice(0, n - 1).join('') + '…'
}
export function fmtVal(v){
  if (typeof v === 'number') return (Math.round(v * 1e4) / 1e4).toString()
  if (Array.isArray(v)) return '[' + v.map(fmtVal).join(', ') + ']'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return truncStr(v, 48)
}
export function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))
}

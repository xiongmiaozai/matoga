/**
 * matoga - node canvas status
 * Copyright (c) 2026 芝世 (xiongmiaozai). MIT
 *
 * Status counters, graph-changed notification, and the transient toast.
 * The dirty-flag callback is injected by the editor via `setStatusHooks`.
 */

import { $ } from '../core.js'
import { state } from './state.js'
import { updateMinimap } from './viewport.js'

let _markDirty = () => {}

/** Inject the editor's dirty-flag setter. */
export function setStatusHooks({ markDirty }) {
  if (typeof markDirty === 'function') _markDirty = markDirty
}

/* ── 状态/Toast ─────────────────────────────── */
export function updateStats(){
  const nodesEl = $('#stat-nodes');
  const edgesEl = $('#stat-edges');
  if (nodesEl) nodesEl.textContent = state.nodes.size;
  if (edgesEl) edgesEl.textContent = state.edges.size;
  _notifyGraphChanged();
  updateMinimap();
}
export function _notifyGraphChanged(){
  _markDirty();
  try{ document.dispatchEvent(new CustomEvent('nodegraph:changed')); }catch(e){}
}
let toastTimer=null;
export function toast(msg){
  const t=$('#toast');
  if(!t) return;               // 无 toast 元素（无头/未挂载）时静默跳过
  t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'), 2000);
}

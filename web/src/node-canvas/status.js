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
  $('#stat-nodes').textContent = state.nodes.size;
  $('#stat-edges').textContent = state.edges.size;
  _notifyGraphChanged();
  updateMinimap();
}
export function _notifyGraphChanged(){
  _markDirty();
  try{ document.dispatchEvent(new CustomEvent('nodegraph:changed')); }catch(e){}
}
let toastTimer=null;
export function toast(msg){
  const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'), 2000);
}

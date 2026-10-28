/**
 * matoga - 节点项目：自动保存与脏标记
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 project.js 按职责搬出，逻辑未改。
 */
import { state } from '../state.js'
import { S } from './state.js'
import { saveNodeProject } from '../project.js'

export const AUTOSAVE_DELAY = 2500;






export function _graphSignature(){
  const nodes = [];
  state.nodes.forEach(n=>{
    nodes.push([n.id, n.type, Math.round(n.x), Math.round(n.y), n.title||null, !!n.collapsed, JSON.stringify(n.props)]);
  });
  const edges = [];
  state.edges.forEach(e=>{
    edges.push([e.id, e.from.node, e.from.port, e.to.node, e.to.port]);
  });
  return JSON.stringify([nodes, edges]);
}

export function _updateProjectIndicator(){
  const badge = document.getElementById('ncProject');
  const stat = document.getElementById('stat-project');
  const name = S.currentProject ? S.currentProject.name : null;
  if(badge){
    const nm = badge.querySelector('.nc-project-name');
    if(nm) nm.textContent = name ? name : '未关联项目';
    badge.classList.toggle('linked', !!name);
    badge.classList.toggle('dirty', !!name && S.dirty);
    badge.title = name
      ? `当前节点项目：${name}（${S.currentProject.id}）· ${S.dirty ? '有未保存更改' : '已保存'}`
      : '当前节点项目：未关联（Ctrl+S 保存后自动关联）';
  }
  if(stat){
    stat.textContent = name ? name : '—';
    stat.parentElement && (stat.parentElement.title = name
      ? `当前打开的节点项目：${name}` : '未关联节点项目');
  }
}

export function _setAutoSaveState(kind, text){
  const seg = document.getElementById('seg-autosave');
  const b = document.getElementById('stat-autosave');
  if(b) b.textContent = text;
  if(seg){
    seg.classList.remove('saving','saved','error');
    if(kind) seg.classList.add(kind);
  }
}

export function markDirty(){
  if(S.suspendAutoSave) return;
  if(!S.dirty){ S.dirty = true; _updateProjectIndicator(); }
  if(!S.currentProject) return;
  if(S.autoSaveTimer) clearTimeout(S.autoSaveTimer);
  S.autoSaveTimer = setTimeout(()=>{ S.autoSaveTimer=null; _autoSave(); }, AUTOSAVE_DELAY);
}

export function resetSavedState(){
  S.dirty = false;
  if(S.autoSaveTimer){ clearTimeout(S.autoSaveTimer); S.autoSaveTimer = null; }
  try { S.lastSavedSig = state.nodes.size ? _graphSignature() : null; } catch(e){ S.lastSavedSig = null; }
  if(S.currentProject) _setAutoSaveState('saved', '已就绪');
  else _setAutoSaveState(null, '—');
  _updateProjectIndicator();
}

export async function _autoSave(force, opts){
  if(!S.currentProject || !S.dirty || S.saving || S.suspendAutoSave) return;
  if(state.nodes.size === 0) return;
  let sig = null;
  try { sig = _graphSignature(); } catch(e){}
  if(sig !== null && sig === S.lastSavedSig){
    S.dirty = false;
    _setAutoSaveState('saved', '已保存');
    _updateProjectIndicator();
    return;
  }
  S.saving = true;
  _setAutoSaveState('saving', '自动保存中…');
  _updateProjectIndicator();
  const proj = { ..._currentProject };
  try {
    await saveNodeProject(proj.name, proj.id, { keepalive: !!(opts && opts.keepalive) });
    if(S.currentProject && S.currentProject.id === proj.id){
      S.dirty = false;
      S.lastSavedSig = sig;
      const t = new Date();
      const hh = String(t.getHours()).padStart(2,'0');
      const mm = String(t.getMinutes()).padStart(2,'0');
      const ss = String(t.getSeconds()).padStart(2,'0');
      _setAutoSaveState('saved', `已保存 ${hh}:${mm}:${ss}`);
    }
  } catch(e){
    if(S.currentProject && S.currentProject.id === proj.id){
      _setAutoSaveState('error', '失败·稍后重试');
      if(S.autoSaveTimer) clearTimeout(S.autoSaveTimer);
      S.autoSaveTimer = setTimeout(()=>{ S.autoSaveTimer=null; _autoSave(); }, 10000);
    }
  } finally {
    S.saving = false;
    _updateProjectIndicator();
  }
}

document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'hidden' && S.currentProject && S.dirty) _autoSave(true);
});
window.addEventListener('beforeunload', (e)=>{
  if(S.currentProject && S.dirty && state.nodes.size > 0){
    _autoSave(true, { keepalive: true });
    e.preventDefault();
    e.returnValue = '';
  }
});


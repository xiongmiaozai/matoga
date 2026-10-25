/**
 * matoga - node canvas undo / redo history
 * Copyright (c) 2026 芝世 (xiongmiaozai). MIT
 *
 * Snapshot-based history stack. A snapshot captures every node (position,
 * props, title, collapsed) and every edge; restore rebuilds the graph in
 * place and re-runs evaluation.
 *
 * The editor injects the pieces that live in node-canvas.js (renderNode /
 * renderEdges / updateStats / evaluate / toast) via `setHistoryHooks`.
 */

import { state } from './state.js'

let _hooks = {
  renderNode: () => {},
  renderEdges: () => {},
  updateStats: () => {},
  evaluate: () => {},
  toast: () => {},
}

/** Inject editor callbacks. */
export function setHistoryHooks(hooks) { _hooks = Object.assign(_hooks, hooks) }

const renderNode = (...a) => _hooks.renderNode(...a)
const renderEdges = (...a) => _hooks.renderEdges(...a)
const updateStats = (...a) => _hooks.updateStats(...a)
const evaluate = (...a) => _hooks.evaluate(...a)
const toast = (...a) => _hooks.toast(...a)

export const _history = { undo: [], redo: [], max: 60, suspend: false };
function _snapshot(){
  const nodes = [];
  state.nodes.forEach((n)=>{
    nodes.push({id:n.id, type:n.type, x:n.x, y:n.y, props:JSON.parse(JSON.stringify(n.props)), title:n.title||null, collapsed:!!n.collapsed});
  });
  const edges = [];
  state.edges.forEach((e)=>{
    edges.push({id:e.id, from:{node:e.from.node,port:e.from.port}, to:{node:e.to.node,port:e.to.port}});
  });
  return {nodes, edges};
}
export function _restore(snap){
  state.nodes.forEach(n=>{ if(n.el) n.el.remove(); });
  state.nodes.clear();
  state.edges.clear();
  state.selected.clear();
  state.selectedEdge = null;
  snap.nodes.forEach(nd=>{
    const node = {id:nd.id, type:nd.type, x:nd.x, y:nd.y, props:nd.props, title:nd.title||null, collapsed:!!nd.collapsed, el:null};
    state.nodes.set(nd.id, node);
    renderNode(node);
  });
  snap.edges.forEach(ed=>{
    state.edges.set(ed.id, {id:ed.id, from:ed.from, to:ed.to});
  });
  renderEdges();
  updateStats();
  evaluate();
}
export function pushHistory(){
  if(_history.suspend) return;
  _history.undo.push(_snapshot());
  if(_history.undo.length > _history.max) _history.undo.shift();
  _history.redo = [];
}
export function undo(){
  if(_history.undo.length === 0){ toast('无可撤销操作'); return; }
  _history.redo.push(_snapshot());
  const snap = _history.undo.pop();
  _history.suspend = true;
  _restore(snap);
  _history.suspend = false;
  toast('撤销');
}
export function redo(){
  if(_history.redo.length === 0){ toast('无可重做操作'); return; }
  _history.undo.push(_snapshot());
  const snap = _history.redo.pop();
  _history.suspend = true;
  _restore(snap);
  _history.suspend = false;
  toast('重做');
}

/**
 * matoga - node canvas edges
 * Copyright (c) 2026 芝世 (xiongmiaozai). MIT
 *
 * Edge drawing: drag-to-connect gesture, SVG path rendering, hit areas,
 * selection and double-click removal.
 *
 * Everything the module needs from the editor (evaluate / pushHistory /
 * selectEdge / canConnect + the pure path helpers) arrives through
 * `setEdgeHooks`, so this module never imports the editor back.
 */

import { $ } from '../core.js'
import { state } from './state.js'
import { canvasWrap, screenToWorld, updateMinimap } from './viewport.js'

const NS = 'http://www.w3.org/2000/svg'

let _hooks = {
  typeColor: () => '#888',
  edgePath: () => '',
  selectEdge: () => {},
  canConnect: () => false,
  evaluate: () => {},
  pushHistory: () => {},
}

/** Inject editor helpers (typeColor / edgePath / selectEdge / canConnect / evaluate / pushHistory). */
export function setEdgeHooks(hooks) {
  _hooks = Object.assign(_hooks, hooks)
}

const typeColor = (...a) => _hooks.typeColor(...a)
const edgePath = (...a) => _hooks.edgePath(...a)
const selectEdge = (...a) => _hooks.selectEdge(...a)
const canConnect = (...a) => _hooks.canConnect(...a)
const evaluate = (...a) => _hooks.evaluate(...a)
const pushHistory = (...a) => _hooks.pushHistory(...a)

export const edgesSvg = $('#edges');
export function startEdge(portEl, e){
  const dir = portEl.dataset.dir;
  const node = portEl.dataset.node;
  const port = portEl.dataset.port;
  const dataType = portEl.dataset.type;
  const startWorld = portCenterWorld(portEl);
  state.dragging = {
    kind:'edge', dir, node, port, dataType, startWorld,
    portEl,
  };
  portEl.classList.add('active');
  canvasWrap.classList.add('connecting');
  const targetDir = dir==='out' ? 'in' : 'out';
  document.querySelectorAll('.port').forEach(p=>{
    if(p===portEl) return;
    if(p.dataset.dir===targetDir){
      if(canConnect(dataType, p.dataset.type)) p.classList.add('compat');
      else p.classList.add('incompat');
    }
  });
}
function portCenterWorld(portEl){
  const r = portEl.getBoundingClientRect();
  const cx = r.left + r.width/2, cy = r.top + r.height/2;
  return screenToWorld(cx, cy);
}
export function renderEdges(){
  // 画布层尚未挂载（如无头环境或提前调用）时直接跳过，不让初始化中断
  if (!edgesSvg) return;
  // 清空（保留 defs）
  const defs = edgesSvg.querySelector('defs');
  edgesSvg.innerHTML='';
  if (defs) edgesSvg.appendChild(defs);
  state.edges.forEach((e,id)=>{
    const fromN = state.nodes.get(e.from.node);
    const toN = state.nodes.get(e.to.node);
    if(!fromN||!toN) return;
    const fromEl = fromN.el.querySelector(`.port.out[data-port="${e.from.port}"]`);
    const toEl = toN.el.querySelector(`.port.in[data-port="${e.to.port}"]`);
    if(!fromEl||!toEl) return;
    const a = portCenterWorld(fromEl);
    const b = portCenterWorld(toEl);
    const color = typeColor(fromEl.dataset.type);
    // hit
    const hit = document.createElementNS(NS,'path');
    hit.setAttribute('class','edge-hit');
    hit.setAttribute('d', edgePath(a,b));
    hit.dataset.id = id;
    hit.addEventListener('pointerdown', (ev)=>{ev.stopPropagation(); selectEdge(id);});
    hit.addEventListener('dblclick', (ev)=>{ev.stopPropagation(); pushHistory(); state.edges.delete(id); state.selectedEdge=null; renderEdges(); updateStats(); evaluate();});
    edgesSvg.appendChild(hit);
    // visible
    const path = document.createElementNS(NS,'path');
    path.setAttribute('class','edge');
    path.setAttribute('d', edgePath(a,b));
    path.setAttribute('stroke', color);
    path.dataset.id = id;
    if(state.selectedEdge===id) path.classList.add('selected');
    path.addEventListener('pointerdown', (ev)=>{ev.stopPropagation(); selectEdge(id);});
    path.addEventListener('dblclick', (ev)=>{ev.stopPropagation(); pushHistory(); state.edges.delete(id); state.selectedEdge=null; renderEdges(); updateStats(); evaluate();});
    edgesSvg.appendChild(path);
  });
  // 清理并重新标记 linked
  document.querySelectorAll('.port.linked').forEach(p=>p.classList.remove('linked'));
  state.edges.forEach(e=>{
    const fN=state.nodes.get(e.from.node), tN=state.nodes.get(e.to.node);
    if(!fN||!tN) return;
    const f=fN.el.querySelector(`.port.out[data-port="${e.from.port}"]`);
    const t=tN.el.querySelector(`.port.in[data-port="${e.to.port}"]`);
    if(f) f.classList.add('linked');
    if(t) t.classList.add('linked');
  });
  updateMinimap();
}

/* ── 拖拽对齐辅助线 + 连线几何/类型校验 ─────────── */
/* 从 node-canvas.js 原样搬出，逻辑未改。
   本模块提供 edges.js 需要的 typeColor / edgePath / selectEdge / canConnect
   （主文件仍用 setEdgeHooks 注入，避免与 edges.js 形成求值期环）。 */
import { state } from './state.js'
import { NODE_DEFS } from './defs.js'
import { canvasWrap } from './viewport.js'
import { refreshSelection } from './nodes.js'
import { toast, updateStats } from './status.js'
import { pushHistory } from './history.js'
import { edgesSvg, renderEdges } from './edges.js'
import { evaluate } from './evaluate.js'

export function _showAlignGuide(orient, worldPos){
  const g = document.createElement('div');
  g.className = 'nc-align-guide ' + orient;
  const {x:vx, y:vy, zoom} = state.viewport;
  if(orient === 'v'){
    g.style.left = (worldPos*zoom + vx) + 'px';
    g.style.top = '0'; g.style.height = '100%';
  } else {
    g.style.top = (worldPos*zoom + vy) + 'px';
    g.style.left = '0'; g.style.width = '100%';
  }
  canvasWrap.appendChild(g);
}
export function _clearAlignGuides(){
  canvasWrap.querySelectorAll('.nc-align-guide').forEach(g=>g.remove());
}
export function _alignGuides(d){
  _clearAlignGuides();
  if(!d.moving || d.moving.size !== 1) return;
  const id = [...d.moving][0];
  const n = state.nodes.get(id);
  if(!n || !n.el) return;
  const zoom = state.viewport.zoom;
  const thr = 6 / zoom;
  const w = n.el.offsetWidth || 200, h = n.el.offsetHeight || 60;
  const myXs = [n.x, n.x + w, n.x + w/2];
  const myYs = [n.y, n.y + h, n.y + h/2];
  const offs = [0, w, w/2], offsY = [0, h, h/2];
  let bestX = null, bestXDiff = thr, bestXi = 0;
  let bestY = null, bestYDiff = thr, bestYi = 0;
  state.nodes.forEach((other, oid)=>{
    if(oid === id || !other.el) return;
    const ow = other.el.offsetWidth || 200, oh = other.el.offsetHeight || 60;
    const oXs = [other.x, other.x + ow, other.x + ow/2];
    const oYs = [other.y, other.y + oh, other.y + oh/2];
    myXs.forEach((mx, mi)=> oXs.forEach(ox=>{
      const diff = Math.abs(mx - ox);
      if(diff < bestXDiff){ bestXDiff = diff; bestX = ox; bestXi = mi; }
    }));
    myYs.forEach((my, mi)=> oYs.forEach(oy=>{
      const diff = Math.abs(my - oy);
      if(diff < bestYDiff){ bestYDiff = diff; bestY = oy; bestYi = mi; }
    }));
  });
  if(bestX !== null){
    n.x = bestX - offs[bestXi]; n.el.style.left = n.x + 'px';
    _showAlignGuide('v', bestX);
  }
  if(bestY !== null){
    n.y = bestY - offsY[bestYi]; n.el.style.top = n.y + 'px';
    _showAlignGuide('h', bestY);
  }
}
export function typeColor(t){
  return {number:'#7cbd56',color:'#c084fc',texture:'#f5a623',material:'#5bcefa',
    environment:'#f5a623',any:'#9a9a9a',vector:'#e8e8e8'}[t]||'#9a9a9a';
}
export function edgePath(a,b){
  const dx = Math.max(40, Math.abs(b.x-a.x)*0.5);
  return `M ${a.x} ${a.y} C ${a.x+dx} ${a.y}, ${b.x-dx} ${b.y}, ${b.x} ${b.y}`;
}
export function selectEdge(id){
  state.selected.clear();
  state.selectedEdge = id;
  refreshSelection();
}
export function canConnect(fromType, toType){
  if(fromType==='any'||toType==='any') return true;
  return fromType===toType;
}
export function finishEdge(endPortEl){
  const d = state.dragging;
  if(!d||d.kind!=='edge') return;
  const endDir = endPortEl.dataset.dir;
  // 必须 out -> in
  let from, to;
  if(d.dir==='out' && endDir==='in'){
    from = {node:d.node, port:d.port};
    to = {node:endPortEl.dataset.node, port:endPortEl.dataset.port};
  } else if(d.dir==='in' && endDir==='out'){
    from = {node:endPortEl.dataset.node, port:endPortEl.dataset.port};
    to = {node:d.node, port:d.port};
  } else { cleanupEdgeDrag(); return; }
  // 类型检查
  const fromDef = NODE_DEFS[state.nodes.get(from.node).type];
  const toDef = NODE_DEFS[state.nodes.get(to.node).type];
  const fromP = fromDef.outputs.find(p=>p.n===from.port);
  const toP = toDef.inputs.find(p=>p.n===to.port);
  if(!fromP||!toP){ cleanupEdgeDrag(); return; }
  if(!canConnect(fromP.t, toP.t)){ toast('类型不匹配: '+fromP.t+' → '+toP.t); cleanupEdgeDrag(); return; }
  // 防止重复连接到同一输入
  for(const [eid,e] of state.edges){
    if(e.to.node===to.node && e.to.port===to.port) state.edges.delete(eid);
  }
  // 防止环（简单检查：from 不能依赖 to）
  if(createsCycle(from.node, to.node)){ toast('会形成循环依赖'); cleanupEdgeDrag(); return; }
  pushHistory();
  const eid = 'e'+Math.random().toString(36).slice(2,9);
  state.edges.set(eid, {id:eid, from, to});
  cleanupEdgeDrag();
  renderEdges();
  updateStats();
  evaluate();
}
export function createsCycle(fromId, toId){
  // 检查 fromId 是否（间接）依赖 toId
  const visited = new Set();
  function dep(nid){
    if(nid===toId) return true;
    if(visited.has(nid)) return false;
    visited.add(nid);
    for(const e of state.edges.values()){
      if(e.from.node===nid && dep(e.to.node)) return true;
    }
    return false;
  }
  return dep(fromId);
}
export function cleanupEdgeDrag(){
  if(state.dragging && state.dragging.portEl) state.dragging.portEl.classList.remove('active');
  state.dragging = null;
  document.querySelectorAll('.port.compat,.port.incompat').forEach(p=>{ p.classList.remove('compat'); p.classList.remove('incompat'); });
  const t = edgesSvg.querySelector('.edge-temp');
  if(t) t.remove();
  canvasWrap.classList.remove('connecting');
}

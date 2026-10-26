/* ── 视图布局（fit / 自动分层排布）────────────── */
/* 从 node-canvas.js 原样搬出，逻辑未改。 */
import { state } from './state.js'
import { canvasWrap, screenToWorld, applyViewport } from './viewport.js'
import { clamp } from './algorithms.js'
import { renderEdges } from './edges.js'

export function fitView(){
  if(state.nodes.size===0){
    state.viewport={x:0,y:0,zoom:1}; applyViewport(); return;
  }
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  state.nodes.forEach(n=>{
    const r = n.el.getBoundingClientRect();
    const a = screenToWorld(r.left, r.top);
    const b = screenToWorld(r.right, r.bottom);
    minX=Math.min(minX,a.x); minY=Math.min(minY,a.y);
    maxX=Math.max(maxX,b.x); maxY=Math.max(maxY,b.y);
  });
  const pad = 60;
  const w = maxX-minX+pad*2, h = maxY-minY+pad*2;
  const r = canvasWrap.getBoundingClientRect();
  const z = clamp(Math.min(r.width/w, r.height/h), 0.2, 3);
  state.viewport.zoom = z;
  state.viewport.x = (r.width - (maxX+minX)*z)/2;
  state.viewport.y = (r.height - (maxY+minY)*z)/2;
  applyViewport();
}
export function autoLayout(){
  // 简单分层布局：按拓扑层级
  const indeg = new Map();
  state.nodes.forEach((n,id)=>indeg.set(id,0));
  state.edges.forEach(e=>{ if(state.nodes.has(e.from.node)&&state.nodes.has(e.to.node)) indeg.set(e.to.node, indeg.get(e.to.node)+1); });
  const layer = new Map();
  const q = [...state.nodes.keys()].filter(id=>indeg.get(id)===0);
  q.forEach(id=>layer.set(id,0));
  while(q.length){
    const id=q.shift();
    state.edges.forEach(e=>{
      if(e.from.node===id){
        const nl = (layer.get(id)||0)+1;
        if(!layer.has(e.to.node) || layer.get(e.to.node)<nl){
          layer.set(e.to.node, nl);
        }
        indeg.set(e.to.node, indeg.get(e.to.node)-1);
        if(indeg.get(e.to.node)===0) q.push(e.to.node);
      }
    });
  }
  // 按层排列
  const byLayer = {};
  state.nodes.forEach((n,id)=>{
    if(!layer.has(id)) layer.set(id, 0);
  });
  layer.forEach((l,id)=>{ (byLayer[l]=byLayer[l]||[]).push(id); });
  Object.entries(byLayer).forEach(([l,ids])=>{
    ids.forEach((id,i)=>{
      const n=state.nodes.get(id);
      n.x = +l*260 - 400; n.y = i*180 - 200;
      n.el.style.left=n.x+'px'; n.el.style.top=n.y+'px';
    });
  });
  renderEdges();
  setTimeout(fitView, 50);
}

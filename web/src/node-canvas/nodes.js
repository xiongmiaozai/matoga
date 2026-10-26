/* ── 节点创建/渲染 ─────────────────────────── */
/* 从 node-canvas.js 原样搬出，逻辑未改。
   跨模块依赖直接 import；尚未拆出的模块（autosave）用 setNodeHooks 注入，
   与项目现有的 setWidgetHooks / setEdgeHooks 同一约定。 */
import { NODE_DEFS } from './defs.js'
import { $ } from './dom.js'
import { state } from './state.js'
import { pushHistory } from './history.js'
import { uid } from './algorithms.js'
import { updateStats } from './status.js'
import { evaluate } from './evaluate.js'
import { getPinch } from './gestures.js'
import { startEdge, renderEdges } from './edges.js'

let _hooks = { markDirty: () => {} }
export function setNodeHooks(h){ _hooks = { ..._hooks, ...h } }

export const nodesLayer = $('#nodes-layer')

export function createNode(type, x, y){
  const def = NODE_DEFS[type];
  if(!def) return null;
  pushHistory();
  const id = uid();
  const props = defaultProps(type);
  const node = {id, type, x, y, props, el:null};
  state.nodes.set(id, node);
  renderNode(node);
  updateStats();
  evaluate();
  return node;
}
export function defaultProps(type){
  const def = NODE_DEFS[type];
  const p = {};
  if(type==='number') p.value = 0.5;
  else if(type==='color') p.color = '#7cbd56';
  else if(type==='texture') p.tex = '';
  else if(type==='mainTex'){ p.tex = ''; p._role = 'main'; }
  else if(type==='vector2'){p.x=0.5; p.y=0.5;}
  else if(type==='hdr') p.preset = 'studio';
  else if(type==='noise'){p.scale=4; p.seed=0; p.octaves=4; p.gain=0.5;}
  else if(type==='voronoi'){p.scale=5; p.seed=0; p.mode='f1'; p.jitter=1; p.smooth=0.5;}
  else if(type==='simplex'){p.scale=4; p.seed=0; p.octaves=4; p.gain=0.5;}
  else if(type==='ridge'){p.scale=4; p.seed=0; p.octaves=4; p.gain=0.5;}
  else if(type==='warp'){p.scale=3; p.seed=0; p.octaves=4; p.amount=1; p.gain=0.5;}
  else if(type==='white'){p.scale=24; p.seed=0;}
  else if(type==='cell'){p.scale=6; p.seed=0;}
  else if(type==='billow'){p.scale=4; p.seed=0; p.octaves=4; p.gain=0.5;}
  else if(type==='cubic'){p.scale=4; p.seed=0; p.octaves=4; p.gain=0.5;}
  else if(type==='pingpong'){p.scale=4; p.seed=0; p.octaves=4; p.gain=0.5; p.strength=2;}
  else if(type==='voronoise'){p.scale=4; p.seed=0; p.jitter=1; p.blend=0.5;}
  else if(type==='reaction'){p.seed=0; p.iterations=120; p.preset='coral';}
  else if(type==='lightning'){p.seed=0; p.branches=0.7; p.detail=1; p.glow=0.5;}
  else if(type==='mandel'){p.fractal='mandel'; p.zoom=1; p.iterations=96; p.seed=0;}
  else if(type==='palette'){p.preset='rainbow'; p.freq=1; p.phase=0;}
  else if(type==='gradient'){p.colorA='#7cbd56'; p.colorB='#c084fc'; p.mode='linear';}
  else if(type==='rgbaMerge'){p.r=0; p.g=0; p.b=0; p.a=1; p.size=null;}
  return p;
}
export function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function renderNode(node){
  const def = NODE_DEFS[node.type];
  const el = document.createElement('div');
  el.className = 'node';
  el.style.left = node.x+'px';
  el.style.top = node.y+'px';
  el.style.setProperty('--node-color', def.color);
  el.dataset.id = node.id;

  // 头
  const head = document.createElement('div');
  head.className = 'node-head';
  const titleText = node.title || def.title;
  head.innerHTML = `<span class="badge pixel"></span><span class="title${node.title?' renamed':''}">${escapeHtml(titleText)}</span><button class="collapse" title="折叠/展开">${node.collapsed?'▸':'▾'}</button><button class="x" title="删除">✕</button>`;
  if(node.collapsed) el.classList.add('collapsed');
  head.querySelector('.x').addEventListener('pointerdown', e=>e.stopPropagation());
  head.querySelector('.x').addEventListener('click', e=>{e.stopPropagation(); deleteNode(node.id);});
  head.querySelector('.collapse').addEventListener('pointerdown', e=>e.stopPropagation());
  head.querySelector('.collapse').addEventListener('click', e=>{e.stopPropagation(); toggleCollapse(node.id);});
  el.appendChild(head);

  // body
  const body = document.createElement('div');
  body.className = 'node-body';

  // 输入端口
  def.inputs.forEach((p,i)=>{
    const row = document.createElement('div');
    row.className = 'port-row in';
    row.innerHTML = `<span class="port in" data-node="${node.id}" data-port="${p.n}" data-dir="in" data-type="${p.t}" style="--port-color:var(--type-${p.t})"></span><span class="port-label">${p.n}</span>`;
    body.appendChild(row);
  });
  // 输出端口
  def.outputs.forEach((p,i)=>{
    const row = document.createElement('div');
    row.className = 'port-row out';
    row.innerHTML = `<span class="port-label">${p.n}</span><span class="port out" data-node="${node.id}" data-port="${p.n}" data-dir="out" data-type="${p.t}" style="--port-color:var(--type-${p.t})"></span>`;
    body.appendChild(row);
  });

  // widget
  if(def.widget){
    const w = document.createElement('div');
    w.className = 'widget';
    w.appendChild(def.widget(node));
    body.appendChild(w);
  }
  // 输出预览
  const _noOutPv = new Set(['color','texture','number','vector2','hdr','preview','output','outputLeft','outputRight']);
  if(def.outputs && def.outputs.length && !_noOutPv.has(node.type)){
    const pv = document.createElement('div');
    pv.className = 'w-preview out-preview';
    const o0 = def.outputs[0];
    pv.innerHTML = `<div class="pv-label"><span>${o0.n}</span><span class="pv-type">${o0.t}</span></div><div class="pv-empty">待计算</div>`;
    node._outPreviewEl = pv;
    body.appendChild(pv);
  }
  el.appendChild(body);
  nodesLayer.appendChild(el);
  node.el = el;

  // 拖拽
  head.addEventListener('pointerdown', (e)=>{
    if(getPinch()) return;
    if(e.button!==0) return;
    e.stopPropagation();
    selectNode(node.id, e.shiftKey);
    const sx = e.clientX, sy = e.clientY;
    const moving = new Set(state.selected);
    if(!moving.has(node.id)) moving.add(node.id);
    el.classList.add('dragging');
    const baselines = new Map();
    moving.forEach(id=>{
      const n = state.nodes.get(id);
      if(n){ baselines.set(id, {x:n.x, y:n.y}); n.el.classList.add('dragging'); }
    });
    state.dragging = {kind:'node', sx, sy, moving, baselines};
  });

  // 选中
  el.addEventListener('pointerdown', (e)=>{
    if(getPinch()) return;
    if(e.target.classList.contains('port')) return;
    e.stopPropagation();
    selectNode(node.id, e.shiftKey);
  });
  // 端口
  el.querySelectorAll('.port').forEach(p=>{
    p.addEventListener('pointerdown', (e)=>{
      if(getPinch()) return;
      e.stopPropagation();
      e.preventDefault();
      startEdge(p, e);
    });
  });
}
export function deleteNode(id){
  if(!state.nodes.has(id)) return;
  pushHistory();
  const n = state.nodes.get(id);
  // 删除相关连线
  for(const [eid,e] of state.edges){
    if(e.from.node===id||e.to.node===id) state.edges.delete(eid);
  }
  n.el.remove();
  state.nodes.delete(id);
  state.selected.delete(id);
  renderEdges();
  updateStats();
  evaluate();
}
export function selectNode(id, additive){
  if(additive){
    if(state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
  } else {
    state.selected.clear();
    state.selected.add(id);
    state.selectedEdge = null;
  }
  refreshSelection();
}
export function refreshSelection(){
  state.nodes.forEach((n,id)=>{
    n.el.classList.toggle('selected', state.selected.has(id));
  });
  document.querySelectorAll('.edges .edge').forEach(p=>{
    p.classList.toggle('selected', p.dataset.id===state.selectedEdge);
  });
  _notifySelected();
}
export function _notifySelected(){
  try{
    const first = state.selected.size > 0 ? [...state.selected][0] : null;
    document.dispatchEvent(new CustomEvent('nodegraph:selected', {
      detail: { id: first, count: state.selected.size },
    }));
  }catch(e){}
}

/* 折叠/展开节点。原在 menus 块里，挪到此处断开 nodedom↔menus 的环。 */
export function toggleCollapse(id){
  const n = state.nodes.get(id); if(!n) return;
  pushHistory();
  n.collapsed = !n.collapsed;
  n.el.classList.toggle('collapsed', n.collapsed);
  const btn = n.el.querySelector('.collapse');
  if(btn) btn.textContent = n.collapsed ? '▸' : '▾';
  renderEdges();
  _hooks.markDirty();
}

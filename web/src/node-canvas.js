
/* ════════════════════════════════════════════════════════════
   matoga Node Canvas — JS 引擎（整合进主页，模式切换）
   ════════════════════════════════════════════════════════════ */

/* 复用主页 material3d 模块；若未初始化则在此主动 initMaterial3D（幂等） */
import * as m3d from './material3d.js';
import { enhancePreview } from './preview2d.js';
import { uiPrompt, uiConfirm } from './ui-dialog.js';
import { apiUrl } from './utils.js';

/* 纯算法层（工具/噪声/混合/特效/simplex）已拆出，见 node-canvas/algorithms.js */
import { num, clamp, _texUrl, col, rgbToHex, hexToRgb, uid, _smoothstep, _lerp, _psBlendApply, _psNode, _paletteRGB, _NOISE_PV_TYPES, _noisePvCache, _noiseValue, _noiseGrid, _gridToImageData, _noisePreviewUrl } from './node-canvas/algorithms.js'
import { state } from './node-canvas/state.js'
import { canvasWrap, world, gridBg, applyViewport, screenToWorld, setZoom, updateMinimap, setNodeColorResolver } from './node-canvas/viewport.js'
import { setStatusHooks, updateStats, _notifyGraphChanged, toast } from './node-canvas/status.js'
import { setWidgetHooks, numWidget, colorWidget, vecWidget, textureWidget, rgbaMergeWidget, rgbaSplitWidget, rgbAlphaSplitWidget, selectWidget, previewWidget, noiseWidget, voronoiWidget, whiteWidget, cellWidget, pingpongWidget, voronoiseWidget, reactionWidget, lightningWidget, mandelWidget, paletteWidget, gradientWidget, warpWidget } from './node-canvas/widgets.js'
import { setEdgeHooks, edgesSvg, startEdge, renderEdges } from './node-canvas/edges.js'
import { setEvalHooks, evaluate } from './node-canvas/evaluate.js'
import { setHistoryHooks, _history, _restore, pushHistory, undo, redo } from './node-canvas/history.js'
import { setGestureHooks, pointers, getPinch, setPinch, clearLongPress, startLongPress, checkLongPressMove } from './node-canvas/gestures.js'
import { _texAvgColor, _texAlpha, _rgbaIn, _rgbaMerge, _rgbaSplit, _rgbAlphaSplit, _noiseTexUrl, _loadImg, _renderNoisePreview } from './node-canvas/tex-utils.js'
import { syncToPreview, _renderPreviewVal, updatePreview } from './node-canvas/preview-sync.js'
import { NODE_DEFS } from './node-canvas/defs.js'
export { buildPreview2DRows } from './node-canvas/preview-sync.js'


let _initialized = false;

const $ = (s) => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';

/* 节点类型定义 已移至 node-canvas/defs.js */
/* ── 节点创建/渲染 ─────────────────────────── */
const nodesLayer = $('#nodes-layer');

function createNode(type, x, y){
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
function defaultProps(type){
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
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function renderNode(node){
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
function deleteNode(id){
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
function selectNode(id, additive){
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
function refreshSelection(){
  state.nodes.forEach((n,id)=>{
    n.el.classList.toggle('selected', state.selected.has(id));
  });
  document.querySelectorAll('.edges .edge').forEach(p=>{
    p.classList.toggle('selected', p.dataset.id===state.selectedEdge);
  });
  _notifySelected();
}
function _notifySelected(){
  try{
    const first = state.selected.size > 0 ? [...state.selected][0] : null;
    document.dispatchEvent(new CustomEvent('nodegraph:selected', {
      detail: { id: first, count: state.selected.size },
    }));
  }catch(e){}
}



/* ── 拖拽对齐辅助线 ─────────────────────────── */
function _showAlignGuide(orient, worldPos){
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
function _clearAlignGuides(){
  canvasWrap.querySelectorAll('.nc-align-guide').forEach(g=>g.remove());
}
function _alignGuides(d){
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
function typeColor(t){
  return {number:'#7cbd56',color:'#c084fc',texture:'#f5a623',material:'#5bcefa',
    environment:'#f5a623',any:'#9a9a9a',vector:'#e8e8e8'}[t]||'#9a9a9a';
}
function edgePath(a,b){
  const dx = Math.max(40, Math.abs(b.x-a.x)*0.5);
  return `M ${a.x} ${a.y} C ${a.x+dx} ${a.y}, ${b.x-dx} ${b.y}, ${b.x} ${b.y}`;
}
function selectEdge(id){
  state.selected.clear();
  state.selectedEdge = id;
  refreshSelection();
}
function canConnect(fromType, toType){
  if(fromType==='any'||toType==='any') return true;
  return fromType===toType;
}
function finishEdge(endPortEl){
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
function createsCycle(fromId, toId){
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
function cleanupEdgeDrag(){
  if(state.dragging && state.dragging.portEl) state.dragging.portEl.classList.remove('active');
  state.dragging = null;
  document.querySelectorAll('.port.compat,.port.incompat').forEach(p=>{ p.classList.remove('compat'); p.classList.remove('incompat'); });
  const t = edgesSvg.querySelector('.edge-temp');
  if(t) t.remove();
  canvasWrap.classList.remove('connecting');
}

/* ── 全局事件 ───────────────────────────────── */
canvasWrap.addEventListener('pointerdown', (e)=>{
  pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  startLongPress(e);
  if(pointers.size>=2){
    const pts=[...pointers.values()];
    setPinch({dist0:Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y),
      zoom0:state.viewport.zoom, vx0:state.viewport.x, vy0:state.viewport.y});
    if(state.dragging){
      if(state.dragging.kind==='node') state.dragging.moving.forEach(id=>{const n=state.nodes.get(id);if(n)n.el.classList.remove('dragging');});
      if(state.dragging.kind==='edge') cleanupEdgeDrag();
      state.dragging=null;
    }
    return;
  }
}, true);
canvasWrap.addEventListener('pointerdown', (e)=>{
  if(getPinch()) return;
  if(e.target===canvasWrap || e.target===gridBg || e.target===world || e.target===nodesLayer){
    if(e.button===2) return; // 右键菜单
    if(e.button===1 || (e.button===0 && e.altKey) || e.pointerType==='touch'){
      e.preventDefault();
      state.dragging = {kind:'pan', sx:e.clientX, sy:e.clientY,
        ox:state.viewport.x, oy:state.viewport.y};
      canvasWrap.classList.add('panning');
    } else if(e.button===0){
      const wp = screenToWorld(e.clientX, e.clientY);
      state.dragging = {kind:'box', sx:e.clientX, sy:e.clientY, startWorld:wp, moved:false};
      if(!e.shiftKey){ state.selected.clear(); state.selectedEdge=null; refreshSelection(); }
    }
  }
});
window.addEventListener('pointermove', (e)=>{
  if(pointers.has(e.pointerId)) pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  checkLongPressMove(e);
  if(getPinch() && pointers.size>=2){
    const pts=[...pointers.values()];
    const dist=Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
    const cx=(pts[0].x+pts[1].x)/2, cy=(pts[0].y+pts[1].y)/2;
    const r=canvasWrap.getBoundingClientRect();
    const zoom=clamp(getPinch().zoom0*dist/getPinch().dist0, 0.2, 3);
    const acx=cx-r.left, acy=cy-r.top;
    const wx=(acx-getPinch().vx0)/getPinch().zoom0, wy=(acy-getPinch().vy0)/getPinch().zoom0;
    state.viewport.zoom=zoom;
    state.viewport.x=acx-wx*zoom;
    state.viewport.y=acy-wy*zoom;
    applyViewport();
    return;
  }
  const d = state.dragging;
  if(!d) return;
  if(d.kind==='pan'){
    state.viewport.x = d.ox + (e.clientX-d.sx);
    state.viewport.y = d.oy + (e.clientY-d.sy);
    applyViewport();
  } else if(d.kind==='node'){
    const dx = (e.clientX-d.sx)/state.viewport.zoom;
    const dy = (e.clientY-d.sy)/state.viewport.zoom;
    d.baselines.forEach((base,id)=>{
      const n = state.nodes.get(id);
      if(!n) return;
      n.x = base.x + dx; n.y = base.y + dy;
      n.el.style.left = n.x+'px';
      n.el.style.top = n.y+'px';
    });
    _alignGuides(d);
    renderEdges();
    updateMinimap();
  } else if(d.kind==='edge'){
    const cur = screenToWorld(e.clientX, e.clientY);
    let a = d.startWorld, b = cur;
    if(d.dir==='in'){ a = cur; b = d.startWorld; }
    let t = edgesSvg.querySelector('.edge-temp');
    if(!t){
      t = document.createElementNS(NS,'path');
      t.setAttribute('class','edge-temp');
      edgesSvg.appendChild(t);
    }
    t.setAttribute('d', edgePath(a,b));
    t.setAttribute('stroke', typeColor(d.dataType));
  } else if(d.kind==='box'){
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if(Math.abs(dx)<3 && Math.abs(dy)<3) return;
    d.moved = true;
    const cur = screenToWorld(e.clientX, e.clientY);
    const x = Math.min(d.startWorld.x, cur.x);
    const y = Math.min(d.startWorld.y, cur.y);
    const w = Math.abs(cur.x - d.startWorld.x);
    const h = Math.abs(cur.y - d.startWorld.y);
    let box = canvasWrap.querySelector('.sel-box');
    if(!box){
      box = document.createElement('div');
      box.className = 'sel-box';
      box.style.cssText = 'position:absolute;border:1px solid var(--accent,#7cbd56);background:rgba(124,189,86,.12);pointer-events:none;z-index:9999';
      canvasWrap.appendChild(box);
    }
    const {x:vx, y:vy, zoom} = state.viewport;
    box.style.left = (x*zoom + vx) + 'px';
    box.style.top = (y*zoom + vy) + 'px';
    box.style.width = (w*zoom) + 'px';
    box.style.height = (h*zoom) + 'px';
  }
});
window.addEventListener('pointerup', (e)=>{
  pointers.delete(e.pointerId);
  clearLongPress();
  if(getPinch()){
    if(pointers.size<2) setPinch(null);
    return;
  }
  const d = state.dragging;
  if(d && d.kind==='edge'){
    // 检查是否落在端口上
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if(target && target.classList.contains('port')){
      finishEdge(target);
    } else {
      cleanupEdgeDrag();
    }
  }
  if(d && d.kind==='node'){
    d.moving.forEach(id=>{
      const n=state.nodes.get(id);
      if(n) n.el.classList.remove('dragging');
    });
    _clearAlignGuides();
    _markDirty();
  }
  if(d && d.kind==='box' && d.moved){
    const cur = screenToWorld(e.clientX, e.clientY);
    const minX = Math.min(d.startWorld.x, cur.x), maxX = Math.max(d.startWorld.x, cur.x);
    const minY = Math.min(d.startWorld.y, cur.y), maxY = Math.max(d.startWorld.y, cur.y);
    state.nodes.forEach((n,id)=>{
      const r = n.el.getBoundingClientRect();
      const cx = (r.left + r.width/2), cy = (r.top + r.height/2);
      const wp = screenToWorld(cx, cy);
      if(wp.x>=minX && wp.x<=maxX && wp.y>=minY && wp.y<=maxY){
        state.selected.add(id);
      }
    });
    refreshSelection();
  }
  const box = canvasWrap.querySelector('.sel-box');
  if(box) box.remove();
  state.dragging = null;
  canvasWrap.classList.remove('panning');
});
window.addEventListener('pointercancel', (e)=>{
  pointers.delete(e.pointerId);
  setPinch(null);
  clearLongPress();
  if(state.dragging){
    if(state.dragging.kind==='node') state.dragging.moving.forEach(id=>{const n=state.nodes.get(id);if(n)n.el.classList.remove('dragging');});
    if(state.dragging.kind==='edge') cleanupEdgeDrag();
    _clearAlignGuides();
    state.dragging=null;
  }
  canvasWrap.classList.remove('panning');
});


// 滚轮缩放
canvasWrap.addEventListener('wheel', (e)=>{
  e.preventDefault();
  const factor = e.deltaY<0 ? 1.1 : 1/1.1;
  setZoom(state.viewport.zoom*factor, e.clientX, e.clientY);
}, {passive:false});

// 右键菜单
canvasWrap.addEventListener('contextmenu', (e)=>{
  e.preventDefault();
  const nodeEl = e.target.closest('.node');
  if(nodeEl){
    showNodeMenu(e, nodeEl.dataset.id);
  } else {
    showCanvasMenu(e);
  }
});

// 键盘
window.addEventListener('keydown', (e)=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT') return;
  // 导入对话框打开时，仅 Escape 关闭，屏蔽其他快捷键
  if(importOverlay.classList.contains('open')){
    if(e.key==='Escape') importOverlay.classList.remove('open');
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  if(ctrl && (e.key==='z'||e.key==='Z')){ e.preventDefault(); if(e.shiftKey) redo(); else undo(); return; }
  if(ctrl && (e.key==='y'||e.key==='Y')){ e.preventDefault(); redo(); return; }
  if(ctrl && (e.key==='d'||e.key==='D')){ e.preventDefault(); state.selected.forEach(id=>duplicateNode(id)); return; }
  if(ctrl && (e.key==='c'||e.key==='C')){ e.preventDefault(); copySelection(); return; }
  if(ctrl && (e.key==='x'||e.key==='X')){ e.preventDefault(); cutSelection(); return; }
  if(ctrl && (e.key==='v'||e.key==='V')){ e.preventDefault(); pasteClipboard(); return; }
  if(ctrl && (e.key==='a'||e.key==='A')){ e.preventDefault(); state.selected.clear(); state.nodes.forEach((n,id)=>state.selected.add(id)); refreshSelection(); return; }
  if(ctrl && (e.key==='s'||e.key==='S')){ e.preventDefault(); saveGraph(); return; }
  if(e.key==='Delete'||e.key==='Backspace'){
    pushHistory();
    if(state.selectedEdge){ state.edges.delete(state.selectedEdge); state.selectedEdge=null; renderEdges(); updateStats(); evaluate(); }
    state.selected.forEach(id=>deleteNode(id));
  } else if(e.key==='f'||e.key==='F'){ fitView(); }
  else if(e.key==='l'||e.key==='L'){ autoLayout(); }
  else if(e.key==='Escape'){
    const hdrModal = document.getElementById('hdrPreviewModal');
    const paramsOv = document.getElementById('m3dParamsOverlay');
    if(hdrModal && hdrModal.classList.contains('show')){ hdrModal.classList.remove('show'); return; }
    if(paramsOv && paramsOv.classList.contains('show')){ paramsOv.classList.remove('show'); return; }
    cleanupEdgeDrag(); state.selected.clear(); state.selectedEdge=null; refreshSelection(); closeCtxMenu();
  }
});

/* ── 右键菜单 ───────────────────────────────── */
let ctxMenuEl = null;
function closeCtxMenu(){ if(ctxMenuEl){ctxMenuEl.remove(); ctxMenuEl=null;} }
function showCanvasMenu(e){
  closeCtxMenu();
  const wp = screenToWorld(e.clientX, e.clientY);
  const m = document.createElement('div');
  m.className='ctx-menu';
  m.style.left=e.clientX+'px'; m.style.top=e.clientY+'px';

  const search = document.createElement('input');
  search.type='text'; search.className='search'; search.placeholder='搜索节点…';
  m.appendChild(search);
  const titleBar = document.createElement('div');
  titleBar.className='title-bar'; titleBar.textContent='添加节点';
  m.appendChild(titleBar);

  const groups = {};
  Object.entries(NODE_DEFS).forEach(([k,d])=>{
    if(d.hidden) return;
    (groups[d.group]=groups[d.group]||[]).push([k,d]);
  });
  const groupEls = [];
  Object.entries(groups).forEach(([g,items])=>{
    const grp=document.createElement('div'); grp.className='grp'; grp.textContent=g;
    m.appendChild(grp);
    const itemEls=[], subHeads=[];
    const hasSub = items.some(([,d])=>d.subgroup);
    if(hasSub){
      const subs={};
      items.forEach(([k,d])=>{ const sg=d.subgroup||'其他'; (subs[sg]=subs[sg]||[]).push([k,d]); });
      Object.entries(subs).forEach(([sg,subItems])=>{
        const sgEl=document.createElement('div'); sgEl.className='subgrp'; sgEl.textContent=sg; sgEl.dataset.sub=sg.toLowerCase();
        m.appendChild(sgEl); subHeads.push(sgEl);
        subItems.forEach(([k,d])=>{
          const it=document.createElement('div'); it.className='item';
          it.innerHTML=`<span class="ic" style="background:${d.color}"></span><span class="nm">${d.title}</span>`;
          it.dataset.name=d.title.toLowerCase(); it.dataset.group=g.toLowerCase(); it.dataset.sub=sg.toLowerCase();
          it.addEventListener('click', ()=>{ createNode(k, wp.x-100, wp.y-14); closeCtxMenu(); });
          m.appendChild(it); itemEls.push(it);
        });
      });
    } else {
      items.forEach(([k,d])=>{
        const it=document.createElement('div'); it.className='item';
        it.innerHTML=`<span class="ic" style="background:${d.color}"></span><span class="nm">${d.title}</span>`;
        it.dataset.name=d.title.toLowerCase(); it.dataset.group=g.toLowerCase();
        it.addEventListener('click', ()=>{ createNode(k, wp.x-100, wp.y-14); closeCtxMenu(); });
        m.appendChild(it); itemEls.push(it);
      });
    }
    groupEls.push({grp,items:itemEls,subHeads});
    const sep=document.createElement('div'); sep.className='sep'; m.appendChild(sep);
  });
  const emptyHint=document.createElement('div');
  emptyHint.className='empty-hint'; emptyHint.textContent='无匹配节点'; emptyHint.style.display='none';
  m.appendChild(emptyHint);

  search.addEventListener('input', ()=>{
    const term=search.value.trim().toLowerCase();
    let anyVisible=false;
    groupEls.forEach(({grp,items,subHeads})=>{
      let gv=false;
      items.forEach(it=>{
        const match=!term || it.dataset.name.includes(term) || it.dataset.group.includes(term) || (it.dataset.sub&&it.dataset.sub.includes(term));
        it.classList.toggle('hidden', !match);
        if(match){ gv=true; anyVisible=true; }
      });
      grp.classList.toggle('hidden', !gv);
      if(subHeads && subHeads.length){
        subHeads.forEach(sh=>{
          const hasVis=items.some(it=>!it.classList.contains('hidden') && it.dataset.sub===sh.dataset.sub);
          sh.classList.toggle('hidden', !hasVis);
        });
      }
    });
    emptyHint.style.display=anyVisible?'none':'block';
  });
  search.addEventListener('keydown', (ev)=>{
    if(ev.key==='Escape') closeCtxMenu();
    else if(ev.key==='Enter'){ const f=m.querySelector('.item:not(.hidden):not(.disabled)'); if(f) f.click(); }
  });

  const opSep=document.createElement('div'); opSep.className='sep'; m.appendChild(opSep);
  const canPaste=!!_clipboard;
  const ops=[
    {nm:'在此处粘贴', sc:'Ctrl+V', act:'paste', disabled:!canPaste},
    {nm:'全选', sc:'Ctrl+A', act:'all'},
    {nm:'自动布局', sc:'L', act:'layout'},
    {nm:'适应视图', sc:'F', act:'fit'},
    {sep:true},
    {nm:'保存项目', sc:'Ctrl+S', act:'save'},
    {nm:'加载图', act:'load'},
    {nm:'清空画布', act:'clear', danger:true}
  ];
  ops.forEach(op=>{
    if(op.sep){ const s=document.createElement('div'); s.className='sep'; m.appendChild(s); return; }
    const it=document.createElement('div');
    it.className='item'+(op.danger?' danger':'')+(op.disabled?' disabled':'');
    it.innerHTML=`<span class="nm">${op.nm}</span>${op.sc?`<span class="sc">${op.sc}</span>`:''}`;
    it.addEventListener('click', ()=>{
      if(it.classList.contains('disabled')) return;
      if(op.act==='paste') pasteClipboard(wp.x, wp.y);
      else if(op.act==='all') selectAll();
      else if(op.act==='layout') autoLayout();
      else if(op.act==='fit') fitView();
      else if(op.act==='save') saveGraph();
      else if(op.act==='load') loadGraph();
      else if(op.act==='clear'){
        if(state.nodes.size===0) return;
        (async()=>{
          if(!await uiConfirm({ title:'清空画布', message:'清空所有节点？', danger:true })) return;
          pushHistory();
          state.nodes.forEach(n=>n.el.remove());
          state.nodes.clear(); state.edges.clear(); state.selected.clear();
          _currentProject = null;
          renderEdges(); updateStats(); evaluate();
          _resetSavedState();
        })();
      }
      closeCtxMenu();
    });
    m.appendChild(it);
  });

  document.body.appendChild(m);
  ctxMenuEl = m;
  adjustMenu(m, e.clientX, e.clientY);
  search.focus();
}
function showNodeMenu(e, id){
  closeCtxMenu();
  if(!id || !state.nodes.has(id)) return;
  if(!state.selected.has(id)) selectNode(id, false);
  const n = state.nodes.get(id);
  const wp = screenToWorld(e.clientX, e.clientY);
  const m=document.createElement('div'); m.className='ctx-menu';
  m.style.left=e.clientX+'px'; m.style.top=e.clientY+'px';
  const canPaste=!!_clipboard;
  m.innerHTML=`
    <div class="item" data-act="dup"><span class="nm">复制节点</span><span class="sc">Ctrl+D</span></div>
    <div class="item" data-act="cut"><span class="nm">剪切节点</span><span class="sc">Ctrl+X</span></div>
    <div class="item${canPaste?'':' disabled'}" data-act="paste"><span class="nm">在此处粘贴</span><span class="sc">Ctrl+V</span></div>
    <div class="sep"></div>
    <div class="item" data-act="disc"><span class="nm">断开所有连线</span></div>
    <div class="item" data-act="col"><span class="nm">${n.collapsed?'展开节点':'折叠节点'}</span></div>
    <div class="item" data-act="ren"><span class="nm">重命名节点</span></div>
    <div class="sep"></div>
    <div class="item" data-act="up"><span class="nm">选中上游节点</span></div>
    <div class="item" data-act="down"><span class="nm">选中下游节点</span></div>
    <div class="sep"></div>
    <div class="item danger" data-act="del"><span class="nm">删除节点</span><span class="sc">Del</span></div>
  `;
  m.addEventListener('click',(ev)=>{
    const item=ev.target.closest('.item');
    if(!item || item.classList.contains('disabled')) return;
    const act=item.dataset.act;
    if(act==='dup') duplicateNode(id);
    else if(act==='cut') cutSelection();
    else if(act==='paste') pasteClipboard(wp.x, wp.y);
    else if(act==='disc') disconnectNode(id);
    else if(act==='col') toggleCollapse(id);
    else if(act==='ren') renameNode(id);
    else if(act==='up') selectUpstream(id);
    else if(act==='down') selectDownstream(id);
    else if(act==='del') deleteNode(id);
    closeCtxMenu();
  });
  document.body.appendChild(m); ctxMenuEl=m;
  adjustMenu(m, e.clientX, e.clientY);
}
function adjustMenu(m, x, y){
  const r = m.getBoundingClientRect();
  if(x+r.width>window.innerWidth) m.style.left=(window.innerWidth-r.width-8)+'px';
  if(y+r.height>window.innerHeight) m.style.top=(window.innerHeight-r.height-8)+'px';
}
window.addEventListener('click', (e)=>{ if(ctxMenuEl && !ctxMenuEl.contains(e.target)) closeCtxMenu(); });
window.addEventListener('resize', ()=>{ applyViewport(); });

function duplicateNode(id){
  const n = state.nodes.get(id); if(!n) return;
  const nn = createNode(n.type, n.x+20, n.y+20);
  nn.props = JSON.parse(JSON.stringify(n.props));
  nn.title = n.title || null;
  nn.collapsed = !!n.collapsed;
  // 重新渲染以应用 props
  nn.el.remove(); renderNode(nn); renderEdges(); evaluate();
}
function toggleCollapse(id){
  const n = state.nodes.get(id); if(!n) return;
  pushHistory();
  n.collapsed = !n.collapsed;
  n.el.classList.toggle('collapsed', n.collapsed);
  const btn = n.el.querySelector('.collapse');
  if(btn) btn.textContent = n.collapsed ? '▸' : '▾';
  renderEdges();
  _markDirty();
}
async function renameNode(id){
  const n = state.nodes.get(id); if(!n) return;
  const def = NODE_DEFS[n.type];
  const v = await uiPrompt({ title:'节点重命名', label:'节点名称:', value:n.title || def.title });
  if(v===null) return;
  pushHistory();
  const t = v.trim();
  n.title = (t && t!==def.title) ? t : null;
  const titleEl = n.el.querySelector('.title');
  if(titleEl){ titleEl.textContent = n.title || def.title; titleEl.classList.toggle('renamed', !!n.title); }
  _notifyGraphChanged();
}
function disconnectNode(id){
  const n = state.nodes.get(id); if(!n) return;
  const toDel = [];
  for(const [eid,e] of state.edges){ if(e.from.node===id||e.to.node===id) toDel.push(eid); }
  if(toDel.length===0){ toast('该节点无连线'); return; }
  pushHistory();
  toDel.forEach(eid=>state.edges.delete(eid));
  renderEdges(); updateStats(); evaluate();
  toast(`已断开 ${toDel.length} 条连线`);
}
function selectUpstream(id){
  if(!state.nodes.has(id)) return;
  const set = new Set([id]), queue = [id];
  while(queue.length){
    const cur = queue.shift();
    state.edges.forEach(e=>{ if(e.to.node===cur && !set.has(e.from.node)){ set.add(e.from.node); queue.push(e.from.node); } });
  }
  state.selected.clear(); set.forEach(x=>state.selected.add(x)); state.selectedEdge=null;
  refreshSelection(); toast(`已选中 ${set.size} 个上游节点`);
}
function selectDownstream(id){
  if(!state.nodes.has(id)) return;
  const set = new Set([id]), queue = [id];
  while(queue.length){
    const cur = queue.shift();
    state.edges.forEach(e=>{ if(e.from.node===cur && !set.has(e.to.node)){ set.add(e.to.node); queue.push(e.to.node); } });
  }
  state.selected.clear(); set.forEach(x=>state.selected.add(x)); state.selectedEdge=null;
  refreshSelection(); toast(`已选中 ${set.size} 个下游节点`);
}
function selectAll(){
  state.selected.clear();
  state.nodes.forEach((n,id)=>state.selected.add(id));
  refreshSelection();
}
function cutSelection(){
  if(state.selected.size===0){ toast('未选中节点'); return; }
  copySelection();
  pushHistory();
  state.selected.forEach(id=>deleteNode(id));
}

/* ── 节点库面板 ─────────────────────────────── */
const libraryEl = $('#library');
const libraryBody = $('#library-body');
const LIB_GLYPHS = {
  number:'#', color:'◑', texture:'▦', vector2:'↗',
  add:'+', sub:'−', mul:'×', div:'÷', mix:'↔', clamp:'⌐', colorMix:'◐',
  mainTex:'▦', sample:'◎', hdr:'☀', normalMap:'⊥', rgbaMerge:'⊞', rgbaSplit:'⊟', rgbAlphaSplit:'⊟',
  noise:'〰', voronoi:'◈', gradient:'▮', simplex:'∼', ridge:'∧', warp:'↭',
  white:'▫', cell:'▦', billow:'☁', cubic:'∿', pingpong:'↕', voronoise:'◈',
  reaction:'⊙', lightning:'⚡', mandel:'∞', palette:'◑',
  mainTexOutLeft:'→', mainTexOutRight:'→', normalOutLeft:'↥', normalOutRight:'↥',
  specOutLeft:'↥', specOutRight:'↥',
};
const LIB_GROUP_SHAPE = { '输入':'circle','运算':'diamond','混合':'rounded','材质':'square','纹理':'square','特效':'hex','输出':'rounded' };
const LIB_GROUP_GLYPH = { '输入':'◆','运算':'◇','混合':'⊕','材质':'▦','纹理':'〰','特效':'✦','输出':'→' };
const _libCollapsed = new Set();
const _libSubCollapsed = new Set();
let _libSearchInput = null;
function _libIconHTML(type, def){
  const shape = LIB_GROUP_SHAPE[def.group] || 'square';
  const glyph = LIB_GLYPHS[type] || LIB_GROUP_GLYPH[def.group] || '◆';
  return `<span class="ic ic-${shape}" style="background:${def.color}">${glyph}</span>`;
}
/* ── 节点库条目预览（常驻缩略图）──────────────
    对各节点类型用默认参数生成预览：噪波/渐变/调色板→图像；颜色→色块；
    数值→刻度条；向量→坐标点；PS 混合→双渐变混合示例；其余回退图标。
    按 type 缓存，搜索重建时零开销。 */
const _libPvCache = new Map();
const _LIB_PV_SIZE = 40;
const _BLEND_MODE_OF = {
  blendNormal:'normal', blendDissolve:'dissolve', blendDarken:'darken',
  blendMultiply:'multiply', blendColorBurn:'colorBurn', blendLinearBurn:'linearBurn',
  blendDarkerColor:'darkerColor', blendLighten:'lighten', blendScreen:'screen',
  blendColorDodge:'colorDodge', blendLinearDodge:'linearDodge', blendLighterColor:'lighterColor',
  blendOverlay:'overlay', blendSoftLight:'softLight', blendHardLight:'hardLight',
  blendVividLight:'vividLight', blendLinearLight:'linearLight', blendPinLight:'pinLight',
  blendHardMix:'hardMix', blendDifference:'difference', blendExclusion:'exclusion',
  blendSubtract:'subtract', blendDivide:'divide', blendHue:'hue',
  blendSaturation:'saturation', blendColor:'blendColor', blendLuminosity:'luminosity',
};
function _blendPreviewUrl(mode){
  const key = 'b:'+mode;
  if(_libPvCache.has(key)) return _libPvCache.get(key);
  const S = _LIB_PV_SIZE;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for(let py = 0; py < S; py++){
    for(let px = 0; px < S; px++){
      const u = px / S, v = py / S;
      const a = [u, 0.5, 1 - u];
      const b = [1 - v, v, 0.5];
      const o = _psBlendApply(mode, a, b, 1);
      const j = (py * S + px) * 4;
      d[j]     = clamp(o[0], 0, 1) * 255;
      d[j + 1] = clamp(o[1], 0, 1) * 255;
      d[j + 2] = clamp(o[2], 0, 1) * 255;
      d[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  let url = null;
  try { url = c.toDataURL('image/png'); } catch(e){ url = null; }
  _libPvCache.set(key, url);
  return url;
}
function _genLibPreview(type, def){
  try {
    if(_NOISE_PV_TYPES.has(type)){
      const url = _noisePreviewUrl({ type, props: defaultProps(type) }, _LIB_PV_SIZE);
      if(url) return `<span class="pv pv-img" style="background-image:url('${url}')"></span>`;
    } else if(type === 'gradient'){
      const p = defaultProps(type);
      return `<span class="pv pv-grad" style="background:linear-gradient(135deg, ${p.colorA}, ${p.colorB})"></span>`;
    } else if(type === 'color'){
      const p = defaultProps(type);
      return `<span class="pv pv-color" style="background:${p.color}"></span>`;
    } else if(type === 'colorMix'){
      return `<span class="pv pv-grad" style="background:linear-gradient(135deg, #7cbd56, #c084fc)"></span>`;
    } else if(type === 'number'){
      return `<span class="pv pv-num"><i class="mark" style="left:50%"></i></span>`;
    } else if(type === 'vector2'){
      return `<span class="pv pv-vec"><i class="dot" style="left:50%;top:50%"></i></span>`;
    } else if(_BLEND_MODE_OF[type]){
      const url = _blendPreviewUrl(_BLEND_MODE_OF[type]);
      if(url) return `<span class="pv pv-img" style="background-image:url('${url}')"></span>`;
    }
  } catch(e){}
  return _libIconHTML(type, def);
}
function _libPreviewHTML(type, def){
  if(_libPvCache.has(type)) return _libPvCache.get(type);
  const html = _genLibPreview(type, def);
  _libPvCache.set(type, html);
  return html;
}
function buildLibrary(){
  const searchBox=document.createElement('div');
  searchBox.className='lib-search';
  searchBox.innerHTML=`<span class="lib-search-ico">⌕</span><input type="text" id="lib-search-input" placeholder="搜索节点…" autocomplete="off" spellcheck="false"><button class="lib-search-clear" id="lib-search-clear" title="清除" type="button">✕</button>`;
  libraryBody.appendChild(searchBox);
  _libSearchInput = searchBox.querySelector('input');
  const clearBtn=searchBox.querySelector('#lib-search-clear');
  _libSearchInput.addEventListener('input',()=>{
    clearBtn.hidden = !_libSearchInput.value;
    filterLibrary(_libSearchInput.value);
  });
  clearBtn.addEventListener('click',()=>{ _libSearchInput.value=''; clearBtn.hidden=true; filterLibrary(''); _libSearchInput.focus(); });
  filterLibrary('');
  _enableLibDrop();
}
function _highlight(text, term){
  if(!term) return escapeHtml(text);
  const t = term.toLowerCase(), low = text.toLowerCase();
  const idx = low.indexOf(t);
  if(idx < 0) return escapeHtml(text);
  return escapeHtml(text.slice(0,idx)) + '<mark>' + escapeHtml(text.slice(idx, idx+t.length)) + '</mark>' + escapeHtml(text.slice(idx+t.length));
}
let _libDragType = null, _ghostEl = null;
function _updateGhost(e){
  if(!_libDragType) return;
  const def = NODE_DEFS[_libDragType];
  if(!def) return;
  if(!_ghostEl){
    _ghostEl = document.createElement('div');
    _ghostEl.className = 'node ghost';
    _ghostEl.innerHTML = `<div class="node-head"><span class="badge" style="background:${def.color}"></span><span class="title">${escapeHtml(def.title)}</span></div>`;
    nodesLayer.appendChild(_ghostEl);
  }
  _ghostEl.style.setProperty('--node-color', def.color);
  const wp = screenToWorld(e.clientX, e.clientY);
  _ghostEl.style.left = (wp.x - 100) + 'px';
  _ghostEl.style.top = (wp.y - 14) + 'px';
}
function _clearGhost(){ if(_ghostEl){ _ghostEl.remove(); _ghostEl = null; } }
function _libItemEl(k,d){
  const it=document.createElement('div'); it.className='lib-item';
  it.draggable=true; it.dataset.type=k;
  it.innerHTML=`${_libPreviewHTML(k,d)}<span class="nm">${d.title}</span><span class="ports">${d.inputs.length||'·'}→${d.outputs.length||'·'}</span>`;
  it.addEventListener('click', ()=>{
    const r = canvasWrap.getBoundingClientRect();
    const wp = screenToWorld(r.left+r.width/2, r.top+r.height/2);
    createNode(k, wp.x-100, wp.y-30);
  });
  it.addEventListener('dragstart',(e)=>{
    e.dataTransfer.setData('text/node-type', k);
    e.dataTransfer.effectAllowed='copy';
    _libDragType = k;
    canvasWrap.classList.add('lib-drop-target');
  });
  it.addEventListener('dragend',()=>{ canvasWrap.classList.remove('lib-drop-target'); _libDragType = null; _clearGhost(); });
  return it;
}
function filterLibrary(term){
  term=(term||'').trim().toLowerCase();
  const existing=libraryBody.querySelectorAll('.lib-group');
  existing.forEach(el=>el.remove());
  const groups = {};
  Object.entries(NODE_DEFS).forEach(([k,d])=>{
    if(d.hidden) return;
    if(term && !d.title.toLowerCase().includes(term) && !k.toLowerCase().includes(term)
       && !d.group.toLowerCase().includes(term) && !(d.subgroup&&d.subgroup.toLowerCase().includes(term))) return;
    (groups[d.group]=groups[d.group]||[]).push([k,d]);
  });
  const wrap=document.createElement('div'); wrap.className='lib-group';
  Object.entries(groups).forEach(([g,items])=>{
    const collapsed = _libCollapsed.has(g);
    const gh=document.createElement('div'); gh.className='lib-group-head'+(collapsed?' collapsed':'');
    gh.innerHTML=`<span class="lib-arrow">${collapsed?'▸':'▾'}</span><span class="lib-gname">${g}</span><span class="lib-count">${items.length}</span>`;
    gh.addEventListener('click',()=>{
      if(_libCollapsed.has(g)) _libCollapsed.delete(g); else _libCollapsed.add(g);
      filterLibrary(_libSearchInput ? _libSearchInput.value : '');
    });
    wrap.appendChild(gh);
    const itemsWrap=document.createElement('div'); itemsWrap.className='lib-group-items';
    if(collapsed) itemsWrap.style.display='none';
    const hasSub = items.some(([,d])=>d.subgroup);
    if(hasSub){
      const subs = {};
      items.forEach(([k,d])=>{ const sg=d.subgroup||'其他'; (subs[sg]=subs[sg]||[]).push([k,d]); });
      Object.entries(subs).forEach(([sg,subItems])=>{
        const subKey=g+'>'+sg;
        const subCollapsed=_libSubCollapsed.has(subKey);
        const sh=document.createElement('div'); sh.className='lib-sub-head'+(subCollapsed?' collapsed':'');
        sh.innerHTML=`<span class="lib-sub-arrow">${subCollapsed?'▸':'▾'}</span><span class="lib-sub-name">${sg}</span><span class="lib-sub-count">${subItems.length}</span>`;
        sh.addEventListener('click',()=>{
          if(_libSubCollapsed.has(subKey)) _libSubCollapsed.delete(subKey); else _libSubCollapsed.add(subKey);
          filterLibrary(_libSearchInput ? _libSearchInput.value : '');
        });
        itemsWrap.appendChild(sh);
        const subWrap=document.createElement('div'); subWrap.className='lib-sub-items';
        if(subCollapsed) subWrap.style.display='none';
        subItems.forEach(([k,d])=>{ const it=_libItemEl(k,d); if(term && d.title.toLowerCase().includes(term)){ it.querySelector('.nm').innerHTML=_highlight(d.title, term); } subWrap.appendChild(it); });
        itemsWrap.appendChild(subWrap);
      });
    } else {
      items.forEach(([k,d])=>{ const it=_libItemEl(k,d); if(term && d.title.toLowerCase().includes(term)){ it.querySelector('.nm').innerHTML=_highlight(d.title, term); } itemsWrap.appendChild(it); });
    }
    wrap.appendChild(itemsWrap);
  });
  if(Object.keys(groups).length===0){
    const empty=document.createElement('div');
    empty.className='lib-empty';
    empty.innerHTML=`<span class="lib-empty-ico">⌕</span><span>未找到匹配节点</span>`;
    wrap.appendChild(empty);
  }
  libraryBody.appendChild(wrap);
}
let _libDropEnabled=false;
function _enableLibDrop(){
  if(_libDropEnabled) return; _libDropEnabled=true;
  canvasWrap.addEventListener('dragover',(e)=>{
    if(e.dataTransfer.types.includes('text/node-type')){ e.preventDefault(); e.dataTransfer.dropEffect='copy'; _updateGhost(e); }
  });
  canvasWrap.addEventListener('dragleave',(e)=>{
    if(!canvasWrap.contains(e.relatedTarget)) _clearGhost();
  });
  canvasWrap.addEventListener('drop',(e)=>{
    const k=e.dataTransfer.getData('text/node-type');
    if(!k) return;
    e.preventDefault();
    const wp=screenToWorld(e.clientX, e.clientY);
    createNode(k, wp.x-100, wp.y-30);
    _clearGhost();
  });
}

/* ── 工具栏 ─────────────────────────────────── */
$('#btn-add').addEventListener('click', (e)=>{
  const r = canvasWrap.getBoundingClientRect();
  showCanvasMenu({clientX:r.left+40, clientY:r.top+60, preventDefault:()=>{}});
});
$('#btn-fit').addEventListener('click', fitView);
$('#btn-clear').addEventListener('click', ()=>{
  if(state.nodes.size===0) return;
  (async()=>{
    if(!await uiConfirm({ title:'清空画布', message:'清空所有节点？', danger:true })) return;
    pushHistory();
    state.nodes.forEach(n=>n.el.remove());
    state.nodes.clear(); state.edges.clear(); state.selected.clear();
    _currentProject = null;
    _rememberProject(null);
    renderEdges(); updateStats(); evaluate();
  })();
});
$('#btn-layout').addEventListener('click', autoLayout);
const _btnSave = $('#btn-save');
if (_btnSave) _btnSave.addEventListener('click', saveGraph);
const _btnLoad = $('#btn-load');
if (_btnLoad) _btnLoad.addEventListener('click', loadGraph);
$('#zoom-in').addEventListener('click', ()=>setZoom(state.viewport.zoom*1.2));
$('#zoom-out').addEventListener('click', ()=>setZoom(state.viewport.zoom/1.2));
$('#btn-lib').addEventListener('click', ()=>{
  libraryEl.classList.toggle('collapsed');
  canvasWrap.classList.toggle('library-collapsed');
  $('#statusbar').classList.toggle('library-collapsed');
  $('#btn-lib').textContent = libraryEl.classList.contains('collapsed') ? '节点库 ▶' : '◀ 节点库';
});
$('#library-close').addEventListener('click', ()=>$('#btn-lib').click());
(()=>{
  const handle=$('#lib-resize'); let dragging=false, sx=0, sw=0;
  handle.addEventListener('pointerdown',(e)=>{
    dragging=true; sx=e.clientX;
    sw=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--lib-w'))||208;
    document.documentElement.style.cursor='ew-resize'; e.preventDefault();
  });
  window.addEventListener('pointermove',(e)=>{
    if(!dragging) return;
    const w=Math.min(360,Math.max(160,sw+e.clientX-sx));
    document.documentElement.style.setProperty('--lib-w',w+'px');
  });
  window.addEventListener('pointerup',()=>{ if(dragging){ dragging=false; document.documentElement.style.cursor=''; } });
})();
$('#canvas-close').addEventListener('click', ()=>{
  const m = canvasWrap.classList.toggle('minimized');
  $('#canvas-close').textContent = m ? '▢' : '✕';
  $('#canvas-close').title = m ? '展开' : '最小化';
});

/* ── 预览面板交互（复用主页右栏 #sidebarRight）────────── */
const sidebarRight = $('#sidebarRight');
const _btnPreview = $('#btn-preview');
if(_btnPreview) _btnPreview.addEventListener('click', ()=>{
  const hidden = sidebarRight ? sidebarRight.classList.toggle('collapsed') : false;
  _btnPreview.textContent = hidden ? '▶ 实时预览' : '◀ 实时预览';
  if(!hidden && m3d){
    const _c = document.getElementById('material3dContainer');
    if(_c && m3d.initMaterial3D && !m3d.isMaterial3DReady()) m3d.initMaterial3D(_c);
    setTimeout(()=>{ if(m3d.isMaterial3DReady && m3d.isMaterial3DReady()) evaluate(); }, 250);
  }
});

function fitView(){
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
function autoLayout(){
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


/* ── 复制/粘贴 ───────────────────────────────── */
let _clipboard = null;
function copySelection(){
  if(state.selected.size === 0){ toast('未选中节点'); return; }
  const nodes = [], edges = [];
  const idMap = new Map();
  state.selected.forEach(id=>{
    const n = state.nodes.get(id);
    if(!n) return;
    const newId = uid();
    idMap.set(id, newId);
    nodes.push({id:newId, type:n.type, x:n.x, y:n.y, props:JSON.parse(JSON.stringify(n.props)), title:n.title||null, collapsed:!!n.collapsed});
  });
  state.edges.forEach((e)=>{
    if(idMap.has(e.from.node) && idMap.has(e.to.node)){
      edges.push({from:idMap.get(e.from.node), fp:e.from.port, to:idMap.get(e.to.node), tp:e.to.port});
    }
  });
  _clipboard = {nodes, edges};
  toast(`已复制 ${nodes.length} 个节点`);
}
function pasteClipboard(wx, wy){
  if(!_clipboard){ toast('剪贴板为空'); return; }
  pushHistory();
  let minX=Infinity, minY=Infinity;
  _clipboard.nodes.forEach(nd=>{ minX=Math.min(minX,nd.x); minY=Math.min(minY,nd.y); });
  const dx = (wx!=null && wy!=null) ? (wx - minX) : 30;
  const dy = (wx!=null && wy!=null) ? (wy - minY) : 30;
  const idMap = new Map();
  const newNodes = [];
  _clipboard.nodes.forEach(nd=>{
    const id = uid();
    idMap.set(nd.id, id);
    const node = {id, type:nd.type, x:nd.x+dx, y:nd.y+dy, props:JSON.parse(JSON.stringify(nd.props)), title:nd.title||null, collapsed:!!nd.collapsed, el:null};
    state.nodes.set(id, node);
    renderNode(node);
    newNodes.push(id);
  });
  _clipboard.edges.forEach(ed=>{
    const fromId = idMap.get(ed.from), toId = idMap.get(ed.to);
    if(fromId && toId){
      const eid = 'e'+Math.random().toString(36).slice(2,9);
      state.edges.set(eid, {id:eid, from:{node:fromId,port:ed.fp}, to:{node:toId,port:ed.tp}});
    }
  });
  renderEdges();
  updateStats();
  evaluate();
  state.selected.clear();
  newNodes.forEach(id=>state.selected.add(id));
  refreshSelection();
  toast(`已粘贴 ${newNodes.length} 个节点`);
}

/* ── 保存/加载图（参考 ComfyUI UI 格式）────────── */
const GRAPH_VERSION = 0.4;

function _topoOrder(){
  const ids = [...state.nodes.keys()];
  const indeg = new Map(), succ = new Map();
  ids.forEach(id=>{ indeg.set(id,0); succ.set(id,[]); });
  state.edges.forEach(e=>{
    if(state.nodes.has(e.from.node) && state.nodes.has(e.to.node)){
      indeg.set(e.to.node, indeg.get(e.to.node)+1);
      succ.get(e.from.node).push(e.to.node);
    }
  });
  const queue = ids.filter(id=>indeg.get(id)===0);
  const order = [], seen = new Set();
  while(queue.length){
    const id = queue.shift();
    if(seen.has(id)) continue;
    seen.add(id); order.push(id);
    succ.get(id).forEach(t=>{ indeg.set(t, indeg.get(t)-1); if(indeg.get(t)===0) queue.push(t); });
  }
  ids.forEach(id=>{ if(!seen.has(id)) order.push(id); });
  return order;
}

function _maxIdNum(map){
  let max = 0;
  map.forEach((_,id)=>{ if(id) max = Math.max(max, parseInt(id.slice(1),36)||0); });
  return max;
}

function _widgetArrayToProps(type, arr){
  const keys = Object.keys(defaultProps(type));
  const p = {};
  arr.forEach((v,i)=>{ if(i<keys.length) p[keys[i]] = v; });
  return p;
}

function _coerceProps(nd){
  const w = nd.widgets_values;
  if(w && typeof w==='object' && !Array.isArray(w)) return JSON.parse(JSON.stringify(w));
  if(Array.isArray(w)) return _widgetArrayToProps(nd.type, w);
  if(nd.props && typeof nd.props==='object') return JSON.parse(JSON.stringify(nd.props));
  return defaultProps(nd.type);
}

function _graphToComfy(){
  const order = _topoOrder();
  const orderIdx = new Map();
  order.forEach((id,i)=>orderIdx.set(id,i));
  const outLinks = new Map(), inLink = new Map();
  state.edges.forEach((e,id)=>{
    if(!state.nodes.has(e.from.node)||!state.nodes.has(e.to.node)) return;
    const fk = e.from.node+':'+e.from.port;
    if(!outLinks.has(fk)) outLinks.set(fk,[]);
    outLinks.get(fk).push(id);
    inLink.set(e.to.node+':'+e.to.port, id);
  });
  const nodes = [];
  state.nodes.forEach((n)=>{
    const def = NODE_DEFS[n.type] || {inputs:[],outputs:[]};
    const inputs = def.inputs.map(p=>({name:p.n, type:p.t, link: inLink.get(n.id+':'+p.n) ?? null}));
    const outputs = def.outputs.map(p=>({name:p.n, type:p.t, links: outLinks.get(n.id+':'+p.n) || []}));
    const size = n.el ? {"0":n.el.offsetWidth, "1":n.el.offsetHeight} : {"0":220,"1":80};
    nodes.push({
      id:n.id, type:n.type, pos:[n.x, n.y], size, flags:{},
      order: orderIdx.get(n.id) ?? 0, mode:0,
      inputs, outputs, properties:{title:n.title||null, collapsed:!!n.collapsed},
      widgets_values: JSON.parse(JSON.stringify(n.props||{}))
    });
  });
  const links = [];
  state.edges.forEach((e,id)=>{
    if(!state.nodes.has(e.from.node)||!state.nodes.has(e.to.node)) return;
    const fDef = NODE_DEFS[state.nodes.get(e.from.node).type];
    const fPort = fDef && fDef.outputs.find(p=>p.n===e.from.port);
    links.push([id, e.from.node, e.from.port, e.to.node, e.to.port, fPort ? fPort.t : 'any']);
  });
  return {
    last_node_id: _maxIdNum(state.nodes),
    last_link_id: _maxIdNum(state.edges),
    nodes, links, groups:[], config:{}, extra:{}, version:GRAPH_VERSION
  };
}

function serializeGraph(){
  return JSON.stringify(_graphToComfy(), null, 2);
}
async function saveGraph(){
  if(state.nodes.size===0){ toast('画布为空'); return; }
  let name = _currentProject ? _currentProject.name : null;
  if(!name){
    const input = await uiPrompt({ title:'保存到节点项目', label:'项目名称', value:'未命名材质图' });
    if(input===null) return;
    name = input.trim();
    if(!name){ toast('项目名不能为空'); return; }
  }
  try {
    const data = await saveNodeProject(name, _currentProject ? _currentProject.id : undefined);
    toast('已保存到节点项目: ' + name + '（' + (data.dir || data.id) + '）');
  } catch(e){ toast('保存失败: ' + e.message); }
}

function _applyComfy(data){
  const nodes = (data.nodes||[]).filter(nd=>NODE_DEFS[nd.type]).map(nd=>{
    const pos = Array.isArray(nd.pos) ? nd.pos : [nd.x ?? 0, nd.y ?? 0];
    const pr = nd.properties || {};
    return {id:nd.id, type:nd.type, x:pos[0], y:pos[1], props:_coerceProps(nd), title:pr.title||null, collapsed:!!pr.collapsed};
  });
  const nodeIds = new Set(nodes.map(n=>n.id));
  const edges = (data.links||[]).map(lnk=>{
    if(Array.isArray(lnk)){
      const [id,fn,fp,tn,tp] = lnk;
      return {id, from:{node:fn,port:fp}, to:{node:tn,port:tp}};
    }
    return {id:lnk.id, from:lnk.from, to:lnk.to};
  }).filter(e=>nodeIds.has(e.from.node) && nodeIds.has(e.to.node));
  _restore({nodes, edges});
}

function loadGraphJSON(json){
  try {
    const data = typeof json==='string' ? JSON.parse(json) : json;
    if(!data || !Array.isArray(data.nodes)) throw new Error('格式无效');
    pushHistory();
    _history.suspend = true;
    _suspendAutoSave = true;
    _currentProject = null;
    if(Array.isArray(data.links)) _applyComfy(data);
    else _restore({nodes:data.nodes, edges:data.edges||[]});
    _history.suspend = false;
    _suspendAutoSave = false;
    _resetSavedState();
    toast(`已加载 ${data.nodes.length} 个节点`);
  } catch(e){
    _history.suspend = false;
    _suspendAutoSave = false;
    toast('加载失败: '+e.message);
  }
}
function loadGraph(){
  const f = document.createElement('input');
  f.type = 'file';
  f.accept = '.json';
  f.addEventListener('change', ()=>{
    const file = f.files[0];
    if(!file) return;
    const r = new FileReader();
    r.onload = ()=> loadGraphJSON(r.result);
    r.readAsText(file);
  });
  f.click();
}


/* ── 初始化示例 ─────────────────────────────── */
function initExample(){
  const r = canvasWrap.getBoundingClientRect();
  state.viewport.x = r.width/2 - 200;
  state.viewport.y = r.height/2 - 100;
  applyViewport();

  const num1 = createNode('number', -380, -120);
  num1.props.value = 0.8;
  const num2 = createNode('number', -380, 60);
  num2.props.value = 0.3;
  const color1 = createNode('color', -380, 220);
  color1.props.color = '#7cbd56';
  const mix = createNode('mix', -100, 0);

  // 重新渲染以应用 props
  [num1,num2,color1,mix].forEach(n=>{ n.el.remove(); renderNode(n); });

  // 连线
  function conn(fn,fp,tn,tp){
    const eid='e'+Math.random().toString(36).slice(2,9);
    state.edges.set(eid,{id:eid,from:{node:fn,port:fp},to:{node:tn,port:tp}});
  }
  conn(num1.id,'value',mix.id,'a');
  conn(num2.id,'value',mix.id,'b');
  conn(num1.id,'value',mix.id,'t');

  renderEdges(); updateStats(); evaluate();
  setTimeout(fitView, 100);
}

/* ── 导入贴图 ─────────────────────────────────── */
const importOverlay = $('#importOverlay');
const importBody = $('#importBody');
const importInfo = $('#importInfo');
const IMG_EXTS_IMP = new Set(['jpg','jpeg','png','gif','bmp','webp','svg','ico','tif','tiff','avif']);
const TEX_SUF_IMP = [['_n','normal'],['_s','specular']];

function buildTexGroups(entries){
  const groups = new Map();
  for(const e of entries){
    if(e.isDirectory) continue;
    const name = e.name;
    const dot = name.lastIndexOf('.');
    if(dot < 0) continue;
    if(!IMG_EXTS_IMP.has(name.slice(dot+1).toLowerCase())) continue;
    const base = name.slice(0, dot);
    let key = base, role = 'main';
    for(const [suf, r] of TEX_SUF_IMP){
      if(base.endsWith(suf)){ key = base.slice(0, -suf.length); role = r; break; }
    }
    if(!groups.has(key)) groups.set(key, {});
    groups.get(key)[role] = e;
  }
  return groups;
}

function texUrl(fullPath){ return `/api/file/raw?path=${encodeURIComponent(fullPath)}`; }

async function openImportDlg(){

  importOverlay.classList.add('open');
  importInfo.textContent = '加载中…';
  importBody.innerHTML = '<div class="import-loading">正在读取配置与扫描文件…</div>';
  try {
    const cfgRes = await fetch('/api/config').then(r => r.json());
    const cfg = (cfgRes && cfgRes.data) || {};
    const sides = [];
    if(cfg.leftPath) sides.push({ side:'left', label:cfg.leftPath, path:cfg.leftPath });
    if(cfg.rightPath) sides.push({ side:'right', label:cfg.rightPath, path:cfg.rightPath });
    if(sides.length === 0){
      importBody.innerHTML = '<div class="import-empty">未设置左右路径。请先在主页面选择左右文件夹后再来导入。</div>';
      importInfo.textContent = '无可用路径';
      return;
    }
    importBody.innerHTML = '';
    let totalGroups = 0;
    for(const s of sides){
      const sideEl = document.createElement('div');
      sideEl.className = 'import-side';
      const h4 = document.createElement('h4');
      h4.innerHTML = `<span class="caret">▾</span>${s.side==='left'?'◀ 左侧':'▶ 右侧'} <span class="tag">${s.label}</span>`;
      h4.addEventListener('click', () => sideEl.classList.toggle('collapsed'));
      sideEl.appendChild(h4);
      try {
        const scanRes = await fetch('/api/compare/scan', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ path:s.path, recursive:true })
        }).then(r => r.json());
        const entries = (scanRes && scanRes.data && scanRes.data.entries) || [];
        const groups = buildTexGroups(entries);
        if(groups.size === 0){
          sideEl.insertAdjacentHTML('beforeend', '<div class="import-empty">未发现贴图文件</div>');
          importBody.appendChild(sideEl);
          continue;
        }
        totalGroups += groups.size;
        const grid = document.createElement('div');
        grid.className = 'import-grid';
        groups.forEach((g, key) => {
          const card = document.createElement('div');
          card.className = 'import-card';
          const previewEntry = g.main || g.normal || g.specular;
          const roleTags = [];
          if(g.main) roleTags.push('<span class="r main">M</span>');
          if(g.normal) roleTags.push('<span class="r normal">N</span>');
          if(g.specular) roleTags.push('<span class="r specular">S</span>');
          card.innerHTML = `<div class="thumb">${previewEntry?`<img src="${texUrl(previewEntry.fullPath)}" alt="" loading="lazy">`:''}</div><div class="nm" title="${key}">${key}</div><div class="roles">${roleTags.join('')}</div>`;
          card._group = g;
          card._key = key;
          card.addEventListener('click', () => {
            card.classList.toggle('selected');
            updateImportInfo();
          });
          grid.appendChild(card);
        });
        sideEl.appendChild(grid);
      } catch(err) {
        sideEl.insertAdjacentHTML('beforeend', `<div class="import-empty">扫描失败：${err.message}</div>`);
      }
      importBody.appendChild(sideEl);
    }
    applyImportFilter();
  } catch(e){
    importBody.innerHTML = `<div class="import-empty">加载失败：${e.message}</div>`;
    importInfo.textContent = '加载失败';
  }
}

let importSearchTerm = '';
let importRoleFilter = 'all';
let importSort = 'name-asc';
function applyImportFilter(){
  const term = importSearchTerm.trim().toLowerCase();
  const cards = importOverlay.querySelectorAll('.import-card');
  let visible = 0, total = 0;
  cards.forEach(card => {
    total++;
    const key = (card._key || '').toLowerCase();
    const g = card._group || {};
    let roleOk = true;
    if(importRoleFilter === 'main') roleOk = !!g.main;
    else if(importRoleFilter === 'normal') roleOk = !!g.normal;
    else if(importRoleFilter === 'specular') roleOk = !!g.specular;
    const searchOk = !term || key.includes(term);
    const show = roleOk && searchOk;
    card.style.display = show ? '' : 'none';
    if(show) visible++;
  });
  const desc = importSort === 'name-desc';
  importOverlay.querySelectorAll('.import-grid').forEach(grid => {
    const arr = [...grid.children];
    arr.sort((a,b) => {
      const r = (a._key||'').localeCompare(b._key||'', 'zh');
      return desc ? -r : r;
    });
    arr.forEach(c => grid.appendChild(c));
  });
  const cnt = document.getElementById('importCount');
  if(cnt) cnt.textContent = total ? `共 ${total} 组 · 匹配 ${visible}` : '';
  updateImportInfo();
}

function updateImportInfo(){
  const n = importOverlay.querySelectorAll('.import-card.selected').length;
  importInfo.textContent = n > 0 ? `已选择 ${n} 个贴图组，点击"导入所选"创建节点。` : '点击贴图组卡片选择，再次点击取消。';
}

function doImport(){
  const cards = importOverlay.querySelectorAll('.import-card.selected');
  if(cards.length === 0) return;
  const r = canvasWrap.getBoundingClientRect();
  const wp = screenToWorld(r.left + r.width/2, r.top + r.height/2);
  let col = 0, row = 0, count = 0;
  const COLS = Math.min(cards.length, 4);
  cards.forEach(card => {
    const g = card._group;
    ['main','normal','specular'].forEach(role => {
      if(!g[role]) return;
      const entry = g[role];
      const node = createNode('texture', wp.x - 100 + col * 230, wp.y - 30 + row * 180);
      if(node){
        node.props.tex = texUrl(entry.fullPath);
        node.props._name = entry.name;
        node.props._role = role;
        const thumb = node.el.querySelector('.w-tex .thumb');
        const fn = node.el.querySelector('.w-tex .fn');
        if(thumb) thumb.innerHTML = `<img src="${node.props.tex}" alt="">`;
        if(fn) fn.textContent = entry.name.slice(0, 20);
        count++;
      }
    });
    col++;
    if(col >= COLS){ col = 0; row++; }
  });
  importOverlay.classList.remove('open');
  if(count > 0) toast(`已导入 ${count} 个贴图节点`);
}

document.getElementById('importSearch').addEventListener('input', e => { importSearchTerm = e.target.value; applyImportFilter(); });
document.querySelectorAll('#importRoleSeg button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#importRoleSeg button').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); importRoleFilter = b.dataset.role; applyImportFilter();
}));
document.querySelectorAll('#importSortSeg button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#importSortSeg button').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); importSort = b.dataset.sort; applyImportFilter();
}));
document.getElementById('importSelectAll').addEventListener('click', () => {
  importOverlay.querySelectorAll('.import-card').forEach(c => { if(c.style.display !== 'none') c.classList.add('selected'); });
  updateImportInfo();
});
document.getElementById('importClearAll').addEventListener('click', () => {
  importOverlay.querySelectorAll('.import-card.selected').forEach(c => c.classList.remove('selected'));
  updateImportInfo();
});
$('#btn-import').addEventListener('click', openImportDlg);
$('#importClose').addEventListener('click', () => importOverlay.classList.remove('open'));
$('#importCancel').addEventListener('click', () => importOverlay.classList.remove('open'));
$('#importOk').addEventListener('click', doImport);

// 点击遮罩区域关闭导入对话框
importOverlay.addEventListener('click', e => { if(e.target === importOverlay) importOverlay.classList.remove('open'); });

/* ── 对外暴露：供节点库 / 资产库面板直接调用 ─────────── */
function _defColorHex(def){
  const c = def && def.color;
  if(!c) return '#9a9a9a';
  const m = /var\(--type-([\w-]+)\)/.exec(c);
  if(m) return typeColor(m[1]);
  if(c.startsWith('var(')){
    const name = c.slice(4, -1).trim();
    try{ return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#9a9a9a'; }
    catch(e){ return '#9a9a9a'; }
  }
  return c;
}
export function getGraphInfo(){
  const nodes = [];
  state.nodes.forEach(n => nodes.push({ id:n.id, type:n.type, title:n.title||null }));
  const edges = [];
  state.edges.forEach(e => edges.push({
    id:e.id,
    from:{ node:e.from.node, port:e.from.port },
    to:{ node:e.to.node, port:e.to.port },
  }));
  const defs = {};
  state.nodes.forEach(n => {
    if(defs[n.type]) return;
    const d = NODE_DEFS[n.type];
    if(!d) return;
    defs[n.type] = {
      title:d.title, group:d.group||'', color:_defColorHex(d),
      inputs:(d.inputs||[]).map(p=>({n:p.n,t:p.t})),
      outputs:(d.outputs||[]).map(p=>({n:p.n,t:p.t})),
    };
  });
  return { nodes, edges, defs };
}
/* 节点预览窗口：选中节点完整信息（props / 预览图 / 计算输出 / 连接） */
export function getNodeDetail(id){
  const n = state.nodes.get(id);
  if(!n) return null;
  const def = NODE_DEFS[n.type];
  if(!def) return null;
  let previewUrl = null;
  let previewKind = 'none';
  if(_NOISE_PV_TYPES.has(n.type)){
    previewUrl = _noisePreviewUrl(n);
    previewKind = 'image';
  } else if(typeof n.props.tex === 'string' && n.props.tex){
    previewUrl = n.props.tex;
    previewKind = 'image';
  } else if(typeof n.props.color === 'string' && n.props.color){
    previewKind = 'color';
  } else if(typeof n.props.value === 'number'){
    previewKind = 'value';
  }
  const evalOut = {};
  const r = state._results ? state._results.get(id) : null;
  if(r){
    for(const k in r){
      const v = r[k];
      const tv = typeof v;
      if(tv === 'number') evalOut[k] = Math.round(v * 1e4) / 1e4;
      else if(tv === 'string' || tv === 'boolean') evalOut[k] = v;
      else if(Array.isArray(v)) evalOut[k] = v.slice(0, 8).map(x => (typeof x === 'number' ? Math.round(x * 1e4) / 1e4 : String(x)));
    }
  }
  const nodeTitle = (nid) => {
    const m = state.nodes.get(nid);
    if(!m) return nid;
    const md = NODE_DEFS[m.type];
    return m.title || (md ? md.title : nid);
  };
  const connIn = [], connOut = [];
  state.edges.forEach(e => {
    if(e.to.node === id) connIn.push({ port:e.to.port, from:e.from.node, fromPort:e.from.port, fromTitle:nodeTitle(e.from.node) });
    if(e.from.node === id) connOut.push({ port:e.from.port, to:e.to.node, toPort:e.to.port, toTitle:nodeTitle(e.to.node) });
  });
  return {
    id:n.id, type:n.type, title:n.title || def.title,
    def:{
      title:def.title, group:def.group||'', color:_defColorHex(def),
      inputs:(def.inputs||[]).map(p=>({n:p.n,t:p.t})),
      outputs:(def.outputs||[]).map(p=>({n:p.n,t:p.t})),
    },
    props:JSON.parse(JSON.stringify(n.props)),
    previewUrl, previewKind,
    evalOut,
    connections:{ inputs:connIn, outputs:connOut },
  };
}
export function focusNodeInCanvas(id){
  const n = state.nodes.get(id);
  if(!n) return false;
  selectNode(id, false);
  const w = n.el ? n.el.offsetWidth : 200;
  const h = n.el ? n.el.offsetHeight : 100;
  const wx = n.x + w/2, wy = n.y + h/2;
  const r = canvasWrap.getBoundingClientRect();
  const z = Math.max(state.viewport.zoom, 0.85);
  state.viewport.zoom = z;
  state.viewport.x = r.width/2 - wx*z;
  state.viewport.y = r.height/2 - wy*z;
  applyViewport();
  return true;
}
export { createNode, startEdge as _debugStartEdge, finishEdge as _debugFinishEdge, saveGraph as _debugSaveGraph, loadGraphJSON as _debugLoadGraphJSON, evaluate as _debugEvaluate, _noiseGrid as _debugNoiseGrid, _gridToImageData as _debugGridToImageData, _noiseValue as _debugNoiseValue, _paletteRGB as _debugPaletteRGB, _psBlendApply as _debugPsBlendApply, _libPreviewHTML as _debugLibPreviewHTML, _genLibPreview as _debugGenLibPreview, _BLEND_MODE_OF as _debugBlendModeOf };

/* ── 节点项目管理：保存 / 加载（.mtgp 特殊格式，自包含工程）── */
const _TEX_REF_PREFIX = '@tex/';
function _safeTexName(name, i){
  const base = (typeof name==='string' && name.trim())
    ? name.trim().replace(/[\\/:*?"<>|\s]/g,'_').slice(0,64) : '';
  const ext = base && /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|svg|ico)$/i.test(base) ? '' : '.png';
  const safe = base || ('texture_'+i);
  return i+'-'+safe+ext;
}
function _texRef(file){ return _TEX_REF_PREFIX+file; }
function _rawTexUrl(absPath){ return '/api/file/raw?path='+encodeURIComponent(absPath); }

function _collectProjectTextures(graph){
  const textures = [];
  const nodeTex = new Map();
  state.nodes.forEach(node=>{
    if((node.type==='texture'||node.type==='mainTex') && node.props.tex) nodeTex.set(node.id, node.props);
  });
  let i = 0;
  graph.nodes.forEach(nd=>{
    const p = nodeTex.get(nd.id);
    if(!p) return;
    const src = p.tex;
    let name = p._name || '';
    let entry = null;
    if(src.startsWith('data:')){
      entry = { name, dataUrl: src };
    } else {
      const m = /[?&]path=([^&]+)/.exec(src);
      if(m){
        try {
          const abs = decodeURIComponent(m[1]);
          if(!name) name = abs.split(/[\\/]/).pop() || '';
          entry = { name, path: abs };
        } catch(e){}
      }
    }
    if(!entry) return;
    const file = _safeTexName(entry.name, i);
    nd.widgets_values = nd.widgets_values && typeof nd.widgets_values==='object' ? JSON.parse(JSON.stringify(nd.widgets_values)) : {};
    nd.widgets_values.tex = _texRef(file);
    textures.push({ name: entry.name, path: entry.path, dataUrl: entry.dataUrl });
    i++;
  });
  return textures;
}

function _generateProjectThumb(){
  return new Promise(resolve=>{
    const S = 256, CELL = 3;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    const sources = [];
    state.nodes.forEach(node=>{
      if((node.type==='texture'||node.type==='mainTex') && node.props.tex){
        sources.push({kind:'img', src: node.props.tex});
      } else if(_NOISE_PV_TYPES.has(node.type)){
        const u = _noisePreviewUrl(node);
        if(u) sources.push({kind:'img', src: u});
      } else if(node.type==='color' && node.props.color){
        sources.push({kind:'color', color: node.props.color});
      }
    });
    const picked = sources.slice(0, CELL*CELL);
    const done = ()=>{
      if(!picked.length){
        const g = ctx.createLinearGradient(0,0,S,S);
        g.addColorStop(0,'#1c2230'); g.addColorStop(1,'#2a3348');
        ctx.fillStyle = g; ctx.fillRect(0,0,S,S);
        ctx.fillStyle = '#7cbd56';
        ctx.font = 'bold 28px ui-monospace,monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(state.nodes.size+' 节点', S/2, S/2);
      }
      resolve(c.toDataURL('image/png'));
    };
    if(!picked.length){ done(); return; }
    const imgs = picked.map(p=> p.kind==='img' ? _loadImg(p.src) : Promise.resolve(null));
    Promise.all(imgs).then(loaded=>{
      const n = picked.length;
      const grid = Math.ceil(Math.sqrt(n));
      const cellW = S/grid, cellH = S/Math.ceil(n/grid);
      picked.forEach((p, idx)=>{
        const x = (idx%grid)*cellW, y = Math.floor(idx/grid)*cellH;
        const im = loaded[idx];
        if(p.kind==='color' || !im){
          ctx.fillStyle = p.kind==='color' ? p.color : '#262b38';
          ctx.fillRect(x+1, y+1, cellW-2, cellH-2);
        } else {
          const r = Math.min(cellW/im.naturalWidth, cellH/im.naturalHeight);
          const w = im.naturalWidth*r, h = im.naturalHeight*r;
          ctx.drawImage(im, x+(cellW-w)/2, y+(cellH-h)/2, w, h);
        }
      });
      done();
    }).catch(done);
  });
}



/* 记忆最近一次打开/保存的项目 id（config.lastNodeProject），供启动时自动恢复 */
function _rememberProject(id){
  try{ if(window.api && window.api.setConfig) window.api.setConfig({ lastNodeProject: id || null }); }catch(e){}
}

/* 启动恢复：读取 lastNodeProject 并静默加载；无记忆/加载失败时回退示例图 */
async function _restoreLastProject(){
  let lastId = null
  try{
    const cfg = await window.api.getConfig()
    lastId = cfg && cfg.lastNodeProject
  }catch(e){}
  if(!lastId) return false
  try{
    const data = await loadNodeProject(lastId)
    toast('已恢复上次项目「' + (data && data.name ? data.name : lastId) + '」')
    return true
  }catch(e){ return false }
}

/* ── 当前节点项目（Ctrl+S / 保存按钮的目标地址：data/node-projects/<id>.mtgp/）── */
let _currentProject = null;
export function getCurrentProject(){ return _currentProject ? { ..._currentProject } : null; }

/* ── 项目指示器 + 自动保存 ────────────────────
   画布头部显示当前打开的项目；内容变化（增删节点/连线/属性/位置）时标记脏，
   防抖后自动保存到当前项目；保存/加载/清空后随时刷新指示器。 */
const AUTOSAVE_DELAY = 2500;
let _dirty = false;
let _autoSaveTimer = null;
let _suspendAutoSave = false;
let _saving = false;
let _lastSavedSig = null;

function _graphSignature(){
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

function _updateProjectIndicator(){
  const badge = document.getElementById('ncProject');
  const stat = document.getElementById('stat-project');
  const name = _currentProject ? _currentProject.name : null;
  if(badge){
    const nm = badge.querySelector('.nc-project-name');
    if(nm) nm.textContent = name ? name : '未关联项目';
    badge.classList.toggle('linked', !!name);
    badge.classList.toggle('dirty', !!name && _dirty);
    badge.title = name
      ? `当前节点项目：${name}（${_currentProject.id}）· ${_dirty ? '有未保存更改' : '已保存'}`
      : '当前节点项目：未关联（Ctrl+S 保存后自动关联）';
  }
  if(stat){
    stat.textContent = name ? name : '—';
    stat.parentElement && (stat.parentElement.title = name
      ? `当前打开的节点项目：${name}` : '未关联节点项目');
  }
}

function _setAutoSaveState(kind, text){
  const seg = document.getElementById('seg-autosave');
  const b = document.getElementById('stat-autosave');
  if(b) b.textContent = text;
  if(seg){
    seg.classList.remove('saving','saved','error');
    if(kind) seg.classList.add(kind);
  }
}

function _markDirty(){
  if(_suspendAutoSave) return;
  if(!_dirty){ _dirty = true; _updateProjectIndicator(); }
  if(!_currentProject) return;
  if(_autoSaveTimer) clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(()=>{ _autoSaveTimer=null; _autoSave(); }, AUTOSAVE_DELAY);
}

function _resetSavedState(){
  _dirty = false;
  if(_autoSaveTimer){ clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }
  try { _lastSavedSig = state.nodes.size ? _graphSignature() : null; } catch(e){ _lastSavedSig = null; }
  if(_currentProject) _setAutoSaveState('saved', '已就绪');
  else _setAutoSaveState(null, '—');
  _updateProjectIndicator();
}

async function _autoSave(force, opts){
  if(!_currentProject || !_dirty || _saving || _suspendAutoSave) return;
  if(state.nodes.size === 0) return;
  let sig = null;
  try { sig = _graphSignature(); } catch(e){}
  if(sig !== null && sig === _lastSavedSig){
    _dirty = false;
    _setAutoSaveState('saved', '已保存');
    _updateProjectIndicator();
    return;
  }
  _saving = true;
  _setAutoSaveState('saving', '自动保存中…');
  _updateProjectIndicator();
  const proj = { ..._currentProject };
  try {
    await saveNodeProject(proj.name, proj.id, { keepalive: !!(opts && opts.keepalive) });
    if(_currentProject && _currentProject.id === proj.id){
      _dirty = false;
      _lastSavedSig = sig;
      const t = new Date();
      const hh = String(t.getHours()).padStart(2,'0');
      const mm = String(t.getMinutes()).padStart(2,'0');
      const ss = String(t.getSeconds()).padStart(2,'0');
      _setAutoSaveState('saved', `已保存 ${hh}:${mm}:${ss}`);
    }
  } catch(e){
    if(_currentProject && _currentProject.id === proj.id){
      _setAutoSaveState('error', '失败·稍后重试');
      if(_autoSaveTimer) clearTimeout(_autoSaveTimer);
      _autoSaveTimer = setTimeout(()=>{ _autoSaveTimer=null; _autoSave(); }, 10000);
    }
  } finally {
    _saving = false;
    _updateProjectIndicator();
  }
}

document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'hidden' && _currentProject && _dirty) _autoSave(true);
});
window.addEventListener('beforeunload', (e)=>{
  if(_currentProject && _dirty && state.nodes.size > 0){
    _autoSave(true, { keepalive: true });
    e.preventDefault();
    e.returnValue = '';
  }
});

export async function saveNodeProject(name, id, opts){
  if(state.nodes.size===0) throw new Error('画布为空');
  const graph = _graphToComfy();
  const textures = _collectProjectTextures(graph);
  const thumbnail = await _generateProjectThumb();
  const res = await fetch(apiUrl('/api/node-projects'), {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ id: id||undefined, name, graph, thumbnail, textures }),
    ...(opts && opts.keepalive ? { keepalive: true } : {})
  });
  const j = await res.json();
  if(!j || !j.ok) throw new Error((j && j.msg) || '保存失败');
  _currentProject = { id: j.data.id, name };
  _rememberProject(j.data.id);
  _resetSavedState();
  try{ document.dispatchEvent(new CustomEvent('nodeproject:saved', { detail:{ id:_currentProject.id, name:_currentProject.name } })); }catch(e){}
  return j.data;
}

export async function loadNodeProject(id){
  const res = await fetch(apiUrl('/api/node-projects/'+encodeURIComponent(id)));
  const j = await res.json();
  if(!j || !j.ok) throw new Error((j && j.msg) || '加载失败');
  const data = j.data;
  const graph = JSON.parse(JSON.stringify(data.graph));
  const urlByFile = new Map();
  (data.textures||[]).forEach(t=>{ if(t.exists) urlByFile.set(t.file, _rawTexUrl(t.fullPath)); });
  let json = JSON.stringify(graph);
  urlByFile.forEach((url, file)=>{
    json = json.split(JSON.stringify(_texRef(file))).join(JSON.stringify(url));
  });
  loadGraphJSON(json);
  _currentProject = { id: data.id || id, name: data.name || id };
  _rememberProject(data.id || id);
  _resetSavedState();
  setTimeout(fitView, 80);
  return data;
}

export function addNodeAt(type, x, y){
  if(!canvasWrap) return null;
  const r = canvasWrap.getBoundingClientRect();
  const wp = screenToWorld(r.left + r.width/2, r.top + r.height/2);
  return createNode(type, x != null ? x : wp.x, y != null ? y : wp.y);
}

export function addTextureAt(path, name, x, y){
  if(!canvasWrap) return null;
  const r = canvasWrap.getBoundingClientRect();
  const wp = screenToWorld(r.left + r.width/2, r.top + r.height/2);
  const node = createNode('texture', x != null ? x : wp.x, y != null ? y : wp.y);
  if(node){
    node.props.tex = (typeof path==='string' && path.startsWith('data:')) ? path : texUrl(path);
    node.props._name = name || '';
    const thumb = node.el.querySelector('.w-tex .thumb');
    const fn = node.el.querySelector('.w-tex .fn');
    if(thumb) thumb.innerHTML = `<img src="${node.props.tex}" alt="">`;
    if(fn) fn.textContent = (name || '').slice(0, 20);
    evaluate();
  }
  return node;
}

function _centerXY(ox, oy){
  const r = canvasWrap.getBoundingClientRect();
  const wp = screenToWorld(r.left + r.width/2, r.top + r.height/2);
  return { x: wp.x + (ox||0), y: wp.y + (oy||0) };
}

function _buildMaterialPreset(baseColor, roughness, metallic){
  const c = _centerXY(-220, -40);
  const colorNode = createNode('color', c.x, c.y);
  if(colorNode) colorNode.props.color = baseColor;
  const roughNode = createNode('number', c.x, c.y + 80);
  if(roughNode) roughNode.props.value = roughness;
  const metalNode = createNode('number', c.x + 120, c.y + 80);
  if(metalNode) metalNode.props.value = metallic;
  [colorNode, roughNode, metalNode].forEach(n => { if(n){ n.el.remove(); renderNode(n); } });
  renderEdges(); updateStats(); evaluate();
}
const _PRESET_RECIPES = {
  metal:    () => _buildMaterialPreset('#c8c8d0', 0.25, 1.0),
  plastic:  () => _buildMaterialPreset('#e0e0e0', 0.5, 0.0),
  glass:    () => _buildMaterialPreset('#e0eef5', 0.05, 0.0),
  fabric:   () => _buildMaterialPreset('#b39880', 0.9, 0.0),
  emissive: () => _buildMaterialPreset('#fff3c0', 0.5, 0.0),
};
export function loadPreset(name){
  const fn = _PRESET_RECIPES[name];
  if(!fn){ toast('未知预设: '+name); return; }
  fn();
  toast('已加载预设: '+name);
}

/* 自定义画布预设：导出当前图（ComfyUI 格式对象）/ 整图恢复 */
export function serializeGraphData(){ return _graphToComfy(); }
export function loadCanvasPresetGraph(graph){
  if(!graph || !Array.isArray(graph.nodes) || !graph.nodes.length){ toast('画布预设为空'); return; }
  loadGraphJSON(typeof graph==='string' ? graph : JSON.stringify(graph));
  setTimeout(fitView, 80);
}

export function initNodeCanvas(){
  if(_initialized) return;
  // 小地图需要节点强调色：注入 NODE_DEFS 的读取方式（避免 viewport 反向依赖编辑器）
  setNodeColorResolver((node)=>{
    const def = NODE_DEFS[node.type];
    return (def && def.color) || '#888';
  });
  _initialized = true;
  buildLibrary();
  initExample();
  _resetSavedState();
  _restoreLastProject();   // 恢复成功时内部清掉示例图并重渲染；失败则保持示例图
  const _c = document.getElementById('material3dContainer');
  if(_c && m3d.initMaterial3D) m3d.initMaterial3D(_c);
  evaluate();
  toast('节点画布就绪 · 右侧实时预览联动 3D 材质引擎');
}
export function refreshNodePreview(){ if(_initialized) evaluate(); }


/* ── 模块接线：把编辑器实现注入已拆出的子模块 ─────────────
   在文件末尾统一执行，不依赖 initNodeCanvas 的调用时机（单测可直接用
   createNode/getNodeDetail 而不需要先跑初始化）。所有被引用的函数均为
   函数声明（提升）或已在文件前部定义的 const，此处执行顺序安全。 */
setWidgetHooks({ evaluate, markDirty: _markDirty, toast });
setStatusHooks({ markDirty: _markDirty });
setEdgeHooks({ typeColor, edgePath, selectEdge, canConnect, evaluate, pushHistory });
setEvalHooks({ nodeDefs: () => NODE_DEFS, syncToPreview, _renderNoisePreview, _renderPreviewVal, updatePreview });
setHistoryHooks({ renderNode, renderEdges, updateStats, evaluate, toast });
setGestureHooks({ showNodeMenu, showCanvasMenu });

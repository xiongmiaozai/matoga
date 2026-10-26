
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
import { nodesLayer, setNodeHooks, toggleCollapse, createNode, renderNode, defaultProps, escapeHtml, deleteNode, selectNode, refreshSelection } from './node-canvas/nodes.js'
import {
  _showAlignGuide, _clearAlignGuides, _alignGuides, typeColor, edgePath,
  selectEdge, canConnect, finishEdge, createsCycle, cleanupEdgeDrag,
} from './node-canvas/edge-glue.js'
import { buildLibrary, libraryEl, _BLEND_MODE_OF, _libPreviewHTML, _genLibPreview } from './node-canvas/library.js'
import { fitView, autoLayout } from './node-canvas/layout.js'
import { initExample } from './node-canvas/example.js'
export { getGraphInfo, getNodeDetail, focusNodeInCanvas } from './node-canvas/api.js'
import { $, NS } from './node-canvas/dom.js'
export { buildPreview2DRows } from './node-canvas/preview-sync.js'


let _initialized = false;

/* $ 与 NS 已移至 node-canvas/dom.js */

/* 节点类型定义 已移至 node-canvas/defs.js */
/* 节点创建/渲染 已移至 node-canvas/nodes.js */

/* 拖拽对齐辅助线 + 连线几何 已移至 node-canvas/edge-glue.js */

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
    markDirty();
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
          clearCurrentProject();
          renderEdges(); updateStats(); evaluate();
          resetSavedState();
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
/* toggleCollapse 已移至 node-canvas/nodes.js */
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

/* 节点库面板 已移至 node-canvas/library.js */

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
    clearCurrentProject();
    rememberProject(null);
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

/* fitView / autoLayout 已移至 node-canvas/layout.js */


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
  let name = getCurrentProject() ? getCurrentProject().name : null;
  if(!name){
    const input = await uiPrompt({ title:'保存到节点项目', label:'项目名称', value:'未命名材质图' });
    if(input===null) return;
    name = input.trim();
    if(!name){ toast('项目名不能为空'); return; }
  }
  try {
    const data = await saveNodeProject(name, getCurrentProject() ? getCurrentProject().id : undefined);
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
    setAutoSaveSuspended(true);
    clearCurrentProject();
    if(Array.isArray(data.links)) _applyComfy(data);
    else _restore({nodes:data.nodes, edges:data.edges||[]});
    _history.suspend = false;
    setAutoSaveSuspended(false);
    resetSavedState();
    toast(`已加载 ${data.nodes.length} 个节点`);
  } catch(e){
    _history.suspend = false;
    setAutoSaveSuspended(false);
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


/* 初始化示例 已移至 node-canvas/example.js */

/* 导入贴图对话框 已移至 node-canvas/import-dlg.js */
import { importOverlay, importBody, importInfo, IMG_EXTS_IMP, TEX_SUF_IMP,
  buildTexGroups, texUrl, openImportDlg, applyImportFilter, updateImportInfo,
  doImport, setImportSearchTerm, setImportRoleFilter, setImportSort } from './node-canvas/import-dlg.js'
/* 对外查询 API 已移至 node-canvas/api.js */
export { startEdge as _debugStartEdge, finishEdge as _debugFinishEdge, saveGraph as _debugSaveGraph, loadGraphJSON as _debugLoadGraphJSON, evaluate as _debugEvaluate, _noiseGrid as _debugNoiseGrid, _gridToImageData as _debugGridToImageData, _noiseValue as _debugNoiseValue, _paletteRGB as _debugPaletteRGB, _psBlendApply as _debugPsBlendApply, _libPreviewHTML as _debugLibPreviewHTML, _genLibPreview as _debugGenLibPreview, _BLEND_MODE_OF as _debugBlendModeOf };
export { createNode } from './node-canvas/nodes.js'

/* 节点项目管理 + 自动保存 已移至 node-canvas/project.js */
import { getCurrentProject, setCurrentProject, clearCurrentProject,
  rememberProject, restoreLastProject, markDirty, resetSavedState,
  saveNodeProject, loadNodeProject, setProjectHooks, setAutoSaveSuspended } from './node-canvas/project.js'
export { getCurrentProject, saveNodeProject, loadNodeProject } from './node-canvas/project.js'
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
  resetSavedState();
  restoreLastProject();   // 恢复成功时内部清掉示例图并重渲染；失败则保持示例图
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
setWidgetHooks({ evaluate, markDirty: markDirty, toast });
setNodeHooks({ markDirty: markDirty });
setStatusHooks({ markDirty: markDirty });
setEdgeHooks({ typeColor, edgePath, selectEdge, canConnect, evaluate, pushHistory });
setEvalHooks({ nodeDefs: () => NODE_DEFS, syncToPreview, _renderNoisePreview, _renderPreviewVal, updatePreview });
setHistoryHooks({ renderNode, renderEdges, updateStats, evaluate, toast });
setGestureHooks({ showNodeMenu, showCanvasMenu });
setProjectHooks({ graphToComfy: _graphToComfy, loadGraphJSON });

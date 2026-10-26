/* ── 全局事件（指针 / 缩放 / 右键 / 键盘）─────────
   从 node-canvas.js 搬出，逻辑未改。
   原本是顶层副作用，现包成 wireEvents()，由主文件在末尾调用。 */
import { state } from './state.js'
import { $ } from './dom.js'
import { canvasWrap, world, gridBg, applyViewport, screenToWorld, setZoom, updateMinimap } from './viewport.js'
import { NODE_DEFS } from './defs.js'
import { nodesLayer, refreshSelection, deleteNode, renderNode } from './nodes.js'
import { renderEdges } from './edges.js'
import { updateStats } from './status.js'
import { evaluate } from './evaluate.js'
import { pushHistory, undo, redo } from './history.js'
import { pointers, getPinch, setPinch, clearLongPress, startLongPress, checkLongPressMove } from './gestures.js'
import { clamp } from './algorithms.js'
import { edgesSvg } from './edges.js'
import { typeColor, edgePath, finishEdge, cleanupEdgeDrag, _alignGuides, _clearAlignGuides } from './edge-glue.js'
import { fitView, autoLayout } from './layout.js'
import { saveGraph } from './graph-io.js'
import { showCanvasMenu, showNodeMenu, closeCtxMenu, duplicateNode, cutSelection } from './menus.js'
import { copySelection, pasteClipboard } from './clipboard.js'
import { importOverlay } from './import-dlg.js'
import { markDirty } from './project.js'
import { NS } from './dom.js'

export function wireEvents(){
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
}

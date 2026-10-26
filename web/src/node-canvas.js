
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

/* 右键菜单 + 节点操作 已移至 node-canvas/menus.js */
import { closeCtxMenu, showCanvasMenu, showNodeMenu, duplicateNode, renameNode,
  disconnectNode, selectUpstream, selectDownstream, selectAll, cutSelection } from './node-canvas/menus.js'
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


/* 复制/粘贴 已移至 node-canvas/clipboard.js */
import { copySelection, pasteClipboard } from './node-canvas/clipboard.js'

/* 图序列化（保存/加载 ComfyUI 格式）已移至 node-canvas/graph-io.js */
import { _topoOrder, _graphToComfy, serializeGraph,
  saveGraph, loadGraphJSON, loadGraph } from './node-canvas/graph-io.js'
export { serializeGraph, saveGraph, loadGraphJSON, loadGraph } from './node-canvas/graph-io.js'
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

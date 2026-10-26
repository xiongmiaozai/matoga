
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

/* 全局事件 已移至 node-canvas/events.js */
/* 右键菜单 + 节点操作 已移至 node-canvas/menus.js */
import { closeCtxMenu, showCanvasMenu, showNodeMenu, duplicateNode, renameNode,
  disconnectNode, selectUpstream, selectDownstream, selectAll, cutSelection } from './node-canvas/menus.js'
/* 节点库面板 已移至 node-canvas/library.js */

/* 工具栏 / 面板交互 已移至 node-canvas/toolbar.js */
import { wireToolbar } from './node-canvas/toolbar.js'
import { wireEvents } from './node-canvas/events.js'
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

/* 材质预设 / 画布预设 已移至 node-canvas/presets.js */
import { loadPreset } from './node-canvas/presets.js'
export { loadPreset, serializeGraphData, loadCanvasPresetGraph } from './node-canvas/presets.js'
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
wireToolbar();
wireEvents();

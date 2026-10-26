/* ── 材质预设 / 画布预设 ────────────────────────
   从 node-canvas.js 原样搬出，逻辑未改。 */
import { canvasWrap, screenToWorld } from './viewport.js'
import { createNode, renderNode } from './nodes.js'
import { renderEdges } from './edges.js'
import { updateStats, toast } from './status.js'
import { evaluate } from './evaluate.js'
import { fitView } from './layout.js'
import { _graphToComfy, loadGraphJSON } from './graph-io.js'

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

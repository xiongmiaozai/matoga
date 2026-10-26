/* ── 对外查询 API（供节点库 / 资产库面板调用）─────── */
/* 从 node-canvas.js 原样搬出，逻辑未改。 */
import { state } from './state.js'
import { NODE_DEFS } from './defs.js'
import { canvasWrap, applyViewport } from './viewport.js'
import { selectNode } from './nodes.js'
import { typeColor } from './edge-glue.js'
import { _NOISE_PV_TYPES, _noisePreviewUrl } from './algorithms.js'

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

/* ── 图的序列化 / 反序列化（ComfyUI 参考格式）──────
   从 node-canvas.js 原样搬出，逻辑未改。 */
import { state } from './state.js'
import { NODE_DEFS } from './defs.js'
import { defaultProps } from './nodes.js'
import { toast } from './status.js'
import { uiPrompt } from '../ui-dialog.js'
import { pushHistory, _history, _restore } from './history.js'
import { getCurrentProject, saveNodeProject, clearCurrentProject,
  setAutoSaveSuspended, resetSavedState } from './project.js'

const GRAPH_VERSION = 0.4;

export function _topoOrder(){
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

export function _graphToComfy(){
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

export function serializeGraph(){
  return JSON.stringify(_graphToComfy(), null, 2);
}
export async function saveGraph(){
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

export function loadGraphJSON(json){
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
export function loadGraph(){
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

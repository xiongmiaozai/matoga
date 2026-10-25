/**
 * matoga - node canvas evaluation engine (topological order + per-node eval)
 * Copyright (c) 2026 芝世 (xiongmiaozai). MIT
 */

import { hexToRgb, _NOISE_PV_TYPES } from './algorithms.js'
import { state } from './state.js'

let _hooks = {
  nodeDefs: () => ({}),
  syncToPreview: () => {},
  _renderNoisePreview: () => {},
  _renderPreviewVal: () => {},
  updatePreview: () => {},
}

/** Inject editor callbacks. */
export function setEvalHooks(hooks) { _hooks = Object.assign(_hooks, hooks) }

const nodeDefs = () => _hooks.nodeDefs()
const syncToPreview = (...a) => _hooks.syncToPreview(...a)
const _renderNoisePreview = (...a) => _hooks._renderNoisePreview(...a)
const _renderPreviewVal = (...a) => _hooks._renderPreviewVal(...a)
const updatePreview = (...a) => _hooks.updatePreview(...a)

export function evaluate(){
  // 拓扑排序
  const ids = [...state.nodes.keys()];
  const indeg = new Map();
  const deps = new Map(); // nodeId -> [inputNodeIds]
  ids.forEach(id=>{indeg.set(id,0); deps.set(id,[]);});
  state.edges.forEach(e=>{
    if(state.nodes.has(e.from.node) && state.nodes.has(e.to.node)){
      indeg.set(e.to.node, indeg.get(e.to.node)+1);
      deps.get(e.to.node).push(e.from.node);
    }
  });
  const queue = ids.filter(id=>indeg.get(id)===0);
  const order = [];
  const seen = new Set();
  while(queue.length){
    const id = queue.shift();
    if(seen.has(id)) continue;
    seen.add(id); order.push(id);
    // 找出以此节点为输入的边
    state.edges.forEach(e=>{
      if(e.from.node===id){
        indeg.set(e.to.node, indeg.get(e.to.node)-1);
        if(indeg.get(e.to.node)===0) queue.push(e.to.node);
      }
    });
  }
  // 计算
  const results = new Map(); // nodeId -> {portName: value}
  order.forEach(id=>{
    const node = state.nodes.get(id);
    const def = nodeDefs()[node.type] || { inputs: [], outputs: [] };
    const inputs = {};
    def.inputs.forEach(p=>{
      // 找到连入此端口的边
      let val = undefined;
      for(const e of state.edges.values()){
        if(e.to.node===id && e.to.port===p.n){
          const r = results.get(e.from.node);
          if(r) val = r[e.from.port];
        }
      }
      inputs[p.n] = val;
    });
    let out = {};
    if(def.eval){
      try { out = def.eval(inputs, node) || {}; } catch(err){ out = {}; }
    }
    // 输入类节点：直接从 props 取
    if(node.type==='number') out.value = +node.props.value;
    else if(node.type==='color') out.color = hexToRgb(node.props.color);
    else if(node.type==='texture') out.tex = node.props.tex || null;
    else if(node.type==='vector2') out.v = [+node.props.x, +node.props.y];
    else if(node.type==='hdr') out.env = node.props.preset;
    results.set(id, out);
    // 更新预览
    if(node._previewEl){
      updatePreview(node, inputs, results);
    }
    if(node._outPreviewEl){
      const _on = def.outputs[0] ? def.outputs[0].n : null;
      if(_NOISE_PV_TYPES.has(node.type)){
        _renderNoisePreview(node, _on ? out[_on] : undefined);
      } else {
        _renderPreviewVal(node._outPreviewEl, _on ? out[_on] : undefined);
      }
    }
  });
  state._results = results;
  syncToPreview(results);
}

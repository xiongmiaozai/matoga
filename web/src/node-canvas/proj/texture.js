/**
 * matoga - 节点项目：项目贴图收集与缩略图
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 project.js 按职责搬出，逻辑未改。
 */

import { _NOISE_PV_TYPES, _noisePreviewUrl } from '../algorithms.js'
import { _loadImg } from '../tex-utils.js'

import { state } from '../state.js'

/* ── 节点项目管理：保存 / 加载（.mtgp 特殊格式，自包含工程）── */
export const _TEX_REF_PREFIX = '@tex/';
export function _safeTexName(name, i){
  const base = (typeof name==='string' && name.trim())
    ? name.trim().replace(/[\\/:*?"<>|\s]/g,'_').slice(0,64) : '';
  const ext = base && /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|svg|ico)$/i.test(base) ? '' : '.png';
  const safe = base || ('texture_'+i);
  return i+'-'+safe+ext;
}
export function _texRef(file){ return _TEX_REF_PREFIX+file; }
export function _rawTexUrl(absPath){ return '/api/file/raw?path='+encodeURIComponent(absPath); }

export function _collectProjectTextures(graph){
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

export function _generateProjectThumb(){
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



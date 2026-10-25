/* 预览联动层：把求值结果推送到 3D / 2D 预览。
   从 node-canvas.js 原样搬出（842-1023），逻辑未改。 */

import * as m3d from '../material3d.js'
import { enhancePreview } from '../preview2d.js'
import { clamp, rgbToHex } from './algorithms.js'
import { state } from './state.js'

/* ── 联动：把求值结果推送到 3D/2D 预览 ─────── */
export function syncToPreview(results){
  // 收集所有 output 节点的材质结果
  let mat = null, matLeft = null, matRight = null, hdrPreset = null;
  // 贴图输出节点（主贴图/法线-n/高光-s × 左/右）：null=已放置未连线，undefined=未放置
  // 仅输出接口节点（output*/mainTexOut*/normalOut*/specOut*）的内容会进入预览与 3D 视口
  const texOutL = { main:undefined, normal:undefined, spec:undefined };
  const texOutR = { main:undefined, normal:undefined, spec:undefined };
  state.nodes.forEach((node,id)=>{
    const r = results.get(id);
    if(!r) return;
    if(node.type==='output' && r.material) mat = r.material;
    if(node.type==='outputLeft' && r.material) matLeft = r.material;
    if(node.type==='outputRight' && r.material) matRight = r.material;
    if(node.type==='hdr' && node.props.preset) hdrPreset = node.props.preset;
    if(r.mainTextureUrl!==undefined){
      if(node.type==='mainTexOutLeft') texOutL.main = r.mainTextureUrl;
      else if(node.type==='mainTexOutRight') texOutR.main = r.mainTextureUrl;
    }
    if(r.normalMapUrl!==undefined){
      if(node.type==='normalOutLeft') texOutL.normal = r.normalMapUrl;
      else if(node.type==='normalOutRight') texOutR.normal = r.normalMapUrl;
    }
    if(r.specTextureUrl!==undefined){
      if(node.type==='specOutLeft') texOutL.spec = r.specTextureUrl;
      else if(node.type==='specOutRight') texOutR.spec = r.specTextureUrl;
    }
  });

  // 3D 联动
  if(m3d && m3d.isMaterial3DReady && m3d.isMaterial3DReady()){
    const buildP = (m, side)=>{
      const p = {};
      let nTex = null;
      if(m){
        if(m.baseColor) p.baseColor = m.baseColor;
        if(typeof m.roughness==='number') p.roughness = m.roughness;
        if(typeof m.metallic==='number') p.metallic = m.metallic;
        if(m.normal && m.normal.src) nTex = m.normal.src;
      }
      // 仅输出接口：贴图槽位只取自贴图输出节点（无输出节点时显式置 null 清空）
      const o = side==='left' ? texOutL : texOutR;
      p.mainTextureUrl = (o.main!==undefined) ? o.main : null;
      p.normalMapUrl = (o.normal!==undefined) ? o.normal : nTex;
      p.specTextureUrl = (o.spec!==undefined) ? o.spec : null;
      if(hdrPreset) p.lightPreset = hdrPreset;
      return p;
    };
    try { m3d.applyNodePBRSide(buildP(matLeft || mat,'left'), 'left'); } catch(e){ console.warn('applyNodePBRSide 失败', e); }
    try { m3d.applyNodePBRSide(buildP(matRight || mat,'right'), 'right'); } catch(e){ console.warn('applyNodePBRSide 失败', e); }
     // 更新底栏
     const barMat = mat || matLeft || matRight;
     if(barMat && barMat.baseColor){
       const [r2,g2,b2]=barMat.baseColor;
       const fc=document.getElementById('ft-color'), fr=document.getElementById('ft-rough'), fm=document.getElementById('ft-metal');
       if(fc) fc.textContent = rgbToHex(r2,g2,b2);
       if(fr) fr.textContent = (barMat.roughness??0).toFixed(2);
       if(fm) fm.textContent = (barMat.metallic??0).toFixed(2);
     }
  }
  // 2D 预览联动
  sync2D(results, {mat, matLeft, matRight, texOutL, texOutR});
}
/* 2D 预览仅承载主贴图/法线/高光三种材质槽位；仅输出接口节点（贴图输出/材质输出）产生行；
   纹理、噪波、颜色等在节点自身预览（widget / out-preview）中查看 */
export function buildPreview2DRows(info){
  const effLeft = info.matLeft || info.mat, effRight = info.matRight || info.mat;
  const texOutL = info.texOutL || {}, texOutR = info.texOutR || {};
  const rows = [];
  // 主贴图：仅主贴图输出节点
  const mainL = texOutL.main!==undefined ? texOutL.main : null;
  const mainR = texOutR.main!==undefined ? texOutR.main : null;
  if(mainL || mainR) rows.push({role:'主贴图 (Albedo)', left:mainL?{img:mainL}:null, right:mainR?{img:mainR}:null});
  // 法线：法线输出节点优先，其次材质输出节点携带的 normal
  let ln = effLeft&&effLeft.normal&&effLeft.normal.src?effLeft.normal.src:null;
  let rn = effRight&&effRight.normal&&effRight.normal.src?effRight.normal.src:null;
  if(texOutL.normal!==undefined) ln = texOutL.normal;
  if(texOutR.normal!==undefined) rn = texOutR.normal;
  if(ln||rn) rows.push({role:'法线 (Normal)', left:ln?{img:ln}:null, right:rn?{img:rn}:null});
  const ls = texOutL.spec!==undefined ? texOutL.spec : null;
  const rs = texOutR.spec!==undefined ? texOutR.spec : null;
  if(ls||rs) rows.push({role:'高光 (-s)', left:ls?{img:ls}:null, right:rs?{img:rs}:null});
  return rows;
}
export function sync2D(results, info){
  const c = document.getElementById('previewPanel');
  if(!c) return;
  const rows = buildPreview2DRows(info);
  c.querySelectorAll('.pv-row').forEach(row => { if (row._splitCleanup) row._splitCleanup() });
  c.innerHTML = '';
  if(rows.length===0){
    c.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:20px;text-align:center">暂无主贴图 / 法线 / 高光输出<br>连线「主贴图输出」「法线输出 -n」「高光输出 -s」节点即可在此预览<br>其他贴图请在各节点预览中查看</div>';
    return;
  }
  const cell = (data, side)=>{
    if(!data) return `<div class="pv-cell"><span class="pv-tag">${side}</span><span class="pv-empty">—</span></div>`;
    return `<div class="pv-cell"><span class="pv-tag">${side}</span><img src="${data.img}" alt=""></div>`;
  };
  rows.forEach(r=>{
    const row = document.createElement('div'); row.className='pv-row';
    row.innerHTML = `<span class="pv-role">${r.role}</span>${cell(r.left,'左')}${cell(r.right,'右')}`;
    c.appendChild(row);
  });
  try { enhancePreview(); } catch(e){}
}
export function _renderPreviewVal(el, val){
  const label = el.querySelector('.pv-label');
  el.innerHTML='';
  if(label) el.appendChild(label);
  if(val===undefined || val===null){
    const e=document.createElement('div'); e.className='pv-empty';
    e.textContent='无输入'; el.appendChild(e); return;
  }
  if(typeof val==='number'){
    _renderNumViz(el, val);
  } else if(Array.isArray(val) && val.length>=3){
    const sw=document.createElement('div'); sw.className='pv-swatch';
    sw.style.background=rgbToHex(val[0],val[1],val[2]); el.appendChild(sw);
    const t=document.createElement('div'); t.className='pv-tag';
    t.textContent=rgbToHex(val[0],val[1],val[2]); el.appendChild(t);
  } else if(typeof val==='object'){
    if(val.baseColor){
      const sw=document.createElement('div'); sw.className='pv-swatch';
      sw.style.background=rgbToHex(val.baseColor[0],val.baseColor[1],val.baseColor[2]);
      el.appendChild(sw);
      const t=document.createElement('div'); t.className='pv-tag';
      t.textContent=`r${val.roughness?.toFixed(2)} m${val.metallic?.toFixed(2)}`;
      el.appendChild(t);
    } else if(val.src){
      _renderPreviewImg(el, val.src);
    } else {
      const t=document.createElement('div'); t.className='pv-text';
      t.textContent=JSON.stringify(val).slice(0,60); el.appendChild(t);
    }
  } else if(typeof val==='string'){
    if(val.startsWith('data:')||val.startsWith('/')){
      _renderPreviewImg(el, val);
    } else {
      const t=document.createElement('div'); t.className='pv-text';
      t.textContent=val; el.appendChild(t);
    }
  }
}
export function _renderPreviewImg(el, url){
  const box=document.createElement('div'); box.className='pv-imgbox';
  const img=document.createElement('img'); img.src=url; img.alt='';
  box.appendChild(img); el.appendChild(box);
  const fillDim=()=>{
    if(!img.naturalWidth) return;
    if(box.querySelector('.pv-dim')) return;
    const d=document.createElement('span'); d.className='pv-dim';
    d.textContent=img.naturalWidth+'×'+img.naturalHeight;
    box.appendChild(d);
  };
  if(img.complete) fillDim();
  else img.addEventListener('load', fillDim);
}
export function _renderNumViz(el, val){
  const box=document.createElement('div'); box.className='pv-numviz';
  const inRange = val>=0 && val<=1;
  const pct = clamp(val,0,1)*100;
  const bar=document.createElement('div'); bar.className='bar'+(inRange?'':' out');
  const mark=document.createElement('div'); mark.className='mark'; mark.style.left=pct+'%';
  bar.appendChild(mark);
  const sc=document.createElement('div'); sc.className='scale';
  sc.innerHTML='<span>0</span><span>1</span>';
  const v=document.createElement('span'); v.className='val'; v.textContent=val.toFixed(4);
  box.appendChild(bar); box.appendChild(sc); box.appendChild(v);
  el.appendChild(box);
}
export function updatePreview(node, inputs, results){
  const el = node._previewEl;
  const key = el.dataset.preview;
  if(key === '__mat__'){
    const r = results.get(node.id);
    _renderPreviewVal(el, r?.material);
  } else {
    _renderPreviewVal(el, inputs[key]);
  }
}


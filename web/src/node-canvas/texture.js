/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 节点画布 - 纹理缓存与通道合并/拆分
 */

import { clamp } from './math.js'

let _evaluateCb = () => {}
export function _setEvaluateCb(fn) { _evaluateCb = fn }

/* ── 纹理平均色缓存（供 sample 节点同步求值用）── */
const _texColorCache = new Map();
export function _texAvgColor(url){
  if(_texColorCache.has(url)) return _texColorCache.get(url);
  _texColorCache.set(url, [0.5,0.5,0.5]);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = ()=>{
    try {
      const c = document.createElement('canvas');
      const w = c.width = 4, h = c.height = 4;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      let r=0,g=0,b=0;
      for(let i=0;i<w*h;i++){ r+=d[i*4]; g+=d[i*4+1]; b+=d[i*4+2]; }
      const n = w*h;
      _texColorCache.set(url, [r/n/255, g/n/255, b/n/255]);
      _evaluateCb();
    } catch(e){ _texColorCache.set(url, [0.5,0.5,0.5]); }
  };
  img.onerror = ()=>{ _texColorCache.set(url, [0.5,0.5,0.5]); };
  img.src = url;
  return [0.5,0.5,0.5];
}

/* ── 纹理 Alpha 通道缓存（供主图节点取不透明度）── */
const _texAlphaCache = new Map();
export function _texAlpha(url){
  if(_texAlphaCache.has(url)) return _texAlphaCache.get(url);
  _texAlphaCache.set(url, 1);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = ()=>{
    try {
      const c = document.createElement('canvas');
      const w = c.width = 4, h = c.height = 4;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      let a=0;
      for(let i=0;i<w*h;i++){ a+=d[i*4+3]; }
      _texAlphaCache.set(url, a/(w*h)/255);
      _evaluateCb();
    } catch(e){ _texAlphaCache.set(url, 1); }
  };
  img.onerror = ()=>{ _texAlphaCache.set(url, 1); };
  img.src = url;
  return 1;
}

/* ── RGBA 通道合并 → PNG（供 rgbaMerge 节点用）── */
const _rgbaMergeCache = new Map();
export function _loadImg(url){
  return new Promise(res=>{
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = ()=>res(img);
    img.onerror = ()=>res(null);
    img.src = url;
  });
}
export function _rgbaIn(v, def, chIdx){
  if(typeof v==='string' && v) return v;
  if(typeof v==='number' && isFinite(v)) return clamp(v,0,1);
  if(Array.isArray(v)) return clamp(+(v[chIdx] ?? [0,0,0,1][chIdx]),0,1);
  return clamp(+(def ?? [0,0,0,1][chIdx]),0,1);
}
export async function _rgbaMergeCompose(rr, gg, bb, aa, size, cb){
  try{
    const srcs = [rr, gg, bb, aa];
    const imgs = await Promise.all(srcs.map(s =>
      (typeof s==='string' && s) ? _loadImg(s) : Promise.resolve(null)));
    const valid = imgs.filter(Boolean);
    let W = size, H = size;
    if(valid.length){
      W = Math.max(...valid.map(im => im.naturalWidth || 1));
      H = Math.max(...valid.map(im => im.naturalHeight || 1));
    }
    W = Math.max(1, Math.round(W)); H = Math.max(1, Math.round(H));

    const chans = srcs.map((s, idx)=>{
      const img = imgs[idx];
      if(typeof s==='number') return {k: Math.round(clamp(s,0,1)*255)};
      if(img){
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d', {willReadFrequently:true});
        ctx.drawImage(img, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        const arr = new Uint8ClampedArray(W*H);
        for(let i=0;i<W*H;i++) arr[i] = d[i*4];
        return {arr};
      }
      return {k: 0};
    });
    const out = new ImageData(W, H);
    const od = out.data;
    const get = (ch,i)=> ch.arr ? ch.arr[i] : ch.k;
    for(let i=0;i<W*H;i++){
      od[i*4]   = get(chans[0],i);
      od[i*4+1] = get(chans[1],i);
      od[i*4+2] = get(chans[2],i);
      od[i*4+3] = get(chans[3],i);
    }
    const c2 = document.createElement('canvas');
    c2.width = W; c2.height = H;
    c2.getContext('2d').putImageData(out, 0, 0);
    cb(c2.toDataURL('image/png'));
  }catch(e){ cb(null); }
}
export function _rgbaMerge(rr, gg, bb, aa, size){
  const key = JSON.stringify([rr, gg, bb, aa, size]);
  if(_rgbaMergeCache.has(key)) return _rgbaMergeCache.get(key);
  if(_rgbaMergeCache.size > 32) _rgbaMergeCache.clear();
  _rgbaMergeCompose(rr, gg, bb, aa, size, (url)=>{
    _rgbaMergeCache.set(key, url || '');
    _evaluateCb();
  });
  return null;
}

/* ── RGBA 通道拆分 → 4 张灰度 PNG（供 rgbaSplit 节点用，rgbaMerge 的逆操作）── */
export function _imageDataToPngUrl(out, W, H){
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  c.getContext('2d').putImageData(out, 0, 0);
  return c.toDataURL('image/png');
}
const _rgbaSplitCache = new Map();
export async function _rgbaSplitCompose(url, cb){
  try{
    const img = await _loadImg(url);
    if(!img){ cb(null); return; }
    const W = Math.max(1, img.naturalWidth || 1), H = Math.max(1, img.naturalHeight || 1);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', {willReadFrequently:true});
    ctx.drawImage(img, 0, 0, W, H);
    const src = ctx.getImageData(0, 0, W, H).data;
    const parts = {};
    ['r','g','b','a'].forEach((name, ch)=>{
      const out = new ImageData(W, H);
      const od = out.data;
      for(let i=0;i<W*H;i++){
        const v = src[i*4+ch];
        od[i*4] = v; od[i*4+1] = v; od[i*4+2] = v; od[i*4+3] = 255;
      }
      parts[name] = _imageDataToPngUrl(out, W, H);
    });
    cb(parts);
  }catch(e){ cb(null); }
}
export function _rgbaSplit(url){
  if(_rgbaSplitCache.has(url)) return _rgbaSplitCache.get(url);
  if(_rgbaSplitCache.size > 16) _rgbaSplitCache.clear();
  _rgbaSplitCompose(url, (parts)=>{
    _rgbaSplitCache.set(url, parts || {r:'',g:'',b:'',a:''});
    _evaluateCb();
  });
  return null;
}

/* ── RGB / Alpha 拆分 → 不透明 RGB 图 + Alpha 灰度遮罩（供 rgbAlphaSplit 节点用）── */
const _rgbAlphaSplitCache = new Map();
export async function _rgbAlphaSplitCompose(url, cb){
  try{
    const img = await _loadImg(url);
    if(!img){ cb(null); return; }
    const W = Math.max(1, img.naturalWidth || 1), H = Math.max(1, img.naturalHeight || 1);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', {willReadFrequently:true});
    ctx.drawImage(img, 0, 0, W, H);
    const src = ctx.getImageData(0, 0, W, H).data;
    const rgb = new ImageData(W, H), alpha = new ImageData(W, H);
    const rd = rgb.data, ad = alpha.data;
    for(let i=0;i<W*H;i++){
      rd[i*4] = src[i*4]; rd[i*4+1] = src[i*4+1]; rd[i*4+2] = src[i*4+2]; rd[i*4+3] = 255;
      const v = src[i*4+3];
      ad[i*4] = v; ad[i*4+1] = v; ad[i*4+2] = v; ad[i*4+3] = 255;
    }
    cb({rgb:_imageDataToPngUrl(rgb, W, H), alpha:_imageDataToPngUrl(alpha, W, H)});
  }catch(e){ cb(null); }
}
export function _rgbAlphaSplit(url){
  if(_rgbAlphaSplitCache.has(url)) return _rgbAlphaSplitCache.get(url);
  if(_rgbAlphaSplitCache.size > 16) _rgbAlphaSplitCache.clear();
  _rgbAlphaSplitCompose(url, (parts)=>{
    _rgbAlphaSplitCache.set(url, parts || {rgb:'', alpha:''});
    _evaluateCb();
  });
  return null;
}
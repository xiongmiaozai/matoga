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

/* LRU 淘汰：超出容量移除最旧 16 条（避免长期使用缓存无限增长） */
function _lruEvict(cache, max){
  if (cache.size <= max) return
  const it = cache.keys()
  for (let i = 0; i < 16; i++) {
    const k = it.next().value
    if (k === undefined) break
    cache.delete(k)
  }
}

/* ── 纹理平均色缓存（供 sample 节点同步求值用）── */
const _texColorCache = new Map();
export function _texAvgColor(url){
  if(_texColorCache.has(url)) return _texColorCache.get(url);
  _texColorCache.set(url, [0.5,0.5,0.5]); _lruEvict(_texColorCache, 64);
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
      _texColorCache.set(url, [r/n/255, g/n/255, b/n/255]); _lruEvict(_texColorCache, 64);
      _evaluateCb();
    } catch(e){ _texColorCache.set(url, [0.5,0.5,0.5]); _lruEvict(_texColorCache, 64); }
  };
  img.onerror = ()=>{ _texColorCache.set(url, [0.5,0.5,0.5]); _lruEvict(_texColorCache, 64); };
  img.src = url;
  return [0.5,0.5,0.5];
}

/* ── 纹理 Alpha 通道缓存（供主图节点取不透明度）── */
const _texAlphaCache = new Map();
export function _texAlpha(url){
  if(_texAlphaCache.has(url)) return _texAlphaCache.get(url);
  _texAlphaCache.set(url, 1); _lruEvict(_texAlphaCache, 64);
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
      _texAlphaCache.set(url, a/(w*h)/255); _lruEvict(_texAlphaCache, 64);
      _evaluateCb();
    } catch(e){ _texAlphaCache.set(url, 1); _lruEvict(_texAlphaCache, 64); }
  };
  img.onerror = ()=>{ _texAlphaCache.set(url, 1); _lruEvict(_texAlphaCache, 64); };
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
  _lruEvict(_rgbaMergeCache, 32);
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
  _lruEvict(_rgbaSplitCache, 16);
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
  _lruEvict(_rgbAlphaSplitCache, 16);
  _rgbAlphaSplitCompose(url, (parts)=>{
    _rgbAlphaSplitCache.set(url, parts || {rgb:'', alpha:''});
    _evaluateCb();
  });
  return null;
}
/* ── 法线生成（高度图 → 切线空间法线贴图，供 normalGen 节点用）──
   对高度场 h 求梯度 (Gx,Gy)，法线 n=normalize(-s*Gx,-s*Gy,1)，编码 RGB=n*0.5+0.5。
   算法：central(中心差分)/sobel/scharr(3×3)/farid(Farid-Simoncelli 可分离 3×3)。 */
const NORMAL_KERNELS = {
  central: { w: 3, h: 1, div: 2, kx: [-1,0,1], ky: [-1,0,1] },
  sobel:   { w: 3, h: 3, div: 8,  kx: [-1,0,1,-2,0,2,-1,0,1], ky: [-1,-2,-1,0,0,0,1,2,1] },
  scharr:  { w: 3, h: 3, div: 32, kx: [-3,0,3,-10,0,10,-3,0,3], ky: [-3,-10,-3,0,0,0,3,10,3] },
}
const FARID_P = [0.2275, 0.5450, 0.2275]
const FARID_D = [0.4530, 0.0, -0.4530]

function _luma(r, g, b){ return 0.299*r + 0.587*g + 0.114*b }

function _convGrad(src, W, H, kern){
  const { w: kw, h: kh, div, kx, ky } = kern
  const hx = Math.floor(kw/2), hy = Math.floor(kh/2)
  const Gx = new Float32Array(W*H), Gy = new Float32Array(W*H)
  for (let y=0; y<H; y++) {
    for (let x=0; x<W; x++) {
      let sx=0, sy=0
      for (let j=0; j<kh; j++) {
        for (let i=0; i<kw; i++) {
          const px = Math.min(W-1, Math.max(0, x + i - hx))
          const py = Math.min(H-1, Math.max(0, y + j - hy))
          const v = src[py*W + px]
          sx += v * kx[j*kw + i]
          sy += v * ky[j*kw + i]
        }
      }
      const idx = y*W + x
      Gx[idx] = sx / div
      Gy[idx] = sy / div
    }
  }
  return { Gx, Gy }
}

function _faridGrad(src, W, H){
  const tmp = new Float32Array(W*H)
  for (let y=0; y<H; y++) {
    for (let x=0; x<W; x++) {
      let s=0
      for (let i=0; i<3; i++) {
        const px = Math.min(W-1, Math.max(0, x + i - 1))
        s += src[y*W + px] * FARID_D[i]
      }
      tmp[y*W + x] = s
    }
  }
  const Gx = new Float32Array(W*H)
  for (let y=0; y<H; y++) {
    for (let x=0; x<W; x++) {
      let s=0
      for (let j=0; j<3; j++) {
        const py = Math.min(H-1, Math.max(0, y + j - 1))
        s += tmp[py*W + x] * FARID_P[j]
      }
      Gx[y*W + x] = s
    }
  }
  const tmp2 = new Float32Array(W*H)
  for (let y=0; y<H; y++) {
    for (let x=0; x<W; x++) {
      let s=0
      for (let j=0; j<3; j++) {
        const py = Math.min(H-1, Math.max(0, y + j - 1))
        s += src[py*W + x] * FARID_D[j]
      }
      tmp2[y*W + x] = s
    }
  }
  const Gy = new Float32Array(W*H)
  for (let y=0; y<H; y++) {
    for (let x=0; x<W; x++) {
      let s=0
      for (let i=0; i<3; i++) {
        const px = Math.min(W-1, Math.max(0, x + i - 1))
        s += tmp2[y*W + px] * FARID_P[i]
      }
      Gy[y*W + x] = s
    }
  }
  return { Gx, Gy }
}

function _boxBlur(src, W, H, r){
  const r1 = Math.max(1, Math.round(r))
  const dst = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, cnt = 0
      for (let j = -r1; j <= r1; j++) {
        for (let i = -r1; i <= r1; i++) {
          const px = Math.min(W-1, Math.max(0, x+i))
          const py = Math.min(H-1, Math.max(0, y+j))
          sum += src[py*W + px]; cnt++
        }
      }
      dst[y*W + x] = sum / cnt
    }
  }
  return dst
}

export function _normalGenFromHeight(height, W, H, algo, strength, smooth){
  let src = height
  if (smooth > 0) src = _boxBlur(height, W, H, smooth)
  let grad
  if (algo === 'farid') {
    grad = _faridGrad(src, W, H)
  } else {
    const kern = NORMAL_KERNELS[algo] || NORMAL_KERNELS.sobel
    grad = _convGrad(src, W, H, kern)
  }
  const { Gx, Gy } = grad
  const od = new Uint8ClampedArray(W * H * 4)
  const s = strength
  for (let i = 0; i < W * H; i++) {
    const nx = -s * Gx[i], ny = -s * Gy[i], nz = 1
    const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1
    od[i*4]   = Math.round((nx/len * 0.5 + 0.5) * 255)
    od[i*4+1] = Math.round((ny/len * 0.5 + 0.5) * 255)
    od[i*4+2] = Math.round((nz/len * 0.5 + 0.5) * 255)
    od[i*4+3] = 255
  }
  return { data: od, width: W, height: H }
}

const _normalGenCache = new Map()
export async function _normalGenCompose(url, algo, strength, smooth, cb){
  try {
    const img = await _loadImg(url)
    if (!img) { cb(null); return }
    const W = Math.max(1, img.naturalWidth || 1)
    const H = Math.max(1, img.naturalHeight || 1)
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, W, H)
    const data = ctx.getImageData(0, 0, W, H).data
    const height = new Float32Array(W * H)
    for (let i = 0; i < W * H; i++) {
      height[i] = _luma(data[i*4], data[i*4+1], data[i*4+2]) / 255
    }
    const result = _normalGenFromHeight(height, W, H, algo, strength, smooth)
    const out = new ImageData(result.data, W, H)
    cb(_imageDataToPngUrl(out, W, H))
  } catch (e) { cb(null) }
}
export function _normalGen(url, algo, strength, smooth){
  const key = JSON.stringify([url, algo, Math.round(strength*100)/100, Math.round(smooth*100)/100])
  if (_normalGenCache.has(key)) return _normalGenCache.get(key)
  _lruEvict(_normalGenCache, 32)
  _normalGenCompose(url, algo, strength, smooth, (outUrl) => {
    _normalGenCache.set(key, outUrl || '')
    _evaluateCb()
  })
  return null
}
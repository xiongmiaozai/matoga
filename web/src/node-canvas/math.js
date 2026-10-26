/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 节点画布 - 数学/颜色工具（纯函数，无共享状态）
 */

export const num = (v)=> (typeof v==='number')?v : (Array.isArray(v)?v[0]:0);
export const clamp = (v,a,b)=> Math.max(a, Math.min(b, v));

export const _texUrl = (v)=>{
  if(typeof v==='string' && v) return v;
  if(v && typeof v==='object' && typeof v.src==='string' && v.src) return v.src;
  return null;
};

export const col = (v)=> {
  if(Array.isArray(v) && v.length>=3) return [v[0],v[1],v[2]];
  if(typeof v==='number') return [v,v,v];
  return [0.6,0.6,0.6];
};

export const rgbToHex = (r,g,b)=> '#'+[r,g,b].map(x=>Math.round(clamp(x,0,1)*255).toString(16).padStart(2,'0')).join('');
export const hexToRgb = (h)=> {h=h.replace('#',''); return [parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255];};
export const uid = ()=> 'n'+Math.random().toString(36).slice(2,9);

export function _hash(x, y, seed){
  let h = (x * 374761393 + y * 668265263 + seed * 1013904223) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}
export function _smoothstep(t){ return t * t * (3 - 2 * t); }
export function _lerp(a, b, t){ return a + (b - a) * t; }

export function _rgbToHsb(r,g,b){
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
  let h=0;
  if(d>0){ if(mx===r)h=((g-b)/d)%6; else if(mx===g)h=(b-r)/d+2; else h=(r-g)/d+4; h*=60; if(h<0)h+=360; }
  return [h/360, mx<=0?0:d/mx, mx];
}
export function _hsbToRgb(h,s,v){
  h=(h%1+1)%1*360; const c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c;
  let r,g,b;
  if(h<60){r=c;g=x;b=0;} else if(h<120){r=x;g=c;b=0;} else if(h<180){r=0;g=c;b=x;}
  else if(h<240){r=0;g=x;b=c;} else if(h<300){r=x;g=0;b=c;} else {r=c;g=0;b=x;}
  return [r+m,g+m,b+m];
}

export function _cubicAt(t, p0, p1, p2, p3){
  return 0.5 * ((2 * p1) + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

export function _rng(seed){
  let s = (Math.imul(Math.round(seed) + 7, 2654435761)) | 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return ((s >>> 8) & 0xffffff) / 0xffffff; };
}

export function _quintic(t){ return t * t * t * (t * (t * 6 - 15) + 10); }
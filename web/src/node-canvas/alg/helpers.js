/**
 * matoga - 节点画布算法层：数值与颜色工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 algorithms.js 按职责搬出，逻辑未改。
 */
/* ── numeric / color helpers ───────────────── */
export const num = (v)=> (typeof v==='number')?v : (Array.isArray(v)?v[0]:0);
export const clamp = (v,a,b)=> Math.max(a, Math.min(b, v));
/* 从贴图链接值取 URL：兼容 PNG dataURL 字符串与 normalMap 节点的 {src,strength} 对象 */
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

/* ── 程序化噪声算法 ───────────────────────── */
export function _hash(x, y, seed){
  let h = (x * 374761393 + y * 668265263 + seed * 1013904223) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}
export function _smoothstep(t){ return t * t * (3 - 2 * t); }
export function _lerp(a, b, t){ return a + (b - a) * t; }


export function _cubicAt(t, p0, p1, p2, p3){
  return 0.5 * ((2 * p1) + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

export function _rng(seed){
  let s = (Math.imul(Math.round(seed) + 7, 2654435761)) | 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return ((s >>> 8) & 0xffffff) / 0xffffff; };
}

/* quintic 插值曲线（C² 连续）：比 cubic smoothstep 频谱旁瓣小，fBm 叠加无格纹残留 */
export function _quintic(t){ return t * t * t * (t * (t * 6 - 15) + 10); }

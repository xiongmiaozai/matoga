/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 节点画布 - PS 混合模式（27 种 + 颜色混合）
 */

import { clamp, num, col, _lerp, _rgbToHsb, _hsbToRgb } from './math.js'

export const _PS_BLEND = {
  normal:(a,b)=>b,
  darken:(a,b)=>Math.min(a,b),
  multiply:(a,b)=>a*b,
  colorBurn:(a,b)=>b<=0?0:1-Math.min(1,(1-a)/b),
  linearBurn:(a,b)=>Math.max(0,a+b-1),
  lighten:(a,b)=>Math.max(a,b),
  screen:(a,b)=>1-(1-a)*(1-b),
  colorDodge:(a,b)=>b>=1?1:Math.min(1,a/(1-b)),
  linearDodge:(a,b)=>Math.min(1,a+b),
  overlay:(a,b)=>a<0.5?2*a*b:1-2*(1-a)*(1-b),
  softLight:(a,b)=>b<0.5?a-(1-2*b)*a*(1-a):a+(2*b-1)*((a<0.25?((16*a-12)*a+4)*a:Math.sqrt(a))-a),
  hardLight:(a,b)=>b<0.5?2*a*b:1-2*(1-a)*(1-b),
  vividLight:(a,b)=>b<0.5?(b*2<=0?0:1-Math.min(1,(1-a)/(b*2))):(b*2-1>=1?1:Math.min(1,a/(2-b*2))),
  linearLight:(a,b)=>clamp(a+2*b-1,0,1),
  pinLight:(a,b)=>b<0.5?Math.min(a,2*b):Math.max(a,2*b-1),
  hardMix:(a,b)=>(b<0.5?(b*2<=0?0:1-Math.min(1,(1-a)/(b*2))):(b*2-1>=1?1:Math.min(1,a/(2-b*2))))<0.5?0:1,
  difference:(a,b)=>Math.abs(a-b),
  exclusion:(a,b)=>a+b-2*a*b,
  subtract:(a,b)=>Math.max(0,a-b),
  divide:(a,b)=>b<=0?1:Math.min(1,a/b),
};

export function _psBlendComponent(mode,a,b){
  const A=_rgbToHsb(a[0],a[1],a[2]), B=_rgbToHsb(b[0],b[1],b[2]);
  let h,s,v;
  if(mode==='hue'){h=A[0];s=B[1];v=B[2];}
  else if(mode==='saturation'){h=B[0];s=A[1];v=B[2];}
  else if(mode==='blendColor'){h=A[0];s=A[1];v=B[2];}
  else {h=B[0];s=B[1];v=A[2];}
  return _hsbToRgb(h,s,v);
}

export function _psBlendApply(mode,aIn,bIn,opacity){
  const op=clamp(num(opacity),0,1);
  const isColor=Array.isArray(aIn)||Array.isArray(bIn);
  if(!isColor){
    const a=clamp(num(aIn),0,1), b=clamp(num(bIn),0,1);
    let r;
    if(mode==='dissolve') r=Math.random()<b?b:a;
    else if(_PS_BLEND[mode]) r=_PS_BLEND[mode](a,b);
    else r=b;
    if(op>=1) return r;
    if(op<=0) return a;
    return _lerp(a,r,op);
  }
  const a=col(aIn), b=col(bIn);
  let out;
  if(mode==='darkerColor'){
    const la=0.299*a[0]+0.587*a[1]+0.114*a[2], lb=0.299*b[0]+0.587*b[1]+0.114*b[2];
    out=la<lb?a:b;
  } else if(mode==='lighterColor'){
    const la=0.299*a[0]+0.587*a[1]+0.114*a[2], lb=0.299*b[0]+0.587*b[1]+0.114*b[2];
    out=la>lb?a:b;
  } else if(mode==='dissolve'){
    const lb=0.299*b[0]+0.587*b[1]+0.114*b[2];
    out=Math.random()<lb?b:a;
  } else if(mode==='hue'||mode==='saturation'||mode==='blendColor'||mode==='luminosity'){
    out=_psBlendComponent(mode,a,b);
  } else {
    const fn=_PS_BLEND[mode]||((x,y)=>y);
    out=[fn(a[0],b[0]),fn(a[1],b[1]),fn(a[2],b[2])];
  }
  if(op>=1) return out;
  if(op<=0) return a;
  return [_lerp(a[0],out[0],op),_lerp(a[1],out[1],op),_lerp(a[2],out[2],op)];
}

export function _psNode(title,mode,subgroup){
  return { title, group:'混合', subgroup, color:'var(--type-color)',
    inputs:[{n:'a',t:'any'},{n:'b',t:'any'},{n:'opacity',t:'number'}],
    outputs:[{n:'out',t:'any'}],
    eval:(i)=>({out:_psBlendApply(mode,i.a,i.b,i.opacity===undefined?1:i.opacity)}) };
}
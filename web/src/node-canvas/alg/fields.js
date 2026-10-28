/**
 * matoga - 节点画布算法层：特效场生成器
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 algorithms.js 按职责搬出，逻辑未改。
 */
import { _hash, _lerp, _rng, clamp } from './helpers.js'

export const _RD_SIM = 256;
export const _RD_PRESETS = {
  coral:   { f: 0.0545, k: 0.062  },
  maze:    { f: 0.029,  k: 0.057  },
  soliton: { f: 0.030,  k: 0.062  },
  waves:   { f: 0.014,  k: 0.045  },
  worm:    { f: 0.078,  k: 0.061  },
};
export const _rdFieldCache = new Map();
export function _reactionField(seed, iterations, presetKey, quick){
  const key = JSON.stringify([seed, iterations, presetKey, !!quick]);
  if(_rdFieldCache.has(key)) return _rdFieldCache.get(key);
  const pr = _RD_PRESETS[presetKey] || _RD_PRESETS.coral;
  const f = pr.f, k = pr.k;
  const S = _RD_SIM;
  let A = new Float32Array(S * S).fill(1);
  let B = new Float32Array(S * S);
  for(let s = 0; s < 8; s++){
    const cx = 0.2 + 0.6 * _hash(s, 1, seed), cy = 0.2 + 0.6 * _hash(s, 2, seed);
    const r = 0.05 + 0.06 * _hash(s, 3, seed);
    for(let py = 0; py < S; py++){
      for(let px = 0; px < S; px++){
        const dx = px / S - cx, dy = py / S - cy;
        if(dx * dx + dy * dy < r * r) B[py * S + px] = 1;
      }
    }
  }
  const DA = 1.0, DB = 0.5, dt = 1.0;
  for(let it = 0; it < iterations; it++){
    const A2 = new Float32Array(S * S), B2 = new Float32Array(S * S);
    for(let py = 0; py < S; py++){
      const yn = py === 0 ? S - 1 : py - 1, ys = py === S - 1 ? 0 : py + 1;
      for(let px = 0; px < S; px++){
        const xw = px === 0 ? S - 1 : px - 1, xe = px === S - 1 ? 0 : px + 1;
        const i = py * S + px;
        const la = 0.2 * (A[py * S + xw] + A[py * S + xe] + A[yn * S + px] + A[ys * S + px])
                 + 0.05 * (A[yn * S + xw] + A[yn * S + xe] + A[ys * S + xw] + A[ys * S + xe]) - A[i];
        const lb = 0.2 * (B[py * S + xw] + B[py * S + xe] + B[yn * S + px] + B[ys * S + px])
                 + 0.05 * (B[yn * S + xw] + B[yn * S + xe] + B[ys * S + xw] + B[ys * S + xe]) - B[i];
        const abb = A[i] * B[i] * B[i];
        A2[i] = Math.min(1, Math.max(0, A[i] + (DA * la - abb + f * (1 - A[i])) * dt));
        B2[i] = Math.min(1, Math.max(0, B[i] + (DB * lb + abb - (k + f) * B[i]) * dt));
      }
    }
    A = A2; B = B2;
  }
  const out = new Float32Array(S * S);
  let mn = Infinity, mx = -Infinity;
  for(let i = 0; i < S * S; i++){
    const v = 1 - B[i];
    out[i] = v; if(v < mn) mn = v; if(v > mx) mx = v;
  }
  const res = { field: out, S, mn, mx };
  if(_rdFieldCache.size > 8) _rdFieldCache.clear();
  _rdFieldCache.set(key, res);
  return res;
}
export function _sampleField(fld, u, v){
  const fx = clamp(u, 0, 1) * (fld.S - 1), fy = clamp(v, 0, 1) * (fld.S - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, fld.S - 1), y1 = Math.min(y0 + 1, fld.S - 1);
  const tx = fx - x0, ty = fy - y0;
  const g = fld.field;
  return _lerp(_lerp(g[y0 * fld.S + x0], g[y0 * fld.S + x1], tx),
               _lerp(g[y1 * fld.S + x0], g[y1 * fld.S + x1], tx), ty);
}
/* 中点位移闪电：线段递归中点随机位移 + 子分支，光栅化到浮点场后模糊做辉光 */
export const _boltFieldCache = new Map();

export function _lightningField(seed, branches, detail, glow, quick){
  const key = JSON.stringify([seed, branches, detail, glow, !!quick]);
  if(_boltFieldCache.has(key)) return _boltFieldCache.get(key);
  const maxDepth = quick ? 6 : 7; // 快速档：细分更早收敛 + 辉光仅 1 遍
  const minLen = quick ? 9 : 6;
  const S = 256;
  const field = new Float32Array(S * S);
  const rand = _rng(seed);
  const segs = [];
  const subdivide = (x0, y0, x1, y1, depth, amp, bright) => {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if(len < minLen || depth > maxDepth){
      segs.push([x0, y0, x1, y1, bright]);
      return;
    }
    const mx = (x0 + x1) / 2 + (rand() - 0.5) * len * amp * detail;
    const my = (y0 + y1) / 2 + (rand() - 0.5) * len * amp * detail * 0.4;
    subdivide(x0, y0, mx, my, depth + 1, amp * 0.52, bright);
    subdivide(mx, my, x1, y1, depth + 1, amp * 0.52, bright);
    if(depth >= 1 && rand() < branches * 0.35){
      const ang = Math.atan2(dy, dx) + (rand() - 0.5) * 2.2;
      const bl = len * (0.35 + rand() * 0.55);
      subdivide(mx, my, mx + Math.cos(ang) * bl, my + Math.sin(ang) * bl, depth + 1, amp * 0.5, bright * 0.4);
    }
  };
  const topX = 0.2 + rand() * 0.6;
  subdivide(topX * S, 0, (topX + (rand() - 0.5) * 0.3) * S, S - 1, 0, 0.28, 1);
  for(const sg of segs){
    const x0 = sg[0], y0 = sg[1], x1 = sg[2], y1 = sg[3], bright = sg[4];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
    for(let t = 0; t <= steps; t++){
      const px = Math.round(_lerp(x0, x1, t / steps));
      const py = Math.round(_lerp(y0, y1, t / steps));
      if(px >= 0 && px < S && py >= 0 && py < S){
        const i = py * S + px;
        if(field[i] < bright) field[i] = bright;
      }
    }
  }
  const passes = quick ? 1 : Math.max(1, Math.round(1 + glow * 5));
  for(let pass = 0; pass < passes; pass++){
    const cp = Float32Array.from(field);
    for(let py = 1; py < S - 1; py++){
      for(let px = 1; px < S - 1; px++){
        const i = py * S + px;
        const blur = (cp[i - 1] + cp[i + 1] + cp[i - S] + cp[i + S]) * 0.25;
        if(field[i] < blur) field[i] = blur;
      }
    }
  }
  let mn = Infinity, mx = -Infinity;
  for(let i = 0; i < S * S; i++){ if(field[i] < mn) mn = field[i]; if(field[i] > mx) mx = field[i]; }
  const res = { field, S, mn, mx };
  if(_boltFieldCache.size > 8) _boltFieldCache.clear();
  _boltFieldCache.set(key, res);
  return res;
}
/* Mandelbrot / Julia + orbit trap：逃逸时间平滑着色，陷阱距离（原点圆）做轨道捕获染色 */
export function _mandelPoint(u, v, p){
  const mode = p.fractal ?? 'mandel';
  const zoom = +(p.zoom ?? 1);
  const maxIter = Math.round(+(p.iterations ?? 96));
  const cx0 = (u - 0.5) * 3.5 / zoom;
  const cy0 = (v - 0.5) * 3.5 / zoom;
  let zx, zy, cx, cy;
  if(mode === 'julia'){
    const seed = Math.round(+(p.seed ?? 0));
    cx = (0.5 + _hash(seed, 1, 11) * 0.35) * (_hash(seed, 2, 11) < 0.5 ? -1 : 1);
    cy = (0.5 + _hash(seed, 3, 11) * 0.35) * (_hash(seed, 4, 11) < 0.5 ? -1 : 1);
    zx = cx0; zy = cy0;
  } else {
    zx = 0; zy = 0; cx = cx0; cy = cy0;
  }
  let trap = Infinity;
  let i = 0;
  while(i < maxIter){
    const zx2 = zx * zx, zy2 = zy * zy;
    if(zx2 + zy2 > 16) break;
    const d = Math.sqrt(zx2 + zy2 + 0.1);
    if(d < trap) trap = d;
    const nx = zx2 - zy2 + cx;
    zy = 2 * zx * zy + cy;
    zx = nx;
    i++;
  }
  if(i >= maxIter) return clamp(1 - trap * 0.5, 0, 1);
  const smooth = i + 1 - Math.log(Math.log(Math.sqrt(zx * zx + zy * zy)) || 1) / Math.log(2);
  return clamp((smooth / maxIter) * 1.35, 0, 1);
}
/* iq 余弦调色板：color(t) = a + b·cos(2π(c·t + d)) */
export const _IQ_PALETTES = {
  rainbow:  { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1,1,1],     d: [0,0.33,0.67] },
  ocean:    { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1,1,1],     d: [0,0.1,0.2] },
  sunset:   { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1,1,0.5],   d: [0.8,0.9,0.3] },
  ember:    { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1,0.7,0.4], d: [0,0.15,0.2] },
  fire:     { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [2,1,0],     d: [0.5,0.2,0.25] },
  verdant:  { a: [0.8,0.5,0.4], b: [0.2,0.4,0.2], c: [2,1,1],     d: [0,0.25,0.25] },
};
export function _paletteRGB(t, presetKey, freq, phase){
  const p = _IQ_PALETTES[presetKey] || _IQ_PALETTES.rainbow;
  const c = +(freq ?? 1), ph = +(phase ?? 0);
  const w = 6.283185 * (c * clamp(t, 0, 1) + ph);
  return [
    clamp(p.a[0] + p.b[0] * Math.cos(w + 6.283185 * p.d[0]), 0, 1),
    clamp(p.a[1] + p.b[1] * Math.cos(w + 6.283185 * p.d[1]), 0, 1),
    clamp(p.a[2] + p.b[2] * Math.cos(w + 6.283185 * p.d[2]), 0, 1),
  ];
}


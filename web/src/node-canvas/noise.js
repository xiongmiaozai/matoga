/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 节点画布 - 噪声算法（分形/Voronoi/Simplex/特效场/调色板/预览生成）
 */

import { clamp, _hash, _lerp, _cubicAt, _rng, _quintic } from './math.js'

function _octaveStep(x, y){
  return [(0.8 * x - 0.6 * y) * 2.03, (0.6 * x + 0.8 * y) * 2.03];
}
function _fbm2D(x, y, seed, octaves, gain){
  gain = gain ?? 0.5;
  let val = 0, amp = 0.5, max = 0;
  for(let o = 0; o < octaves; o++){
    val += _valueNoise2D(x, y, seed + o * 17) * amp;
    max += amp; amp *= gain;
    [x, y] = _octaveStep(x, y);
  }
  return val / max;
}
function _voronoiCells2D(x, y, seed, jitter){
  jitter = jitter ?? 1;
  const ix = Math.floor(x), iy = Math.floor(y);
  let d1 = Infinity, d2 = Infinity;
  for(let dx = -1; dx <= 1; dx++){
    for(let dy = -1; dy <= 1; dy++){
      const cx = ix + dx + 0.5 + (_hash(ix + dx, iy + dy, seed) - 0.5) * jitter;
      const cy = iy + dy + 0.5 + (_hash(ix + dx, iy + dy, seed + 999) - 0.5) * jitter;
      const dist = (cx - x) * (cx - x) + (cy - y) * (cy - y);
      if(dist < d1){ d2 = d1; d1 = dist; }
      else if(dist < d2){ d2 = dist; }
    }
  }
  return [Math.sqrt(d1), Math.sqrt(d2)];
}
function _voronoiSmooth2D(x, y, seed, jitter, falloff){
  const ix = Math.floor(x), iy = Math.floor(y);
  let res = 0;
  for(let dx = -1; dx <= 1; dx++){
    for(let dy = -1; dy <= 1; dy++){
      const cx = ix + dx + 0.5 + (_hash(ix + dx, iy + dy, seed) - 0.5) * jitter;
      const cy = iy + dy + 0.5 + (_hash(ix + dx, iy + dy, seed + 999) - 0.5) * jitter;
      const d = Math.sqrt((cx - x) * (cx - x) + (cy - y) * (cy - y));
      res += Math.pow(2, -falloff * d);
    }
  }
  return -Math.log2(res) / falloff;
}

function _white2D(x, y, seed){
  return _hash((x * 8191) | 0, (y * 131071) | 0, seed);
}
function _cell2D(x, y, seed){
  return _hash(Math.floor(x), Math.floor(y), seed);
}

function _cubicNoise2D(x, y, seed){
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const v = (i, j) => _hash(ix + i, iy + j, seed);
  const r = [0, 1, 2, 3].map(j => _cubicAt(fx, v(0, j), v(1, j), v(2, j), v(3, j)));
  return _cubicAt(fy, r[0], r[1], r[2], r[3]);
}
function _cubicFbm2D(x, y, seed, octaves, gain){
  gain = gain ?? 0.5;
  let val = 0, amp = 0.5, max = 0;
  for(let o = 0; o < octaves; o++){
    val += _cubicNoise2D(x, y, seed + o * 17) * amp;
    max += amp; amp *= gain;
    [x, y] = _octaveStep(x, y);
  }
  return val / max;
}
function _pingpongFbm2D(x, y, seed, octaves, gain, strength){
  gain = gain ?? 0.5; strength = strength ?? 2;
  let val = 0, amp = 0.5, max = 0;
  for(let o = 0; o < octaves; o++){
    const n = _valueNoise2D(x, y, seed + o * 17);
    let t = (n * strength) % 2; if(t < 0) t += 2;
    const s = t < 1 ? t : 2 - t;
    val += (s * 2 - 1) * amp;
    max += amp; amp *= gain;
    [x, y] = _octaveStep(x, y);
  }
  return val / max;
}
function _billow2D(x, y, seed, octaves, gain){
  gain = gain ?? 0.5;
  let val = 0, amp = 0.5, max = 0;
  for(let o = 0; o < octaves; o++){
    const n = Math.abs(_simplex2D(x, y, seed + o * 17));
    val += (n * 2 - 1) * amp;
    max += amp; amp *= gain;
    [x, y] = _octaveStep(x, y);
  }
  return val / max;
}
function _voronoise2D(x, y, seed, jitter, blend){
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const k = 1 + 63 * Math.pow(1 - blend, 4);
  let va = 0, wt = 0;
  for(let j = -2; j <= 2; j++){
    for(let i = -2; i <= 2; i++){
      const hx = _hash(ix + i, iy + j, seed);
      const hy = _hash(ix + i, iy + j, seed + 999);
      const hz = _hash(ix + i, iy + j, seed + 555);
      const rx = i - fx + hx * jitter;
      const ry = j - fy + hy * jitter;
      const d = Math.sqrt(rx * rx + ry * ry);
      const s = Math.min(d / 1.41421356, 1);
      const w = Math.pow(1 - s * s * (3 - 2 * s), k);
      va += w * hz; wt += w;
    }
  }
  return wt > 0 ? va / wt : 0;
}

/* ── 特效场生成器（玄幻/科幻，整图计算型）──────────────── */
const _RD_SIM = 256;
const _RD_PRESETS = {
  coral:   { f: 0.0545, k: 0.062  },
  maze:    { f: 0.029,  k: 0.057  },
  soliton: { f: 0.030,  k: 0.062  },
  waves:   { f: 0.014,  k: 0.045  },
  worm:    { f: 0.078,  k: 0.061  },
};
const _rdFieldCache = new Map();
function _reactionField(seed, iterations, presetKey, quick){
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
function _sampleField(fld, u, v){
  const fx = clamp(u, 0, 1) * (fld.S - 1), fy = clamp(v, 0, 1) * (fld.S - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, fld.S - 1), y1 = Math.min(y0 + 1, fld.S - 1);
  const tx = fx - x0, ty = fy - y0;
  const g = fld.field;
  return _lerp(_lerp(g[y0 * fld.S + x0], g[y0 * fld.S + x1], tx),
               _lerp(g[y1 * fld.S + x0], g[y1 * fld.S + x1], tx), ty);
}
/* 中点位移闪电：线段递归中点随机位移 + 子分支，光栅化到浮点场后模糊做辉光 */
const _boltFieldCache = new Map();

function _lightningField(seed, branches, detail, glow, quick){
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
function _mandelPoint(u, v, p){
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
const _IQ_PALETTES = {
  rainbow:  { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1,1,1],     d: [0,0.33,0.67] },
  ocean:    { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1,1,1],     d: [0,0.1,0.2] },
  sunset:   { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1,1,0.5],   d: [0.8,0.9,0.3] },
  ember:    { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1,0.7,0.4], d: [0,0.15,0.2] },
  fire:     { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [2,1,0],     d: [0.5,0.2,0.25] },
  verdant:  { a: [0.8,0.5,0.4], b: [0.2,0.4,0.2], c: [2,1,1],     d: [0,0.25,0.25] },
};
function _paletteRGB(t, presetKey, freq, phase){
  const p = _IQ_PALETTES[presetKey] || _IQ_PALETTES.rainbow;
  const c = +(freq ?? 1), ph = +(phase ?? 0);
  const w = 6.283185 * (c * clamp(t, 0, 1) + ph);
  return [
    clamp(p.a[0] + p.b[0] * Math.cos(w + 6.283185 * p.d[0]), 0, 1),
    clamp(p.a[1] + p.b[1] * Math.cos(w + 6.283185 * p.d[1]), 0, 1),
    clamp(p.a[2] + p.b[2] * Math.cos(w + 6.283185 * p.d[2]), 0, 1),
  ];
}

/* ── Simplex 2D（Stefan Gustavson 公有域实现）── */
const _F2 = 0.3660254037844386;
const _G2 = 0.21132486540518713;
const _grad3 = [1,1, -1,1, 1,-1, -1,-1, 1,0, -1,0, 0,1, 0,-1];
function _simplex2D(xin, yin, seed){
  const s = (xin+yin)*_F2;
  const i = Math.floor(xin+s), j = Math.floor(yin+s);
  const t = (i+j)*_G2;
  const x0 = xin-(i-t), y0 = yin-(j-t);
  let i1, j1;
  if(x0>y0){i1=1;j1=0;} else {i1=0;j1=1;}
  const x1=x0-i1+_G2, y1=y0-j1+_G2;
  const x2=x0-1+2*_G2, y2=y0-1+2*_G2;
  const g0=(Math.floor(_hash(i,j,seed)*256)%8)*2;
  const g1=(Math.floor(_hash(i+i1,j+j1,seed)*256)%8)*2;
  const g2=(Math.floor(_hash(i+1,j+1,seed)*256)%8)*2;
  let n0=0,n1=0,n2=0;
  let t0=0.5-x0*x0-y0*y0; if(t0>0){t0*=t0; n0=t0*t0*(_grad3[g0]*x0+_grad3[g0+1]*y0);}
  let t1=0.5-x1*x1-y1*y1; if(t1>0){t1*=t1; n1=t1*t1*(_grad3[g1]*x1+_grad3[g1+1]*y1);}
  let t2=0.5-x2*x2-y2*y2; if(t2>0){t2*=t2; n2=t2*t2*(_grad3[g2]*x2+_grad3[g2+1]*y2);}
  return 70*(n0+n1+n2);
}
function _simplexFbm2D(x, y, seed, octaves, gain){
  gain = gain ?? 0.5;
  let val=0, amp=0.5, max=0;
  for(let o=0;o<octaves;o++){
    val += _simplex2D(x, y, seed+o*17)*amp;
    max += amp; amp*=gain;
    [x, y] = _octaveStep(x, y);
  }
  return val/max;
}
function _ridged2D(x, y, seed, octaves, gain){
  gain = gain ?? 0.5;
  let val=0, amp=0.5, max=0;
  for(let o=0;o<octaves;o++){
    let n = 1 - Math.abs(_simplex2D(x, y, seed+o*17));
    val += n*n*amp; max += amp; amp*=gain;
    [x, y] = _octaveStep(x, y);
  }
  return val/max;
}

/* ── 噪波节点预览图（对 [0,1]² 域整图采样，算法与各节点 eval 统一走 _noiseValue）── */
const _NOISE_PV_TYPES = new Set(['noise','voronoi','simplex','ridge','warp','white','cell','billow','cubic','pingpong','voronoise','reaction','lightning','mandel','palette']);
const _noisePvCache = new Map();
function _noiseValue(type, u, v, p){
  const scale = +(p.scale ?? 4);
  const seed = Math.round(+(p.seed ?? 0));
  const octaves = Math.round(+(p.octaves ?? 4));
  const gain = +(p.gain ?? 0.5);
  const x = u * scale, y = v * scale;
  switch(type){
    case 'reaction': { // 场模拟型：忽略 scale，整图 [0,1]² 域采样；小预览走快速档（低迭代）
      const iters = p._quick ? Math.min(Math.round(+(p.iterations ?? 120)), 40) : Math.round(+(p.iterations ?? 120));
      const fld = _reactionField(seed, iters, p.preset ?? 'coral', !!p._quick);
      return clamp(_sampleField(fld, u, v), 0, 1);
    }
    case 'lightning': {
      const fld = _lightningField(seed, +(p.branches ?? 0.7), +(p.detail ?? 1), +(p.glow ?? 0.5), !!p._quick);
      return clamp(_sampleField(fld, u, v), 0, 1);
    }
    case 'mandel':    return _mandelPoint(u, v, p);
    case 'noise':     return clamp(_fbm2D(x, y, seed, octaves, gain), 0, 1);
    case 'simplex':   return clamp(_simplexFbm2D(x, y, seed, octaves, gain) * 0.5 + 0.5, 0, 1);
    case 'ridge':     return clamp(_ridged2D(x, y, seed, octaves, gain), 0, 1);
    case 'billow':    return clamp(_billow2D(x, y, seed, octaves, gain) * 0.5 + 0.5, 0, 1);
    case 'cubic':     return clamp(_cubicFbm2D(x, y, seed, octaves, gain), 0, 1);
    case 'pingpong':  return clamp(_pingpongFbm2D(x, y, seed, octaves, gain, +(p.strength ?? 2)) * 0.5 + 0.5, 0, 1);
    case 'white':     return clamp(_white2D(x, y, seed), 0, 1);
    case 'cell':      return clamp(_cell2D(x, y, seed), 0, 1);
    case 'voronoise': return clamp(_voronoise2D(x, y, seed, +(p.jitter ?? 1), +(p.blend ?? 0.5)), 0, 1);
    case 'voronoi': {
      const mode = p.mode ?? 'f1';
      const jit = +(p.jitter ?? 1);
      if(mode === 'smooth'){
        const falloff = 4 + 60 * clamp(+(p.smooth ?? 0.5), 0, 1);
        return clamp(_voronoiSmooth2D(x, y, seed, jit, falloff), 0, 1);
      }
      const [f1, f2] = _voronoiCells2D(x, y, seed, jit);
      if(mode === 'f2')    return clamp(f2, 0, 1);
      if(mode === 'f2-f1') return clamp((f2 - f1) * 1.6, 0, 1);
      return clamp(f1, 0, 1);
    }
    default: { // warp：双层递归域扭曲 fbm(p + fbm(p + fbm(p)))
      const amount = +(p.amount ?? 1);
      const qx = x + amount * _simplex2D(x + 2.7, y + 1.3, seed);
      const qy = y + amount * _simplex2D(x - 1.7, y + 2.1, seed + 31);
      const rx = qx + amount * 0.5 * _simplex2D(qx + 1.7, qy + 9.2, seed + 7);
      const ry = qy + amount * 0.5 * _simplex2D(qx + 8.3, qy + 2.8, seed + 38);
      return clamp(_simplexFbm2D(rx, ry, seed + 13, octaves, gain) * 0.5 + 0.5, 0, 1);
    }
  }
}

/* quintic 插值曲线（C² 连续）：比 cubic smoothstep 频谱旁瓣小，fBm 叠加无格纹残留 */

function _valueNoise2D(x, y, seed){
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = _hash(ix, iy, seed);
  const b = _hash(ix + 1, iy, seed);
  const c = _hash(ix, iy + 1, seed);
  const d = _hash(ix + 1, iy + 1, seed);
  const ux = _quintic(fx), uy = _quintic(fy);
  return _lerp(_lerp(a, b, ux), _lerp(c, d, ux), uy);
}
/* ── 噪波图像生成（画质三重保障）────────────────
   ① SSAA 超采样：小图 2×2 子像素平均抗锯齿（离散型/模拟型除外——white/cell/voronoise
     离散高频，reaction/lightning 为场采样，mandel 逐点迭代成本高，SSAA 无收益）
   ② min-max 对比度归一化：多倍频叠加使动态范围收窄（oct=4 仅 ~77%），拉伸满幅
   ③ 三角分布抖动 ±0.5LSB：打散 8bit 量化在缓变区的色带 */
const _NO_SSAA = new Set(['white', 'cell', 'voronoise', 'reaction', 'lightning', 'mandel']);
function _noiseGrid(type, S, p){
  const ssaa = (S <= 256 && !_NO_SSAA.has(type)) ? 2 : 1;
  /* 小图（节点预览/预览窗口）走快速档：field 类降参（低迭代/浅细分），
     全参 512 纹理由 _noiseTexUrl 异步队列生成 —— 拖动滑条时保帧率 */
  const gp = (S <= 128 && (type === 'reaction' || type === 'lightning')) ? { ...p, _quick: true } : p;
  const buf = new Float32Array(S * S);
  let mn = Infinity, mx = -Infinity;
  const sub = 1 / (S * ssaa);
  for(let py = 0; py < S; py++){
    for(let px = 0; px < S; px++){
      let v = 0;
      for(let sy = 0; sy < ssaa; sy++){
        const vy = (py * ssaa + sy + 0.5) * sub;
        for(let sx = 0; sx < ssaa; sx++){
          v += _noiseValue(type, (px * ssaa + sx + 0.5) * sub, vy, gp);
        }
      }
      v /= ssaa * ssaa;
      const i = py * S + px;
      buf[i] = v;
      if(v < mn) mn = v;
      if(v > mx) mx = v;
    }
  }
  return {buf, mn, mx};
}
function _gridToImageData(buf, mn, mx, S){
  const span = (mx - mn) > 1e-6 ? 1 / (mx - mn) : 0;
  const out = new Uint8ClampedArray(S * S);
  for(let i = 0; i < S * S; i++){
    const v = span ? (buf[i] - mn) * span : buf[i];
    const dith = ((_hash(i % S, (i / S) | 0, 0) - 0.5) + (_hash((i % S) + 7, ((i / S) | 0) + 13, 0) - 0.5)) * 0.5;
    out[i] = Math.round(clamp(v, 0, 1) * 255 + dith);
  }
  return out;
}
function _noisePreviewUrl(node, S){
  S = Math.max(8, Math.round(+(S ?? 96)));
  const p = node.props;
  const key = JSON.stringify([node.type, node.props, S]);
  if(_noisePvCache.has(key)) return _noisePvCache.get(key);
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  if(node.type === 'palette'){ // iq 余弦调色板：彩色横条渐变（t=u）
    const preset = p.preset ?? 'rainbow';
    const freq = +(p.freq ?? 1), phase = +(p.phase ?? 0);
    for(let py = 0; py < S; py++){
      for(let px = 0; px < S; px++){
        const rgb = _paletteRGB(px / S * 0.999, preset, freq, phase);
        const j = (py * S + px) * 4;
        d[j] = rgb[0] * 255; d[j + 1] = rgb[1] * 255; d[j + 2] = rgb[2] * 255; d[j + 3] = 255;
      }
    }
  } else {
    const {buf, mn, mx} = _noiseGrid(node.type, S, p);
    const gray = _gridToImageData(buf, mn, mx, S);
    for(let i = 0; i < S * S; i++){
      const b = gray[i];
      const j = i * 4;
      d[j] = b; d[j + 1] = b; d[j + 2] = b; d[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  let url = null;
  try { url = c.toDataURL('image/png'); } catch(e){ url = null; }
  /* LRU 淘汰：超出容量移除最旧 8 条（而非清空——来回拖动滑条时保留热门键） */
  if(_noisePvCache.size > 32){
    const it = _noisePvCache.keys();
    for(let i = 0; i < 8; i++){
      const k = it.next().value;
      if(k === undefined) break;
      _noisePvCache.delete(k);
    }
  }
  _noisePvCache.set(key, url);
  return url;
}

const _NOISE_TEX_SIZE = 512;

function _renderNoisePreview(node, val){
  const el = node._outPreviewEl;
  if(!el) return;
  const label = el.querySelector('.pv-label');
  el.innerHTML='';
  if(label) el.appendChild(label);
  const url = _noisePreviewUrl(node);
  if(!url){
    const e=document.createElement('div'); e.className='pv-empty';
    e.textContent='预览生成失败'; el.appendChild(e); return;
  }
  const box=document.createElement('div'); box.className='pv-imgbox';
  const img=document.createElement('img'); img.src=url; img.alt='';
  box.appendChild(img); el.appendChild(box);
  if(typeof val==='number'){
    const t=document.createElement('div'); t.className='pv-tag';
    t.textContent = val.toFixed(4); el.appendChild(t);
  }
}

export {
  _octaveStep, _fbm2D, _voronoiCells2D, _voronoiSmooth2D, _white2D, _cell2D,
  _cubicNoise2D, _cubicFbm2D, _pingpongFbm2D, _billow2D, _voronoise2D,
  _reactionField, _sampleField, _lightningField, _mandelPoint,
  _paletteRGB, _simplex2D, _simplexFbm2D, _ridged2D,
  _noiseValue, _valueNoise2D, _noiseGrid, _gridToImageData, _noisePreviewUrl,
  _renderNoisePreview, _noisePvCache, _NOISE_TEX_SIZE, _NOISE_PV_TYPES
};
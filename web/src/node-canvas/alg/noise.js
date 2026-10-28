/**
 * matoga - 节点画布算法层：程序化噪声算法
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 algorithms.js 按职责搬出，逻辑未改。
 */
import { _cubicAt, _hash, _lerp, _quintic } from './helpers.js'

export function _octaveStep(x, y){
  return [(0.8 * x - 0.6 * y) * 2.03, (0.6 * x + 0.8 * y) * 2.03];
}
export function _fbm2D(x, y, seed, octaves, gain){
  gain = gain ?? 0.5;
  let val = 0, amp = 0.5, max = 0;
  for(let o = 0; o < octaves; o++){
    val += _valueNoise2D(x, y, seed + o * 17) * amp;
    max += amp; amp *= gain;
    [x, y] = _octaveStep(x, y);
  }
  return val / max;
}
export function _voronoiCells2D(x, y, seed, jitter){
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
export function _voronoiSmooth2D(x, y, seed, jitter, falloff){
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

export function _white2D(x, y, seed){
  return _hash((x * 8191) | 0, (y * 131071) | 0, seed);
}
export function _cell2D(x, y, seed){
  return _hash(Math.floor(x), Math.floor(y), seed);
}

export function _cubicNoise2D(x, y, seed){
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const v = (i, j) => _hash(ix + i, iy + j, seed);
  const r = [0, 1, 2, 3].map(j => _cubicAt(fx, v(0, j), v(1, j), v(2, j), v(3, j)));
  return _cubicAt(fy, r[0], r[1], r[2], r[3]);
}
export function _cubicFbm2D(x, y, seed, octaves, gain){
  gain = gain ?? 0.5;
  let val = 0, amp = 0.5, max = 0;
  for(let o = 0; o < octaves; o++){
    val += _cubicNoise2D(x, y, seed + o * 17) * amp;
    max += amp; amp *= gain;
    [x, y] = _octaveStep(x, y);
  }
  return val / max;
}
export function _pingpongFbm2D(x, y, seed, octaves, gain, strength){
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
export function _billow2D(x, y, seed, octaves, gain){
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
export function _voronoise2D(x, y, seed, jitter, blend){
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
/* 反应扩散 Gray-Scott：A' = A + (DA∇²A − AB² + f(1−A))·dt，B' = B + (DB∇²B + AB² − (k+f)B)·dt
   f/k 决定形态：珊瑚/迷宫/孤子/波动。固定 256² 模拟，S 更大时双线性上采样（每 props 仅算一次并缓存） */

/* ── Simplex 2D（Stefan Gustavson 公有域实现）── */
export const _F2 = 0.3660254037844386;
export const _G2 = 0.21132486540518713;
export const _grad3 = [1,1, -1,1, 1,-1, -1,-1, 1,0, -1,0, 0,1, 0,-1];
export function _simplex2D(xin, yin, seed){
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
export function _simplexFbm2D(x, y, seed, octaves, gain){
  gain = gain ?? 0.5;
  let val=0, amp=0.5, max=0;
  for(let o=0;o<octaves;o++){
    val += _simplex2D(x, y, seed+o*17)*amp;
    max += amp; amp*=gain;
    [x, y] = _octaveStep(x, y);
  }
  return val/max;
}
export function _ridged2D(x, y, seed, octaves, gain){
  gain = gain ?? 0.5;
  let val=0, amp=0.5, max=0;
  for(let o=0;o<octaves;o++){
    let n = 1 - Math.abs(_simplex2D(x, y, seed+o*17));
    val += n*n*amp; max += amp; amp*=gain;
    [x, y] = _octaveStep(x, y);
  }
  return val/max;
}


export function _valueNoise2D(x, y, seed){
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

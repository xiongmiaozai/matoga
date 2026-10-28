/**
 * matoga - 节点画布算法层：噪波预览与图像生成
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 algorithms.js 按职责搬出，逻辑未改。
 */
import { _lightningField, _mandelPoint, _paletteRGB, _reactionField, _sampleField } from './fields.js'
import { _hash, clamp } from './helpers.js'
import { _billow2D, _cell2D, _cubicFbm2D, _fbm2D, _pingpongFbm2D, _ridged2D, _simplex2D, _simplexFbm2D, _voronoiCells2D, _voronoiSmooth2D, _voronoise2D, _white2D } from './noise.js'

/* ── 噪波节点预览图（对 [0,1]² 域整图采样，算法与各节点 eval 统一走 _noiseValue）── */
export const _NOISE_PV_TYPES = new Set(['noise','voronoi','simplex','ridge','warp','white','cell','billow','cubic','pingpong','voronoise','reaction','lightning','mandel','palette']);
export const _noisePvCache = new Map();
export function _noiseValue(type, u, v, p){
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


export const _NO_SSAA = new Set(['white', 'cell', 'voronoise', 'reaction', 'lightning', 'mandel']);
export function _noiseGrid(type, S, p){
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
export function _gridToImageData(buf, mn, mx, S){
  const span = (mx - mn) > 1e-6 ? 1 / (mx - mn) : 0;
  const out = new Uint8ClampedArray(S * S);
  for(let i = 0; i < S * S; i++){
    const v = span ? (buf[i] - mn) * span : buf[i];
    const dith = ((_hash(i % S, (i / S) | 0, 0) - 0.5) + (_hash((i % S) + 7, ((i / S) | 0) + 13, 0) - 0.5)) * 0.5;
    out[i] = Math.round(clamp(v, 0, 1) * 255 + dith);
  }
  return out;
}
export function _noisePreviewUrl(node, S){
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
/* ── 噪波纹理输出（异步生成）────────────────
   eval 调用时不做 512² 采样+PNG 编码（~46ms 同步阻塞）：缓存命中或上次成功 URL 立即返回，
   miss 时入队（同节点去重，只保留最新 props），每帧后台处理一个，完成后 evaluate 刷新下游收敛。 */


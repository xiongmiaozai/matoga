
/* ════════════════════════════════════════════════════════════
   matoga Node Canvas — JS 引擎（整合进主页，模式切换）
   ════════════════════════════════════════════════════════════ */

/* 复用主页 material3d 模块；若未初始化则在此主动 initMaterial3D（幂等） */
import * as m3d from './material3d.js';
import { enhancePreview } from './preview2d.js';
import { uiPrompt, uiConfirm } from './ui-dialog.js';


let _initialized = false;

const $ = (s) => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';

/* ── 节点类型定义 ───────────────────────────── */
const NODE_DEFS = {
  // 输入
  number: { title:'数值', group:'输入', color:'var(--type-number)',
    inputs:[], outputs:[{n:'value',t:'number'}],
    widget:(n)=>numWidget(n,'value',0,1,0.01), eval:()=>null },
  color: { title:'颜色', group:'输入', color:'var(--type-color)',
    inputs:[], outputs:[{n:'color',t:'color'}],
    widget:(n)=>colorWidget(n,'color'), eval:()=>null },
  texture: { title:'纹理', group:'输入', color:'var(--type-texture)',
    inputs:[], outputs:[{n:'tex',t:'texture'}],
    widget:(n)=>textureWidget(n,'tex'), eval:()=>null },
  vector2: { title:'向量2', group:'输入', color:'var(--type-vector)',
    inputs:[], outputs:[{n:'v',t:'vector'}],
    widget:(n)=>vecWidget(n,['x','y'],0,1,0.01), eval:()=>null },

  // 运算
  add: { title:'加法 (a+b)', group:'运算', color:'var(--type-number)',
    inputs:[{n:'a',t:'number'},{n:'b',t:'number'}], outputs:[{n:'out',t:'number'}],
    eval:(i)=>({out:(num(i.a)+num(i.b))}) },
  sub: { title:'减法 (a-b)', group:'运算', color:'var(--type-number)',
    inputs:[{n:'a',t:'number'},{n:'b',t:'number'}], outputs:[{n:'out',t:'number'}],
    eval:(i)=>({out:(num(i.a)-num(i.b))}) },
  mul: { title:'乘法 (a×b)', group:'运算', color:'var(--type-number)',
    inputs:[{n:'a',t:'number'},{n:'b',t:'number'}], outputs:[{n:'out',t:'number'}],
    eval:(i)=>({out:(num(i.a)*num(i.b))}) },
  div: { title:'除法 (a÷b)', group:'运算', color:'var(--type-number)',
    inputs:[{n:'a',t:'number'},{n:'b',t:'number'}], outputs:[{n:'out',t:'number'}],
    eval:(i)=>({out:(num(i.b)===0?0:num(i.a)/num(i.b))}) },
  mix: { title:'混合 mix(a,b,t)', group:'运算', color:'var(--type-number)',
    inputs:[{n:'a',t:'number'},{n:'b',t:'number'},{n:'t',t:'number'}], outputs:[{n:'out',t:'number'}],
    eval:(i)=>{const t=clamp(num(i.t),0,1); return {out:num(i.a)*(1-t)+num(i.b)*t}} },
  clamp: { title:'钳制', group:'运算', color:'var(--type-number)',
    inputs:[{n:'v',t:'number'},{n:'min',t:'number'},{n:'max',t:'number'}], outputs:[{n:'out',t:'number'}],
    eval:(i)=>({out:clamp(num(i.v),num(i.min),num(i.max))}) },
  colorMix: { title:'颜色混合', group:'运算', color:'var(--type-color)',
    inputs:[{n:'a',t:'color'},{n:'b',t:'color'},{n:'t',t:'number'}], outputs:[{n:'out',t:'color'}],
    eval:(i)=>{const t=clamp(num(i.t),0,1); const a=col(i.a),b=col(i.b);
      return {out:[a[0]*(1-t)+b[0]*t, a[1]*(1-t)+b[1]*t, a[2]*(1-t)+b[2]*t]}} },

  // 材质
  mainTex: { title:'主图', group:'材质', color:'var(--type-texture)',
    inputs:[], outputs:[{n:'color',t:'color'},{n:'alpha',t:'number'},{n:'tex',t:'texture'}],
    widget:(n)=>textureWidget(n,'tex'),
    eval:(i,n)=>{
      const url = n.props.tex || '';
      return { color: url ? _texAvgColor(url) : [0.6,0.6,0.6],
               alpha: url ? _texAlpha(url) : 1,
               tex: url || null };
    } },

  sample: { title:'贴图采样', group:'材质', color:'var(--type-texture)',
    inputs:[{n:'tex',t:'texture'},{n:'uv',t:'vector'}], outputs:[{n:'color',t:'color'}],
    eval:(i)=>{
      if(typeof i.tex==='string' && i.tex) return {color:_texAvgColor(i.tex)};
      if(Array.isArray(i.tex) && i.tex.length>=3) return {color:[i.tex[0],i.tex[1],i.tex[2]]};
      return {color:[0.5,0.5,0.5]};
    } },
  hdr: { title:'HDR 环境', group:'材质', color:'var(--type-env)',
    inputs:[], outputs:[{n:'env',t:'environment'}],
    widget:(n)=>selectWidget(n,'preset',['studio','forest','sunset','night','courtyard']),
    eval:()=>null },
  normalMap: { title:'法线生成', group:'材质', color:'var(--type-texture)',
    inputs:[{n:'tex',t:'texture'},{n:'strength',t:'number'}], outputs:[{n:'normal',t:'texture'}],
    eval:(i)=>{
      const tex = i.tex || null;
      const strength = clamp(num(i.strength),0,2);
      return {normal: tex ? {src:tex, strength} : null};
    } },
  rgbaMerge: { title:'RGBA 合并', group:'材质', color:'var(--type-texture)',
    inputs:[{n:'r',t:'any'},{n:'g',t:'any'},{n:'b',t:'any'},{n:'a',t:'any'}],
    outputs:[{n:'tex',t:'texture'}],
    widget:(n)=>rgbaMergeWidget(n),
    eval:(i,n)=>{
      const size = Math.max(16, Math.round(+(n.props.size ?? 256) || 256));
      const rr = _rgbaIn(i.r, n.props.r, 0);
      const gg = _rgbaIn(i.g, n.props.g, 1);
      const bb = _rgbaIn(i.b, n.props.b, 2);
      const aa = _rgbaIn(i.a, n.props.a, 3);
      const url = _rgbaMerge(rr, gg, bb, aa, size);
      n._rgbaUrl = url || null;
      return {tex: url || null};
    } },

  // 程序化纹理
  noise: { title:'噪声 (Perlin)', group:'纹理', color:'var(--type-number)',
    inputs:[{n:'uv',t:'vector'}], outputs:[{n:'out',t:'number'},{n:'tex',t:'texture'}],
    widget:(n)=>noiseWidget(n),
    eval:(i,n)=>{
      const uv = Array.isArray(i.uv) ? i.uv : [0.5,0.5];
      const scale = +(n.props.scale ?? 4);
      const seed = Math.round(+(n.props.seed ?? 0));
      const octaves = Math.round(+(n.props.octaves ?? 4));
      const v = _fbm2D(uv[0]*scale, uv[1]*scale, seed, octaves);
      return {out:clamp(v,0,1), tex:_noiseTexUrl(n)};
    } },
  voronoi: { title:'Voronoi', group:'纹理', color:'var(--type-number)',
    inputs:[{n:'uv',t:'vector'}], outputs:[{n:'out',t:'number'},{n:'tex',t:'texture'}],
    widget:(n)=>voronoiWidget(n),
    eval:(i,n)=>{
      const uv = Array.isArray(i.uv) ? i.uv : [0.5,0.5];
      const scale = +(n.props.scale ?? 5);
      const seed = Math.round(+(n.props.seed ?? 0));
      const v = _voronoi2D(uv[0]*scale, uv[1]*scale, seed);
      return {out:clamp(v,0,1), tex:_noiseTexUrl(n)};
    } },
  gradient: { title:'渐变', group:'纹理', color:'var(--type-color)',
    inputs:[{n:'colorA',t:'color'},{n:'colorB',t:'color'},{n:'t',t:'number'}],
    outputs:[{n:'out',t:'color'}],
    widget:(n)=>gradientWidget(n),
    eval:(i,n)=>{
      const t = clamp(num(i.t),0,1);
      const mode = n.props.mode ?? 'linear';
      let tt = t;
      if(mode==='smooth') tt = _smoothstep(t);
      else if(mode==='ease') tt = t*t*(3-2*t);
      const a = col(i.colorA), b = col(i.colorB);
      return {out:[_lerp(a[0],b[0],tt), _lerp(a[1],b[1],tt), _lerp(a[2],b[2],tt)]};
    } },
  simplex: { title:'Simplex 噪声', group:'纹理', color:'var(--type-number)',
    inputs:[{n:'uv',t:'vector'}], outputs:[{n:'out',t:'number'},{n:'tex',t:'texture'}],
    widget:(n)=>noiseWidget(n),
    eval:(i,n)=>{
      const uv = Array.isArray(i.uv) ? i.uv : [0.5,0.5];
      const scale = +(n.props.scale ?? 4);
      const seed = Math.round(+(n.props.seed ?? 0));
      const octaves = Math.round(+(n.props.octaves ?? 4));
      const v = _simplexFbm2D(uv[0]*scale, uv[1]*scale, seed, octaves);
      return {out:clamp(v*0.5+0.5,0,1), tex:_noiseTexUrl(n)};
    } },
  ridge: { title:'山脊噪声', group:'纹理', color:'var(--type-number)',
    inputs:[{n:'uv',t:'vector'}], outputs:[{n:'out',t:'number'},{n:'tex',t:'texture'}],
    widget:(n)=>noiseWidget(n),
    eval:(i,n)=>{
      const uv = Array.isArray(i.uv) ? i.uv : [0.5,0.5];
      const scale = +(n.props.scale ?? 4);
      const seed = Math.round(+(n.props.seed ?? 0));
      const octaves = Math.round(+(n.props.octaves ?? 4));
      const v = _ridged2D(uv[0]*scale, uv[1]*scale, seed, octaves);
      return {out:clamp(v,0,1), tex:_noiseTexUrl(n)};
    } },
  warp: { title:'域扭曲', group:'纹理', color:'var(--type-number)',
    inputs:[{n:'uv',t:'vector'}], outputs:[{n:'out',t:'number'},{n:'tex',t:'texture'}],
    widget:(n)=>warpWidget(n),
    eval:(i,n)=>{
      const uv = Array.isArray(i.uv) ? i.uv : [0.5,0.5];
      const scale = +(n.props.scale ?? 3);
      const seed = Math.round(+(n.props.seed ?? 0));
      const octaves = Math.round(+(n.props.octaves ?? 4));
      const amount = +(n.props.amount ?? 1);
      const x = uv[0]*scale, y = uv[1]*scale;
      const qx = x + amount*_simplex2D(x+2.7, y+1.3, seed);
      const qy = y + amount*_simplex2D(x-1.7, y+2.1, seed+31);
      const v = _simplexFbm2D(qx, qy, seed+13, octaves);
      return {out:clamp(v*0.5+0.5,0,1), tex:_noiseTexUrl(n)};
    } },

  // 输出（hidden：不显示在节点库/添加菜单，仅供程序内部创建）
  preview: { title:'预览', group:'输出', color:'var(--primary)', hidden:true,
    inputs:[{n:'in',t:'any'}], outputs:[],
    widget:(n)=>previewWidget(n,'in'), eval:()=>null },
  output: { title:'主输出', group:'输出', color:'var(--primary)', hidden:true,
    inputs:[{n:'baseColor',t:'color'},{n:'roughness',t:'number'},{n:'metallic',t:'number'},{n:'normal',t:'texture'}],
    outputs:[],
    widget:(n)=>previewWidget(n,'__mat__'),
    eval:(i)=>({material:{baseColor:col(i.baseColor),roughness:clamp(num(i.roughness),0,1),
      metallic:clamp(num(i.metallic),0,1),normal:i.normal}}) },
  outputLeft: { title:'左输出', group:'输出', color:'#2b6cff', hidden:true,
    inputs:[{n:'baseColor',t:'color'},{n:'roughness',t:'number'},{n:'metallic',t:'number'},{n:'normal',t:'texture'}],
    outputs:[],
    widget:(n)=>previewWidget(n,'__mat__'),
    eval:(i)=>({material:{baseColor:col(i.baseColor),roughness:clamp(num(i.roughness),0,1),
      metallic:clamp(num(i.metallic),0,1),normal:i.normal}}) },
  outputRight: { title:'右输出', group:'输出', color:'#d97706', hidden:true,
    inputs:[{n:'baseColor',t:'color'},{n:'roughness',t:'number'},{n:'metallic',t:'number'},{n:'normal',t:'texture'}],
    outputs:[],
    widget:(n)=>previewWidget(n,'__mat__'),
    eval:(i)=>({material:{baseColor:col(i.baseColor),roughness:clamp(num(i.roughness),0,1),
      metallic:clamp(num(i.metallic),0,1),normal:i.normal}}) },

  // 贴图输出节点（可从节点库添加；左/右对应 3D 预览两个球，直接驱动对应材质槽）
  // 输入端口 tex 接收 texture/mainTex/rgbaMerge/normalMap 节点的贴图链接（PNG dataURL，含 RGBA 通道）
  mainTexOutLeft: { title:'主贴图输出 (左)', group:'输出', color:'#2b6cff',
    inputs:[{n:'tex',t:'texture'}], outputs:[],
    widget:(n)=>previewWidget(n,'tex'),
    eval:(i)=>({mainTextureUrl:_texUrl(i.tex)}) },
  mainTexOutRight: { title:'主贴图输出 (右)', group:'输出', color:'#d97706',
    inputs:[{n:'tex',t:'texture'}], outputs:[],
    widget:(n)=>previewWidget(n,'tex'),
    eval:(i)=>({mainTextureUrl:_texUrl(i.tex)}) },
  normalOutLeft: { title:'法线输出 -n (左)', group:'输出', color:'#2b6cff',
    inputs:[{n:'tex',t:'texture'}], outputs:[],
    widget:(n)=>previewWidget(n,'tex'),
    eval:(i)=>{ const out={normalMapUrl:_texUrl(i.tex)};
      if(i.tex && typeof i.tex==='object' && typeof i.tex.strength==='number') out.normalScale=i.tex.strength;
      return out; } },
  normalOutRight: { title:'法线输出 -n (右)', group:'输出', color:'#d97706',
    inputs:[{n:'tex',t:'texture'}], outputs:[],
    widget:(n)=>previewWidget(n,'tex'),
    eval:(i)=>{ const out={normalMapUrl:_texUrl(i.tex)};
      if(i.tex && typeof i.tex==='object' && typeof i.tex.strength==='number') out.normalScale=i.tex.strength;
      return out; } },
  specOutLeft: { title:'高光输出 -s (左)', group:'输出', color:'#2b6cff',
    inputs:[{n:'tex',t:'texture'}], outputs:[],
    widget:(n)=>previewWidget(n,'tex'),
    eval:(i)=>({specTextureUrl:_texUrl(i.tex)}) },
  specOutRight: { title:'高光输出 -s (右)', group:'输出', color:'#d97706',
    inputs:[{n:'tex',t:'texture'}], outputs:[],
    widget:(n)=>previewWidget(n,'tex'),
    eval:(i)=>({specTextureUrl:_texUrl(i.tex)}) },
};

/* ── 工具 ───────────────────────────────────── */
const num = (v)=> (typeof v==='number')?v : (Array.isArray(v)?v[0]:0);
const clamp = (v,a,b)=> Math.max(a, Math.min(b, v));
/* 从贴图链接值取 URL：兼容 PNG dataURL 字符串与 normalMap 节点的 {src,strength} 对象 */
const _texUrl = (v)=>{
  if(typeof v==='string' && v) return v;
  if(v && typeof v==='object' && typeof v.src==='string' && v.src) return v.src;
  return null;
};
const col = (v)=> {
  if(Array.isArray(v) && v.length>=3) return [v[0],v[1],v[2]];
  if(typeof v==='number') return [v,v,v];
  return [0.6,0.6,0.6];
};
const rgbToHex = (r,g,b)=> '#'+[r,g,b].map(x=>Math.round(clamp(x,0,1)*255).toString(16).padStart(2,'0')).join('');
const hexToRgb = (h)=> {h=h.replace('#',''); return [parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255];};
const uid = ()=> 'n'+Math.random().toString(36).slice(2,9);

/* ── 纹理平均色缓存（供 sample 节点同步求值用）── */
const _texColorCache = new Map();
function _texAvgColor(url){
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
      evaluate();
    } catch(e){ _texColorCache.set(url, [0.5,0.5,0.5]); }
  };
  img.onerror = ()=>{ _texColorCache.set(url, [0.5,0.5,0.5]); };
  img.src = url;
  return [0.5,0.5,0.5];
}

/* ── 纹理 Alpha 通道缓存（供主图节点取不透明度）── */
const _texAlphaCache = new Map();
function _texAlpha(url){
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
      evaluate();
    } catch(e){ _texAlphaCache.set(url, 1); }
  };
  img.onerror = ()=>{ _texAlphaCache.set(url, 1); };
  img.src = url;
  return 1;
}

/* ── RGBA 通道合并 → PNG（供 rgbaMerge 节点用）── */
const _rgbaMergeCache = new Map();
function _loadImg(url){
  return new Promise(res=>{
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = ()=>res(img);
    img.onerror = ()=>res(null);
    img.src = url;
  });
}
function _rgbaIn(v, def, chIdx){
  if(typeof v==='string' && v) return v;
  if(typeof v==='number' && isFinite(v)) return clamp(v,0,1);
  if(Array.isArray(v)) return clamp(+(v[chIdx] ?? [0,0,0,1][chIdx]),0,1);
  return clamp(+(def ?? [0,0,0,1][chIdx]),0,1);
}
async function _rgbaMergeCompose(rr, gg, bb, aa, size, cb){
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
function _rgbaMerge(rr, gg, bb, aa, size){
  const key = JSON.stringify([rr, gg, bb, aa, size]);
  if(_rgbaMergeCache.has(key)) return _rgbaMergeCache.get(key);
  if(_rgbaMergeCache.size > 32) _rgbaMergeCache.clear();
  _rgbaMergeCompose(rr, gg, bb, aa, size, (url)=>{
    _rgbaMergeCache.set(key, url || '');
    evaluate();
  });
  return null;
}

/* ── 程序化噪声算法 ───────────────────────── */
function _hash(x, y, seed){
  let h = (x * 374761393 + y * 668265263 + seed * 1013904223) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}
function _smoothstep(t){ return t * t * (3 - 2 * t); }
function _lerp(a, b, t){ return a + (b - a) * t; }
function _valueNoise2D(x, y, seed){
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = _hash(ix, iy, seed);
  const b = _hash(ix + 1, iy, seed);
  const c = _hash(ix, iy + 1, seed);
  const d = _hash(ix + 1, iy + 1, seed);
  const ux = _smoothstep(fx), uy = _smoothstep(fy);
  return _lerp(_lerp(a, b, ux), _lerp(c, d, ux), uy);
}
function _fbm2D(x, y, seed, octaves){
  let val = 0, amp = 0.5, freq = 1, max = 0;
  for(let o = 0; o < octaves; o++){
    val += _valueNoise2D(x * freq, y * freq, seed + o * 17) * amp;
    max += amp; amp *= 0.5; freq *= 2;
  }
  return val / max;
}
function _voronoi2D(x, y, seed){
  const ix = Math.floor(x), iy = Math.floor(y);
  let minDist = Infinity;
  for(let dx = -1; dx <= 1; dx++){
    for(let dy = -1; dy <= 1; dy++){
      const cx = ix + dx + _hash(ix + dx, iy + dy, seed);
      const cy = iy + dy + _hash(ix + dx, iy + dy, seed + 999);
      const dist = (cx - x) * (cx - x) + (cy - y) * (cy - y);
      if(dist < minDist) minDist = dist;
    }
  }
  return Math.sqrt(minDist);
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
function _simplexFbm2D(x, y, seed, octaves){
  let val=0, amp=0.5, freq=1, max=0;
  for(let o=0;o<octaves;o++){
    val += _simplex2D(x*freq, y*freq, seed+o*17)*amp;
    max += amp; amp*=0.5; freq*=2;
  }
  return val/max;
}
function _ridged2D(x, y, seed, octaves){
  let val=0, amp=0.5, freq=1, max=0;
  for(let o=0;o<octaves;o++){
    let n = 1 - Math.abs(_simplex2D(x*freq, y*freq, seed+o*17));
    val += n*n*amp; max += amp; amp*=0.5; freq*=2;
  }
  return val/max;
}

/* ── 噪波节点预览图（对 [0,1]² 域整图采样，算法与各节点 eval 一致）── */
const _NOISE_PV_TYPES = new Set(['noise','voronoi','simplex','ridge','warp']);
const _noisePvCache = new Map();
function _noiseSample(type, u, v, p){
  const scale = +(p.scale ?? 4);
  const seed = Math.round(+(p.seed ?? 0));
  const octaves = Math.round(+(p.octaves ?? 4));
  const x = u*scale, y = v*scale;
  if(type==='noise')    return clamp(_fbm2D(x, y, seed, octaves), 0, 1);
  if(type==='voronoi')  return clamp(_voronoi2D(x, y, seed), 0, 1);
  if(type==='simplex')  return clamp(_simplexFbm2D(x, y, seed, octaves)*0.5+0.5, 0, 1);
  if(type==='ridge')    return clamp(_ridged2D(x, y, seed, octaves), 0, 1);
  const amount = +(p.amount ?? 1);
  const qx = x + amount*_simplex2D(x+2.7, y+1.3, seed);
  const qy = y + amount*_simplex2D(x-1.7, y+2.1, seed+31);
  return clamp(_simplexFbm2D(qx, qy, seed+13, octaves)*0.5+0.5, 0, 1);
}
function _noisePreviewUrl(node, S){
  S = Math.max(8, Math.round(+(S ?? 96)));
  const p = node.props;
  const key = JSON.stringify([node.type, +p.scale, Math.round(+(p.seed??0)), Math.round(+(p.octaves??4)), +(p.amount??1), S]);
  if(_noisePvCache.has(key)) return _noisePvCache.get(key);
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for(let py=0;py<S;py++){
    const v = py/S;
    for(let px=0;px<S;px++){
      const b = Math.round(_noiseSample(node.type, px/S, v, p)*255);
      const i = (py*S+px)*4;
      d[i]=b; d[i+1]=b; d[i+2]=b; d[i+3]=255;
    }
  }
  ctx.putImageData(img, 0, 0);
  let url = null;
  try { url = c.toDataURL('image/png'); } catch(e){ url = null; }
  if(_noisePvCache.size > 32) _noisePvCache.clear();
  _noisePvCache.set(key, url);
  return url;
}
/* ── 噪波纹理输出：对 [0,1]² 域整图采样生成灰度 PNG（供 tex 输出端口用）── */
const _NOISE_TEX_SIZE = 256;
function _noiseTexUrl(node){
  const url = _noisePreviewUrl(node, _NOISE_TEX_SIZE);
  return (typeof url === 'string' && url) ? url : null;
}
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

/* ── 状态 ───────────────────────────────────── */
const state = {
  nodes: new Map(),     // id -> {id, type, x, y, props, el}
  edges: new Map(),     // id -> {id, from:{node,port}, to:{node,port}}
  selected: new Set(),  // node ids
  selectedEdge: null,
  viewport: {x:0, y:0, zoom:1},
  dragging: null,       // {kind:'node'|'pan'|'edge'|'box', ...}
};

/* ── 视口 ───────────────────────────────────── */
const canvasWrap = $('#canvas-wrap');
const world = $('#world');
const gridBg = $('#grid-bg');

function applyViewport(){
  const {x,y,zoom} = state.viewport;
  world.style.transform = `translate(${x}px,${y}px) scale(${zoom})`;
  // 网格随缩放平移
  const g = 24*zoom, G = 120*zoom;
  gridBg.style.backgroundSize = `${g}px ${g}px, ${g}px ${g}px, ${G}px ${G}px, ${G}px ${G}px`;
  gridBg.style.backgroundPosition = `${x}px ${y}px, ${x}px ${y}px, ${x}px ${y}px, ${x}px ${y}px`;
  const pct = Math.round(zoom*100)+'%';
  $('#zoom-label').textContent = pct;
  $('#stat-zoom').textContent = pct;
}
function screenToWorld(sx, sy){
  const r = canvasWrap.getBoundingClientRect();
  const {x,y,zoom} = state.viewport;
  return {x:(sx-r.left-x)/zoom, y:(sy-r.top-y)/zoom};
}
function setZoom(z, cx, cy){
  z = clamp(z, 0.2, 3);
  const r = canvasWrap.getBoundingClientRect();
  cx = (cx??r.left+r.width/2) - r.left;
  cy = (cy??r.top+r.height/2) - r.top;
  const {x,y,zoom} = state.viewport;
  const wx = (cx-x)/zoom, wy = (cy-y)/zoom;
  state.viewport.zoom = z;
  state.viewport.x = cx - wx*z;
  state.viewport.y = cy - wy*z;
  applyViewport();
}

/* ── 节点创建/渲染 ─────────────────────────── */
const nodesLayer = $('#nodes-layer');

function createNode(type, x, y){
  const def = NODE_DEFS[type];
  if(!def) return null;
  pushHistory();
  const id = uid();
  const props = defaultProps(type);
  const node = {id, type, x, y, props, el:null};
  state.nodes.set(id, node);
  renderNode(node);
  updateStats();
  evaluate();
  return node;
}
function defaultProps(type){
  const def = NODE_DEFS[type];
  const p = {};
  if(type==='number') p.value = 0.5;
  else if(type==='color') p.color = '#7cbd56';
  else if(type==='texture') p.tex = '';
  else if(type==='mainTex'){ p.tex = ''; p._role = 'main'; }
  else if(type==='vector2'){p.x=0.5; p.y=0.5;}
  else if(type==='hdr') p.preset = 'studio';
  else if(type==='noise'){p.scale=4; p.seed=0; p.octaves=4;}
  else if(type==='voronoi'){p.scale=5; p.seed=0;}
  else if(type==='simplex'){p.scale=4; p.seed=0; p.octaves=4;}
  else if(type==='ridge'){p.scale=4; p.seed=0; p.octaves=4;}
  else if(type==='warp'){p.scale=3; p.seed=0; p.octaves=4; p.amount=1;}
  else if(type==='gradient'){p.colorA='#7cbd56'; p.colorB='#c084fc'; p.mode='linear';}
  else if(type==='rgbaMerge'){p.r=0; p.g=0; p.b=0; p.a=1; p.size=null;}
  return p;
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function renderNode(node){
  const def = NODE_DEFS[node.type];
  const el = document.createElement('div');
  el.className = 'node';
  el.style.left = node.x+'px';
  el.style.top = node.y+'px';
  el.style.setProperty('--node-color', def.color);
  el.dataset.id = node.id;

  // 头
  const head = document.createElement('div');
  head.className = 'node-head';
  const titleText = node.title || def.title;
  head.innerHTML = `<span class="badge pixel"></span><span class="title${node.title?' renamed':''}">${escapeHtml(titleText)}</span><button class="collapse" title="折叠/展开">${node.collapsed?'▸':'▾'}</button><button class="x" title="删除">✕</button>`;
  if(node.collapsed) el.classList.add('collapsed');
  head.querySelector('.x').addEventListener('pointerdown', e=>e.stopPropagation());
  head.querySelector('.x').addEventListener('click', e=>{e.stopPropagation(); deleteNode(node.id);});
  head.querySelector('.collapse').addEventListener('pointerdown', e=>e.stopPropagation());
  head.querySelector('.collapse').addEventListener('click', e=>{e.stopPropagation(); toggleCollapse(node.id);});
  el.appendChild(head);

  // body
  const body = document.createElement('div');
  body.className = 'node-body';

  // 输入端口
  def.inputs.forEach((p,i)=>{
    const row = document.createElement('div');
    row.className = 'port-row in';
    row.innerHTML = `<span class="port in" data-node="${node.id}" data-port="${p.n}" data-dir="in" data-type="${p.t}" style="--port-color:var(--type-${p.t})"></span><span class="port-label">${p.n}</span>`;
    body.appendChild(row);
  });
  // 输出端口
  def.outputs.forEach((p,i)=>{
    const row = document.createElement('div');
    row.className = 'port-row out';
    row.innerHTML = `<span class="port-label">${p.n}</span><span class="port out" data-node="${node.id}" data-port="${p.n}" data-dir="out" data-type="${p.t}" style="--port-color:var(--type-${p.t})"></span>`;
    body.appendChild(row);
  });

  // widget
  if(def.widget){
    const w = document.createElement('div');
    w.className = 'widget';
    w.appendChild(def.widget(node));
    body.appendChild(w);
  }
  // 输出预览
  const _noOutPv = new Set(['color','texture','number','vector2','hdr','preview','output','outputLeft','outputRight']);
  if(def.outputs && def.outputs.length && !_noOutPv.has(node.type)){
    const pv = document.createElement('div');
    pv.className = 'w-preview out-preview';
    const o0 = def.outputs[0];
    pv.innerHTML = `<div class="pv-label"><span>${o0.n}</span><span class="pv-type">${o0.t}</span></div><div class="pv-empty">待计算</div>`;
    node._outPreviewEl = pv;
    body.appendChild(pv);
  }
  el.appendChild(body);
  nodesLayer.appendChild(el);
  node.el = el;

  // 拖拽
  head.addEventListener('pointerdown', (e)=>{
    if(pinch) return;
    if(e.button!==0) return;
    e.stopPropagation();
    selectNode(node.id, e.shiftKey);
    const sx = e.clientX, sy = e.clientY;
    const moving = new Set(state.selected);
    if(!moving.has(node.id)) moving.add(node.id);
    el.classList.add('dragging');
    const baselines = new Map();
    moving.forEach(id=>{
      const n = state.nodes.get(id);
      if(n){ baselines.set(id, {x:n.x, y:n.y}); n.el.classList.add('dragging'); }
    });
    state.dragging = {kind:'node', sx, sy, moving, baselines};
  });

  // 选中
  el.addEventListener('pointerdown', (e)=>{
    if(pinch) return;
    if(e.target.classList.contains('port')) return;
    e.stopPropagation();
    selectNode(node.id, e.shiftKey);
  });
  // 端口
  el.querySelectorAll('.port').forEach(p=>{
    p.addEventListener('pointerdown', (e)=>{
      if(pinch) return;
      e.stopPropagation();
      e.preventDefault();
      startEdge(p, e);
    });
  });
}
function deleteNode(id){
  if(!state.nodes.has(id)) return;
  pushHistory();
  const n = state.nodes.get(id);
  // 删除相关连线
  for(const [eid,e] of state.edges){
    if(e.from.node===id||e.to.node===id) state.edges.delete(eid);
  }
  n.el.remove();
  state.nodes.delete(id);
  state.selected.delete(id);
  renderEdges();
  updateStats();
  evaluate();
}
function selectNode(id, additive){
  if(additive){
    if(state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
  } else {
    state.selected.clear();
    state.selected.add(id);
    state.selectedEdge = null;
  }
  refreshSelection();
}
function refreshSelection(){
  state.nodes.forEach((n,id)=>{
    n.el.classList.toggle('selected', state.selected.has(id));
  });
  document.querySelectorAll('.edges .edge').forEach(p=>{
    p.classList.toggle('selected', p.dataset.id===state.selectedEdge);
  });
  _notifySelected();
}
function _notifySelected(){
  try{
    const first = state.selected.size > 0 ? [...state.selected][0] : null;
    document.dispatchEvent(new CustomEvent('nodegraph:selected', {
      detail: { id: first, count: state.selected.size },
    }));
  }catch(e){}
}

/* ── widgets ───────────────────────────────── */
function numWidget(node, key, min, max, step){
  const box = document.createElement('div');
  box.className='w-num';
  const inp = document.createElement('input');
  inp.type='range'; inp.min=min; inp.max=max; inp.step=step; inp.value=node.props[key];
  const val = document.createElement('span'); val.className='val';
  val.textContent = (+node.props[key]).toFixed(2);
  inp.addEventListener('input', ()=>{
    node.props[key] = +inp.value;
    val.textContent = (+inp.value).toFixed(2);
    evaluate();
    _markDirty();
  });
  // 双击可输入
  val.addEventListener('dblclick', async ()=>{
    const v = await uiPrompt({ title:'输入数值', label:node.props[key]+'' , value:node.props[key]+'' });
    if(v!==null && !isNaN(+v)){ node.props[key]=clamp(+v,min,max); inp.value=node.props[key];
      val.textContent=(+node.props[key]).toFixed(2); evaluate(); _markDirty(); }
  });
  box.appendChild(inp); box.appendChild(val);
  return box;
}
function colorWidget(node, key){
  const box = document.createElement('div');
  box.className='w-color';
  const inp = document.createElement('input');
  inp.type='color'; inp.value=node.props[key];
  const hex = document.createElement('span'); hex.className='hex'; hex.textContent=node.props[key];
  inp.addEventListener('input', ()=>{
    node.props[key]=inp.value; hex.textContent=inp.value; evaluate(); _markDirty();
  });
  box.appendChild(inp); box.appendChild(hex);
  return box;
}
function vecWidget(node, keys, min, max, step){
  const box = document.createElement('div');
  keys.forEach(k=>{
    const row = document.createElement('div');
    row.className='w-num';
    row.style.marginBottom='4px';
    const lbl=document.createElement('span'); lbl.className='w-label';
    lbl.style.margin='0 6px 0 0'; lbl.textContent=k+':';
    lbl.style.textTransform='none'; lbl.style.letterSpacing='0';
    const inp=document.createElement('input'); inp.type='range';
    inp.min=min; inp.max=max; inp.step=step; inp.value=node.props[k];
    const val=document.createElement('span'); val.className='val';
    val.textContent=(+node.props[k]).toFixed(2);
    inp.addEventListener('input',()=>{node.props[k]=+inp.value; val.textContent=(+inp.value).toFixed(2); evaluate(); _markDirty();});
    row.appendChild(lbl); row.appendChild(inp); row.appendChild(val);
    box.appendChild(row);
  });
  return box;
}
function textureWidget(node, key){
  const box = document.createElement('div');
  box.className='w-tex';
  const thumb=document.createElement('div'); thumb.className='thumb';
  const info=document.createElement('div'); info.className='info';
  const fn=document.createElement('div'); fn.className='fn'; fn.textContent='未选择';
  const btn=document.createElement('div'); btn.className='btn'; btn.textContent='选择图片…';
  info.appendChild(fn); info.appendChild(btn);
  box.appendChild(thumb); box.appendChild(info);
  if(node.props[key]){
    thumb.innerHTML=`<img src="${node.props[key]}" alt="">`;
    fn.textContent = (node.props._name || node.props[key].split('/').pop()).slice(0,20);
  }
  btn.addEventListener('click', ()=>{
    const f = document.createElement('input'); f.type='file'; f.accept='image/*';
    f.addEventListener('change', ()=>{
      const file=f.files[0]; if(!file) return;
      const r=new FileReader();
      r.onload=()=>{ node.props[key]=r.result; node.props._name=file.name;
        thumb.innerHTML=`<img src="${r.result}" alt="">`;
        fn.textContent=file.name.slice(0,20); evaluate(); _markDirty(); };
      r.readAsDataURL(file);
    });
    f.click();
  });
  return box;
}
function rgbaMergeWidget(node){
  const box = document.createElement('div');
  box.className='w-multi';
  const hint = document.createElement('div');
  hint.style.cssText='font-size:10px;color:var(--text-dim);margin-bottom:4px;line-height:1.4;';
  hint.textContent='连线贴图 / 噪波 tex 输入时取图像通道，常量仅作未连线兜底';
  box.appendChild(hint);
  box.appendChild(_labeledRow('R 常量', numWidget(node,'r',0,1,0.01)));
  box.appendChild(_labeledRow('G 常量', numWidget(node,'g',0,1,0.01)));
  box.appendChild(_labeledRow('B 常量', numWidget(node,'b',0,1,0.01)));
  box.appendChild(_labeledRow('A 常量', numWidget(node,'a',0,1,0.01)));
  const sizeInp = document.createElement('input');
  sizeInp.type='number'; sizeInp.className='w-text';
  sizeInp.min=16; sizeInp.step=64; sizeInp.placeholder='自动/自定义';
  sizeInp.value = node.props.size ?? '';
  sizeInp.title = '留空=自动（取输入纹理尺寸）；可输入任意值，如 4096';
  sizeInp.addEventListener('change', ()=>{
    const raw = sizeInp.value.trim();
    if(raw===''){ node.props.size = null; }
    else {
      const v = Math.max(16, Math.round(+raw));
      if(!isFinite(v)){ sizeInp.value=''; node.props.size = null; return; }
      node.props.size = v; sizeInp.value = v;
    }
    evaluate();
    _markDirty();
  });
  box.appendChild(_labeledRow('尺寸', sizeInp));
  const actions = document.createElement('div');
  actions.className='w-tex';
  actions.style.marginTop='4px';
  const info = document.createElement('div'); info.className='info';
  const btn=document.createElement('div'); btn.className='btn'; btn.textContent='保存 PNG';
  info.appendChild(btn); actions.appendChild(info);
  box.appendChild(actions);
  btn.addEventListener('click', ()=>{
    const url = node._rgbaUrl;
    if(!url){ toast('RGBA 尚未合成（等待输入或常量求值）'); return; }
    const a=document.createElement('a');
    a.href=url; a.download='matoga-rgba.png';
    a.click();
  });
  return box;
}
function selectWidget(node, key, options){
  const box=document.createElement('div');
  const sel=document.createElement('select'); sel.className='w-select';
  options.forEach(o=>{
    const op=document.createElement('option'); op.value=o; op.textContent=o;
    if(o===node.props[key]) op.selected=true;
    sel.appendChild(op);
  });
  sel.addEventListener('change',()=>{node.props[key]=sel.value; evaluate(); _markDirty();});
  box.appendChild(sel);
  return box;
}
function previewWidget(node, key){
  const box=document.createElement('div');
  box.className='w-preview';
  box.innerHTML=`<div class="pv-empty">无输入</div>`;
  box.dataset.preview = key;
  node._previewEl = box;
  return box;
}
function _labeledRow(label, widgetEl){
  const row=document.createElement('div');
  row.className='w-row';
  row.style.display='flex'; row.style.alignItems='center'; row.style.gap='6px';
  row.style.marginBottom='4px';
  const lbl=document.createElement('span');
  lbl.style.fontSize='10px'; lbl.style.color='var(--text-dim)';
  lbl.style.minWidth='28px'; lbl.style.textTransform='none'; lbl.style.letterSpacing='0';
  lbl.textContent=label;
  row.appendChild(lbl); row.appendChild(widgetEl);
  widgetEl.style.flex='1';
  return row;
}
function noiseWidget(node){
  const box=document.createElement('div');
  box.className='w-multi';
  box.appendChild(_labeledRow('缩放', numWidget(node,'scale',0.1,20,0.1)));
  box.appendChild(_labeledRow('种子', numWidget(node,'seed',0,100,1)));
  box.appendChild(_labeledRow('层数', numWidget(node,'octaves',1,8,1)));
  return box;
}
function voronoiWidget(node){
  const box=document.createElement('div');
  box.className='w-multi';
  box.appendChild(_labeledRow('缩放', numWidget(node,'scale',0.1,20,0.1)));
  box.appendChild(_labeledRow('种子', numWidget(node,'seed',0,100,1)));
  return box;
}
function gradientWidget(node){
  const box=document.createElement('div');
  box.className='w-multi';
  box.appendChild(_labeledRow('A', colorWidget(node,'colorA')));
  box.appendChild(_labeledRow('B', colorWidget(node,'colorB')));
  box.appendChild(_labeledRow('模式', selectWidget(node,'mode',['linear','smooth','ease'])));
  return box;
}
function warpWidget(node){
  const box=document.createElement('div');
  box.className='w-multi';
  box.appendChild(_labeledRow('缩放', numWidget(node,'scale',0.1,20,0.1)));
  box.appendChild(_labeledRow('扭曲', numWidget(node,'amount',0,3,0.1)));
  box.appendChild(_labeledRow('种子', numWidget(node,'seed',0,100,1)));
  box.appendChild(_labeledRow('层数', numWidget(node,'octaves',1,8,1)));
  return box;
}

/* ── 连线 ───────────────────────────────────── */
const edgesSvg = $('#edges');
function startEdge(portEl, e){
  const dir = portEl.dataset.dir;
  const node = portEl.dataset.node;
  const port = portEl.dataset.port;
  const dataType = portEl.dataset.type;
  const startWorld = portCenterWorld(portEl);
  state.dragging = {
    kind:'edge', dir, node, port, dataType, startWorld,
    portEl,
  };
  portEl.classList.add('active');
  canvasWrap.classList.add('connecting');
  const targetDir = dir==='out' ? 'in' : 'out';
  document.querySelectorAll('.port').forEach(p=>{
    if(p===portEl) return;
    if(p.dataset.dir===targetDir){
      if(canConnect(dataType, p.dataset.type)) p.classList.add('compat');
      else p.classList.add('incompat');
    }
  });
}
function portCenterWorld(portEl){
  const r = portEl.getBoundingClientRect();
  const cx = r.left + r.width/2, cy = r.top + r.height/2;
  return screenToWorld(cx, cy);
}
function renderEdges(){
  // 清空（保留 defs）
  const defs = edgesSvg.querySelector('defs');
  edgesSvg.innerHTML='';
  edgesSvg.appendChild(defs);
  state.edges.forEach((e,id)=>{
    const fromN = state.nodes.get(e.from.node);
    const toN = state.nodes.get(e.to.node);
    if(!fromN||!toN) return;
    const fromEl = fromN.el.querySelector(`.port.out[data-port="${e.from.port}"]`);
    const toEl = toN.el.querySelector(`.port.in[data-port="${e.to.port}"]`);
    if(!fromEl||!toEl) return;
    const a = portCenterWorld(fromEl);
    const b = portCenterWorld(toEl);
    const color = typeColor(fromEl.dataset.type);
    // hit
    const hit = document.createElementNS(NS,'path');
    hit.setAttribute('class','edge-hit');
    hit.setAttribute('d', edgePath(a,b));
    hit.dataset.id = id;
    hit.addEventListener('pointerdown', (ev)=>{ev.stopPropagation(); selectEdge(id);});
    hit.addEventListener('dblclick', (ev)=>{ev.stopPropagation(); pushHistory(); state.edges.delete(id); state.selectedEdge=null; renderEdges(); updateStats(); evaluate();});
    edgesSvg.appendChild(hit);
    // visible
    const path = document.createElementNS(NS,'path');
    path.setAttribute('class','edge');
    path.setAttribute('d', edgePath(a,b));
    path.setAttribute('stroke', color);
    path.dataset.id = id;
    if(state.selectedEdge===id) path.classList.add('selected');
    path.addEventListener('pointerdown', (ev)=>{ev.stopPropagation(); selectEdge(id);});
    path.addEventListener('dblclick', (ev)=>{ev.stopPropagation(); pushHistory(); state.edges.delete(id); state.selectedEdge=null; renderEdges(); updateStats(); evaluate();});
    edgesSvg.appendChild(path);
  });
  // 清理并重新标记 linked
  document.querySelectorAll('.port.linked').forEach(p=>p.classList.remove('linked'));
  state.edges.forEach(e=>{
    const fN=state.nodes.get(e.from.node), tN=state.nodes.get(e.to.node);
    if(!fN||!tN) return;
    const f=fN.el.querySelector(`.port.out[data-port="${e.from.port}"]`);
    const t=tN.el.querySelector(`.port.in[data-port="${e.to.port}"]`);
    if(f) f.classList.add('linked');
    if(t) t.classList.add('linked');
  });
}
function typeColor(t){
  return {number:'#7cbd56',color:'#c084fc',texture:'#f5a623',material:'#5bcefa',
    environment:'#f5a623',any:'#9a9a9a',vector:'#e8e8e8'}[t]||'#9a9a9a';
}
function edgePath(a,b){
  const dx = Math.max(40, Math.abs(b.x-a.x)*0.5);
  return `M ${a.x} ${a.y} C ${a.x+dx} ${a.y}, ${b.x-dx} ${b.y}, ${b.x} ${b.y}`;
}
function selectEdge(id){
  state.selected.clear();
  state.selectedEdge = id;
  refreshSelection();
}
function canConnect(fromType, toType){
  if(fromType==='any'||toType==='any') return true;
  return fromType===toType;
}
function finishEdge(endPortEl){
  const d = state.dragging;
  if(!d||d.kind!=='edge') return;
  const endDir = endPortEl.dataset.dir;
  // 必须 out -> in
  let from, to;
  if(d.dir==='out' && endDir==='in'){
    from = {node:d.node, port:d.port};
    to = {node:endPortEl.dataset.node, port:endPortEl.dataset.port};
  } else if(d.dir==='in' && endDir==='out'){
    from = {node:endPortEl.dataset.node, port:endPortEl.dataset.port};
    to = {node:d.node, port:d.port};
  } else { cleanupEdgeDrag(); return; }
  // 类型检查
  const fromDef = NODE_DEFS[state.nodes.get(from.node).type];
  const toDef = NODE_DEFS[state.nodes.get(to.node).type];
  const fromP = fromDef.outputs.find(p=>p.n===from.port);
  const toP = toDef.inputs.find(p=>p.n===to.port);
  if(!fromP||!toP){ cleanupEdgeDrag(); return; }
  if(!canConnect(fromP.t, toP.t)){ toast('类型不匹配: '+fromP.t+' → '+toP.t); cleanupEdgeDrag(); return; }
  // 防止重复连接到同一输入
  for(const [eid,e] of state.edges){
    if(e.to.node===to.node && e.to.port===to.port) state.edges.delete(eid);
  }
  // 防止环（简单检查：from 不能依赖 to）
  if(createsCycle(from.node, to.node)){ toast('会形成循环依赖'); cleanupEdgeDrag(); return; }
  pushHistory();
  const eid = 'e'+Math.random().toString(36).slice(2,9);
  state.edges.set(eid, {id:eid, from, to});
  cleanupEdgeDrag();
  renderEdges();
  updateStats();
  evaluate();
}
function createsCycle(fromId, toId){
  // 检查 fromId 是否（间接）依赖 toId
  const visited = new Set();
  function dep(nid){
    if(nid===toId) return true;
    if(visited.has(nid)) return false;
    visited.add(nid);
    for(const e of state.edges.values()){
      if(e.from.node===nid && dep(e.to.node)) return true;
    }
    return false;
  }
  return dep(fromId);
}
function cleanupEdgeDrag(){
  if(state.dragging && state.dragging.portEl) state.dragging.portEl.classList.remove('active');
  state.dragging = null;
  document.querySelectorAll('.port.compat,.port.incompat').forEach(p=>{ p.classList.remove('compat'); p.classList.remove('incompat'); });
  const t = edgesSvg.querySelector('.edge-temp');
  if(t) t.remove();
  canvasWrap.classList.remove('connecting');
}

/* ── 求值引擎 ───────────────────────────────── */
function evaluate(){
  // 拓扑排序
  const ids = [...state.nodes.keys()];
  const indeg = new Map();
  const deps = new Map(); // nodeId -> [inputNodeIds]
  ids.forEach(id=>{indeg.set(id,0); deps.set(id,[]);});
  state.edges.forEach(e=>{
    if(state.nodes.has(e.from.node) && state.nodes.has(e.to.node)){
      indeg.set(e.to.node, indeg.get(e.to.node)+1);
      deps.get(e.to.node).push(e.from.node);
    }
  });
  const queue = ids.filter(id=>indeg.get(id)===0);
  const order = [];
  const seen = new Set();
  while(queue.length){
    const id = queue.shift();
    if(seen.has(id)) continue;
    seen.add(id); order.push(id);
    // 找出以此节点为输入的边
    state.edges.forEach(e=>{
      if(e.from.node===id){
        indeg.set(e.to.node, indeg.get(e.to.node)-1);
        if(indeg.get(e.to.node)===0) queue.push(e.to.node);
      }
    });
  }
  // 计算
  const results = new Map(); // nodeId -> {portName: value}
  order.forEach(id=>{
    const node = state.nodes.get(id);
    const def = NODE_DEFS[node.type];
    const inputs = {};
    def.inputs.forEach(p=>{
      // 找到连入此端口的边
      let val = undefined;
      for(const e of state.edges.values()){
        if(e.to.node===id && e.to.port===p.n){
          const r = results.get(e.from.node);
          if(r) val = r[e.from.port];
        }
      }
      inputs[p.n] = val;
    });
    let out = {};
    if(def.eval){
      try { out = def.eval(inputs, node) || {}; } catch(err){ out = {}; }
    }
    // 输入类节点：直接从 props 取
    if(node.type==='number') out.value = +node.props.value;
    else if(node.type==='color') out.color = hexToRgb(node.props.color);
    else if(node.type==='texture') out.tex = node.props.tex || null;
    else if(node.type==='vector2') out.v = [+node.props.x, +node.props.y];
    else if(node.type==='hdr') out.env = node.props.preset;
    results.set(id, out);
    // 更新预览
    if(node._previewEl){
      updatePreview(node, inputs, results);
    }
    if(node._outPreviewEl){
      const _on = def.outputs[0] ? def.outputs[0].n : null;
      if(_NOISE_PV_TYPES.has(node.type)){
        _renderNoisePreview(node, _on ? out[_on] : undefined);
      } else {
        _renderPreviewVal(node._outPreviewEl, _on ? out[_on] : undefined);
      }
    }
  });
  state._results = results;
  syncToPreview(results);
}
/* ── 联动：把求值结果推送到 3D/2D 预览 ─────── */
function syncToPreview(results){
  // 收集所有 output 节点的材质结果
  let mat = null, matLeft = null, matRight = null, mainTex = null, normalTex = null, hdrPreset = null;
  // 贴图输出节点（主贴图/法线-n/高光-s × 左/右）：null=已放置未连线，undefined=未放置
  const texOutL = { main:undefined, normal:undefined, spec:undefined };
  const texOutR = { main:undefined, normal:undefined, spec:undefined };
  state.nodes.forEach((node,id)=>{
    const r = results.get(id);
    if(!r) return;
    if(node.type==='output' && r.material) mat = r.material;
    if(node.type==='outputLeft' && r.material) matLeft = r.material;
    if(node.type==='outputRight' && r.material) matRight = r.material;
    if((node.type==='texture' || node.type==='mainTex') && node.props.tex){
      // 第一个 texture/mainTex 节点作为主贴图候选
      if(!mainTex) mainTex = node.props.tex;
    }
    if(node.type==='normalMap' && r.normal && r.normal.src) normalTex = r.normal.src;
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
  const hasTexOutL = texOutL.main!==undefined || texOutL.normal!==undefined || texOutL.spec!==undefined;
  const hasTexOutR = texOutR.main!==undefined || texOutR.normal!==undefined || texOutR.spec!==undefined;
  // 3D 联动
  if(m3d && m3d.isMaterial3DReady && m3d.isMaterial3DReady()){
    const buildP = (m, side)=>{
      const p = {};
      let nTex = normalTex;
      if(m){
        if(m.baseColor) p.baseColor = m.baseColor;
        if(typeof m.roughness==='number') p.roughness = m.roughness;
        if(typeof m.metallic==='number') p.metallic = m.metallic;
        if(m.normal && m.normal.src) nTex = m.normal.src;
      }
      // 左右专用贴图输出节点优先于全局纹理候选（null=显式清除该槽位）
      const o = side==='left' ? texOutL : texOutR;
      if(o.main!==undefined) p.mainTextureUrl = o.main;
      else if(mainTex) p.mainTextureUrl = mainTex;
      if(o.normal!==undefined) p.normalMapUrl = o.normal;
      else if(nTex) p.normalMapUrl = nTex;
      if(o.spec!==undefined) p.specTextureUrl = o.spec;
      if(hdrPreset) p.lightPreset = hdrPreset;
      return p;
    };
    const effLeft = matLeft || mat, effRight = matRight || mat;
    if(effLeft || hasTexOutL){ try { m3d.applyNodePBRSide(buildP(effLeft,'left'), 'left'); } catch(e){ console.warn('applyNodePBRSide 失败', e); } }
    if(effRight || hasTexOutR){ try { m3d.applyNodePBRSide(buildP(effRight,'right'), 'right'); } catch(e){ console.warn('applyNodePBRSide 失败', e); } }
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
  sync2D(results, {mainTex, normalTex, mat, matLeft, matRight, texOutL, texOutR});
}
/* 2D 预览仅承载主贴图/法线/高光三种材质槽位；纹理、噪波、颜色等在节点自身预览（widget / out-preview）中查看 */
export function buildPreview2DRows(info){
  const effLeft = info.matLeft || info.mat, effRight = info.matRight || info.mat;
  const texOutL = info.texOutL || {}, texOutR = info.texOutR || {};
  const rows = [];
  // 主贴图：左右贴图输出节点优先，回退全局纹理候选
  const mainL = texOutL.main!==undefined ? texOutL.main : info.mainTex;
  const mainR = texOutR.main!==undefined ? texOutR.main : info.mainTex;
  if(mainL || mainR) rows.push({role:'主贴图 (Albedo)', left:mainL?{img:mainL}:null, right:mainR?{img:mainR}:null});
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
function sync2D(results, info){
  const c = document.getElementById('previewPanel');
  if(!c) return;
  const rows = buildPreview2DRows(info);
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
function _renderPreviewVal(el, val){
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
function _renderPreviewImg(el, url){
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
function _renderNumViz(el, val){
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
function updatePreview(node, inputs, results){
  const el = node._previewEl;
  const key = el.dataset.preview;
  if(key === '__mat__'){
    const r = results.get(node.id);
    _renderPreviewVal(el, r?.material);
  } else {
    _renderPreviewVal(el, inputs[key]);
  }
}

/* ── 多指针 / 触摸手势 ──────────────────────── */
const pointers = new Map();
let pinch = null;
let longPressTimer = null;
let longPressStart = null;
function clearLongPress(){ if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer=null; } }
function startLongPress(e){
  if(e.pointerType!=='touch') return;
  longPressStart={x:e.clientX, y:e.clientY, target:e.target};
  longPressTimer=setTimeout(()=>{
    longPressTimer=null;
    if(state.dragging) return;
    const nodeEl=longPressStart.target.closest('.node');
    const fe={clientX:longPressStart.x, clientY:longPressStart.y, preventDefault(){}};
    if(nodeEl) showNodeMenu(fe, nodeEl.dataset.id);
    else showCanvasMenu(fe);
  }, 500);
}
function checkLongPressMove(e){
  if(!longPressTimer||!longPressStart) return;
  if(Math.hypot(e.clientX-longPressStart.x, e.clientY-longPressStart.y)>10) clearLongPress();
}

/* ── 全局事件 ───────────────────────────────── */
canvasWrap.addEventListener('pointerdown', (e)=>{
  pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  startLongPress(e);
  if(pointers.size>=2){
    const pts=[...pointers.values()];
    pinch={dist0:Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y),
      zoom0:state.viewport.zoom, vx0:state.viewport.x, vy0:state.viewport.y};
    if(state.dragging){
      if(state.dragging.kind==='node') state.dragging.moving.forEach(id=>{const n=state.nodes.get(id);if(n)n.el.classList.remove('dragging');});
      if(state.dragging.kind==='edge') cleanupEdgeDrag();
      state.dragging=null;
    }
    return;
  }
}, true);
canvasWrap.addEventListener('pointerdown', (e)=>{
  if(pinch) return;
  if(e.target===canvasWrap || e.target===gridBg || e.target===world || e.target===nodesLayer){
    if(e.button===2) return; // 右键菜单
    if(e.button===1 || (e.button===0 && e.altKey) || e.pointerType==='touch'){
      e.preventDefault();
      state.dragging = {kind:'pan', sx:e.clientX, sy:e.clientY,
        ox:state.viewport.x, oy:state.viewport.y};
      canvasWrap.classList.add('panning');
    } else if(e.button===0){
      const wp = screenToWorld(e.clientX, e.clientY);
      state.dragging = {kind:'box', sx:e.clientX, sy:e.clientY, startWorld:wp, moved:false};
      if(!e.shiftKey){ state.selected.clear(); state.selectedEdge=null; refreshSelection(); }
    }
  }
});
window.addEventListener('pointermove', (e)=>{
  if(pointers.has(e.pointerId)) pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  checkLongPressMove(e);
  if(pinch && pointers.size>=2){
    const pts=[...pointers.values()];
    const dist=Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
    const cx=(pts[0].x+pts[1].x)/2, cy=(pts[0].y+pts[1].y)/2;
    const r=canvasWrap.getBoundingClientRect();
    const zoom=clamp(pinch.zoom0*dist/pinch.dist0, 0.2, 3);
    const acx=cx-r.left, acy=cy-r.top;
    const wx=(acx-pinch.vx0)/pinch.zoom0, wy=(acy-pinch.vy0)/pinch.zoom0;
    state.viewport.zoom=zoom;
    state.viewport.x=acx-wx*zoom;
    state.viewport.y=acy-wy*zoom;
    applyViewport();
    return;
  }
  const d = state.dragging;
  if(!d) return;
  if(d.kind==='pan'){
    state.viewport.x = d.ox + (e.clientX-d.sx);
    state.viewport.y = d.oy + (e.clientY-d.sy);
    applyViewport();
  } else if(d.kind==='node'){
    const dx = (e.clientX-d.sx)/state.viewport.zoom;
    const dy = (e.clientY-d.sy)/state.viewport.zoom;
    d.baselines.forEach((base,id)=>{
      const n = state.nodes.get(id);
      if(!n) return;
      n.x = base.x + dx; n.y = base.y + dy;
      n.el.style.left = n.x+'px';
      n.el.style.top = n.y+'px';
    });
    renderEdges();
  } else if(d.kind==='edge'){
    const cur = screenToWorld(e.clientX, e.clientY);
    let a = d.startWorld, b = cur;
    if(d.dir==='in'){ a = cur; b = d.startWorld; }
    let t = edgesSvg.querySelector('.edge-temp');
    if(!t){
      t = document.createElementNS(NS,'path');
      t.setAttribute('class','edge-temp');
      edgesSvg.appendChild(t);
    }
    t.setAttribute('d', edgePath(a,b));
    t.setAttribute('stroke', typeColor(d.dataType));
  } else if(d.kind==='box'){
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if(Math.abs(dx)<3 && Math.abs(dy)<3) return;
    d.moved = true;
    const cur = screenToWorld(e.clientX, e.clientY);
    const x = Math.min(d.startWorld.x, cur.x);
    const y = Math.min(d.startWorld.y, cur.y);
    const w = Math.abs(cur.x - d.startWorld.x);
    const h = Math.abs(cur.y - d.startWorld.y);
    let box = canvasWrap.querySelector('.sel-box');
    if(!box){
      box = document.createElement('div');
      box.className = 'sel-box';
      box.style.cssText = 'position:absolute;border:1px solid var(--accent,#7cbd56);background:rgba(124,189,86,.12);pointer-events:none;z-index:9999';
      canvasWrap.appendChild(box);
    }
    const {x:vx, y:vy, zoom} = state.viewport;
    box.style.left = (x*zoom + vx) + 'px';
    box.style.top = (y*zoom + vy) + 'px';
    box.style.width = (w*zoom) + 'px';
    box.style.height = (h*zoom) + 'px';
  }
});
window.addEventListener('pointerup', (e)=>{
  pointers.delete(e.pointerId);
  clearLongPress();
  if(pinch){
    if(pointers.size<2) pinch=null;
    return;
  }
  const d = state.dragging;
  if(d && d.kind==='edge'){
    // 检查是否落在端口上
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if(target && target.classList.contains('port')){
      finishEdge(target);
    } else {
      cleanupEdgeDrag();
    }
  }
  if(d && d.kind==='node'){
    d.moving.forEach(id=>{
      const n=state.nodes.get(id);
      if(n) n.el.classList.remove('dragging');
    });
    _markDirty();
  }
  if(d && d.kind==='box' && d.moved){
    const cur = screenToWorld(e.clientX, e.clientY);
    const minX = Math.min(d.startWorld.x, cur.x), maxX = Math.max(d.startWorld.x, cur.x);
    const minY = Math.min(d.startWorld.y, cur.y), maxY = Math.max(d.startWorld.y, cur.y);
    state.nodes.forEach((n,id)=>{
      const r = n.el.getBoundingClientRect();
      const cx = (r.left + r.width/2), cy = (r.top + r.height/2);
      const wp = screenToWorld(cx, cy);
      if(wp.x>=minX && wp.x<=maxX && wp.y>=minY && wp.y<=maxY){
        state.selected.add(id);
      }
    });
    refreshSelection();
  }
  const box = canvasWrap.querySelector('.sel-box');
  if(box) box.remove();
  state.dragging = null;
  canvasWrap.classList.remove('panning');
});
window.addEventListener('pointercancel', (e)=>{
  pointers.delete(e.pointerId);
  pinch=null;
  clearLongPress();
  if(state.dragging){
    if(state.dragging.kind==='node') state.dragging.moving.forEach(id=>{const n=state.nodes.get(id);if(n)n.el.classList.remove('dragging');});
    if(state.dragging.kind==='edge') cleanupEdgeDrag();
    state.dragging=null;
  }
  canvasWrap.classList.remove('panning');
});


// 滚轮缩放
canvasWrap.addEventListener('wheel', (e)=>{
  e.preventDefault();
  const factor = e.deltaY<0 ? 1.1 : 1/1.1;
  setZoom(state.viewport.zoom*factor, e.clientX, e.clientY);
}, {passive:false});

// 右键菜单
canvasWrap.addEventListener('contextmenu', (e)=>{
  e.preventDefault();
  const nodeEl = e.target.closest('.node');
  if(nodeEl){
    showNodeMenu(e, nodeEl.dataset.id);
  } else {
    showCanvasMenu(e);
  }
});

// 键盘
window.addEventListener('keydown', (e)=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT') return;
  // 导入对话框打开时，仅 Escape 关闭，屏蔽其他快捷键
  if(importOverlay.classList.contains('open')){
    if(e.key==='Escape') importOverlay.classList.remove('open');
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  if(ctrl && (e.key==='z'||e.key==='Z')){ e.preventDefault(); if(e.shiftKey) redo(); else undo(); return; }
  if(ctrl && (e.key==='y'||e.key==='Y')){ e.preventDefault(); redo(); return; }
  if(ctrl && (e.key==='d'||e.key==='D')){ e.preventDefault(); state.selected.forEach(id=>duplicateNode(id)); return; }
  if(ctrl && (e.key==='c'||e.key==='C')){ e.preventDefault(); copySelection(); return; }
  if(ctrl && (e.key==='x'||e.key==='X')){ e.preventDefault(); cutSelection(); return; }
  if(ctrl && (e.key==='v'||e.key==='V')){ e.preventDefault(); pasteClipboard(); return; }
  if(ctrl && (e.key==='a'||e.key==='A')){ e.preventDefault(); state.selected.clear(); state.nodes.forEach((n,id)=>state.selected.add(id)); refreshSelection(); return; }
  if(ctrl && (e.key==='s'||e.key==='S')){ e.preventDefault(); saveGraph(); return; }
  if(e.key==='Delete'||e.key==='Backspace'){
    pushHistory();
    if(state.selectedEdge){ state.edges.delete(state.selectedEdge); state.selectedEdge=null; renderEdges(); updateStats(); evaluate(); }
    state.selected.forEach(id=>deleteNode(id));
  } else if(e.key==='f'||e.key==='F'){ fitView(); }
  else if(e.key==='l'||e.key==='L'){ autoLayout(); }
  else if(e.key==='Escape'){
    const hdrModal = document.getElementById('hdrPreviewModal');
    const paramsOv = document.getElementById('m3dParamsOverlay');
    if(hdrModal && hdrModal.classList.contains('show')){ hdrModal.classList.remove('show'); return; }
    if(paramsOv && paramsOv.classList.contains('show')){ paramsOv.classList.remove('show'); return; }
    cleanupEdgeDrag(); state.selected.clear(); state.selectedEdge=null; refreshSelection(); closeCtxMenu();
  }
});

/* ── 右键菜单 ───────────────────────────────── */
let ctxMenuEl = null;
function closeCtxMenu(){ if(ctxMenuEl){ctxMenuEl.remove(); ctxMenuEl=null;} }
function showCanvasMenu(e){
  closeCtxMenu();
  const wp = screenToWorld(e.clientX, e.clientY);
  const m = document.createElement('div');
  m.className='ctx-menu';
  m.style.left=e.clientX+'px'; m.style.top=e.clientY+'px';

  const search = document.createElement('input');
  search.type='text'; search.className='search'; search.placeholder='搜索节点…';
  m.appendChild(search);
  const titleBar = document.createElement('div');
  titleBar.className='title-bar'; titleBar.textContent='添加节点';
  m.appendChild(titleBar);

  const groups = {};
  Object.entries(NODE_DEFS).forEach(([k,d])=>{
    if(d.hidden) return;
    (groups[d.group]=groups[d.group]||[]).push([k,d]);
  });
  const groupEls = [];
  Object.entries(groups).forEach(([g,items])=>{
    const grp=document.createElement('div'); grp.className='grp'; grp.textContent=g;
    m.appendChild(grp);
    const itemEls=[];
    items.forEach(([k,d])=>{
      const it=document.createElement('div'); it.className='item';
      it.innerHTML=`<span class="ic" style="background:${d.color}"></span><span class="nm">${d.title}</span>`;
      it.dataset.name=d.title.toLowerCase(); it.dataset.group=g.toLowerCase();
      it.addEventListener('click', ()=>{ createNode(k, wp.x-100, wp.y-14); closeCtxMenu(); });
      m.appendChild(it); itemEls.push(it);
    });
    groupEls.push({grp,items:itemEls});
    const sep=document.createElement('div'); sep.className='sep'; m.appendChild(sep);
  });
  const emptyHint=document.createElement('div');
  emptyHint.className='empty-hint'; emptyHint.textContent='无匹配节点'; emptyHint.style.display='none';
  m.appendChild(emptyHint);

  search.addEventListener('input', ()=>{
    const term=search.value.trim().toLowerCase();
    let anyVisible=false;
    groupEls.forEach(({grp,items})=>{
      let gv=false;
      items.forEach(it=>{
        const match=!term || it.dataset.name.includes(term) || it.dataset.group.includes(term);
        it.classList.toggle('hidden', !match);
        if(match){ gv=true; anyVisible=true; }
      });
      grp.classList.toggle('hidden', !gv);
    });
    emptyHint.style.display=anyVisible?'none':'block';
  });
  search.addEventListener('keydown', (ev)=>{
    if(ev.key==='Escape') closeCtxMenu();
    else if(ev.key==='Enter'){ const f=m.querySelector('.item:not(.hidden):not(.disabled)'); if(f) f.click(); }
  });

  const opSep=document.createElement('div'); opSep.className='sep'; m.appendChild(opSep);
  const canPaste=!!_clipboard;
  const ops=[
    {nm:'在此处粘贴', sc:'Ctrl+V', act:'paste', disabled:!canPaste},
    {nm:'全选', sc:'Ctrl+A', act:'all'},
    {nm:'自动布局', sc:'L', act:'layout'},
    {nm:'适应视图', sc:'F', act:'fit'},
    {sep:true},
    {nm:'保存项目', sc:'Ctrl+S', act:'save'},
    {nm:'加载图', act:'load'},
    {nm:'清空画布', act:'clear', danger:true}
  ];
  ops.forEach(op=>{
    if(op.sep){ const s=document.createElement('div'); s.className='sep'; m.appendChild(s); return; }
    const it=document.createElement('div');
    it.className='item'+(op.danger?' danger':'')+(op.disabled?' disabled':'');
    it.innerHTML=`<span class="nm">${op.nm}</span>${op.sc?`<span class="sc">${op.sc}</span>`:''}`;
    it.addEventListener('click', ()=>{
      if(it.classList.contains('disabled')) return;
      if(op.act==='paste') pasteClipboard(wp.x, wp.y);
      else if(op.act==='all') selectAll();
      else if(op.act==='layout') autoLayout();
      else if(op.act==='fit') fitView();
      else if(op.act==='save') saveGraph();
      else if(op.act==='load') loadGraph();
      else if(op.act==='clear'){
        if(state.nodes.size===0) return;
        (async()=>{
          if(!await uiConfirm({ title:'清空画布', message:'清空所有节点？', danger:true })) return;
          pushHistory();
          state.nodes.forEach(n=>n.el.remove());
          state.nodes.clear(); state.edges.clear(); state.selected.clear();
          _currentProject = null;
          renderEdges(); updateStats(); evaluate();
          _resetSavedState();
        })();
      }
      closeCtxMenu();
    });
    m.appendChild(it);
  });

  document.body.appendChild(m);
  ctxMenuEl = m;
  adjustMenu(m, e.clientX, e.clientY);
  search.focus();
}
function showNodeMenu(e, id){
  closeCtxMenu();
  if(!id || !state.nodes.has(id)) return;
  if(!state.selected.has(id)) selectNode(id, false);
  const n = state.nodes.get(id);
  const wp = screenToWorld(e.clientX, e.clientY);
  const m=document.createElement('div'); m.className='ctx-menu';
  m.style.left=e.clientX+'px'; m.style.top=e.clientY+'px';
  const canPaste=!!_clipboard;
  m.innerHTML=`
    <div class="item" data-act="dup"><span class="nm">复制节点</span><span class="sc">Ctrl+D</span></div>
    <div class="item" data-act="cut"><span class="nm">剪切节点</span><span class="sc">Ctrl+X</span></div>
    <div class="item${canPaste?'':' disabled'}" data-act="paste"><span class="nm">在此处粘贴</span><span class="sc">Ctrl+V</span></div>
    <div class="sep"></div>
    <div class="item" data-act="disc"><span class="nm">断开所有连线</span></div>
    <div class="item" data-act="col"><span class="nm">${n.collapsed?'展开节点':'折叠节点'}</span></div>
    <div class="item" data-act="ren"><span class="nm">重命名节点</span></div>
    <div class="sep"></div>
    <div class="item" data-act="up"><span class="nm">选中上游节点</span></div>
    <div class="item" data-act="down"><span class="nm">选中下游节点</span></div>
    <div class="sep"></div>
    <div class="item danger" data-act="del"><span class="nm">删除节点</span><span class="sc">Del</span></div>
  `;
  m.addEventListener('click',(ev)=>{
    const item=ev.target.closest('.item');
    if(!item || item.classList.contains('disabled')) return;
    const act=item.dataset.act;
    if(act==='dup') duplicateNode(id);
    else if(act==='cut') cutSelection();
    else if(act==='paste') pasteClipboard(wp.x, wp.y);
    else if(act==='disc') disconnectNode(id);
    else if(act==='col') toggleCollapse(id);
    else if(act==='ren') renameNode(id);
    else if(act==='up') selectUpstream(id);
    else if(act==='down') selectDownstream(id);
    else if(act==='del') deleteNode(id);
    closeCtxMenu();
  });
  document.body.appendChild(m); ctxMenuEl=m;
  adjustMenu(m, e.clientX, e.clientY);
}
function adjustMenu(m, x, y){
  const r = m.getBoundingClientRect();
  if(x+r.width>window.innerWidth) m.style.left=(window.innerWidth-r.width-8)+'px';
  if(y+r.height>window.innerHeight) m.style.top=(window.innerHeight-r.height-8)+'px';
}
window.addEventListener('click', (e)=>{ if(ctxMenuEl && !ctxMenuEl.contains(e.target)) closeCtxMenu(); });
window.addEventListener('resize', ()=>{ applyViewport(); });

function duplicateNode(id){
  const n = state.nodes.get(id); if(!n) return;
  const nn = createNode(n.type, n.x+20, n.y+20);
  nn.props = JSON.parse(JSON.stringify(n.props));
  nn.title = n.title || null;
  nn.collapsed = !!n.collapsed;
  // 重新渲染以应用 props
  nn.el.remove(); renderNode(nn); renderEdges(); evaluate();
}
function toggleCollapse(id){
  const n = state.nodes.get(id); if(!n) return;
  pushHistory();
  n.collapsed = !n.collapsed;
  n.el.classList.toggle('collapsed', n.collapsed);
  const btn = n.el.querySelector('.collapse');
  if(btn) btn.textContent = n.collapsed ? '▸' : '▾';
  renderEdges();
  _markDirty();
}
async function renameNode(id){
  const n = state.nodes.get(id); if(!n) return;
  const def = NODE_DEFS[n.type];
  const v = await uiPrompt({ title:'节点重命名', label:'节点名称:', value:n.title || def.title });
  if(v===null) return;
  pushHistory();
  const t = v.trim();
  n.title = (t && t!==def.title) ? t : null;
  const titleEl = n.el.querySelector('.title');
  if(titleEl){ titleEl.textContent = n.title || def.title; titleEl.classList.toggle('renamed', !!n.title); }
  _notifyGraphChanged();
}
function disconnectNode(id){
  const n = state.nodes.get(id); if(!n) return;
  const toDel = [];
  for(const [eid,e] of state.edges){ if(e.from.node===id||e.to.node===id) toDel.push(eid); }
  if(toDel.length===0){ toast('该节点无连线'); return; }
  pushHistory();
  toDel.forEach(eid=>state.edges.delete(eid));
  renderEdges(); updateStats(); evaluate();
  toast(`已断开 ${toDel.length} 条连线`);
}
function selectUpstream(id){
  if(!state.nodes.has(id)) return;
  const set = new Set([id]), queue = [id];
  while(queue.length){
    const cur = queue.shift();
    state.edges.forEach(e=>{ if(e.to.node===cur && !set.has(e.from.node)){ set.add(e.from.node); queue.push(e.from.node); } });
  }
  state.selected.clear(); set.forEach(x=>state.selected.add(x)); state.selectedEdge=null;
  refreshSelection(); toast(`已选中 ${set.size} 个上游节点`);
}
function selectDownstream(id){
  if(!state.nodes.has(id)) return;
  const set = new Set([id]), queue = [id];
  while(queue.length){
    const cur = queue.shift();
    state.edges.forEach(e=>{ if(e.from.node===cur && !set.has(e.to.node)){ set.add(e.to.node); queue.push(e.to.node); } });
  }
  state.selected.clear(); set.forEach(x=>state.selected.add(x)); state.selectedEdge=null;
  refreshSelection(); toast(`已选中 ${set.size} 个下游节点`);
}
function selectAll(){
  state.selected.clear();
  state.nodes.forEach((n,id)=>state.selected.add(id));
  refreshSelection();
}
function cutSelection(){
  if(state.selected.size===0){ toast('未选中节点'); return; }
  copySelection();
  pushHistory();
  state.selected.forEach(id=>deleteNode(id));
}

/* ── 节点库面板 ─────────────────────────────── */
const libraryEl = $('#library');
const libraryBody = $('#library-body');
function buildLibrary(){
  const searchBox=document.createElement('div');
  searchBox.className='lib-search';
  searchBox.innerHTML=`<input type="text" id="lib-search-input" placeholder="搜索节点…" style="width:100%;box-sizing:border-box;padding:4px 8px;border:1px solid var(--border,#333);border-radius:4px;background:var(--bg2,#1a1a1a);color:var(--text,#eee);font-size:11px;margin-bottom:6px">`;
  libraryBody.appendChild(searchBox);
  const searchInput=searchBox.querySelector('input');
  searchInput.addEventListener('input',()=>filterLibrary(searchInput.value));
  filterLibrary('');
}
function filterLibrary(term){
  term=(term||'').trim().toLowerCase();
  const existing=libraryBody.querySelectorAll('.lib-group');
  existing.forEach(el=>el.remove());
  const groups = {};
  Object.entries(NODE_DEFS).forEach(([k,d])=>{
    if(d.hidden) return;
    if(term && !d.title.toLowerCase().includes(term) && !k.toLowerCase().includes(term) && !d.group.toLowerCase().includes(term)) return;
    (groups[d.group]=groups[d.group]||[]).push([k,d]);
  });
  const wrap=document.createElement('div'); wrap.className='lib-group';
  Object.entries(groups).forEach(([g,items])=>{
    const h=document.createElement('h3'); h.textContent=g; wrap.appendChild(h);
    items.forEach(([k,d])=>{
      const it=document.createElement('div'); it.className='lib-item';
      it.innerHTML=`<span class="ic" style="background:${d.color}"></span><span class="nm">${d.title}</span>`;
      it.addEventListener('click', ()=>{
        const r = canvasWrap.getBoundingClientRect();
        const wp = screenToWorld(r.left+r.width/2, r.top+r.height/2);
        createNode(k, wp.x-100, wp.y-30);
      });
      wrap.appendChild(it);
    });
    const sep=document.createElement('div'); sep.className='lib-sep'; wrap.appendChild(sep);
  });
  if(Object.keys(groups).length===0){
    const empty=document.createElement('div');
    empty.style.cssText='color:var(--text-dim);font-size:11px;padding:12px;text-align:center';
    empty.textContent='未找到匹配节点';
    wrap.appendChild(empty);
  }
  libraryBody.appendChild(wrap);
}

/* ── 工具栏 ─────────────────────────────────── */
$('#btn-add').addEventListener('click', (e)=>{
  const r = canvasWrap.getBoundingClientRect();
  showCanvasMenu({clientX:r.left+40, clientY:r.top+60, preventDefault:()=>{}});
});
$('#btn-fit').addEventListener('click', fitView);
$('#btn-clear').addEventListener('click', ()=>{
  if(state.nodes.size===0) return;
  (async()=>{
    if(!await uiConfirm({ title:'清空画布', message:'清空所有节点？', danger:true })) return;
    pushHistory();
    state.nodes.forEach(n=>n.el.remove());
    state.nodes.clear(); state.edges.clear(); state.selected.clear();
    _currentProject = null;
    _rememberProject(null);
    renderEdges(); updateStats(); evaluate();
  })();
});
$('#btn-layout').addEventListener('click', autoLayout);
$('#btn-save').addEventListener('click', saveGraph);
$('#btn-load').addEventListener('click', loadGraph);
$('#zoom-in').addEventListener('click', ()=>setZoom(state.viewport.zoom*1.2));
$('#zoom-out').addEventListener('click', ()=>setZoom(state.viewport.zoom/1.2));
$('#btn-lib').addEventListener('click', ()=>{
  libraryEl.classList.toggle('collapsed');
  canvasWrap.classList.toggle('library-collapsed');
  $('#statusbar').classList.toggle('library-collapsed');
  $('#btn-lib').textContent = libraryEl.classList.contains('collapsed') ? '节点库 ▶' : '◀ 节点库';
});
$('#library-close').addEventListener('click', ()=>$('#btn-lib').click());
(()=>{
  const handle=$('#lib-resize'); let dragging=false, sx=0, sw=0;
  handle.addEventListener('pointerdown',(e)=>{
    dragging=true; sx=e.clientX;
    sw=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--lib-w'))||208;
    document.documentElement.style.cursor='ew-resize'; e.preventDefault();
  });
  window.addEventListener('pointermove',(e)=>{
    if(!dragging) return;
    const w=Math.min(360,Math.max(160,sw+e.clientX-sx));
    document.documentElement.style.setProperty('--lib-w',w+'px');
  });
  window.addEventListener('pointerup',()=>{ if(dragging){ dragging=false; document.documentElement.style.cursor=''; } });
})();
$('#canvas-close').addEventListener('click', ()=>{
  const m = canvasWrap.classList.toggle('minimized');
  $('#canvas-close').textContent = m ? '▢' : '✕';
  $('#canvas-close').title = m ? '展开' : '最小化';
});

/* ── 预览面板交互（复用主页右栏 #sidebarRight）────────── */
const sidebarRight = $('#sidebarRight');
const _btnPreview = $('#btn-preview');
if(_btnPreview) _btnPreview.addEventListener('click', ()=>{
  const hidden = sidebarRight ? sidebarRight.classList.toggle('collapsed') : false;
  _btnPreview.textContent = hidden ? '▶ 实时预览' : '◀ 实时预览';
  if(!hidden && m3d){
    const _c = document.getElementById('material3dContainer');
    if(_c && m3d.initMaterial3D && !m3d.isMaterial3DReady()) m3d.initMaterial3D(_c);
    setTimeout(()=>{ if(m3d.isMaterial3DReady && m3d.isMaterial3DReady()) evaluate(); }, 250);
  }
});

function fitView(){
  if(state.nodes.size===0){
    state.viewport={x:0,y:0,zoom:1}; applyViewport(); return;
  }
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  state.nodes.forEach(n=>{
    const r = n.el.getBoundingClientRect();
    const a = screenToWorld(r.left, r.top);
    const b = screenToWorld(r.right, r.bottom);
    minX=Math.min(minX,a.x); minY=Math.min(minY,a.y);
    maxX=Math.max(maxX,b.x); maxY=Math.max(maxY,b.y);
  });
  const pad = 60;
  const w = maxX-minX+pad*2, h = maxY-minY+pad*2;
  const r = canvasWrap.getBoundingClientRect();
  const z = clamp(Math.min(r.width/w, r.height/h), 0.2, 3);
  state.viewport.zoom = z;
  state.viewport.x = (r.width - (maxX+minX)*z)/2;
  state.viewport.y = (r.height - (maxY+minY)*z)/2;
  applyViewport();
}
function autoLayout(){
  // 简单分层布局：按拓扑层级
  const indeg = new Map();
  state.nodes.forEach((n,id)=>indeg.set(id,0));
  state.edges.forEach(e=>{ if(state.nodes.has(e.from.node)&&state.nodes.has(e.to.node)) indeg.set(e.to.node, indeg.get(e.to.node)+1); });
  const layer = new Map();
  const q = [...state.nodes.keys()].filter(id=>indeg.get(id)===0);
  q.forEach(id=>layer.set(id,0));
  while(q.length){
    const id=q.shift();
    state.edges.forEach(e=>{
      if(e.from.node===id){
        const nl = (layer.get(id)||0)+1;
        if(!layer.has(e.to.node) || layer.get(e.to.node)<nl){
          layer.set(e.to.node, nl);
        }
        indeg.set(e.to.node, indeg.get(e.to.node)-1);
        if(indeg.get(e.to.node)===0) q.push(e.to.node);
      }
    });
  }
  // 按层排列
  const byLayer = {};
  state.nodes.forEach((n,id)=>{
    if(!layer.has(id)) layer.set(id, 0);
  });
  layer.forEach((l,id)=>{ (byLayer[l]=byLayer[l]||[]).push(id); });
  Object.entries(byLayer).forEach(([l,ids])=>{
    ids.forEach((id,i)=>{
      const n=state.nodes.get(id);
      n.x = +l*260 - 400; n.y = i*180 - 200;
      n.el.style.left=n.x+'px'; n.el.style.top=n.y+'px';
    });
  });
  renderEdges();
  setTimeout(fitView, 50);
}

/* ── 撤销/重做 ───────────────────────────────── */
const _history = { undo: [], redo: [], max: 60, suspend: false };
function _snapshot(){
  const nodes = [];
  state.nodes.forEach((n)=>{
    nodes.push({id:n.id, type:n.type, x:n.x, y:n.y, props:JSON.parse(JSON.stringify(n.props)), title:n.title||null, collapsed:!!n.collapsed});
  });
  const edges = [];
  state.edges.forEach((e)=>{
    edges.push({id:e.id, from:{node:e.from.node,port:e.from.port}, to:{node:e.to.node,port:e.to.port}});
  });
  return {nodes, edges};
}
function _restore(snap){
  state.nodes.forEach(n=>{ if(n.el) n.el.remove(); });
  state.nodes.clear();
  state.edges.clear();
  state.selected.clear();
  state.selectedEdge = null;
  snap.nodes.forEach(nd=>{
    const node = {id:nd.id, type:nd.type, x:nd.x, y:nd.y, props:nd.props, title:nd.title||null, collapsed:!!nd.collapsed, el:null};
    state.nodes.set(nd.id, node);
    renderNode(node);
  });
  snap.edges.forEach(ed=>{
    state.edges.set(ed.id, {id:ed.id, from:ed.from, to:ed.to});
  });
  renderEdges();
  updateStats();
  evaluate();
}
function pushHistory(){
  if(_history.suspend) return;
  _history.undo.push(_snapshot());
  if(_history.undo.length > _history.max) _history.undo.shift();
  _history.redo = [];
}
function undo(){
  if(_history.undo.length === 0){ toast('无可撤销操作'); return; }
  _history.redo.push(_snapshot());
  const snap = _history.undo.pop();
  _history.suspend = true;
  _restore(snap);
  _history.suspend = false;
  toast('撤销');
}
function redo(){
  if(_history.redo.length === 0){ toast('无可重做操作'); return; }
  _history.undo.push(_snapshot());
  const snap = _history.redo.pop();
  _history.suspend = true;
  _restore(snap);
  _history.suspend = false;
  toast('重做');
}

/* ── 复制/粘贴 ───────────────────────────────── */
let _clipboard = null;
function copySelection(){
  if(state.selected.size === 0){ toast('未选中节点'); return; }
  const nodes = [], edges = [];
  const idMap = new Map();
  state.selected.forEach(id=>{
    const n = state.nodes.get(id);
    if(!n) return;
    const newId = uid();
    idMap.set(id, newId);
    nodes.push({id:newId, type:n.type, x:n.x, y:n.y, props:JSON.parse(JSON.stringify(n.props)), title:n.title||null, collapsed:!!n.collapsed});
  });
  state.edges.forEach((e)=>{
    if(idMap.has(e.from.node) && idMap.has(e.to.node)){
      edges.push({from:idMap.get(e.from.node), fp:e.from.port, to:idMap.get(e.to.node), tp:e.to.port});
    }
  });
  _clipboard = {nodes, edges};
  toast(`已复制 ${nodes.length} 个节点`);
}
function pasteClipboard(wx, wy){
  if(!_clipboard){ toast('剪贴板为空'); return; }
  pushHistory();
  let minX=Infinity, minY=Infinity;
  _clipboard.nodes.forEach(nd=>{ minX=Math.min(minX,nd.x); minY=Math.min(minY,nd.y); });
  const dx = (wx!=null && wy!=null) ? (wx - minX) : 30;
  const dy = (wx!=null && wy!=null) ? (wy - minY) : 30;
  const idMap = new Map();
  const newNodes = [];
  _clipboard.nodes.forEach(nd=>{
    const id = uid();
    idMap.set(nd.id, id);
    const node = {id, type:nd.type, x:nd.x+dx, y:nd.y+dy, props:JSON.parse(JSON.stringify(nd.props)), title:nd.title||null, collapsed:!!nd.collapsed, el:null};
    state.nodes.set(id, node);
    renderNode(node);
    newNodes.push(id);
  });
  _clipboard.edges.forEach(ed=>{
    const fromId = idMap.get(ed.from), toId = idMap.get(ed.to);
    if(fromId && toId){
      const eid = 'e'+Math.random().toString(36).slice(2,9);
      state.edges.set(eid, {id:eid, from:{node:fromId,port:ed.fp}, to:{node:toId,port:ed.tp}});
    }
  });
  renderEdges();
  updateStats();
  evaluate();
  state.selected.clear();
  newNodes.forEach(id=>state.selected.add(id));
  refreshSelection();
  toast(`已粘贴 ${newNodes.length} 个节点`);
}

/* ── 保存/加载图（参考 ComfyUI UI 格式）────────── */
const GRAPH_VERSION = 0.4;

function _topoOrder(){
  const ids = [...state.nodes.keys()];
  const indeg = new Map(), succ = new Map();
  ids.forEach(id=>{ indeg.set(id,0); succ.set(id,[]); });
  state.edges.forEach(e=>{
    if(state.nodes.has(e.from.node) && state.nodes.has(e.to.node)){
      indeg.set(e.to.node, indeg.get(e.to.node)+1);
      succ.get(e.from.node).push(e.to.node);
    }
  });
  const queue = ids.filter(id=>indeg.get(id)===0);
  const order = [], seen = new Set();
  while(queue.length){
    const id = queue.shift();
    if(seen.has(id)) continue;
    seen.add(id); order.push(id);
    succ.get(id).forEach(t=>{ indeg.set(t, indeg.get(t)-1); if(indeg.get(t)===0) queue.push(t); });
  }
  ids.forEach(id=>{ if(!seen.has(id)) order.push(id); });
  return order;
}

function _maxIdNum(map){
  let max = 0;
  map.forEach((_,id)=>{ if(id) max = Math.max(max, parseInt(id.slice(1),36)||0); });
  return max;
}

function _widgetArrayToProps(type, arr){
  const keys = Object.keys(defaultProps(type));
  const p = {};
  arr.forEach((v,i)=>{ if(i<keys.length) p[keys[i]] = v; });
  return p;
}

function _coerceProps(nd){
  const w = nd.widgets_values;
  if(w && typeof w==='object' && !Array.isArray(w)) return JSON.parse(JSON.stringify(w));
  if(Array.isArray(w)) return _widgetArrayToProps(nd.type, w);
  if(nd.props && typeof nd.props==='object') return JSON.parse(JSON.stringify(nd.props));
  return defaultProps(nd.type);
}

function _graphToComfy(){
  const order = _topoOrder();
  const orderIdx = new Map();
  order.forEach((id,i)=>orderIdx.set(id,i));
  const outLinks = new Map(), inLink = new Map();
  state.edges.forEach((e,id)=>{
    if(!state.nodes.has(e.from.node)||!state.nodes.has(e.to.node)) return;
    const fk = e.from.node+':'+e.from.port;
    if(!outLinks.has(fk)) outLinks.set(fk,[]);
    outLinks.get(fk).push(id);
    inLink.set(e.to.node+':'+e.to.port, id);
  });
  const nodes = [];
  state.nodes.forEach((n)=>{
    const def = NODE_DEFS[n.type] || {inputs:[],outputs:[]};
    const inputs = def.inputs.map(p=>({name:p.n, type:p.t, link: inLink.get(n.id+':'+p.n) ?? null}));
    const outputs = def.outputs.map(p=>({name:p.n, type:p.t, links: outLinks.get(n.id+':'+p.n) || []}));
    const size = n.el ? {"0":n.el.offsetWidth, "1":n.el.offsetHeight} : {"0":220,"1":80};
    nodes.push({
      id:n.id, type:n.type, pos:[n.x, n.y], size, flags:{},
      order: orderIdx.get(n.id) ?? 0, mode:0,
      inputs, outputs, properties:{title:n.title||null, collapsed:!!n.collapsed},
      widgets_values: JSON.parse(JSON.stringify(n.props||{}))
    });
  });
  const links = [];
  state.edges.forEach((e,id)=>{
    if(!state.nodes.has(e.from.node)||!state.nodes.has(e.to.node)) return;
    const fDef = NODE_DEFS[state.nodes.get(e.from.node).type];
    const fPort = fDef && fDef.outputs.find(p=>p.n===e.from.port);
    links.push([id, e.from.node, e.from.port, e.to.node, e.to.port, fPort ? fPort.t : 'any']);
  });
  return {
    last_node_id: _maxIdNum(state.nodes),
    last_link_id: _maxIdNum(state.edges),
    nodes, links, groups:[], config:{}, extra:{}, version:GRAPH_VERSION
  };
}

function serializeGraph(){
  return JSON.stringify(_graphToComfy(), null, 2);
}
async function saveGraph(){
  if(state.nodes.size===0){ toast('画布为空'); return; }
  let name = _currentProject ? _currentProject.name : null;
  if(!name){
    const input = await uiPrompt({ title:'保存到节点项目', label:'项目名称', value:'未命名材质图' });
    if(input===null) return;
    name = input.trim();
    if(!name){ toast('项目名不能为空'); return; }
  }
  try {
    const data = await saveNodeProject(name, _currentProject ? _currentProject.id : undefined);
    toast('已保存到节点项目: ' + name + '（' + (data.dir || data.id) + '）');
  } catch(e){ toast('保存失败: ' + e.message); }
}

function _applyComfy(data){
  const nodes = (data.nodes||[]).filter(nd=>NODE_DEFS[nd.type]).map(nd=>{
    const pos = Array.isArray(nd.pos) ? nd.pos : [nd.x ?? 0, nd.y ?? 0];
    const pr = nd.properties || {};
    return {id:nd.id, type:nd.type, x:pos[0], y:pos[1], props:_coerceProps(nd), title:pr.title||null, collapsed:!!pr.collapsed};
  });
  const nodeIds = new Set(nodes.map(n=>n.id));
  const edges = (data.links||[]).map(lnk=>{
    if(Array.isArray(lnk)){
      const [id,fn,fp,tn,tp] = lnk;
      return {id, from:{node:fn,port:fp}, to:{node:tn,port:tp}};
    }
    return {id:lnk.id, from:lnk.from, to:lnk.to};
  }).filter(e=>nodeIds.has(e.from.node) && nodeIds.has(e.to.node));
  _restore({nodes, edges});
}

function loadGraphJSON(json){
  try {
    const data = typeof json==='string' ? JSON.parse(json) : json;
    if(!data || !Array.isArray(data.nodes)) throw new Error('格式无效');
    pushHistory();
    _history.suspend = true;
    _suspendAutoSave = true;
    _currentProject = null;
    if(Array.isArray(data.links)) _applyComfy(data);
    else _restore({nodes:data.nodes, edges:data.edges||[]});
    _history.suspend = false;
    _suspendAutoSave = false;
    _resetSavedState();
    toast(`已加载 ${data.nodes.length} 个节点`);
  } catch(e){
    _history.suspend = false;
    _suspendAutoSave = false;
    toast('加载失败: '+e.message);
  }
}
function loadGraph(){
  const f = document.createElement('input');
  f.type = 'file';
  f.accept = '.json';
  f.addEventListener('change', ()=>{
    const file = f.files[0];
    if(!file) return;
    const r = new FileReader();
    r.onload = ()=> loadGraphJSON(r.result);
    r.readAsText(file);
  });
  f.click();
}

/* ── 状态/Toast ─────────────────────────────── */
function updateStats(){
  $('#stat-nodes').textContent = state.nodes.size;
  $('#stat-edges').textContent = state.edges.size;
  _notifyGraphChanged();
}
function _notifyGraphChanged(){
  _markDirty();
  try{ document.dispatchEvent(new CustomEvent('nodegraph:changed')); }catch(e){}
}
let toastTimer=null;
function toast(msg){
  const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'), 2000);
}

/* ── 初始化示例 ─────────────────────────────── */
function initExample(){
  const r = canvasWrap.getBoundingClientRect();
  state.viewport.x = r.width/2 - 200;
  state.viewport.y = r.height/2 - 100;
  applyViewport();

  const num1 = createNode('number', -380, -120);
  num1.props.value = 0.8;
  const num2 = createNode('number', -380, 60);
  num2.props.value = 0.3;
  const color1 = createNode('color', -380, 220);
  color1.props.color = '#7cbd56';
  const mix = createNode('mix', -100, 0);

  // 重新渲染以应用 props
  [num1,num2,color1,mix].forEach(n=>{ n.el.remove(); renderNode(n); });

  // 连线
  function conn(fn,fp,tn,tp){
    const eid='e'+Math.random().toString(36).slice(2,9);
    state.edges.set(eid,{id:eid,from:{node:fn,port:fp},to:{node:tn,port:tp}});
  }
  conn(num1.id,'value',mix.id,'a');
  conn(num2.id,'value',mix.id,'b');
  conn(num1.id,'value',mix.id,'t');

  renderEdges(); updateStats(); evaluate();
  setTimeout(fitView, 100);
}

/* ── 导入贴图 ─────────────────────────────────── */
const importOverlay = $('#importOverlay');
const importBody = $('#importBody');
const importInfo = $('#importInfo');
const IMG_EXTS_IMP = new Set(['jpg','jpeg','png','gif','bmp','webp','svg','ico','tif','tiff','avif']);
const TEX_SUF_IMP = [['_n','normal'],['_s','specular']];

function buildTexGroups(entries){
  const groups = new Map();
  for(const e of entries){
    if(e.isDirectory) continue;
    const name = e.name;
    const dot = name.lastIndexOf('.');
    if(dot < 0) continue;
    if(!IMG_EXTS_IMP.has(name.slice(dot+1).toLowerCase())) continue;
    const base = name.slice(0, dot);
    let key = base, role = 'main';
    for(const [suf, r] of TEX_SUF_IMP){
      if(base.endsWith(suf)){ key = base.slice(0, -suf.length); role = r; break; }
    }
    if(!groups.has(key)) groups.set(key, {});
    groups.get(key)[role] = e;
  }
  return groups;
}

function texUrl(fullPath){ return `/api/file/raw?path=${encodeURIComponent(fullPath)}`; }

async function openImportDlg(){

  importOverlay.classList.add('open');
  importInfo.textContent = '加载中…';
  importBody.innerHTML = '<div class="import-loading">正在读取配置与扫描文件…</div>';
  try {
    const cfgRes = await fetch('/api/config').then(r => r.json());
    const cfg = (cfgRes && cfgRes.data) || {};
    const sides = [];
    if(cfg.leftPath) sides.push({ side:'left', label:cfg.leftPath, path:cfg.leftPath });
    if(cfg.rightPath) sides.push({ side:'right', label:cfg.rightPath, path:cfg.rightPath });
    if(sides.length === 0){
      importBody.innerHTML = '<div class="import-empty">未设置左右路径。请先在主页面选择左右文件夹后再来导入。</div>';
      importInfo.textContent = '无可用路径';
      return;
    }
    importBody.innerHTML = '';
    let totalGroups = 0;
    for(const s of sides){
      const sideEl = document.createElement('div');
      sideEl.className = 'import-side';
      const h4 = document.createElement('h4');
      h4.innerHTML = `<span class="caret">▾</span>${s.side==='left'?'◀ 左侧':'▶ 右侧'} <span class="tag">${s.label}</span>`;
      h4.addEventListener('click', () => sideEl.classList.toggle('collapsed'));
      sideEl.appendChild(h4);
      try {
        const scanRes = await fetch('/api/compare/scan', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ path:s.path, recursive:true })
        }).then(r => r.json());
        const entries = (scanRes && scanRes.data && scanRes.data.entries) || [];
        const groups = buildTexGroups(entries);
        if(groups.size === 0){
          sideEl.insertAdjacentHTML('beforeend', '<div class="import-empty">未发现贴图文件</div>');
          importBody.appendChild(sideEl);
          continue;
        }
        totalGroups += groups.size;
        const grid = document.createElement('div');
        grid.className = 'import-grid';
        groups.forEach((g, key) => {
          const card = document.createElement('div');
          card.className = 'import-card';
          const previewEntry = g.main || g.normal || g.specular;
          const roleTags = [];
          if(g.main) roleTags.push('<span class="r main">M</span>');
          if(g.normal) roleTags.push('<span class="r normal">N</span>');
          if(g.specular) roleTags.push('<span class="r specular">S</span>');
          card.innerHTML = `<div class="thumb">${previewEntry?`<img src="${texUrl(previewEntry.fullPath)}" alt="" loading="lazy">`:''}</div><div class="nm" title="${key}">${key}</div><div class="roles">${roleTags.join('')}</div>`;
          card._group = g;
          card._key = key;
          card.addEventListener('click', () => {
            card.classList.toggle('selected');
            updateImportInfo();
          });
          grid.appendChild(card);
        });
        sideEl.appendChild(grid);
      } catch(err) {
        sideEl.insertAdjacentHTML('beforeend', `<div class="import-empty">扫描失败：${err.message}</div>`);
      }
      importBody.appendChild(sideEl);
    }
    applyImportFilter();
  } catch(e){
    importBody.innerHTML = `<div class="import-empty">加载失败：${e.message}</div>`;
    importInfo.textContent = '加载失败';
  }
}

let importSearchTerm = '';
let importRoleFilter = 'all';
let importSort = 'name-asc';
function applyImportFilter(){
  const term = importSearchTerm.trim().toLowerCase();
  const cards = importOverlay.querySelectorAll('.import-card');
  let visible = 0, total = 0;
  cards.forEach(card => {
    total++;
    const key = (card._key || '').toLowerCase();
    const g = card._group || {};
    let roleOk = true;
    if(importRoleFilter === 'main') roleOk = !!g.main;
    else if(importRoleFilter === 'normal') roleOk = !!g.normal;
    else if(importRoleFilter === 'specular') roleOk = !!g.specular;
    const searchOk = !term || key.includes(term);
    const show = roleOk && searchOk;
    card.style.display = show ? '' : 'none';
    if(show) visible++;
  });
  const desc = importSort === 'name-desc';
  importOverlay.querySelectorAll('.import-grid').forEach(grid => {
    const arr = [...grid.children];
    arr.sort((a,b) => {
      const r = (a._key||'').localeCompare(b._key||'', 'zh');
      return desc ? -r : r;
    });
    arr.forEach(c => grid.appendChild(c));
  });
  const cnt = document.getElementById('importCount');
  if(cnt) cnt.textContent = total ? `共 ${total} 组 · 匹配 ${visible}` : '';
  updateImportInfo();
}

function updateImportInfo(){
  const n = importOverlay.querySelectorAll('.import-card.selected').length;
  importInfo.textContent = n > 0 ? `已选择 ${n} 个贴图组，点击"导入所选"创建节点。` : '点击贴图组卡片选择，再次点击取消。';
}

function doImport(){
  const cards = importOverlay.querySelectorAll('.import-card.selected');
  if(cards.length === 0) return;
  const r = canvasWrap.getBoundingClientRect();
  const wp = screenToWorld(r.left + r.width/2, r.top + r.height/2);
  let col = 0, row = 0, count = 0;
  const COLS = Math.min(cards.length, 4);
  cards.forEach(card => {
    const g = card._group;
    ['main','normal','specular'].forEach(role => {
      if(!g[role]) return;
      const entry = g[role];
      const node = createNode('texture', wp.x - 100 + col * 230, wp.y - 30 + row * 180);
      if(node){
        node.props.tex = texUrl(entry.fullPath);
        node.props._name = entry.name;
        node.props._role = role;
        const thumb = node.el.querySelector('.w-tex .thumb');
        const fn = node.el.querySelector('.w-tex .fn');
        if(thumb) thumb.innerHTML = `<img src="${node.props.tex}" alt="">`;
        if(fn) fn.textContent = entry.name.slice(0, 20);
        count++;
      }
    });
    col++;
    if(col >= COLS){ col = 0; row++; }
  });
  importOverlay.classList.remove('open');
  if(count > 0) toast(`已导入 ${count} 个贴图节点`);
}

document.getElementById('importSearch').addEventListener('input', e => { importSearchTerm = e.target.value; applyImportFilter(); });
document.querySelectorAll('#importRoleSeg button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#importRoleSeg button').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); importRoleFilter = b.dataset.role; applyImportFilter();
}));
document.querySelectorAll('#importSortSeg button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#importSortSeg button').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); importSort = b.dataset.sort; applyImportFilter();
}));
document.getElementById('importSelectAll').addEventListener('click', () => {
  importOverlay.querySelectorAll('.import-card').forEach(c => { if(c.style.display !== 'none') c.classList.add('selected'); });
  updateImportInfo();
});
document.getElementById('importClearAll').addEventListener('click', () => {
  importOverlay.querySelectorAll('.import-card.selected').forEach(c => c.classList.remove('selected'));
  updateImportInfo();
});
$('#btn-import').addEventListener('click', openImportDlg);
$('#importClose').addEventListener('click', () => importOverlay.classList.remove('open'));
$('#importCancel').addEventListener('click', () => importOverlay.classList.remove('open'));
$('#importOk').addEventListener('click', doImport);

// 点击遮罩区域关闭导入对话框
importOverlay.addEventListener('click', e => { if(e.target === importOverlay) importOverlay.classList.remove('open'); });

/* ── 对外暴露：供节点库 / 资产库面板直接调用 ─────────── */
function _defColorHex(def){
  const c = def && def.color;
  if(!c) return '#9a9a9a';
  const m = /var\(--type-([\w-]+)\)/.exec(c);
  if(m) return typeColor(m[1]);
  if(c.startsWith('var(')){
    const name = c.slice(4, -1).trim();
    try{ return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#9a9a9a'; }
    catch(e){ return '#9a9a9a'; }
  }
  return c;
}
export function getGraphInfo(){
  const nodes = [];
  state.nodes.forEach(n => nodes.push({ id:n.id, type:n.type, title:n.title||null }));
  const edges = [];
  state.edges.forEach(e => edges.push({
    id:e.id,
    from:{ node:e.from.node, port:e.from.port },
    to:{ node:e.to.node, port:e.to.port },
  }));
  const defs = {};
  state.nodes.forEach(n => {
    if(defs[n.type]) return;
    const d = NODE_DEFS[n.type];
    if(!d) return;
    defs[n.type] = {
      title:d.title, group:d.group||'', color:_defColorHex(d),
      inputs:(d.inputs||[]).map(p=>({n:p.n,t:p.t})),
      outputs:(d.outputs||[]).map(p=>({n:p.n,t:p.t})),
    };
  });
  return { nodes, edges, defs };
}
/* 节点预览窗口：选中节点完整信息（props / 预览图 / 计算输出 / 连接） */
export function getNodeDetail(id){
  const n = state.nodes.get(id);
  if(!n) return null;
  const def = NODE_DEFS[n.type];
  if(!def) return null;
  let previewUrl = null;
  let previewKind = 'none';
  if(_NOISE_PV_TYPES.has(n.type)){
    previewUrl = _noisePreviewUrl(n);
    previewKind = 'image';
  } else if(typeof n.props.tex === 'string' && n.props.tex){
    previewUrl = n.props.tex;
    previewKind = 'image';
  } else if(typeof n.props.color === 'string' && n.props.color){
    previewKind = 'color';
  } else if(typeof n.props.value === 'number'){
    previewKind = 'value';
  }
  const evalOut = {};
  const r = state._results ? state._results.get(id) : null;
  if(r){
    for(const k in r){
      const v = r[k];
      const tv = typeof v;
      if(tv === 'number') evalOut[k] = Math.round(v * 1e4) / 1e4;
      else if(tv === 'string' || tv === 'boolean') evalOut[k] = v;
      else if(Array.isArray(v)) evalOut[k] = v.slice(0, 8).map(x => (typeof x === 'number' ? Math.round(x * 1e4) / 1e4 : String(x)));
    }
  }
  const nodeTitle = (nid) => {
    const m = state.nodes.get(nid);
    if(!m) return nid;
    const md = NODE_DEFS[m.type];
    return m.title || (md ? md.title : nid);
  };
  const connIn = [], connOut = [];
  state.edges.forEach(e => {
    if(e.to.node === id) connIn.push({ port:e.to.port, from:e.from.node, fromPort:e.from.port, fromTitle:nodeTitle(e.from.node) });
    if(e.from.node === id) connOut.push({ port:e.from.port, to:e.to.node, toPort:e.to.port, toTitle:nodeTitle(e.to.node) });
  });
  return {
    id:n.id, type:n.type, title:n.title || def.title,
    def:{
      title:def.title, group:def.group||'', color:_defColorHex(def),
      inputs:(def.inputs||[]).map(p=>({n:p.n,t:p.t})),
      outputs:(def.outputs||[]).map(p=>({n:p.n,t:p.t})),
    },
    props:JSON.parse(JSON.stringify(n.props)),
    previewUrl, previewKind,
    evalOut,
    connections:{ inputs:connIn, outputs:connOut },
  };
}
export function focusNodeInCanvas(id){
  const n = state.nodes.get(id);
  if(!n) return false;
  selectNode(id, false);
  const w = n.el ? n.el.offsetWidth : 200;
  const h = n.el ? n.el.offsetHeight : 100;
  const wx = n.x + w/2, wy = n.y + h/2;
  const r = canvasWrap.getBoundingClientRect();
  const z = Math.max(state.viewport.zoom, 0.85);
  state.viewport.zoom = z;
  state.viewport.x = r.width/2 - wx*z;
  state.viewport.y = r.height/2 - wy*z;
  applyViewport();
  return true;
}
export { createNode, startEdge as _debugStartEdge, finishEdge as _debugFinishEdge, saveGraph as _debugSaveGraph, loadGraphJSON as _debugLoadGraphJSON };

/* ── 节点项目管理：保存 / 加载（.mtgp 特殊格式，自包含工程）── */
const _TEX_REF_PREFIX = '@tex/';
function _safeTexName(name, i){
  const base = (typeof name==='string' && name.trim())
    ? name.trim().replace(/[\\/:*?"<>|\s]/g,'_').slice(0,64) : '';
  const ext = base && /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|svg|ico)$/i.test(base) ? '' : '.png';
  const safe = base || ('texture_'+i);
  return i+'-'+safe+ext;
}
function _texRef(file){ return _TEX_REF_PREFIX+file; }
function _rawTexUrl(absPath){ return '/api/file/raw?path='+encodeURIComponent(absPath); }

function _collectProjectTextures(graph){
  const textures = [];
  const nodeTex = new Map();
  state.nodes.forEach(node=>{
    if((node.type==='texture'||node.type==='mainTex') && node.props.tex) nodeTex.set(node.id, node.props);
  });
  let i = 0;
  graph.nodes.forEach(nd=>{
    const p = nodeTex.get(nd.id);
    if(!p) return;
    const src = p.tex;
    let name = p._name || '';
    let entry = null;
    if(src.startsWith('data:')){
      entry = { name, dataUrl: src };
    } else {
      const m = /[?&]path=([^&]+)/.exec(src);
      if(m){
        try {
          const abs = decodeURIComponent(m[1]);
          if(!name) name = abs.split(/[\\/]/).pop() || '';
          entry = { name, path: abs };
        } catch(e){}
      }
    }
    if(!entry) return;
    const file = _safeTexName(entry.name, i);
    nd.widgets_values = nd.widgets_values && typeof nd.widgets_values==='object' ? JSON.parse(JSON.stringify(nd.widgets_values)) : {};
    nd.widgets_values.tex = _texRef(file);
    textures.push({ name: entry.name, path: entry.path, dataUrl: entry.dataUrl });
    i++;
  });
  return textures;
}

function _generateProjectThumb(){
  return new Promise(resolve=>{
    const S = 256, CELL = 3;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    const sources = [];
    state.nodes.forEach(node=>{
      if((node.type==='texture'||node.type==='mainTex') && node.props.tex){
        sources.push({kind:'img', src: node.props.tex});
      } else if(_NOISE_PV_TYPES.has(node.type)){
        const u = _noisePreviewUrl(node);
        if(u) sources.push({kind:'img', src: u});
      } else if(node.type==='color' && node.props.color){
        sources.push({kind:'color', color: node.props.color});
      }
    });
    const picked = sources.slice(0, CELL*CELL);
    const done = ()=>{
      if(!picked.length){
        const g = ctx.createLinearGradient(0,0,S,S);
        g.addColorStop(0,'#1c2230'); g.addColorStop(1,'#2a3348');
        ctx.fillStyle = g; ctx.fillRect(0,0,S,S);
        ctx.fillStyle = '#7cbd56';
        ctx.font = 'bold 28px ui-monospace,monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(state.nodes.size+' 节点', S/2, S/2);
      }
      resolve(c.toDataURL('image/png'));
    };
    if(!picked.length){ done(); return; }
    const imgs = picked.map(p=> p.kind==='img' ? _loadImg(p.src) : Promise.resolve(null));
    Promise.all(imgs).then(loaded=>{
      const n = picked.length;
      const grid = Math.ceil(Math.sqrt(n));
      const cellW = S/grid, cellH = S/Math.ceil(n/grid);
      picked.forEach((p, idx)=>{
        const x = (idx%grid)*cellW, y = Math.floor(idx/grid)*cellH;
        const im = loaded[idx];
        if(p.kind==='color' || !im){
          ctx.fillStyle = p.kind==='color' ? p.color : '#262b38';
          ctx.fillRect(x+1, y+1, cellW-2, cellH-2);
        } else {
          const r = Math.min(cellW/im.naturalWidth, cellH/im.naturalHeight);
          const w = im.naturalWidth*r, h = im.naturalHeight*r;
          ctx.drawImage(im, x+(cellW-w)/2, y+(cellH-h)/2, w, h);
        }
      });
      done();
    }).catch(done);
  });
}

function _projApiUrl(p){
  return (window.matogaCore && window.matogaCore.url) ? window.matogaCore.url(p) : p;
}

/* 记忆最近一次打开/保存的项目 id（config.lastNodeProject），供启动时自动恢复 */
function _rememberProject(id){
  try{ if(window.api && window.api.setConfig) window.api.setConfig({ lastNodeProject: id || null }); }catch(e){}
}

/* 启动恢复：读取 lastNodeProject 并静默加载；无记忆/加载失败时回退示例图 */
async function _restoreLastProject(){
  let lastId = null
  try{
    const cfg = await window.api.getConfig()
    lastId = cfg && cfg.lastNodeProject
  }catch(e){}
  if(!lastId) return false
  try{
    const data = await loadNodeProject(lastId)
    toast('已恢复上次项目「' + (data && data.name ? data.name : lastId) + '」')
    return true
  }catch(e){ return false }
}

/* ── 当前节点项目（Ctrl+S / 保存按钮的目标地址：data/node-projects/<id>.mtgp/）── */
let _currentProject = null;
export function getCurrentProject(){ return _currentProject ? { ..._currentProject } : null; }

/* ── 项目指示器 + 自动保存 ────────────────────
   画布头部显示当前打开的项目；内容变化（增删节点/连线/属性/位置）时标记脏，
   防抖后自动保存到当前项目；保存/加载/清空后随时刷新指示器。 */
const AUTOSAVE_DELAY = 2500;
let _dirty = false;
let _autoSaveTimer = null;
let _suspendAutoSave = false;
let _saving = false;
let _lastSavedSig = null;

function _graphSignature(){
  const nodes = [];
  state.nodes.forEach(n=>{
    nodes.push([n.id, n.type, Math.round(n.x), Math.round(n.y), n.title||null, !!n.collapsed, JSON.stringify(n.props)]);
  });
  const edges = [];
  state.edges.forEach(e=>{
    edges.push([e.id, e.from.node, e.from.port, e.to.node, e.to.port]);
  });
  return JSON.stringify([nodes, edges]);
}

function _updateProjectIndicator(){
  const badge = document.getElementById('ncProject');
  const stat = document.getElementById('stat-project');
  const name = _currentProject ? _currentProject.name : null;
  if(badge){
    const nm = badge.querySelector('.nc-project-name');
    if(nm) nm.textContent = name ? name : '未关联项目';
    badge.classList.toggle('linked', !!name);
    badge.classList.toggle('dirty', !!name && _dirty);
    badge.title = name
      ? `当前节点项目：${name}（${_currentProject.id}）· ${_dirty ? '有未保存更改' : '已保存'}`
      : '当前节点项目：未关联（Ctrl+S 保存后自动关联）';
  }
  if(stat){
    stat.textContent = name ? name : '—';
    stat.parentElement && (stat.parentElement.title = name
      ? `当前打开的节点项目：${name}` : '未关联节点项目');
  }
}

function _setAutoSaveState(kind, text){
  const seg = document.getElementById('seg-autosave');
  const b = document.getElementById('stat-autosave');
  if(b) b.textContent = text;
  if(seg){
    seg.classList.remove('saving','saved','error');
    if(kind) seg.classList.add(kind);
  }
}

function _markDirty(){
  if(_suspendAutoSave) return;
  if(!_dirty){ _dirty = true; _updateProjectIndicator(); }
  if(!_currentProject) return;
  if(_autoSaveTimer) clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(()=>{ _autoSaveTimer=null; _autoSave(); }, AUTOSAVE_DELAY);
}

function _resetSavedState(){
  _dirty = false;
  if(_autoSaveTimer){ clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }
  try { _lastSavedSig = state.nodes.size ? _graphSignature() : null; } catch(e){ _lastSavedSig = null; }
  if(_currentProject) _setAutoSaveState('saved', '已就绪');
  else _setAutoSaveState(null, '—');
  _updateProjectIndicator();
}

async function _autoSave(force, opts){
  if(!_currentProject || !_dirty || _saving || _suspendAutoSave) return;
  if(state.nodes.size === 0) return;
  let sig = null;
  try { sig = _graphSignature(); } catch(e){}
  if(sig !== null && sig === _lastSavedSig){
    _dirty = false;
    _setAutoSaveState('saved', '已保存');
    _updateProjectIndicator();
    return;
  }
  _saving = true;
  _setAutoSaveState('saving', '自动保存中…');
  _updateProjectIndicator();
  const proj = { ..._currentProject };
  try {
    await saveNodeProject(proj.name, proj.id, { keepalive: !!(opts && opts.keepalive) });
    if(_currentProject && _currentProject.id === proj.id){
      _dirty = false;
      _lastSavedSig = sig;
      const t = new Date();
      const hh = String(t.getHours()).padStart(2,'0');
      const mm = String(t.getMinutes()).padStart(2,'0');
      const ss = String(t.getSeconds()).padStart(2,'0');
      _setAutoSaveState('saved', `已保存 ${hh}:${mm}:${ss}`);
    }
  } catch(e){
    if(_currentProject && _currentProject.id === proj.id){
      _setAutoSaveState('error', '失败·稍后重试');
      if(_autoSaveTimer) clearTimeout(_autoSaveTimer);
      _autoSaveTimer = setTimeout(()=>{ _autoSaveTimer=null; _autoSave(); }, 10000);
    }
  } finally {
    _saving = false;
    _updateProjectIndicator();
  }
}

document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'hidden' && _currentProject && _dirty) _autoSave(true);
});
window.addEventListener('beforeunload', (e)=>{
  if(_currentProject && _dirty && state.nodes.size > 0){
    _autoSave(true, { keepalive: true });
    e.preventDefault();
    e.returnValue = '';
  }
});

export async function saveNodeProject(name, id, opts){
  if(state.nodes.size===0) throw new Error('画布为空');
  const graph = _graphToComfy();
  const textures = _collectProjectTextures(graph);
  const thumbnail = await _generateProjectThumb();
  const res = await fetch(_projApiUrl('/api/node-projects'), {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ id: id||undefined, name, graph, thumbnail, textures }),
    ...(opts && opts.keepalive ? { keepalive: true } : {})
  });
  const j = await res.json();
  if(!j || !j.ok) throw new Error((j && j.msg) || '保存失败');
  _currentProject = { id: j.data.id, name };
  _rememberProject(j.data.id);
  _resetSavedState();
  try{ document.dispatchEvent(new CustomEvent('nodeproject:saved', { detail:{ id:_currentProject.id, name:_currentProject.name } })); }catch(e){}
  return j.data;
}

export async function loadNodeProject(id){
  const res = await fetch(_projApiUrl('/api/node-projects/'+encodeURIComponent(id)));
  const j = await res.json();
  if(!j || !j.ok) throw new Error((j && j.msg) || '加载失败');
  const data = j.data;
  const graph = JSON.parse(JSON.stringify(data.graph));
  const urlByFile = new Map();
  (data.textures||[]).forEach(t=>{ if(t.exists) urlByFile.set(t.file, _rawTexUrl(t.fullPath)); });
  let json = JSON.stringify(graph);
  urlByFile.forEach((url, file)=>{
    json = json.split(JSON.stringify(_texRef(file))).join(JSON.stringify(url));
  });
  loadGraphJSON(json);
  _currentProject = { id: data.id || id, name: data.name || id };
  _rememberProject(data.id || id);
  _resetSavedState();
  setTimeout(fitView, 80);
  return data;
}

export function addNodeAt(type){
  if(!canvasWrap) return null;
  const r = canvasWrap.getBoundingClientRect();
  const wp = screenToWorld(r.left + r.width/2, r.top + r.height/2);
  return createNode(type, wp.x, wp.y);
}

export function addTextureAt(path, name){
  if(!canvasWrap) return null;
  const r = canvasWrap.getBoundingClientRect();
  const wp = screenToWorld(r.left + r.width/2, r.top + r.height/2);
  const node = createNode('texture', wp.x, wp.y);
  if(node){
    node.props.tex = (typeof path==='string' && path.startsWith('data:')) ? path : texUrl(path);
    node.props._name = name || '';
    const thumb = node.el.querySelector('.w-tex .thumb');
    const fn = node.el.querySelector('.w-tex .fn');
    if(thumb) thumb.innerHTML = `<img src="${node.props.tex}" alt="">`;
    if(fn) fn.textContent = (name || '').slice(0, 20);
    evaluate();
  }
  return node;
}

function _centerXY(ox, oy){
  const r = canvasWrap.getBoundingClientRect();
  const wp = screenToWorld(r.left + r.width/2, r.top + r.height/2);
  return { x: wp.x + (ox||0), y: wp.y + (oy||0) };
}

function _buildMaterialPreset(baseColor, roughness, metallic){
  const c = _centerXY(-220, -40);
  const colorNode = createNode('color', c.x, c.y);
  if(colorNode) colorNode.props.color = baseColor;
  const roughNode = createNode('number', c.x, c.y + 80);
  if(roughNode) roughNode.props.value = roughness;
  const metalNode = createNode('number', c.x + 120, c.y + 80);
  if(metalNode) metalNode.props.value = metallic;
  [colorNode, roughNode, metalNode].forEach(n => { if(n){ n.el.remove(); renderNode(n); } });
  renderEdges(); updateStats(); evaluate();
}
const _PRESET_RECIPES = {
  metal:    () => _buildMaterialPreset('#c8c8d0', 0.25, 1.0),
  plastic:  () => _buildMaterialPreset('#e0e0e0', 0.5, 0.0),
  glass:    () => _buildMaterialPreset('#e0eef5', 0.05, 0.0),
  fabric:   () => _buildMaterialPreset('#b39880', 0.9, 0.0),
  emissive: () => _buildMaterialPreset('#fff3c0', 0.5, 0.0),
};
export function loadPreset(name){
  const fn = _PRESET_RECIPES[name];
  if(!fn){ toast('未知预设: '+name); return; }
  fn();
  toast('已加载预设: '+name);
}

export function initNodeCanvas(){
  if(_initialized) return;
  _initialized = true;
  buildLibrary();
  initExample();
  _resetSavedState();
  _restoreLastProject();   // 恢复成功时内部清掉示例图并重渲染；失败则保持示例图
  const _c = document.getElementById('material3dContainer');
  if(_c && m3d.initMaterial3D) m3d.initMaterial3D(_c);
  evaluate();
  toast('节点画布就绪 · 右侧实时预览联动 3D 材质引擎');
}
export function refreshNodePreview(){ if(_initialized) evaluate(); }


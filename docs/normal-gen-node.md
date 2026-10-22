# 法线生成节点（normalGen）— 最终设计

> 基于法线生成算法调研（Sobel / Scharr / 中心差分 / Farid-Simoncelli / 多 pass 叠加），
> 针对本项目 `web/src/node-canvas.js` 节点引擎架构，设计一个**真正从高度图计算法线贴图**的节点。

---

## 1. 背景与现状

### 1.1 现有 `normalMap` 节点的局限

`node-canvas.js:79` 现有节点：

```js
normalMap: { title:'法线生成', group:'材质', ...
  inputs:[{n:'tex',t:'texture'},{n:'strength',t:'number'}], outputs:[{n:'normal',t:'texture'}],
  eval:(i)=>{
    const tex = i.tex || null;
    const strength = clamp(num(i.strength),0,2);
    return {normal: tex ? {src:tex, strength} : null};   // ← 仅传递，不生成
  } },
```

**它只是把输入贴图当作法线贴图原样透传**，仅附带 `strength` 系数。用户若只有高度图/灰度噪声，无法得到法线贴图。

### 1.2 设计目标

新增 `normalGen` 节点（保留原 `normalMap` 作为"法线贴图直传"用途，避免破坏旧工程）：

| 能力 | 说明 |
|------|------|
| 输入 | 高度图（灰度或彩色取亮度）+ strength + 算法选择 + 平滑 |
| 处理 | 在 Canvas 上用所选梯度算子逐像素计算法线，编码为 RGB（切线空间） |
| 输出 | 法线贴图 PNG dataURL，附带 strength，可直接接 `normalOutLeft/Right` |
| 预览 | 节点内实时缩略图（复用现有 preview 机制） |
| 导出 | 一键保存 PNG（复用 rgbaMerge 的保存按钮模式） |

---

## 2. 算法选型

统一框架：对高度场 $h$ 求梯度 $(G_x, G_y)$，法线 $\mathbf{n}=\text{normalize}(-sG_x,-sG_y,1)$，编码 $RGB=\mathbf{n}\cdot0.5+0.5$。

| 算法 | 核 | 旋转误差 | 用途 | 复杂度 |
|------|----|---------|------|--------|
| `central` | 3×1 中心差分 | 大 | 快速预览 | 低 |
| `sobel` | 3×3 Sobel | 中 | 默认（对齐 Substance） | 中 |
| `scharr` | 3×3 Scharr | 小 | 高质量 | 中 |
| `farid` | 5×5 Farid-Simoncelli | 最小 | 离线烘焙 | 高 |

**梯度核定义**（$G_x$；$G_y$ 为其转置）：

```
central:  [-1, 0, 1] / 2

sobel:    [-1  0  1          scharr:  [-3  0  3
           -2  0  2                    -10 0 10
           -1  0  1] / 8               -3  0  3] / 32

farid (3×3, Farid-Simoncelli 2004):
  p = [0.2275, 0.5450, 0.2275]   (平滑，可分离)
  d = [0.4530, 0, -0.4530]       (求导，可分离)
  G = outer(d, p)  → 3×3
```

Farid 5×5 精度更高但开销大，作为可选高档位。

---

## 3. 节点规格

```js
normalGen: {
  title: '法线生成 (高度→法线)',
  group: '材质',
  color: 'var(--type-texture)',
  inputs: [
    {n:'tex',      t:'texture'},   // 高度图（灰度/彩色取亮度）
    {n:'strength', t:'number'}     // 法线强度 0-4（可连线，也可用 widget）
  ],
  outputs: [
    {n:'normal', t:'texture'}      // 法线贴图（{src, strength} 对象，兼容 normalOut*）
  ],
  widget: (n) => normalGenWidget(n),
  eval: (i, n) => { ... }
}
```

**端口兼容性**：
- 输出 `normal` 为 `{src: dataURL, strength}` 对象，与现有 `normalOutLeft/Right`（node-canvas.js:279）的 `i.tex.strength` 读取逻辑完全兼容。
- 也可被 `_texUrl()`（node-canvas.js:305）正确提取 URL。

---

## 4. 核心实现

### 4.1 梯度核表

```js
/* ── 法线生成梯度核 ── */
const NORMAL_KERNELS = {
  central: { w: 3, h: 1, div: 2, kx: [-1,0,1], ky: [-1,0,1] }, // ky 竖向 3×1
  sobel:   { w: 3, h: 3, div: 8, kx: [-1,0,1,-2,0,2,-1,0,1],
                                  ky: [-1,-2,-1,0,0,0,1,2,1] },
  scharr:  { w: 3, h: 3, div: 32, kx: [-3,0,3,-10,0,10,-3,0,3],
                                  ky: [-3,-10,-3,0,0,0,3,10,3] },
};
// Farid-Simoncelli 可分离核（3×3）
const FARID_P = [0.2275, 0.5450, 0.2275];
const FARID_D = [0.4530, 0.0, -0.4530];
```

### 4.2 亮度提取

```js
function _luma(r, g, b) { return 0.299*r + 0.587*g + 0.114*b; }
```

### 4.3 卷积求梯度（通用核）

```js
function _convGrad(src, W, H, kern) {
  const { w: kw, h: kh, div, kx, ky } = kern;
  const hx = Math.floor(kw/2), hy = Math.floor(kh/2);
  const Gx = new Float32Array(W*H), Gy = new Float32Array(W*H);
  for (let y=0; y<H; y++) {
    for (let x=0; x<W; x++) {
      let sx=0, sy=0;
      for (let j=0; j<kh; j++) {
        for (let i=0; i<kw; i++) {
          const px = Math.min(W-1, Math.max(0, x + i - hx));
          const py = Math.min(H-1, Math.max(0, y + j - hy));
          const v = src[py*W + px];
          sx += v * kx[j*kw + i];
          sy += v * ky[j*kw + i];
        }
      }
      const idx = y*W + x;
      Gx[idx] = sx / div;
      Gy[idx] = sy / div;
    }
  }
  return { Gx, Gy };
}
```

### 4.4 Farid-Simoncelli 可分离梯度

```js
function _faridGrad(src, W, H) {
  // 先沿 X 求导（d⊗p），再沿 Y；利用可分离性两次 1D 卷积
  const tmp = new Float32Array(W*H); // 中间：X 方向导数
  for (let y=0; y<H; y++) {
    for (let x=0; x<W; x++) {
      let s=0;
      for (let i=0; i<3; i++) {
        const px = Math.min(W-1, Math.max(0, x + i - 1));
        s += src[y*W + px] * FARID_D[i];
      }
      tmp[y*W + x] = s;
    }
  }
  const Gx = new Float32Array(W*H);
  for (let y=0; y<H; y++) {
    for (let x=0; x<W; x++) {
      let s=0;
      for (let j=0; j<3; j++) {
        const py = Math.min(H-1, Math.max(0, y + j - 1));
        s += tmp[py*W + x] * FARID_P[j];
      }
      Gx[y*W + x] = s;
    }
  }
  // Y 方向同理（p⊗d）
  const tmp2 = new Float32Array(W*H);
  for (let y=0; y<H; y++) {
    for (let x=0; x<W; x++) {
      let s=0;
      for (let j=0; j<3; j++) {
        const py = Math.min(H-1, Math.max(0, y + j - 1));
        s += src[py*W + x] * FARID_D[j];
      }
      tmp2[y*W + x] = s;
    }
  }
  const Gy = new Float32Array(W*H);
  for (let y=0; y<H; y++) {
    for (let x=0; x<W; x++) {
      let s=0;
      for (let i=0; i<3; i++) {
        const px = Math.min(W-1, Math.max(0, x + i - 1));
        s += tmp2[y*W + px] * FARID_P[i];
      }
      Gy[y*W + x] = s;
    }
  }
  return { Gx, Gy };
}
```

### 4.5 异步合成（遵循 `_rgbaMerge` 模式：缓存 + 异步 + evaluate 回流）

```js
const _normalGenCache = new Map();

async function _normalGenCompose(url, algo, strength, smooth, cb) {
  try {
    const img = await _loadImg(url);
    if (!img) { cb(null); return; }
    const W = Math.max(1, img.naturalWidth || 1);
    const H = Math.max(1, img.naturalHeight || 1);

    // 取高度（亮度）
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    const height = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      height[i] = _luma(data[i*4], data[i*4+1], data[i*4+2]) / 255;
    }

    // 可选预平滑（box blur，smooth>0 时）
    let src = height;
    if (smooth > 0) src = _boxBlur(height, W, H, smooth);

    // 求梯度
    let Gx, Gy;
    if (algo === 'farid') {
      ({ Gx, Gy } = _faridGrad(src, W, H));
    } else {
      const kern = NORMAL_KERNELS[algo] || NORMAL_KERNELS.sobel;
      ({ Gx, Gy } = _convGrad(src, W, H, kern));
    }

    // 法线编码：n = normalize(-s*Gx, -s*Gy, 1)，RGB = n*0.5+0.5
    const out = new ImageData(W, H);
    const od = out.data;
    const s = strength;
    for (let i = 0; i < W * H; i++) {
      let nx = -s * Gx[i], ny = -s * Gy[i], nz = 1;
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
      nx = nx/len * 0.5 + 0.5;
      ny = ny/len * 0.5 + 0.5;
      nz = nz/len * 0.5 + 0.5;
      od[i*4]   = Math.round(nx * 255);
      od[i*4+1] = Math.round(ny * 255);
      od[i*4+2] = Math.round(nz * 255);
      od[i*4+3] = 255;
    }
    cb(_imageDataToPngUrl(out, W, H));
  } catch (e) { cb(null); }
}

function _normalGen(url, algo, strength, smooth) {
  const key = JSON.stringify([url, algo, strength, smooth]);
  if (_normalGenCache.has(key)) return _normalGenCache.get(key);
  if (_normalGenCache.size > 32) _normalGenCache.clear();
  _normalGenCompose(url, algo, strength, smooth, (outUrl) => {
    _normalGenCache.set(key, outUrl || '');
    evaluate();
  });
  return null; // 首次同步返回 null，异步完成后回流
}
```

### 4.6 简单 box blur（预平滑用）

```js
function _boxBlur(src, W, H, r) {
  const r1 = Math.max(1, Math.round(r));
  const dst = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, cnt = 0;
      for (let j = -r1; j <= r1; j++) {
        for (let i = -r1; i <= r1; i++) {
          const px = Math.min(W-1, Math.max(0, x+i));
          const py = Math.min(H-1, Math.max(0, y+j));
          sum += src[py*W + px]; cnt++;
        }
      }
      dst[y*W + x] = sum / cnt;
    }
  }
  return dst;
}
```

---

## 5. 节点定义（NODE_DEFS 条目）

```js
normalGen: { title:'法线生成 (高度→法线)', group:'材质', color:'var(--type-texture)',
  inputs:[{n:'tex',t:'texture'},{n:'strength',t:'number'}],
  outputs:[{n:'normal',t:'texture'}],
  widget:(n)=>normalGenWidget(n),
  eval:(i,n)=>{
    const url = _texUrl(i.tex);
    const strength = clamp(num(i.strength ?? n.props.strength), 0, 4);
    const algo = n.props.algo || 'sobel';
    const smooth = clamp(+(n.props.smooth ?? 0), 0, 4);
    const outUrl = url ? _normalGen(url, algo, strength, smooth) : null;
    n._normalUrl = outUrl || null;
    // 输出 {src, strength} 对象，兼容 normalOutLeft/Right 的 normalScale 读取
    return { normal: outUrl ? { src: outUrl, strength } : null };
  } },
```

**要点**：
- `strength` 优先取连线输入 `i.strength`，回退到 widget `n.props.strength`。
- 输出 `{src, strength}` 与 `normalOutLeft`（node-canvas.js:282-283）的 `i.tex.strength` 读取逻辑一致。
- 首次求值 `_normalGen` 返回 null，异步合成完成后 `evaluate()` 回流，与 `_rgbaMerge` 模式一致。

---

## 6. Widget 设计

```js
function normalGenWidget(node) {
  if (node.props.algo === undefined) node.props.algo = 'sobel';
  if (node.props.strength === undefined) node.props.strength = 1.0;
  if (node.props.smooth === undefined) node.props.smooth = 0;
  const box = document.createElement('div');
  box.className = 'w-multi';

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:10px;color:var(--text-dim);margin-bottom:4px;line-height:1.4;';
  hint.textContent = '从高度图（灰度/彩色取亮度）生成切线空间法线贴图；输出可接法线输出节点';
  box.appendChild(hint);

  box.appendChild(_labeledRow('算法', selectWidget(node, 'algo',
    ['central', 'sobel', 'scharr', 'farid'])));
  box.appendChild(_labeledRow('强度', numWidget(node, 'strength', 0, 4, 0.05)));
  box.appendChild(_labeledRow('平滑', numWidget(node, 'smooth', 0, 4, 0.5)));

  // 保存 PNG 按钮（复用 rgbaMergeWidget 的保存模式）
  const actions = document.createElement('div');
  actions.className = 'w-tex';
  actions.style.marginTop = '4px';
  const info = document.createElement('div'); info.className = 'info';
  const btn = document.createElement('div'); btn.className = 'btn'; btn.textContent = '保存 PNG';
  info.appendChild(btn); actions.appendChild(info);
  box.appendChild(actions);
  btn.addEventListener('click', () => {
    const url = node._normalUrl;
    if (!url) { toast('法线尚未生成（等待高度图输入或异步计算）'); return; }
    const a = document.createElement('a');
    a.href = url; a.download = 'matoga-normal.png';
    a.click();
  });
  return box;
}
```

---

## 7. 节点预览

现有预览机制通过 `previewWidget(node, key)` + `node._previewEl` 实现，对输出端口 `normal` 自动渲染贴图缩略图。`normalGen` 的输出是 `{src, strength}` 对象，需确保预览渲染逻辑能处理该对象——现有 `_texUrl()`（node-canvas.js:305）已兼容 `{src}` 对象取 URL，故**无需改动预览代码**。

若预览只识别字符串 dataURL，则在预览渲染处补充：
```js
const previewUrl = typeof val === 'string' ? val : (val && val.src) || null;
```

---

## 8. 集成清单

在 `web/src/node-canvas.js` 中新增以下内容：

| 位置 | 内容 |
|------|------|
| `NODE_DEFS` 内（`normalMap` 之后） | 第 5 节的 `normalGen` 条目 |
| 工具函数区（`_rgbaMerge` 附近） | 第 4.1–4.6 节的全部辅助函数 |
| Widget 函数区（`rgbaMergeWidget` 附近） | 第 6 节的 `normalGenWidget` |

**无需改动**：`_texUrl`、`normalOutLeft/Right`、预览机制、节点序列化（`node-project-store` 已通用处理 `graph.nodes`）。

---

## 9. 典型连接图

```
[噪声 Perlin] ──tex──→ [normalGen] ──normal──→ [normalOutLeft]
                         ↑ strength(1.0)
                         algo=sobel
```

或从外部高度图：

```
[texture(高度图)] ──tex──→ [normalGen] ──normal──→ [normalOutLeft]
                            algo=scharr, strength=2.0
```

---

## 10. 测试要点

| 场景 | 预期 |
|------|------|
| 平坦高度图（全灰） | 输出纯蓝 `#8080FF`（法线指向 +Z） |
| 左→右线性渐变 | 输出偏红/青（X 方向倾斜） |
| Sobel vs Scharr | 旋转 45° 渲染时 Scharr 各向异性更小 |
| strength=0 | 输出纯蓝（无位移） |
| smooth>0 | 噪声高度图输出更平滑，无高频锯齿 |
| 异步回流 | 首帧预览空，下一帧 `evaluate()` 后出现法线 |
| 缓存命中 | 同参数不重复计算（`_normalGenCache`） |
| 保存 PNG | 导出标准切线空间法线贴图，可直接用于引擎 |

单元测试可参考 `test/unit/nodesplit.test.js` 的 DOM stub + 模块加载模式，验证：
1. 端口结构（inputs/outputs）
2. 平坦输入 → `#8080FF`
3. 缓存命中幂等

---

## 11. 算法出处（供后续深入）

| 算法 | 出处 |
|------|------|
| Sobel | Irwin Sobel, 1968 |
| Scharr | Scharr, "Optimal Operators in Digital Image Processing", 2000 |
| Farid-Simoncelli | Farid & Simoncelli, "Differentiation of discrete multidimensional signals", IEEE TIP 2004 |
| 中心差分 | 经典数值分析 |
| 切线空间编码 | OpenGL 法线贴图标准（learnopengl.com） |
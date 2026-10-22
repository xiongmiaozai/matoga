# 噪波算法参考资料

> 整理自 Inigo Quilez 文章（fbm / warp / voronoise / smoothvoronoi / derivatives / directional）、FastNoiseLite 仓库、《地平线：零之曙光》体积云演讲，以及本项目源码分析。

---

## 1. 核心原理

噪波 = **确定性哈希（可复现的伪随机）→ 空间插值（连续性）→ 多倍频叠加（分形自相似）**。

```
hash(格点) → 伪随机值/梯度
lerp/quintic(格点间) → 连续信号
Σ noise(2ⁱ·x)·2⁻ⁱ → fBm 分形细节
```

- **Value Noise**：格点存随机值，插值。快，但插值曲线可能显出格状伪影。
- **Gradient Noise（Perlin）**：格点存随机梯度，取 `梯度·偏移`。频谱更干净。
- **插值曲线**：cubic `3x²-2x³` 便宜但二阶导不连续（法线有接缝）；quintic `6x⁵-15x⁴+10x³` 是 C² 连续的标准选择。

---

## 2. 基础噪声类型大全

| 类型 | 原理 | 视觉特征 | 本项目 |
|---|---|---|---|
| Value | 格点值插值 | 柔和云雾 | ✅ node-canvas.js `_valueNoise2D` |
| Perlin | 格点梯度点积 + quintic | 经典，无格纹 | ❌ 3D 版随体积云移除；2D 缺 |
| Simplex | 三角/单纯形网格 + 梯度衰减 `(0.5-r²)⁴` | 无轴向伪影，效率高 | ✅ `_simplex2D` |
| OpenSimplex2/S | Simplex 改良，免专利 | 同上，质量更好 | ❌ FastNoiseLite 有 |
| Value Cubic | 三次 Hermite 插值 | 比 value 更平滑无格纹 | ❌ 几行代码可加 |
| White | 纯哈希，不插值 | 颗粒/星空 | ❌ `_hash` 已有，直接可用 |
| Voronoi/Worley | 最近特征点距离 | 细胞/石纹/焦散 | ✅ `_voronoi2D` |
| Cell | 每格一个常数值 | 硬格子（u=0,v=0 特例） | ❌ |
| Voronoise | 抖动网格 + 距离加权插值 | 噪声但无网格伪影 | ❌ |
| Ridged | `1-|n|` 后平方 | 山脊地貌 | ✅ `_ridged2D` |
| Billow | `|n|` | 蓬松云朵 | ❌ |
| Curl | 嵌套噪声求旋度 | 无散度湍流（流体感） | ✅ sky `genCurlTexture` |
| Gabor | 带核的定向随机核叠加 | 各向异性（木纹/布纹） | ❌ 学术向 |
| Wavelet | 频域带限噪声（Pixar） | 多倍频无走样 | ❌ 学术向 |
| Blue Noise | Poisson 盘 / void-and-cluster | 采样点均匀分布 | ✅ sky `genBlueNoise` |

### Voronoi 变体（评估模式）

- **F1**：最近点距离（经典）
- **F2**：次近点距离
- **F2-F1**：细胞边缘暗线（砖墙/干裂）
- **Distance2Div**：F2/F1 比值，细胞内部渐变
- **Smooth Voronoi**：用平滑 min 替代不连续的 `min()`，falloff 可调（4/8/16/32/64）：

```js
res += Math.exp2(-32 * d);        // 指数衰减版
return -Math.log2(res) / 32;
```

---

## 3. 分形框架（FastNoiseLite 全集）

| 框架 | 公式要点 | 特征 |
|---|---|---|
| **FBM** | `Σ amp·noise(freq·x)`，freq×2，amp×0.5 | 万能底料 |
| **Billow** | 每 octave 取 `|n|` | 蓬松 |
| **Ridged** | 每 octave 取 `(1-|n|)²` | 山脊 |
| **PingPong** | 值折叠 `1-2|frac(x/2)-0.5|` | 硬表面岩层 |
| **DomainWarp Progression** | 每层 octave 先 warp 再采样 | 强有机扭曲 |

### 信号处理视角（Hurst 指数 H 与增益 G）

`G = 2^(-H)`，控制自相似性与频谱衰减：

| 名称 | H | G | 频谱 | 听感 |
|---|---|---|---|---|
| Pink | 0 | 1 | f⁻¹（-3dB/oct） | 雨 |
| Brown | 0.5 | √2 | f⁻²（-6dB/oct） | 室内雨 |
| **Yellow** | 1 | 0.5 | f⁻³（-9dB/oct） | 门后引擎 |

**实测山地轮廓 ≈ -9dB/oct（Yellow）**，所以 G=0.5 是地形标配——但 G 应作为可调参数暴露，而非硬编码 0.5。

---

## 4. 组合技术

### 域扭曲（Domain Warping）

```js
// 单层（本项目 warp 节点现状）
q = [fbm(p), fbm(p+off)];
f = fbm(p + amount·q);

// 双层递归（Quilez 经典，有机度大幅提升）
q = [fbm(p), fbm(p+5.2,1.3)];
r = [fbm(p+4q+1.7,9.2), fbm(p+4q+8.3,2.8)];
f = fbm(p + 4r);
```

- 中间量 **q、r 可输出用于调色**（模长/分量做颜色混合源）——Shadertoy `4s23zzM`
- 域扭曲历史：1984 年 Ken Perlin 首个程序化大理石纹理即此技术

### Perlin-Worley（地平线：零之曙光 云 Base 纹理）

- Worley 逆置后作为**膨胀量**偏移 Perlin 采样 → 保留 Perlin 连通性 + 团絮感
- RGBA 四通道 = Perlin-Worley + 3 个递增频率 Worley
- 高频 Detail 纹理（3×Worley）从边缘**侵蚀** Base 形状；底部逆 Worley 得丝缕状
- 2D curl 噪声扰动两纹理，伪造大气湍流漩涡

---

## 5. 工程技巧

| 技巧 | 要点 | 收益 |
|---|---|---|
| **Cell-space 精度** | floor/fract 分离后只在格内坐标运算，丢弃整数部分 | 大坐标/星球尺度不丢精度；Voronoi/Perlin 通用 |
| **Detune** | 倍频用 2.01/1.99 而非整 2 | 避免各 octave 波峰重叠产生规则伪图案 |
| **旋转矩阵** | `mat2 m=(0.8,-0.6,0.6,0.8)` 每 octave 旋转域 | 消除轴向对齐伪影（2D fBm 标配） |
| **解析导数** | quintic 展开为 k0~k7 多项式系数，值+梯度一次算出 | 比中心差分快 5×；体积云法线快 6× |
| **导数注入 fBm** | `d+=grad; a += b·n/(1+dot(d,d))` | 一行代码得侵蚀感地形（平缓+粗粞自然过渡） |
| **方向导数光照** | `(map(p+eps·L)-den)/eps` 替代 6 采样梯度法线 | 单光源快 3.5× |

### 解析导数核心（Value Noise）

```js
// u(x)=6x⁵-15x⁴+10x³,  u'(x)=30x²(x-1)²
// n 展开: k0 + k1u + k2v + k3w + k4uv + k5vw + k6wu + k7uvw
// ∂n/∂x = (k1 + k4·v + k6·w + k7·vw)·u'(x)
```

---

## 6. 性能参考（FastNoiseLite 2D，Mpts/s）

```
Value 114 > Perlin 93 > Simplex 71 > Cellular 39
（FastNoise2 AVX2: 776 / 624 / 466 / 194）
```

---

## 7. 本项目落地记录（已实现）

**现状**（web/src/node-canvas.js）：2D 噪波节点由 5 种扩展至 **11 种**——noise、voronoi、simplex、ridge、warp、white、cell、billow、cubic、pingpong、voronoise；sky 侧有 perlin3/fbm3/worley/curl/blue-noise。单测见 `test/unit/noisevariants.test.js`。

| 批次 | 内容 | 状态 |
|---|---|---|
| 零成本 | White（`_white2D` 质数放大哈希）、Cell（`_cell2D`）、Billow（`_billow2D`）、Voronoi F2/F2-F1（`_voronoiCells2D` 双最近距离） | ✅ |
| 低成本高收益 | fBm 增益 G 参数化（`gain` 滑条 0.4~0.95）；warp 升双层递归；Smooth Voronoi（指数衰减加权，`smooth` 滑条）；每层旋转矩阵 + 2.03 微失谐（`_octaveStep`） | ✅ |
| 中等 | Value Cubic（`_cubicAt` Catmull-Rom）、PingPong（`_pingpongFbm2D` 折波）、Voronoise（`_voronoise2D`，jitter/blend 双滑条） | ✅ |
| 后期 | 解析导数节点（输出 vector 供法线用）、Gabor 各向异性 | 待做 |

工程细节：eval 与预览统一走 `_noiseValue(type,u,v,props)` 单一入口；预览缓存键为全量 props；旧图缺新字段时 `??` 兜底（gain=0.5、mode='f1'、jitter=1），widget 渲染时补默认值。npm `fastnoise-lite`（MIT）可作对照实现。

---

## 8. 参考资料

- Inigo Quilez：
  - fBm 与 Hurst 指数 — https://iquilezles.org/articles/fbm/
  - 域扭曲 — https://iquilezles.org/articles/warp/
  - Voronoise — https://iquilezles.org/articles/voronoise/
  - 平滑 Voronoi — https://iquilezles.org/articles/smoothvoronoi/
  - 噪声导数 — https://iquilezles.org/articles/morenoise/
  - 方向导数光照 — https://iquilezles.org/articles/derivative/
- FastNoiseLite（MIT，16 语言端口）— https://github.com/Auburn/FastNoiseLite
- FastNoise2（SIMD + 节点图）— https://github.com/Auburn/FastNoise2
- OpenSimplex2 — https://github.com/KdotJPG/OpenSimplex2
- Simplex noise 讲义（Stefan Gustavson 公有域实现，本项目 2D 版即源于此）
- 《The Real-time Volumetric Cloudscapes of Horizon: Zero Dawn》（Nubis；本项目 `MinerU_markdown_*.md` 有全文）
- Shadertoy：`4s23zzM`（双层 warp 调色）、`MdX3RrM`（导数侵蚀地形）、`ldB3zc`（多项式 smooth voronoi）、`Xl23Wy`（方向导数光照）
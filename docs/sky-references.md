# 体积云参考资料汇总

## 1. Guerrilla Games 官方资源

### SIGGRAPH 2015 原始论文
- 《The Real-time Volumetric Cloudscapes of Horizon - Zero Dawn》
- 已有 Markdown 版本在项目根目录

### 2024 新演讲：Synthesizing Realistic Clouds for Video Games
- 日期：2024-07-25
- 演讲者：Andrew Schneider（Guerrilla 大气渲染负责人）
- 场合：Lorentz Center, Leiden, NL - Light and Color in Nature and Art Conference
- PPTX下载：https://d3d3g8mu99pzk9.cloudfront.net/AndrewSchneider/Schneider%20-%20Synthesizing%20Realistic%20Clouds%20for%20Video%20Games.pptx
- PDF下载：https://d3d3g8mu99pzk9.cloudfront.net/AndrewSchneider/Abstract.pdf
- 要点：基于 "Nubis, Evolved" 演讲，使用 High Performance + Approximation 定义云

### Nubis, Evolved（SIGGRAPH 2015 演讲页面）
- https://www.guerrilla-games.com/read/nubis-evolved

## 2. GitHub 参考实现

### FarazzShaikh/three-volumetric-clouds（125★，已归档）
- 仓库：https://github.com/FarazzShaikh/three-volumetric-clouds
- 基于 "Nubis, Evolved" 的 Three.js 实现
- 实现：Envelope 模型、Perlin-Worley 3D纹理、自适应 ray-march、多散射+各向异性相位函数
- 技术栈：React + Vite + TypeScript + Three.js

#### 核心架构
```
src/Clouds/CloudsRenderer/
├── index.tsx                    # 主渲染器 (4.5KB)
├── FullScreenQuad.ts            # 全屏四边形
├── fbo/                         # FBO 纹理生成
│   ├── TextureEnvelope/         # 包络纹理（minH/maxH/type）
│   ├── TextureA3D/              # 3D纹理A（Perlin-Worley）
│   ├── TextureB3D/              # 3D纹理B
│   ├── TextureC3D/              # 3D纹理C
│   ├── TextureCloud/            # 云纹理
│   └── TextureScene/            # 场景纹理
├── materials/
│   ├── CloudMaterial/index.ts   # 云材质 (8.5KB)
│   ├── RenderMaterial/index.ts  # 渲染材质
│   └── shaders/
│       ├── rayMarch.ts          # Ray-march GLSL (3.9KB)
│       ├── intersectAABB.ts     # AABB相交 (2.0KB)
│       ├── defines.ts           # 宏定义
│       └── getWorldSpacePos.ts  # 世界空间位置
└── shaders/
    ├── perlin.ts                # Perlin噪声 GLSL (2.5KB)
    ├── worley.ts                # Worley噪声 GLSL (0.9KB)
    └── common.ts                # 公共函数
```

#### rayMarch.ts 关键技术
1. **Beer-Lambert 定律**：`exp(-absorption * density)`
2. **Henvey-Greenstein 相位函数**（单叶）
3. **双叶 HG**：`mix(HG(g), HG(-g), K)` — 前向+后向散射
4. **多散射近似**（4 octaves）：
   - 每octave衰减 attenuation=0.5, contribution=0.5, phaseAttenuation=0.1
   - 累加 `contribution * phase * beer` 
5. **自适应步长 ray-march**：
   - 空区域用大步 `(far-near)/MAX_STEPS`
   - 命中云时步长 ×0.5，回退一步重新采样
   - 离开云时恢复大步
6. **光照 ray-march**：`N_LIGHT_STEPS` 步，密度≥1.0 提前退出
7. **环境光**：`ambientLight * density * transmittance`

#### perlin.ts 关键技术
- iq 的梯度噪声，可平铺 `mod(p, freq)`
- quintic 插值：`w*w*w*(w*(w*6-15)+10)`
- FBM：octaves 累加，amp 按 `exp2(-0.85)` 衰减
- curl 噪声：domain warping `p + r` 其中 r 由 Perlin 嵌套生成

#### TextureEnvelopeMaterial.ts 关键技术
- 2D 纹理存储 (minHeight, maxHeight, cloudType, 0)
- 云类型按 uv.x 混合：stratus(高) → cumulus(中) → cumulonimbus(低)
- 每类型有不同高度带和 smoothstep 过渡

### xiaxiangfeng/sky-cloud-3d（29★）
- 仓库：https://github.com/xiaxiangfeng/sky-cloud-3d
- npm 包：threejs-sky-cloud
- 更简单的实现：天空穹顶 mesh + Perlin 纹理 + 体积云
- 非商用许可

### ZyFou/ProceduralTerrains（634★）
- 仓库：https://github.com/ZyFou/ProceduralTerrains
- Three.js 程序化地形，含体积云、无限世界、行星模式

## 3. 与当前实现的对比

| 技术点 | FarazzShaikh 参考 | 我们的实现 | 状态 |
|--------|-------------------|-----------|------|
| 自适应步长 | 命中×0.5，离开恢复 | 两级LOD大步/小步 | ✅ 类似 |
| 多散射 | 4 octaves 衰减近似 | 4-octave multipleScattering() | ✅ 已实现 |
| 双叶HG相位 | mix(HG(g),HG(-g),K) | dualLobeHG(K=0.2) | ✅ 已实现 |
| Envelope模型 | 2D纹理(minH,maxH,type) | 直接密度采样 | 🟡 不同路线 |
| 噪声计算 | Shader内程序化 | 预烘焙3D纹理 | ✅ 我们更高效 |
| 时域重投影 | ❌ 未实现 | 4×4块+reproject+upsample | ✅ 已实现 |
| 球面ray-march | ❌ 平面 | 球壳相交+EARTH_RADIUS | ✅ 已实现 |
| 光照提前退出 | density≥1.0 break | alpha提前终止+cheap LOD | ✅ 已实现 |
| curl噪声 | ✅ domain warping | ✅ 预烘焙2D | ✅ 类似 |

## 4. 已实现改进（全部完成）

### P0 - 时域重投影 ✅
- 4×4块 1/16像素更新 + reprojection + quarter res + 上采样
- 多pass管线：CloudRenderMaterial → ReprojectMaterial → UpsampleMaterial
- 管线管理：CloudTemporalPipeline（cloud-pipeline.js）
- 参考 Nathan Vos 方案，两个参考实现均未做此优化

### P1 - 多散射近似 ✅
- multipleScattering() 函数：4 octaves
- 每 octave: attenuation=0.5, contribution=0.5, phaseAttenuation=0.1
- 替换了原单次 Beer×HG×Powder

### P2 - 双叶 HG 相位函数 ✅
- dualLobeHG(cosTheta, g, K=0.2)
- mix(HG(g,cosθ), HG(-g,cosθ), K)
- 前向+后向散射，更真实的银边效果

### P3 - 球面大气 ray-march ✅
- EARTH_RADIUS=6371000m, EARTH_CENTER 常量
- cloudDensity() 改用球面高度: length(wp - EARTH_CENTER) - EARTH_RADIUS
- intersectCloudLayer() 球壳相交（处理内/外球壳所有情况）
- 地球曲率使云自然下沉地平线

### P4 - 光照 cheap LOD ✅
- cloudLighting() 新增 cheap 参数
- alpha > 0.3 时：6采样→3采样，步距加大（100+180i vs 60+110i）
- 预计 2x 光照加速
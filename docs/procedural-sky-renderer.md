# 实时程序化天空渲染系统 — 技术设计文档

> 技术基础：SIGGRAPH 2015《Real-Time Volumetric Cloudscapes of Horizon: Zero Dawn》（Andrew Schneider）
> 目标平台：中端 PC（GTX1660 / RTX3050），1080p，多云工况体积云 GPU 耗时 **1.4 ~ 2.0 ms**，总纹理内存 **≤ 15 MB**
> 附降级模式，面向低配/移动端。

---

## 目录

1. [系统架构总览](#1-系统架构总览)
2. [渲染管线与混合顺序](#2-渲染管线与混合顺序)
3. [离线预生成只读纹理](#3-离线预生成只读纹理)
4. [GPU — 大气散射模块（选项 A / 选项 B）](#4-gpu--大气散射模块)
5. [GPU — 体积云模块（核心）](#5-gpu--体积云模块核心)
6. [GPU — 星空天体模块](#6-gpu--星空天体模块)
7. [CPU — 天文时间模块](#7-cpu--天文时间模块)
8. [CPU — 天气管理模块](#8-cpu--天气管理模块)
9. [美术参数面板](#9-美术参数面板)
10. [性能预算验收表](#10-性能预算验收表)
11. [硬性约束落实对照表](#11-硬性约束落实对照表)
12. [集成 / 扩展备注](#12-集成--扩展备注)

---

## 1. 系统架构总览

```
 ┌────────────────────────────────────────────────────────────────────┐
 │ CPU（每帧更新，毫秒级）                                              │
 │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
 │  │ 天文时间模块  │→ │ 天气管理模块  │→ │ 参数面板/覆写 │               │
 │  │ sunMoon/day… │  │ coverage/…   │  │ 性能降级开关  │               │
 │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
 │         └──────────────────┼────────────────┘                        │
 │                      常量缓冲上传（Uniform Block）                     │
 └──────────────────────────┼───────────────────────────────────────────┘
                            ▼
 ┌────────────────────────────────────────────────────────────────────┐
 │ GPU 全屏后处理 Pass（仅天空像素执行 Ray-March）                       │
 │  1. 大气底色（选项A解析近似 / 选项B LUT）                            │
 │  2. 体积云（两级LOD Ray-March，光线步进）                            │
 │  3. 星空天体（星星 + 银河 + 月亮）                                   │
 │  4. 与地面雾融合                                                     │
 │  → Bloom / 镜头光晕（后处理链由引擎侧提供）                           │
 └────────────────────────────────────────────────────────────────────┘
```

**渲染走查：**
- 全屏全分辨率调用一次天空 Sky Shader。
- 针对深度缓冲（或逐像素 `rayDir` / 相机几何）区分：
  - **天空像素**（无遮挡）：全流程 —— 大气底色 → 云 → 星空；
  - **地面像素**（有遮挡）：只返回大气颜色（`fog` 融合），**不执行 Ray-March**。
- 云颜色使用自身 Alpha 与大气底色顺序混合；星空在云之后绘制（云不遮挡星星或由云 Alpha 决定遮挡强度，见 §6）。

---

## 2. 渲染管线与混合顺序

```
renderSky(out RT_Color, in depthTex)
├─ 逐像素：rayDir = 根据相机矩阵与像素 UV 重建
├─ 天空判定：depth 为背景 → fullSky 路径
├─ fullSky:
│   ├─ vec3 skyColor = atmosphere(rayDir)            // §4
│   ├─ vec3 cloudAlbedo, float cloudAlpha
│   ├─ (cloudAlbedo, cloudAlpha) = raymarchClouds(...) // §5，仅高空仍执行
│   ├─ skyColor = mix(skyColor, cloudLighted, cloudAlpha) // 大气底色 ← 云（正向混合）
│   ├─ skyColor += stars(rayDir) * (1.0 - cloudAlpha*cloudOccludesStars) // 星空天体
│   └─ RT_Color = skyColor
├─ ground 遮挡:
│   ├─ skyColor = atmosphere(rayDir)                 // 大气底色
│   ├─ 与场景雾混合：skyColor = mix(skyColor, fogColor, fogFactor(worldPos))
│   └─ RT_Color = skyColor
└─ 后处理（引擎侧）：Bloom → 镜头光晕 → 色调映射
```

**性能防御开关**（由 CPU 依据相机高度/视角与质量档驱动）：
- `uScreenSkyRatio`：当天空在屏幕占比大（高空俯视）时动态调低最大步数（见 §5.4）。
- `uQualityPreset`：0 = 全质量，1 = 低配，2 = 移动端（见 §9）。

---

## 3. 离线预生成只读纹理

| 纹理 | 格式 | 尺寸 | 内存 | 内容 |
|---|---|---|---|---|
| `uTexBase` | RGBA8 (32bit) | 128³ | ~8.0 MB | Perlin-Worley 分频段噪声组合，构建云大轮廓（低/中/高频段存 R/G/B/A） |
| `uTexDetail` | RGB8 (24bit) | 32³ | ~0.09 MB | 高频 Worley 噪声，云边缘侵蚀细节 |
| `uTexCurl`  | RGB8 (24bit) | 128² | ~0.05 MB | Curl 噪声（卷曲扰动流场） |
| `uWeatherMap` | RGBA8 | 512² | ~1.0 MB | 天气控制贴图：R=coverage、G=cloudType、B=precipitation、A=密度变化 |
| 星星 | RGBA8 | 1024² | ~4.0 MB | 星空亮度贴图 + 噪声随机点；银河为独立 512² ~0.5 MB |
| 月亮相位 | RGBA8 | 256² | ~0.25 MB | 月相圆盘贴图（8 相线性插值） |

**合计：≈ 13.9 MB ≤ 15 MB** ✅（降级档可降至 < 6 MB，见 §9）

> **离线生成要点（伪代码，CPU 或烘焙工具）**
> ```
> for each texel(x,y,z) in 128³:
>     p = perlin(x,y,z)            // 大尺度形状
>     wLow  = worley(x,y,z, f1)
>     wHigh = worley(x,y,z, f2)
>     wMid  = remap(wLow, 1-wHigh01, 1, 0, 1)
>     base = p * 0.5 + (wMid + wHigh) * 0.5
>     // R=perlin, G=worley低频, B=worley高频扰动, A=wMid组合
> ```
> 生成工具建议直接生成 DDS/DXT5(BC3) 压缩版以进一步省显存（压缩后 Base ≈ 2.1 MB）。

---

## 4. GPU — 大气散射模块

> 二选一：**选项 A** 无 LUT 解析近似（低配默认）；**选项 B** 预计算 LUT 高质量模式。
> 两者统一输出：`skyColor(rayDir, sunDir)` —— 天空底色 + 太阳光晕 + 地平线色调，并输出 `fogFactor(worldPos)` 供地面融合。

### 4.1 选项 A：Bruneton 解析近似（无 LUT）

```glsl
//—— 输入（Uniform Block）——
uniform vec3 uSunDir;            // 单位方向（指向太阳）
uniform vec3 uSunColor;          // 太阳颜色（含色温）
uniform float uSunIntensity;     // 光晕强度
uniform float uAtmoDensity;      // 大气密度（臭氧主导色散控制）
uniform float uEarthRadius;      // 6.378e3 km
uniform float uAtmoHeight;       // 100 km
uniform vec3 uRayleighBeta;      // 瑞利散射系数(预计算: vec3(5.8e-6, 1.35e-5, 3.31e-5))
uniform float uMieBeta;          // 米氏散射系数(1.2e-6)
uniform float uMieG;             // 米氏HG不对称因子 ~0.79

float phaseRayleigh(float cosTheta) { return 3.0/(16.0*PI) * (1.0+cosTheta*cosTheta); }
float phaseMie(float cosTheta) {
    float g = uMieG, g2 = g*g;
    return 3.0/(8.0*PI) * ((1.0-g2)*(1.0+cosTheta*cosTheta))
           / ((2.0+g2)*pow(1.0+g2-2.0*g*cosTheta, 1.5));
}

// 解析光学厚度近似（沿射线积分到达大气层顶）
vec2 opticalDepth(vec3 rayOrigin, vec3 rayDir, float h, float cosZenith, inout float distToTop) {
    float r = uEarthRadius + h;
    float b = 2.0*dot(rayOrigin, rayDir) / r;       // 光线与大气几何
    float c = r*r - (uEarthRadius + uAtmoHeight)*(uEarthRadius + uAtmoHeight);
    float disc = b*b - 4.0*c;
    if (disc < 0.0) distToTop = 1e5; else distToTop = 0.5*(-b+sqrt(disc));
    // 指数大气近似：O(μ)=H_scale/cosθ*(1-exp(-dist/H_scale))
    float Hr = 8.0, Hm = 1.2;                        // 瑞利/米氏标高(km)
    float mu  = max(abs(cosZenith), 0.05);
    float O_r = Hr/mu * (1.0 - exp(-distToTop/Hr));
    float O_m = Hm/mu * (1.0 - exp(-distToTop/Hm));
    return vec2(O_r, O_m);
}

vec3 atmosphere(vec3 rd) {
    float cosTheta = clamp(dot(rd, uSunDir), -1.0, 1.0);
    float h = uAtmoHeight;                 // 相机在行星地表假设
    // 太阳方向：若视线穿过大气未被地面遮挡则计算，这里按全场景近似
    float cosSunZen = clamp(-dot(normalize(vec3(0,1,0)), uSunDir), 0.0, 1.0);
    vec2 O_sun = opticalDepth(vec3(0,uEarthRadius+0.002,0), uSunDir, 0.0, cosSunZen, /*dist*/_);
    vec2 O_view= opticalDepth(vec3(0,uEarthRadius+0.002,0), rd, 0.0, -rd.y, /*dist*/_);
    // 单次散射解析：
    vec3 T = exp(-(uRayleighBeta*O_sun.x + vec3(uMieBeta)*(O_sun.y + O_view.y)));
    vec3 rScatter = uRayleighBeta * phaseRayleigh(cosTheta) * T * (1.0 - exp(-O_view.x));
    vec3 mScatter = vec3(uMieBeta) * phaseMie(cosTheta) * T * (1.0 - exp(-O_view.y));
    vec3 sky = rScatter * uSunColor * uSunIntensity + mScatter * uSunColor;      // ×单位化系数省略
    // 地平线/天顶渐变修正（美术可控）：加入臭氧层青色与地平线变暖
    float up = clamp(rd.y, 0.0, 1.0);
    sky = mix(uHorizonColor, sky, pow(up, 0.6)) + uZenithTint * (1.0-up);
    return sky;
}
```

### 4.2 选项 B：预计算 Transmittance LUT(256×64) + MultiScatter LUT(32×32)

LUT 布局与采样参数（参照 Bruneton 2017 采样约定）：

```
Transmittance LUT : 采样参数 lo=(h∈[0, 60km], µ∈[0,1])  → 存储 T(r,µ)
MultiScatter LUT :  (µ, cosSunZen)  → 存储多级散射近似 E
```

```glsl
// 采样函数（高品质）：
vec3 sampleTransmittance(float h, float mu) {
    float u  = sqrt(clamp((h - ATMO_R) / (ATMO_TOP - ATMO_R), 0.0, 1.0)); // 高度非线性
    float v  = 0.5 + 0.5*asinh(mu) / asinh(1.0);
    return texture(uLutTrans, vec2(v, u)).rgb;
}
vec3 sampleMultiScatter(float mu, float cosSunZen) {
    return texture(uLutMulti, vec2(0.5+0.5*mu, cosSunZen*0.5+0.5)).rgb;
}
vec3 atmosphere(vec3 rd) {
    float mu = clamp(rd.y, -1.0, 1.0);             // 视线天顶角余弦
    float muS = clamp(dot(normalize(vec3(0,1,0)), uSunDir), -1.0, 1.0);
    // 1) 透射率
    vec3 trans = sampleTransmittance(ATMO_H, mu);
    // 2) 多级散射
    vec3 multi = sampleMultiScatter(mu, muS);
    // 3) 单次瑞利 + 米氏（相位 + LUT 加权，精确积分由 LUT 生成器离线完成）
    float phaseR = phaseRayleigh(dot(rd, uSunDir));
    float phaseM = phaseMie(dot(rd, uSunDir));
    vec3 single = uRayleighBeta*phaseR*vec3(1.0) + vec3(uMieBeta)*phaseM*vec3(1.0);
    vec3 radiance = single * trans
                  + multi * trans                      // 多级散射贡献
                  + sunDiskTerm(mu, muS) * uSunColor;  // 太阳圆盘光晕（紧凑HG）
    return radiance;
}
```

> 实现备注：Transmittance LUT 为 256×64、MultiScatter 32×32，合计 < 0.1 MB。混合在 CPU 侧根据 `uAtmoQuality` 判定切换。

---

## 5. GPU — 体积云模块（核心）

### 5.1 层级与常量

```
低层体积云(可Ray-March)   : 底 1500 m ~ 顶 4000 m（厚度 2500 m）
高层卷云(>4000 m)         : 滚动2D噪声贴图，不做光线步进（§5.6）
```

### 5.2 云密度函数 `cloudDensity`

```glsl
//---- 工具
float remap01(float x, float a, float b, float c, float d) {
    return c + clamp((x-a)/(b-a), 0.0, 1.0) * (d-c);
}
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }

//---- 高度归一化
float heightFraction(vec3 worldPos) {
    return clamp((worldPos.y - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM), 0.0, 1.0);
}

//---- 三套高度梯度（层云/积云/积雨云），由 cloudType 插值
float heightGradient(float hf, float cloudType) {
    // 各型的 (peakH, thinTopAmp, sharpTop) 三个控制：0层云(扁平,顶点低)
    float paramA = cloudType;                          // 0~2
    float peak   = mix(0.25, 0.55, smoothstep(0.0,2.0,paramA));   // 云型顶点位置
    float amp    = mix(0.85, 1.40, smoothstep(0.0,2.0,paramA));   // 顶部扩展
    float base   = 1.0 - smoothstep(0.05, peak, hf);             // 底部控制
    float top    = smoothstep(0.35, 1.0, hf*amp);                // 顶部包围
    return clamp(base * top + 0.15, 0.0, 1.0);                   // 保底厚度
}

//---- 主密度函数（两级LOD）
// lodMode: 0 = 低频(仅 Base，供空区大步长探测)
//          1 = 完整(含 Detail + Curl，供命中区小步长)
// 注意：函数内部不采样太阳方向，成本集中在 1 次 Base + 1 次 Detail(可选) + 1 次 Curl(可选)
float cloudDensity(vec3 wp,
                   vec2 windOffset,      // (windSpeed*time * windDir) * tilingFactor
                   float coverage,       // 全局区域覆盖率（0~1）
                   float cloudType,      // 0~2
                   int   lodMode)        // 0 / 1
{
    float hf   = heightFraction(wp);
    float hg   = heightGradient(hf, cloudType);

    //—— 1) 低频大轮廓
    vec3 baseUV = wp * uNoiseBaseScale + vec3(windOffset*0.4, 0.0);
    vec4 base = textureLod(uTexBase, baseUV, 0.0);            // LOD0 清晰采样
    float lowFreq = base.r;                                    // Perlin-Worley 大结构
    float wLow  = base.g;
    float wHigh = base.b;
    float baseCloud = remap01(lowFreq, 1.0 - coverage*hg, 1.0,  0.0, 1.0) * hg;
    baseCloud += wLow * 0.2;                                   // 微弱第二频段加厚

    if (lodMode == 0)
        return max(baseCloud, 0.0);                            // 空区：无 Detail，无 Curl

    //—— 2) 云底虚化（压低底部密度）
    float bottomFade = 1.0 - smoothstep(0.0, 0.06, hf);
    baseCloud = mix(baseCloud, baseCloud*0.35, bottomFade);

    //—— 3) Curl 扰动采样坐标（湍流侵蚀）
    vec2 curl = texture(uTexCurl, (wp.xz * uNoiseCurlScale + windOffset*1.5) - floor(wp.xz*uNoiseCurlScale + windOffset*1.5)).xy;
    curl = curl * 2.0 - 1.0;                                  // 归一化 [-1,1]
    vec3 perturb = vec3(curl, 0.0) * uNoiseCurlAmplitude;

    //—— 4) 高频 Detail 侵蚀
    vec3 detailUV = wp * uNoiseDetailScale + perturb / uNoiseDetailScale;
    vec4 detail = texture(uTexDetail, detailUV);
    float erosion = detail.r;                                  // Worley 高频
    float finalDen = remap01(baseCloud, 1.0 - erosion*uNoiseDetailStrength, 1.0, 0.0, 1.0);

    return max(finalDen, 0.0);
}
```

### 5.3 云光照模型 `cloudLighting`

```glsl
// Henyey-Greenstein 双瓣相位（前向+后向，用于白天/雨天不同形态）
float HGPhase(float cosTheta, float g) {
    float g2=g*g, a = 1.0+g2-2.0*g*cosTheta;
    return (1.0-g2) / (pow(a, 1.5) * 4.0*PI);
}

// Beer-Lambert 光衰减；HG 相位；Powder 糖粉经验效应
// 降水>0 时吸收系数增大 → 雨云变暗
vec3 cloudLighting(vec3 samplePos,
                   float density,
                   vec2  windOffset,
                   float coverage, float cloudType,
                   vec3  lightDir,   // 太阳/月亮方向统一入口
                   vec3  lightColor,
                   float absorption, // 吸收系数 r（受降水调节）
                   float g)          // HG 不对称因子
{
    // (a) Beer-Lambert：向光方向锥形 6 次加权采样（替代逐点太阳全 RayMarch）
    float sumDensity = 0.0;
    float stepBase = 120.0;             // 首采样距离(m)，随锥形半径同步扩大
    float stepInc  = 160.0;
    vec3  sunSampDir = lightDir;
    for (int i=0; i<6; ++i) {
        float d = stepBase + float(i)*stepInc;
        vec3 o = sunSampDir * d;
        // 锥形张开：半径随距离线性增大，两次垂直于光轴的随机方向展开
        float cone = 12.0 + 38.0 * float(i);                 // 锥半径(m)
        vec2  perp = vec2(cos(float(i)*7.31), sin(float(i)*7.31)) * cone;
        vec3  off  = normalize(cross(sunSampDir, vec3(0.0,1.0,0.0))) * perp.x
                   + normalize(cross(sunSampDir, vec3(1.0,0.0,0.0))) * perp.y;
        float lightDen = cloudDensity(samplePos + o + off, windOffset, coverage, cloudType, 1);
        sumDensity += lightDen;
    }
    vec3 transmittance = exp(-absorption * sumDensity * stepInc);   // Beer-Lambert: T=exp(-∫σdt)

    // (b) HG 相位（逆光金边）：cosθ = dot(viewDir, lightDir)
    float cosTheta = dot(normalize(-uCameraPos + samplePos), lightDir);
    float phase = mix(HGPhase(cosTheta, g), HGPhase(cosTheta, -0.2), 0.1);  // 双瓣混合

    // (c) Powder 糖粉效应（云凸起边缘暗化系数直观控制）
    float powder = 1.0 + uLightPowder * exp(-density * 2.0);

    vec3 energy = lightColor * transmittance * phase * powder;
    // 环境补光（减少全黑），雨天对切向光降低
    energy += uLightAmbient * vec3(0.3, 0.35, 0.42) * (1.0 - transmittance*0.5);
    return energy;
}

// 统一入口：月亮光照复用同一公式，仅降低亮度
vec3 cloudSunLighting(...) { return cloudLighting(..., uSunDir, uSunColor, uCloudAbsorption, uCloudG); }
vec3 cloudMoonLighting(...) { return cloudLighting(..., uMoonDir, uMoonColor * 0.12 * (1.0-moonPhaseShadow), uMoonAbsorption, uMoonG); }
```

### 5.4 两级 LOD Ray-March 主循环（核心）

```glsl
struct RayMarchResult { vec3 color; float alpha; };

RayMarchResult raymarchClouds(vec3 ro, vec3 rd, vec2 windOffset,
                              float coverage, float cloudType)
{
    RayMarchResult out; out.color = vec3(0.0); out.alpha = 0.0;

    // (1) 计算射线与云层球壳/盒的交点 [t0,t1]
    float t0 = (CLOUD_BOTTOM - ro.y) / rd.y;
    float t1 = (CLOUD_TOP    - ro.y) / rd.y;
    if (t0 > t1) { float tmp=t0; t0=t1; t1=tmp; }
    if (t1 < 0.0) return out;
    t0 = max(t0, 0.0);

    // (2) 视角相关动态步数上限
    float viewUp = clamp(dot(rd, vec3(0,1,0)), 0.0, 1.0);     // 1=头顶
    int   maxSteps = int(mix(uMaxStepsHorizon, uMaxStepsTop, pow(viewUp, 0.8)));
    // 高空俯视性能防御：天空大面积 → 直接减半
    maxSteps = int(maxSteps * (1.0 - uSkyRatioPenalty)); // uSkyRatioPenalty∈[0,0.5] CPU算好

    // (3) 屏幕空间微小抖动（缓解 RayMarch 带状伪影；代价<一次哈希）
    float jitter = hash21(gl_FragCoord.xy + float(uFrame) * 17.0);
    t0 += jitter * 90.0;   // 抖动幅度 ≤ 大步长

    // (4) 两级 LOD 主循环
    const float STEP_BIG   = 500.0;   // 空区大步（仅低频）
    const float STEP_SMALL = 64.0;    // 命中区小步（完整光照）
    const float DENSITY_BIAS = 0.02;  // 判 "命中" 阈值

    float t  = t0;
    float step = STEP_BIG;
    bool  inCloud = false;
    int   emptyStreak = 0;
    float totalTransmittance = 1.0;

    for (int i=0; i<maxSteps; ++i)
    {
        // ⛔ 提前终止：累积 Alpha≈1（视觉不透）或射线离开云层边界
        if (out.alpha >= 0.99f || t > t1 - 0.5) break;

        vec3 pos = ro + rd * t;

        // —— 阶段一（LOD0）：空区域大步，仅 Base 低频
        float densLow = cloudDensity(pos, windOffset, coverage, cloudType, 0);
        if (densLow <= DENSITY_BIAS) {
            // 连续 N 次为空 → 切回大步长
            if (inCloud) {
                if (++emptyStreak > 2) { inCloud=false; step=STEP_BIG; emptyStreak=0; }
            }
            t += step;
            continue;
        }

        // —— 命中云等值面 → 回退一小步，切换 LOD1
        if (!inCloud) {
            inCloud = true;
            emptyStreak = 0;
            t -= step;            // 回退上一步，重新精细采样
            step = STEP_SMALL;
            continue;
        }

        // —— 阶段二（LOD1）：完整密度 + 光照
        float dens = cloudDensity(pos, windOffset, coverage, cloudType, 1);
        if (dens > DENSITY_BIAS) {
            vec3 lightEnergy = cloudSunLighting(pos, dens, windOffset, coverage, cloudType);
            lightEnergy += cloudMoonLighting(pos, dens, windOffset, coverage, cloudType);

            // 前后向合成（front-to-back）
            float alpha_i = 1.0 - exp(-uCloudExtinction * dens * step);
            out.color    += lightEnergy * alpha_i * totalTransmittance;
            out.alpha    += alpha_i * (1.0 - out.alpha);
            totalTransmittance *= exp(-uCloudExtinction * dens * step);
            emptyStreak = 0;
        } else {
            // 连续多次 density=0 → 切回大步长
            if (++emptyStreak > 3) { inCloud=false; step=STEP_BIG; emptyStreak=0; }
        }
        t += step;
    }
    return out;
}
```

### 5.5 光照锥形采样示意

```
        太阳光方向 ────────────▶
                  ╱  ╲
           射线  ╱      ╲     每步采样点随距离张开锥形（cone）
                ●──●──●──●   带横向扰动，6 次求平均光学厚度
  命中点（小步长区域）
```

### 5.6 高层卷云（>4000 m，滚动 2D 噪声，不做光线步进）

```glsl
vec3 cirrus(vec3 rd, vec2 windOffset, float daylight) {
    // 向地平线方向取 2D 投影坐标
    vec2 uv = rd.xz / (rd.y + 0.2) * 0.5 + 0.5;    // 平面投影近似
    uv += windOffset * uCirrusWindFactor;
    float n1 = texture(uTexCirrus, uv * 2.0).r;
    float n2 = texture(uTexCirrus, uv * 4.0 + 0.3).r;
    float dens = remap01(n1, 1.0-uCirrusAmount, 1.0, 0.0, 1.0) * 0.6
               + remap01(n2, 0.5, 1.0, 0.0, 0.4);
    // 漫射光照近似（不做RayMarch）：简化 HG*exp
    float cosTheta = dot(rd, uSunDir);
    float illum = HGPhase(cosTheta, 0.35) * uCirrusBrightness * daylight;
    return dens * uCirrusColor * illum * float(rd.y > 0.02);  // 仅视角向上部分
}
```

---

## 6. GPU — 星空天体模块

```glsl
// 星星：2D星空纹理 + 噪声随机点，随时间旋转，dayFactor 白天淡出
vec4 stars(vec3 rd) {
    vec3 dir = rotate(rd, uStarRotationAxis, uStarRotationAngle); // 仿真天球自转
    vec2 uv = dir.xz / (abs(dir.y) + 0.35) * 0.4 + 0.5;
    float star = texture(uTexStars, uv).r;

    // 噪声随机点补充（避免单纹理重复感）
    vec2 g = floor(uv * 96.0);
    vec2 f = fract(uv * 96.0);
    float rnd = hash21(g);
    float point = smoothstep(0.985, 1.0, rnd) * smoothstep(0.5, 1.0, abs(f.x-0.5) + abs(f.y-0.5));
    point *= step(0.992, hash21(g+7.0));       // 稀疏剔除
    star += point * 0.8;

    // 银河（独立纹理，仅夜间可见）
    float milky = texture(uTexMilky, dir.xz*0.5+0.5).r * uMilkyIntensity;

    vec3 col = vec3(star)*starColor + milky*vec3(0.75,0.78,0.95);
    float nightMask = uNightFactor;            // 白天淡出
    return vec4(col * nightMask, nightMask);
}

// 月亮：月相纹理 + 输出月亮光源方向（已由CPU上传 uMoonDir）
vec3 moon(vec3 rd) {
    float disk = smoothstep(0.995, 0.998, dot(rd, uMoonDir));
    float phase = moonPhaseFactor(uMoonPhase);           // CPU传入，0=新月…1=满月
    vec3 col = uMoonColor * disk * clamp(phase*1.5, 0.0, 1.0);
    return col * uNightFactor;
}
```

---

## 7. CPU — 天文时间模块

> 输入 `dayTime ∈ [0,1]`（0=子夜, 0.5=正午）。输出 sunDir / moonDir / moonPhase / 太阳天顶角 / dayFactor / nightFactor。
> 提供两套算法：`AstroSimpleSphere`（快速）、`AstroNOAA`（高精度）。

```js
// —— 伪代码（TypeScript 风格）——
class Astronomy {
  latitude; longitude; timezone;   // 观测点 + 时区
  algorithm = 'noaa';               // 'simple' | 'noaa'

  // 主入口：dayTime → 天空状态
  compute(dayTime) {
    // 1. 太阳高度角（两套算法任取）
    let alt, az;
    if (this.algorithm === 'noaa') {
      const s = noaaSunPosition(dayTime, this.latitude, this.longitude, this.timezone);
      alt = s.altitude; az = s.azimuth;
    } else {
      // 简化球面模型：太阳沿天球大圆运动
      const hourAngle = (dayTime * 24 - 12) * 15 * DEG2RAD;  // -180°..+180°
      const decl = Math.sin(dayTime * 2 * Math.PI - Math.PI / 2) * 23.44 * DEG2RAD; // 季节
      alt = Math.asin(Math.sin(this.latitude*DEG2RAD) * Math.sin(decl)
                    + Math.cos(this.latitude*DEG2RAD) * Math.cos(decl) * Math.cos(hourAngle));
      az  = Math.atan2(Math.cos(decl) * Math.sin(hourAngle),
                       Math.cos(this.latitude*DEG2RAD) * Math.sin(decl)
                       - Math.sin(this.latitude*DEG2RAD) * Math.cos(decl) * Math.cos(hourAngle)) + Math.PI;
    }

    // 2. 太阳方向 (HD→XYZ)
    this.sunDir = dirFromHorizon(alt, az);
    this.sunZenith = Math.PI/2 - alt;                     // 天顶角

    // 3. 月亮（简化：基于 dayTime 偏移相位）
    const moonOffset = 6.0 / 24.0;                        // 月亮滞后太阳 6h 近似
    const moonHour = (dayTime + moonOffset) % 1.0;
    this.moonDir = dirFromHorizon(moonAltitude(moonHour, this.latitude), moonAzimuth(moonHour));
    this.moonPhase = phaseFromElongation(Math.abs(dayTime - 0.5) * 2.0); // 0新月→1满月

    // 4. 昼夜混合系数（平滑过渡）
    const cosZenith = this.sunDir.y;
    const t = cosZenith;
    this.dayFactor   = smoothstep(-0.15, 0.35, t);        // 白天 0.35 以上全亮
    this.nightFactor = smoothstep(0.10, -0.25, t);        // 夜晚 < -0.25 全夜
    return this.snapshot();
  }
}

// 高精度 NOAA 算法（实现可引标准 NOAA sun 公式，此处给出接口占位）
function noaaSunPosition(dayTime, lat, lon, tz) {
  // NOAA 太阳算法：儒略日 → 太阳赤纬/时角 → 高度角与方位角
  // jd = jdFromDate(Date.now()); fractionalYear = 2π*(dayOfYear-1)/365;
  // eqTime = 229.18*(0.000075 + 0.001868*cos(B) - 0.032077*sin(B) - 0.014615*cos(2B) - 0.040849*sin(2B));
  // decl = 0.006918 - 0.399912*cos(B) + 0.070257*sin(B) - 0.006758*cos(2B) + 0.000907*sin(2B) − ...;
  // trueSolarTime = ( (hour*60 + min + sec/60) + eqTime + 4*lon - 60*tz ) min; …
  // 上方向、高度角公式同 §简单模型
  return { altitude: 0, azimuth: 0 };
}
```

---

## 8. CPU — 天气管理模块

```js
// —— 伪代码 ——
enum WeatherType { CLEAR, CLOUDY, OVERCAST, STORM }   // 晴天 多云 阴天 暴雨

class WeatherManager {
  // —— 状态变量 ——
  state = { coverage: 0.3, cloudType: 1.2, precipitation: 0.0,
            windSpeed: 0.3, windDir: [1, 0] };
  target = { ...this.state };          // 插值目标（无跳变）
  preset = {
    CLEAR:   { coverage: 0.05, cloudType: 0.4, precipitation: 0.0, windSpeed: 0.2 },
    CLOUDY:  { coverage: 0.55, cloudType: 1.4, precipitation: 0.0, windSpeed: 0.4 },
    OVERCAST:{ coverage: 0.85, cloudType: 1.0, precipitation: 0.1, windSpeed: 0.5 },
    STORM:   { coverage: 0.95, cloudType: 2.0, precipitation: 0.9, windSpeed: 0.9 },
  };

  // —— API ——
  setWeather(type, transitionSec)  { this.target = {...this.preset[type]}; this.blendSec = transitionSec; }
  override(coverage?, cloudType?, precipitation?, windSpeed?, windDir?) { /**
    // 直接覆写全部参数，立即生效，可配合过场动画
    */ }
  setControlTexture(tex) { this.controlTexture = tex; /* 过场动画用控制贴图驱动天气信号 */ }

  // —— 每帧更新 ——
  update(dt) {
    // 1. 目标平滑插值（无跳变）
    const k = 1 - Math.exp((-dt / this.blendSec));
    this.state.coverage     = lerp(this.state.coverage,     this.target.coverage,     k);
    this.state.cloudType    = lerp(this.state.cloudType,    this.target.cloudType,    k);
    this.state.precipitation= lerp(this.state.precipitation,this.target.precipitation,k);
    this.state.windSpeed    = lerp(this.state.windSpeed,    this.target.windSpeed,    k);
    this.state.windDir      = normalize(nlerp(this.state.windDir, this.target.windDir, k));

    // 2. 内置缓慢随机漂移模拟（目标附近 ±0.05 徘徊，周期 ~120s）
    if (Math.random() < dt/120.0)
      this.state.coverage = clamp(0.9*this.state.target.coverage +
                                 0.2*this.target.coverage + (Math.random()-0.5)*0.1, 0, 1);

    // 3. 控制贴图驱动（过场动画模式）
    //    采样 uWeatherMap：coverage *= tex.r; cloudType += tex.g; precipitation *= tex.b
    if (this.controlTexture)
      this.controlSignals = sampleWeatherTex(this.controlTexture, this.t);

    // 上传 GPU 常量缓冲
    this.uploadUniformBlock({ ...this.state, windDir: this.state.windDir,
                              windOffset: this.windOffset += this.windSpeed*dt });
  }
}
```

---

## 9. 美术参数面板

> 全部可运行时修改，立即生效；性能降级开关即时驱动 §5.4 行为变化。

| 分组 | 参数 | 类型 | 范围 | 默认 | 说明 |
|---|---|---|---|---|---|
| **时间** | `dayTime` | float | [0,1] | 0.35 | 归一化时刻 |
| | `latitude / longitude / timezone` | float | — | 30 / 120 / 8 | 天文模型观测点 |
| | `astronomyAlgo` | enum | simple/noaa | simple | 简化/高精度切换 |
| **大气** | `sunColor` | color3 | — | (1,0.93,0.85) | 太阳色温 |
| | `sunIntensity` | float | [0,5] | 1.2 | 光晕强度 |
| | `horizonColor` | color3 | — | (0.85,0.68,0.55) | 地平线暖色调 |
| | `zenithTint` | color3 | — | (0.15,0.3,0.6) | 天顶青色调 |
| | `fogDensity` | float | [0,1] | 0.12 | 地面雾密度 |
| | `atmoQuality` | enum | A/B | A | 选项A解析 / 选项B LUT |
| **云全局** | `cloudLayerBottom/Top` | float | m | 1500/4000 | 云层高度范围 |
| | `cloudCoverage` | float | [0,1] | 0.55 | 覆盖率（乘贴图R） |
| | `cloudType` | float | [0,2] | 1.2 | 0层云/1积云/2积雨云（贴图G偏移） |
| | `precipitation` | float | [0,1] | 0.0 | 降水（吸收系数倍增，雨云变暗） |
| | `windSpeed` / `windDir` | float/vec2 | [0,1] | 0.3 / (1,0) | 风速风向 |
| | `cirrusAmount/Brightness` | float | [0,1] | 0.4 / 0.6 | 卷云量/亮度 |
| **云光照** | `cloudAbsorption` | float | [0,3] | 1.6 | Beer-Lambert 吸收系数 r |
| | `cloudG` | float | [-1,1] | 0.42 | HG 不对称因子（逆光金边） |
| | `lightPowder` | float | [0,2] | 1.0 | Powder 糖粉效果强度 |
| | `lightAmbient` | float | [0,1] | 0.25 | 环境补光 |
| | `moonAbsorption / moonG` | float | — | 1.2 / 0.3 | 月亮光照复用参数 |
| | `moonBrightness` | float | [0,1] | 0.12 | 月照亮度 |
| **云噪声** | `noiseBaseScale` | float | — | 0.00038 | Base 3D 噪声采样尺度 |
| | `noiseDetailScale` | float | — | 0.0016 | Detail 高频尺度 |
| | `noiseDetailStrength` | float | [0,1] | 0.65 | Detail 侵蚀强度 |
| | `noiseCurlScale/Amp` | float | — | 0.0006 / 60 | Curl 扰动尺度/幅度 |
| **天气** | `weatherPreset` | enum | 4 种 | CLOUDY | 天气枚举快捷按钮 |
| | `transitionSec` | float | [0,120] | 8 | 过渡平滑时间 |
| | `randomDrift` | bool | — | on | 缓慢随机漂移 |
| | `controlTexturePath` | path | — | — | 过场动画控制贴图 |
| **性能降级** | `disablePowder` | bool | — | off | 关闭 Powder 效果 |
| | `halfMaxSteps` | bool | — | off | 最大步数减半 |
| | `lower3DTexRes` | bool | — | off | Base 128³→64³(+8x渲小近似) |
| | `singleLightSample` | bool | — | off | 太阳锥形6次→1次 |
| | `halfResCloud` | bool | — | off | 半分辨率云渲染+上采样 |

**降级档预期（QualPreset）**

| 档位 | 开启项 | 云耗时 | 显存 |
|---|---|---|---|
| Quality 0（全质量） | 无 | 1.8~2.0 ms | 13.9 MB |
| Quality 1（低配） | disablePowder + halfMaxSteps | 1.2~1.4 ms | 13.9 MB |
| Quality 2（移动端） | + lower3DTexRes + singleLightSample + halfResCloud | 0.6~0.9 ms | < 6 MB |

---

## 10. 性能预算验收表

**硬指标（目标平台 GTX1660 / RTX3050，1080p）：**

| 项 | 预算 | 备注 |
|---|---|---|
| 体积云 GPU 耗时（多云工况） | **1.4 ~ 2.0 ms** | 全质量档 |
| 大气散射 | ≤ 0.15 ms | 选项 A 解析无 LUT；B 仅 2 次 LUT 采样 |
| 星空天体 | ≤ 0.05 ms | 星星+银河+月亮 |
| 全屏天空合成（含混合 + fog） | ≤ 0.3 ms | 逐像素分支极低 |
| 纹理总内存 | **≤ 15 MB** | 见 §3 清单 ≈13.9MB |
| Ground 像素耗时 | ≈0 | 仅大气色 + 雾，不 Ray-March |
| 头顶视角最大步数 | 64 | §5.4 |
| 地平线视角最大步数 | 128 | §5.4 |
| 命中云平均步数 | 20~40 | LOD1 区域占比 < 30% |

**验收方法与项：**
1. FrameCapture 统计云 Pass 独立计时，多云（coverage=0.55）中框，要求 1.4~2.0ms。
2. 高空俯视场景（飞机的极端视角）：要求基于 §5.4 的 `uSkyRatioPenalty` 行动态降步，云耗时 ≤ 0.8ms。
3. 显存通过 GPU 内存监听验证 ≤ 15MB（含所有纹理 + LUT）。
4. 各降级档逐一关闭渲染验证视觉损失可接受（见 §9 表）。
5. 移动/低配档跑通 30fps（云 ≤ 1ms）。

---

## 11. 硬性约束落实对照表

| 约束 | 落实位置 | 状态 |
|---|---|---|
| 禁止所有像素固定最大步数 → 动态步数（头顶64 / 地平线128 / 俯视减半） | §5.4 `maxSteps` 动态计算 | ✅ |
| 禁止每步进点向太阳完整 Ray-March → 锥形 6 次采样加权近似 | §5.3 `cloudLighting` | ✅ |
| 禁止关闭 Alpha 提前终止 | §5.4 `if (out.alpha >= 0.99f) break` | ✅ |
| 不实现流体动力学（无动力学消散/生长） | 全系统仅参数插值 + 贴图驱动 | ✅ |
| 本版不做云投射地面实时光影（可选扩展） | §12 扩展列表 | ✅ |
| Shader 减少 3D 纹理采样次数 | 空区仅 1 次 Base（LOD0），命中区 Base+Detail+Curl | ✅ |
| 屏幕微小抖动缓解带状伪影 | §5.4 步骤(3) `jitter` | ✅ |
| 高空俯视动态降低最大步数（性能防御） | §5.4 `uSkyRatioPenalty` | ✅ |

---

## 12. 集成 / 扩展备注

- **引擎集成**：以单个 `sky.frag` 全屏 postPass 为加载入口，需要引擎提供：相机矩阵、深度纹理、全局帧号、一名 UniformBlock 更新回调（`updateSkyUniforms(state)`）。
- **可选扩展（本版不实现）**：
  - 云对地面投射实时阴影（Shadow Map 投影到云层）；
  - 双层云弹射光照（多长大步数云质量档）；
  - 屏幕空间折射云（降雨低空）。
- 资源加载：DDS 直读 + mipmap 默认生成，压缩版利于低配。
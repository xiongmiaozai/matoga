# 视差贴图完全学习笔记 (Parallax Mapping Mastery)

> 本文档整合自 LearnOpenGL（中/英）、Wikipedia（Parallax Mapping / POM / Relief Mapping）及 GPU Gems 3 等资料，系统梳理视差贴图技术族的历史、数学原理、算法实现、对比与工程实践。

---

## 目录

1. [历史与背景](#1-历史与背景)
2. [前置知识](#2-前置知识)
3. [数学原理](#3-数学原理)
4. [算法族谱系](#4-算法族谱系)
5. [算法一：基础视差贴图](#5-算法一基础视差贴图)
6. [算法二：带偏移量限制的视差贴图](#6-算法二带偏移量限制的视差贴图)
7. [算法三：陡峭视差映射](#7-算法三陡峭视差映射)
8. [算法四：视差遮蔽映射 (POM)](#8-算法四视差遮蔽映射-pom)
9. [算法五：Relief Parallax Mapping](#9-算法五relief-parallax-mapping)
10. [高级变体](#10-高级变体)
11. [完整着色器代码](#11-完整着色器代码)
12. [工程实践与优化](#12-工程实践与优化)
13. [算法对比总结](#13-算法对比总结)
14. [参考文献](#14-参考文献)

---

## 1. 历史与背景

| 年份 | 事件 | 人物/来源 |
|------|------|-----------|
| 2000 | Relief texture mapping 首次提出 | Oliveira, Bishop, McAllister (SIGGRAPH 2000) |
| 2001 | **视差贴图 (Parallax Mapping)** 首次提出 | Tomomichi Kaneko et al. (ICAT 2001) |
| 2005 | **视差遮蔽映射 (POM)** 发表 | Zoe Brawley, Natalya Tatarchuk (ShaderX3) |
| 2005 | Relief mapping GPU 实时实现 | Policarpo, Oliveira, Comba (I3D 2005) |
| 2005 | ATI Toy Shop Demo 使用 POM 展示 Radeon X1800 | ATI/AMD |
| 2006 | Relief mapping 多层扩展（非高度场） | Policarpo, Oliveira (SI3D 2006) |
| 2007 | Prism POM 精确轮廓生成 | Dachsbacher, Tatarchuk (SI3D 2007) |
| 2007 | Relaxed Cone Stepping | Policarpo, Oliveira (GPU Gems 3 Ch.18) |

**别名**：视差贴图也被称为 *offset mapping* 或 *virtual displacement mapping*。

**工业应用**：Unigine、CryEngine 2/3、Unreal Engine 4 等引擎均采用 POM。

---

## 2. 前置知识

### 2.1 切线空间 (Tangent Space)

视差贴图在**切线空间**中实现，原因：当表面被任意旋转后，世界空间难以确定纹理坐标偏移方向。切线空间的 x/y 轴始终与纹理表面对齐（切线 T 和副切线 B），z 轴为法线 N。

**TBN 矩阵**构建：
```
T = normalize(mat3(model) * tangent)
B = normalize(mat3(model) * bitangent)
N = normalize(mat3(model) * normal)
TBN = transpose(mat3(T, B, N))   // 正交化
```

### 2.2 高度贴图 vs 深度贴图

- **高度贴图 (Height Map)**：亮=高，暗=低
- **深度贴图 (Depth Map)**：高度贴图的反色，亮=浅，暗=深。模拟深度比模拟高度更直观。

转换关系：`depth = 1.0 - height`

### 2.3 与法线贴图的关系

视差贴图**与光照无关**，但通常与法线贴图联用。法线贴图根据高度贴图生成，二者联用可保证光照与位移匹配，否则视差产生的深度幻觉会被错误光照破坏。

---

## 3. 数学原理

### 3.1 核心问题

给定平面上的 fragment 位置 B（实际渲染点），求真实位移后观察者应看到的位置 A 的纹理坐标。

```
观察者 → B（平面上的接触点）
         ↓ 需要找到 A 的纹理坐标
         A（位移后表面的真实点）
```

### 3.2 基本公式

将 fragment 到观察者的方向向量 V（切线空间）按高度缩放，得到偏移向量 P：

```
P = V.xy / V.z * (H(B) * height_scale)
T_A = T_B - P
```

其中：
- `V` = 切线空间中归一化的观察方向
- `H(B)` = 深度贴图在 B 处的采样值
- `height_scale` = 全局缩放参数（控制视差强度，通常 0.1）
- `T_B` = 原始纹理坐标
- `T_A` = 位移后纹理坐标

### 3.3 为什么除以 V.z？

V 归一化后，`V.z ∈ [0, 1]`：
- **垂直看向表面**：V.z ≈ 1，P 较小，位移小（正视时视差本就不明显）
- **斜看向表面**：V.z ≈ 0，P 放大，位移大（斜视时视差最明显）

这符合真实视差物理特性：越斜看，视差越大。

### 3.4 近似的本质

基础视差贴图是**单步近似**——假设表面高度在 B 附近变化不大。当高度变化剧烈时，P 不会接近真实交点 A，产生失真。这是后续算法改进的出发点。

---

## 4. 算法族谱系

```
位移贴图 (Displacement Mapping) —— 真实移动顶点，需要高网格密度
    │
    └─ 视差贴图族 (不移动顶点，欺骗眼睛)
        │
        ├─ 基础视差贴图 (Parallax Mapping) [Kaneko 2001]
        │   └─ 带偏移量限制 (Offset Limiting) —— 不除以 V.z
        │
        ├─ 陡峭视差映射 (Steep Parallax Mapping) —— 多层采样
        │   │
        │   ├─ 视差遮蔽映射 (POM) [Tatarchuk 2005] —— 层间线性插值
        │   │   └─ Prism POM [Dachsbacher 2007] —— 精确轮廓
        │   │
        │   └─ Relief Parallax Mapping —— 二分搜索精化
        │       └─ Interval Mapping —— 射线-直线交点替代中点
        │
        └─ Cone Step Mapping —— 预计算锥图加速
            └─ Relaxed Cone Stepping [GPU Gems 3] —— 锥步进+二分精化
```

---

## 5. 算法一：基础视差贴图

**原理**：单次采样，直接用 B 处高度计算偏移。

```glsl
vec2 ParallaxMapping(vec2 texCoords, vec3 viewDir)
{
    float height = texture(depthMap, texCoords).r;
    vec2 p = viewDir.xy / viewDir.z * (height * height_scale);
    return texCoords - p;
}
```

**优点**：极快，仅 1 次额外纹理采样。
**缺点**：高度变化剧烈时失真严重；斜视角度下结果不正确。
**适用**：平缓高度变化、性能敏感场景。

---

## 6. 算法二：带偏移量限制的视差贴图

**原理**：去掉除以 `V.z`，避免斜视时偏移过大。

```glsl
vec2 ParallaxMapping(vec2 texCoords, vec3 viewDir)
{
    float height = texture(depthMap, texCoords).r;
    vec2 p = viewDir.xy * (height * height_scale);  // 不除以 viewDir.z
    return texCoords - p;
}
```

**区别**：斜视时偏移不会放大，减少了角度伪影，但牺牲了部分真实感。选择哪种是个人偏好问题。

---

## 7. 算法三：陡峭视差映射

**原理**：将深度范围 [0,1] 均分为 N 层，沿 P 方向逐层采样，直到某层深度 > 深度贴图值（进入表面下方）。

```
层0 (depth=0.0) ──────── 采样 D(0)
层1 (depth=0.1) ──────── 采样 D(1)
层2 (depth=0.2) ──────── 采样 D(2)=0.73 > 0.2? 否，继续
层3 (depth=0.3) ──────── 采样 D(3)=0.37 > 0.3? 是！交点在第2~3层间
```

```glsl
vec2 ParallaxMapping(vec2 texCoords, vec3 viewDir)
{
    const float numLayers = 10;
    float layerDepth = 1.0 / numLayers;
    float currentLayerDepth = 0.0;
    vec2 P = viewDir.xy * height_scale;
    vec2 deltaTexCoords = P / numLayers;

    vec2  currentTexCoords     = texCoords;
    float currentDepthMapValue = texture(depthMap, currentTexCoords).r;

    while(currentLayerDepth < currentDepthMapValue)
    {
        currentTexCoords     -= deltaTexCoords;
        currentDepthMapValue  = texture(depthMap, currentTexCoords).r;
        currentLayerDepth    += layerDepth;
    }
    return currentTexCoords;
}
```

### 自适应层数优化

垂直看时位移小，用少层；斜看时位移大，用多层：

```glsl
const float minLayers = 8.0;
const float maxLayers = 32.0;
float numLayers = mix(maxLayers, minLayers, max(dot(vec3(0.0,0.0,1.0), viewDir), 0.0));
```

**优点**：陡峭高度下结果大幅改善。
**缺点**：层数有限导致**锯齿**和**层间断层**可见。

---

## 8. 算法四：视差遮蔽映射 (POM)

**原理**：在陡峭视差映射找到交点层后，对交点前后两层纹理坐标做**线性插值**，消除断层。

```
        prevLayer (before collision)
            ╲
             ╲ ← 线性插值
              ● ← 真实交点（近似）
             ╱
            ╱
        currentLayer (after collision)
```

```glsl
// ... 陡峭视差映射代码（while循环结束后）...

// 碰撞前纹理坐标（反向一步）
vec2 prevTexCoords = currentTexCoords + deltaTexCoords;

// 碰撞前后深度差（用于插值权重）
float afterDepth  = currentDepthMapValue - currentLayerDepth;
float beforeDepth = texture(depthMap, prevTexCoords).r - currentLayerDepth + layerDepth;

// 线性插值
float weight = afterDepth / (afterDepth - beforeDepth);
vec2 finalTexCoords = prevTexCoords * weight + currentTexCoords * (1.0 - weight);

return finalTexCoords;
```

**优点**：效果接近 Relief Mapping，但更高效；轻微伪影仅在极端放大或极陡角度下可见。
**缺点**：标准 POM **不改变底层网格轮廓**（silhouette 不变）——后续 Prism POM 解决此问题。
**工业应用**：CryEngine 2/3、Unreal Engine 4、Unigine。

---

## 9. 算法五：Relief Parallax Mapping

**原理**：在陡峭视差映射找到交点层后，用**二分搜索 (Binary Search)** 在前后两层间精化交点，而非线性插值。

```glsl
// ... 陡峭视差映射代码（while循环结束后）...

// 二分搜索精化（通常 5 次迭代足够）
vec2 deltaBinaryTexCoords = deltaTexCoords;
for(int i = 0; i < 5; ++i)
{
    deltaBinaryTexCoords *= 0.5;
    float sampledDepth = texture(depthMap, currentTexCoords).r;
    if(currentLayerDepth < sampledDepth)
    {
        currentTexCoords += deltaBinaryTexCoords;
        currentLayerDepth += ...; // 相应调整
    }
    else
    {
        currentTexCoords -= deltaBinaryTexCoords;
        currentLayerDepth -= ...;
    }
}
return currentTexCoords;
```

**与 POM 的区别**：
- POM：线性插值（1 步）—— 快但近似
- Relief：二分搜索（~5 步）—— 慢但精确

> **注意**：Wikipedia 指出 Relief Mapping 和 POM 都依赖 ray marching，但 POM 使用**反向高度图追踪**，二者不应混淆。

---

## 10. 高级变体

### 10.1 Interval Mapping

改进 Relief Mapping 的二分搜索：不取中点，而是用已知内外两点的连线与射线的交点作为下一个采样点，收敛更快。

### 10.2 Cone Step Mapping

预计算**锥图 (Cone Map)**：每个纹素存储一个锥角，指示射线可以安全跳跃多远而不穿过表面。加速射线-高度场求交，减少采样次数。

### 10.3 Relaxed Cone Stepping (GPU Gems 3 Ch.18)

锥步进 + 二分搜索精化的混合方案。先大步跳跃快速接近交点，再二分精化。兼顾速度与精度。

### 10.4 Prism POM

Dachsbacher & Tatarchuk (SI3D 2007) 提出，解决标准 POM 轮廓不准确的问题，实现精确的物体轮廓渲染。

---

## 11. 完整着色器代码

### 11.1 顶点着色器

```glsl
#version 330 core
layout (location = 0) in vec3 position;
layout (location = 1) in vec3 normal;
layout (location = 2) in vec2 texCoords;
layout (location = 3) in vec3 tangent;
layout (location = 4) in vec3 bitangent;

out VS_OUT {
    vec3 FragPos;
    vec2 TexCoords;
    vec3 TangentLightPos;
    vec3 TangentViewPos;
    vec3 TangentFragPos;
} vs_out;

uniform mat4 projection;
uniform mat4 view;
uniform mat4 model;
uniform vec3 lightPos;
uniform vec3 viewPos;

void main()
{
    gl_Position      = projection * view * model * vec4(position, 1.0);
    vs_out.FragPos   = vec3(model * vec4(position, 1.0));
    vs_out.TexCoords = texCoords;

    vec3 T   = normalize(mat3(model) * tangent);
    vec3 B   = normalize(mat3(model) * bitangent);
    vec3 N   = normalize(mat3(model) * normal);
    mat3 TBN = transpose(mat3(T, B, N));

    vs_out.TangentLightPos = TBN * lightPos;
    vs_out.TangentViewPos  = TBN * viewPos;
    vs_out.TangentFragPos  = TBN * vs_out.FragPos;
}
```

### 11.2 像素着色器（POM 版本）

```glsl
#version 330 core
out vec4 FragColor;

in VS_OUT {
    vec3 FragPos;
    vec2 TexCoords;
    vec3 TangentLightPos;
    vec3 TangentViewPos;
    vec3 TangentFragPos;
} fs_in;

uniform sampler2D diffuseMap;
uniform sampler2D normalMap;
uniform sampler2D depthMap;
uniform float height_scale;

vec2 ParallaxMapping(vec2 texCoords, vec3 viewDir)
{
    // 自适应层数
    const float minLayers = 8.0;
    const float maxLayers = 32.0;
    float numLayers = mix(maxLayers, minLayers,
                          max(dot(vec3(0.0, 0.0, 1.0), viewDir), 0.0));

    float layerDepth = 1.0 / numLayers;
    float currentLayerDepth = 0.0;
    vec2 P = viewDir.xy * height_scale;
    vec2 deltaTexCoords = P / numLayers;

    vec2  currentTexCoords     = texCoords;
    float currentDepthMapValue = texture(depthMap, currentTexCoords).r;

    while(currentLayerDepth < currentDepthMapValue)
    {
        currentTexCoords     -= deltaTexCoords;
        currentDepthMapValue  = texture(depthMap, currentTexCoords).r;
        currentLayerDepth    += layerDepth;
    }

    // POM 线性插值
    vec2 prevTexCoords = currentTexCoords + deltaTexCoords;
    float afterDepth  = currentDepthMapValue - currentLayerDepth;
    float beforeDepth = texture(depthMap, prevTexCoords).r
                        - currentLayerDepth + layerDepth;
    float weight = afterDepth / (afterDepth - beforeDepth);
    return prevTexCoords * weight + currentTexCoords * (1.0 - weight);
}

void main()
{
    vec3 viewDir   = normalize(fs_in.TangentViewPos - fs_in.TangentFragPos);
    vec2 texCoords = ParallaxMapping(fs_in.TexCoords, viewDir);

    // 丢弃超出范围的纹理坐标（修复边缘失真）
    if(texCoords.x > 1.0 || texCoords.y > 1.0 ||
       texCoords.x < 0.0 || texCoords.y < 0.0)
        discard;

    vec3 diffuse = texture(diffuseMap, texCoords).rgb;
    vec3 normal  = texture(normalMap, texCoords).rgb;
    normal = normalize(normal * 2.0 - 1.0);

    // 光照计算（切线空间）
    vec3 lightDir = normalize(fs_in.TangentLightPos - fs_in.TangentFragPos);
    float diff = max(dot(lightDir, normal), 0.0);
    vec3 ambient = 0.1 * diffuse;
    FragColor = vec4(ambient + diff * diffuse, 1.0);
}
```

---

## 12. 工程实践与优化

### 12.1 边缘失真修复

位移后纹理坐标可能超出 [0,1]，导致边缘伪影：

```glsl
if(texCoords.x > 1.0 || texCoords.y > 1.0 ||
   texCoords.x < 0.0 || texCoords.y < 0.0)
    discard;
```

> 注意：此技巧不适用于所有表面类型，但平面效果很好。

### 12.2 height_scale 调参

- 过大（>0.2）：视差过强，失真明显
- 过小（<0.05）：效果不明显
- **推荐起点**：0.1，根据高度贴图动态范围调整

### 12.3 自适应采样数

垂直看少采样、斜看多采样，平衡性能与质量：

```glsl
float numLayers = mix(maxLayers, minLayers,
                      max(dot(vec3(0.0,0.0,1.0), viewDir), 0.0));
```

### 12.4 适用场景

视差贴图最适合**地面、墙壁**等表面：
- 轮廓不易辨认 → 伪影不显眼
- 观察角度趋于垂直 → 视差效果最佳
- 避免用于轮廓清晰的凸起物体（如小球），轮廓不匹配会穿帮

### 12.5 与自阴影结合

POM 可扩展支持**自阴影 (Self-shadowing)**：从交点向光源方向再做一次射线步进，判断是否被高度场遮挡。Tatarchuk 的 SIGGRAPH 2005 演讲涵盖了此技术。

### 12.6 纹理要求

- 深度贴图与 diffuse/normal 贴图**同源**（同一高度场生成）
- 法线贴图由高度贴图计算得来，保证光照与位移一致
- 深度贴图 = 高度贴图反色（或在着色器中 `1.0 - height`）

---

## 13. 算法对比总结

| 算法 | 采样数 | 精度 | 性能 | 轮廓准确 | 自遮挡 | 适用场景 |
|------|--------|------|------|----------|--------|----------|
| 基础视差贴图 | 1 | 低 | 最快 | 否 | 否 | 平缓表面、移动端 |
| Offset Limiting | 1 | 低 | 最快 | 否 | 否 | 减少角度伪影 |
| 陡峭视差映射 | 8-32 | 中 | 中 | 否 | 否 | 一般场景 |
| **POM** | 8-32+1 | 高 | 较快 | 否 | 可扩展 | **推荐默认** |
| Relief PM | 8-32+5 | 最高 | 较慢 | 否 | 是 | 高质量离线/高端 |
| Prism POM | 多 | 高 | 慢 | **是** | 是 | 需要准确轮廓 |
| Cone Step | 少(预计算) | 高 | 快(需预计算) | 否 | 是 | 预计算可接受 |
| Relaxed Cone | 少+二分 | 高 | 快 | 否 | 是 | GPU Gems 3 推荐 |

### 选型决策树

```
需要真实位移顶点？ ──是──→ 位移贴图 (Displacement Mapping)
    │否
需要准确轮廓？ ──是──→ Prism POM
    │否
性能极度敏感？ ──是──→ 基础视差贴图 / Offset Limiting
    │否
需要最高精度？ ──是──→ Relief Parallax Mapping / Relaxed Cone Stepping
    │否
推荐默认 ────────────→ 视差遮蔽映射 (POM)
```

---

## 14. 参考文献

### 论文
1. Kaneko, T. et al. (2001). "Detailed Shape Representation with Parallax Mapping." ICAT 2001, pp. 205-208.
2. Oliveira, M., Bishop, G., McAllister, D. (2000). "Relief texture mapping." SIGGRAPH 2000, pp. 359-368.
3. Brawley, Z., Tatarchuk, N. (2005). "Parallax Occlusion Mapping." ShaderX3.
4. Tatarchuk, N. (2005). "Practical Dynamic Parallax Occlusion Mapping." SIGGRAPH 2005.
5. Policarpo, F., Oliveira, M., Comba, J. (2005). "Real-time relief mapping on arbitrary polygonal surfaces." I3D 2005, pp. 155-162.
6. Policarpo, F., Oliveira, M. (2006). "Relief mapping of non-height-field surface details." SI3D 2006.
7. Dachsbacher, C., Tatarchuk, N. (2007). "Prism Parallax Occlusion Mapping with Accurate Silhouette Generation." SI3D 2007.

### 书籍/章节
8. GPU Gems 3, Chapter 18: "Relaxed Cone Stepping for Relief Mapping" — https://developer.nvidia.com/gpugems/gpugems3/part-iii-rendering/chapter-18-relaxed-cone-stepping-relief-mapping
9. ShaderX3: Advanced Rendering with DirectX and OpenGL (Engel, 2005)

### 教程
10. LearnOpenGL (英文): https://learnopengl.com/Advanced-Lighting/Parallax-Mapping
11. LearnOpenGL CN (中文): https://learnopengl-cn.github.io/05%20Advanced%20Lighting/05%20Parallax%20Mapping/
12. TheBennyBox 视频教程: https://www.youtube.com/watch?v=xvOT62L-fQI
13. gamedev.net POM 深入: https://www.gamedev.net/tutorials/programming/graphics/a-closer-look-at-parallax-occlusion-mapping-r3262

### Wikipedia
14. Parallax mapping: https://en.wikipedia.org/wiki/Parallax_mapping
15. Parallax occlusion mapping: https://en.wikipedia.org/wiki/Parallax_occlusion_mapping
16. Relief mapping: https://en.wikipedia.org/wiki/Relief_mapping_(computer_graphics)

### 引擎应用
17. CryEngine 2/3 — 使用 POM
18. Unreal Engine 4 — 使用 POM
19. Unigine — 使用 POM
20. ATI Toy Shop Demo (2005) — POM 首次工业展示
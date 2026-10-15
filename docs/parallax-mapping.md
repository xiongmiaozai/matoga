# 视差贴图 (Parallax Mapping)

> 来源：[LearnOpenGL CN - 视差贴图](https://learnopengl-cn.github.io/05%20Advanced%20Lighting/05%20Parallax%20Mapping/)
> 原文：[Parallax Mapping](http://learnopengl.com/#!Advanced-Lighting/Parallax-Mapping)
> 作者：JoeyDeVries ｜ 翻译：[Django](http://bullteacher.com/)

---

## 目录

- [概述](#概述)
- [视差贴图](#视差贴图实现)
- [陡峭视差映射](#陡峭视差映射)
- [视差遮蔽映射](#视差遮蔽映射)
- [附加资源](#附加资源)

---

## 概述

视差贴图（Parallax Mapping）技术和法线贴图差不多，但它有着不同的原则。和法线贴图一样，视差贴图能够极大提升表面细节，使之具有深度感。它也是利用视错觉，然而对深度有着更好的表达，与法线贴图一起用能够产生难以置信的效果。视差贴图和光照无关，这里是作为法线贴图的技术延续来讨论它。

> **前置知识**：在开始学习视差贴图之前，强烈建议先对法线贴图，特别是切线空间有较好的理解。

视差贴图属于位移贴图（Displacement Mapping）技术的一种，它根据储存在纹理中的几何信息对顶点进行位移或偏移。一种实现方式是比如有 1000 个顶点，根据纹理中的数据对平面特定区域的顶点的高度进行位移。这样的每个纹理像素包含了高度值纹理叫做**高度贴图**。一张简单的砖块表面的高度贴图如下所示：

![高度贴图](https://learnopengl-cn.github.io/img/05/05/parallax_mapping_height_map.png)

整个平面上的每个顶点都根据从高度贴图采样出来的高度值进行位移，根据材质的几何属性平坦的平面变换成凹凸不平的表面。例如一个平坦的平面利用上面的高度贴图进行置换能得到以下结果：

![平面高度贴图置换结果](https://learnopengl-cn.github.io/img/05/05/parallax_mapping_plane_heightmap.png)

置换顶点有一个问题：平面必须由很多顶点组成才能获得具有真实感的效果，否则看起来效果并不会很好。一个平坦的表面上有 1000 个顶点计算量太大了。我们能否不用这么多的顶点就能取得相似的效果呢？事实上，上面的表面就是用 6 个顶点渲染出来的（两个三角形）。上面的那个表面使用视差贴图技术渲染，位移贴图技术不需要额外的顶点数据来表达深度，它像法线贴图一样采用一种聪明的手段欺骗用户的眼睛。

### 核心思想

视差贴图背后的思想是**修改纹理坐标**使一个 fragment 的表面看起来比实际的更高或者更低，所有这些都根据观察方向和高度贴图。为了理解它如何工作，看看下面砖块表面的图片：

![砖块表面](https://learnopengl-cn.github.io/img/05/05/parallax_mapping_plane_height.png)

这里粗糙的红线代表高度贴图中的数值的立体表达，向量代表观察方向。如果平面进行实际位移，观察者会在点 A 看到表面。然而我们的平面没有实际上进行位移，观察方向将在点 B 与平面接触。视差贴图的目的是，在位置 B 上的 fragment 不再使用点 B 的纹理坐标而是使用点 A 的。随后我们用点 A 的纹理坐标采样，观察者就像看到了点 A 一样。

这个技巧就是描述如何从点 B 得到点 A 的纹理坐标。视差贴图尝试通过对从 fragment 到观察者的方向向量进行缩放的方式解决这个问题，缩放的大小是 B 处 fragment 的高度。所以我们将向量的长度缩放为高度贴图在点 B 处采样得来的值。下图展示了经缩放得到的向量：

![缩放高度](https://learnopengl-cn.github.io/img/05/05/parallax_mapping_scaled_height.png)

我们随后选出这个向量与平面对齐的坐标作为纹理坐标的偏移量。这能工作是因为向量是使用从高度贴图得到的高度值计算出来的，所以一个 fragment 的高度越高位移的量越大。

这个技巧在大多数时候都没问题，但点 A 是粗略估算得到的。当表面的高度变化很快的时候，看起来就不会真实，因为向量最终不会和 A 接近，就像下图这样：

![不正确的 P](https://learnopengl-cn.github.io/img/05/05/parallax_mapping_incorrect_p.png)

### 切线空间

视差贴图的另一个问题是，当表面被任意旋转以后很难指出从 B 获取哪一个坐标。我们在视差贴图中使用了另一个坐标空间，这个空间向量的 x 和 y 元素总是与纹理表面对齐。如果你看了法线贴图教程，你也许猜到了，我们实现它的方法——还是在**切线空间**中实现视差贴图。

将 fragment 到观察者的向量转换到切线空间中，经变换的向量的 x 和 y 元素将与表面的切线和副切线向量对齐。由于切线和副切线向量与表面纹理坐标的方向相同，我们可以用它的 x 和 y 元素作为纹理坐标的偏移量，这样就不用考虑表面的方向了。

---

## 视差贴图实现

我们将使用一个简单的 2D 平面，在把它发送给 GPU 之前我们先计算它的切线和副切线向量；和法线贴图教程做的差不多。我们将向平面贴 diffuse 纹理、法线贴图以及一个位移贴图。这个例子中我们将视差贴图和法线贴图连用。因为视差贴图生成表面位移了的幻觉，当光照不匹配时这种幻觉就被破坏了。法线贴图通常根据高度贴图生成，法线贴图和高度贴图一起用能保证光照能和位移相匹配。

> **深度贴图**：使用反色高度贴图（也叫深度贴图）去模拟深度比模拟高度更容易。我们通过在着色器中用 `1.0` 减去采样得到的高度贴图中的值来取得深度值，或者简单地在图片编辑软件中把这个纹理进行反色操作。

![深度贴图](https://learnopengl-cn.github.io/img/05/05/parallax_mapping_depth.png)

### 顶点着色器

位移贴图是在像素着色器中实现的，因为三角形表面的所有位移效果都不同。在像素着色器中我们将需要计算 fragment 到观察者的方向向量，所以我们需要观察者位置和在切线空间中的 fragment 位置。法线贴图教程中我们已经有了一个顶点着色器，它把这些向量发送到切线空间，所以我们可以复制那个顶点着色器：

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
    gl_Position      = projection * view * model * vec4(position, 1.0f);
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

> **重要**：我们需要把 `position` 和在切线空间中的观察者的位置 `viewPos` 发送给像素着色器。

### 像素着色器

在像素着色器中，我们实现视差贴图的逻辑：

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

vec2 ParallaxMapping(vec2 texCoords, vec3 viewDir);

void main()
{
    // 使用视差贴图偏移纹理坐标
    vec3 viewDir   = normalize(fs_in.TangentViewPos - fs_in.TangentFragPos);
    vec2 texCoords = ParallaxMapping(fs_in.TexCoords,  viewDir);

    // 用新的纹理坐标采样贴图
    vec3 diffuse = texture(diffuseMap, texCoords);
    vec3 normal  = texture(normalMap, texCoords);
    normal = normalize(normal * 2.0 - 1.0);
    // 继续光照计算
    // [...]
}
```

我们定义了一个叫做 `ParallaxMapping` 的函数，它把 fragment 的纹理坐标和切线空间中的 fragment 到观察者的方向向量为输入，返回经位移的纹理坐标。然后我们使用这些经位移的纹理坐标进行 diffuse 和法线贴图的采样。

### ParallaxMapping 函数

```glsl
vec2 ParallaxMapping(vec2 texCoords, vec3 viewDir)
{
    float height =  texture(depthMap, texCoords).r;
    vec2 p = viewDir.xy / viewDir.z * (height * height_scale);
    return texCoords - p;
}
```

这个相对简单的函数是所讨论过的内容的直接表述：

1. 用本来的纹理坐标 `texCoords` 从高度贴图中采样，得到当前 fragment 的高度
2. 计算出 `p`，x 和 y 元素在切线空间中，`viewDir` 向量除以它的 z 元素，用 fragment 的高度对它进行缩放
3. 引入一个 `height_scale` 的 uniform 进行额外控制（视差效果如果没有缩放参数通常会过于强烈）
4. 用 `texCoords` 减去 `p` 来获得最终的经过位移的纹理坐标

> **关于除以 viewDir.z**：因为 `viewDir` 向量是经过了标准化的，`viewDir.z` 会在 0.0 到 1.0 之间。当 `viewDir` 大致平行于表面时，它的 z 元素接近 0.0，除法会返回比垂直于表面时更大的向量。所以当带有角度地看向平面时，会更大程度地缩放 `p` 的大小，从而增加纹理坐标的偏移，在视角上获得更大的真实度。
>
> **有偏移量限制的视差贴图（Parallax Mapping with Offset Limiting）**：有些人更喜欢不在等式中使用 `viewDir.z`，因为普通的视差贴图会在角度上产生不尽如人意的结果。选择哪一个技术是个人偏好问题。

### 边缘失真修复

在视差贴图的那个平面里仍然能看到在边上有古怪的失真。原因是在平面的边缘上，纹理坐标超出了 0 到 1 的范围进行采样，根据纹理的环绕方式导致了不真实的结果。解决方法是当超出默认纹理坐标范围进行采样时丢弃这个 fragment：

```glsl
texCoords = ParallaxMapping(fs_in.TexCoords,  viewDir);
if(texCoords.x > 1.0 || texCoords.y > 1.0 || texCoords.x < 0.0 || texCoords.y < 0.0)
    discard;
```

丢弃了超出默认范围的纹理坐标的所有 fragment，视差贴图的表面边缘给出了正确的结果。注意，这个技巧不能在所有类型的表面上都能工作，但是应用于平面上它还是能够使平面看起来真的进行位移了。

![边缘修复](https://learnopengl-cn.github.io/img/05/05/parallax_mapping_edge_fix.png)

> **问题**：当从一个角度看过去的时候，会有一些问题产生（和法线贴图相似），陡峭的地方会产生不正确的结果。原因是这只是一个大致近似的视差映射。

---

## 陡峭视差映射

陡峭视差映射（Steep Parallax Mapping）是视差映射的扩展，原则是一样的，但不是使用一个样本而是多个样本来确定向量。即使在陡峭的高度变化的情况下，它也能得到更好的结果，原因在于该技术通过增加采样的数量提高了精确性。

### 基本思想

将总深度范围划分为同一个深度/高度的多个层。从每个层中我们沿着方向移动采样纹理坐标，直到我们找到一个采样低于当前层的深度值。

![陡峭视差映射图解](https://learnopengl-cn.github.io/img/05/05/parallax_mapping_steep_parallax_mapping_diagram.png)

我们从上到下遍历深度层，把每个深度层和储存在深度贴图中的它的深度值进行对比。如果这个层的深度值小于深度贴图的值，就意味着这一层的向量部分在表面之下。我们继续这个处理过程直到有一层的深度高于储存在深度贴图中的值：这个点就在（经过位移的）表面下方。

### 实现

```glsl
vec2 ParallaxMapping(vec2 texCoords, vec3 viewDir)
{
    // 深度层数量
    const float numLayers = 10;
    // 计算每一层的大小
    float layerDepth = 1.0 / numLayers;
    // 当前层的深度
    float currentLayerDepth = 0.0;
    // 每层纹理坐标的偏移量（来自向量 P）
    vec2 P = viewDir.xy * height_scale;
    vec2 deltaTexCoords = P / numLayers;

    // 初始值
    vec2  currentTexCoords     = texCoords;
    float currentDepthMapValue = texture(depthMap, currentTexCoords).r;

    while(currentLayerDepth < currentDepthMapValue)
    {
        // 沿 P 方向移动纹理坐标
        currentTexCoords -= deltaTexCoords;
        // 获取当前纹理坐标处的深度贴图值
        currentDepthMapValue = texture(depthMap, currentTexCoords).r;
        // 获取下一层的深度
        currentLayerDepth += layerDepth;
    }

    return currentTexCoords;
}
```

这里我们循环每一层深度，直到沿着向量找到第一个返回低于（位移）表面的深度的纹理坐标偏移量。从 fragment 的纹理坐标减去最后的偏移量，来得到最终的经过位移的纹理坐标向量，这次就比传统的视差映射更精确了。

### 自适应样本数量

我们可以通过对视差贴图的一个属性的利用，对算法进行一点提升。当垂直看一个表面的时候纹理位移比以一定角度看时的小。我们可以在垂直看时使用更少的样本，以一定角度看时增加样本数量：

```glsl
const float minLayers = 8;
const float maxLayers = 32;
float numLayers = mix(maxLayers, minLayers, abs(dot(vec3(0.0, 0.0, 1.0), viewDir)));
```

这里我们得到 `viewDir` 和正 z 方向的点乘，使用它的结果根据我们看向表面的角度调整样本数量（注意正 z 方向等于切线空间中的表面的法线）。如果我们所看的方向平行于表面，我们就使用 32 层。

### 问题

陡峭视差贴图同样有自己的问题。因为这个技术是基于有限的样本数量的，我们会遇到锯齿效果以及图层之间有明显的断层：

![陡峭视差映射伪影](https://learnopengl-cn.github.io/img/05/05/parallax_mapping_steep_artifact.png)

我们可以通过增加样本的方式减少这个问题，但是很快就会花费很多性能。有些旨在修复这个问题的方法：不使用低于表面的第一个位置，而是在两个接近的深度层进行插值找出更匹配的。

两种最流行的解决方法叫做 **Relief Parallax Mapping** 和 **Parallax Occlusion Mapping**。Relief Parallax Mapping 更精确一些，但是比 Parallax Occlusion Mapping 性能开销更多。因为 Parallax Occlusion Mapping 的效果和前者差不多但效率更高，因此这种方式更经常使用。

---

## 视差遮蔽映射

视差遮蔽映射（Parallax Occlusion Mapping）和陡峭视差映射的原则相同，但不是用触碰的第一个深度层的纹理坐标，而是在触碰之前和之后，在深度层之间进行线性插值。我们根据表面的高度距离两个深度层的深度层值的距离来确定线性插值的大小。

![视差遮蔽映射图解](https://learnopengl-cn.github.io/img/05/05/parallax_mapping_parallax_occlusion_mapping_diagram.png)

你可以看到大部分和陡峭视差映射一样，不一样的地方是有个额外的步骤，两个深度层的纹理坐标围绕着交叉点的线性插值。这也是近似的，但是比陡峭视差映射更精确。

### 实现

```glsl
// ... 陡峭视差映射代码 ...

// 获取碰撞前的纹理坐标（反向操作）
vec2 prevTexCoords = currentTexCoords + deltaTexCoords;

// 获取碰撞后和碰撞前的深度用于线性插值
float afterDepth  = currentDepthMapValue - currentLayerDepth;
float beforeDepth = texture(depthMap, prevTexCoords).r - currentLayerDepth + layerDepth;

// 纹理坐标插值
float weight = afterDepth / (afterDepth - beforeDepth);
vec2 finalTexCoords = prevTexCoords * weight + currentTexCoords * (1.0 - weight);

return finalTexCoords;
```

在对（位移的）表面几何进行交叉，找到深度层之后，我们获取交叉前的纹理坐标。然后我们计算来自相应深度层的几何之间的深度之间的距离，并在两个值之间进行插值。线性插值的方式是在两个层的纹理坐标之间进行的基础插值。函数最后返回最终的经过插值的纹理坐标。

视差遮蔽映射的效果非常好，尽管有一些可以看到的轻微的不真实和锯齿的问题，这仍是一个好交易，因为除非是放得非常大或者观察角度特别陡，否则也看不到。

![视差遮蔽映射结果](https://learnopengl-cn.github.io/img/05/05/parallax_mapping_parallax_occlusion_mapping.png)

### 使用建议

视差贴图是提升场景细节非常好的技术，但是使用的时候还是要考虑到它会带来一点不自然。大多数时候视差贴图用在**地面和墙壁表面**，这种情况下查明表面的轮廓并不容易，同时观察角度往往趋向于垂直于表面。这样视差贴图的不自然也就很难能被注意到了，对于提升物体的细节可以起到难以置信的效果。

---

## 附加资源

- [Parallax Occlusion Mapping in GLSL](http://sunandblackcat.com/tipFullView.php?topicid=28)：sunandblackcat.com 上的视差贴图教程
- [How Parallax Displacement Mapping Works](https://www.youtube.com/watch?v=xvOT62L-fQI)：TheBennyBox 的关于视差贴图原理的视频教程

---

## 技术对比总结

| 技术 | 样本数 | 精度 | 性能 | 适用场景 |
|------|--------|------|------|----------|
| 视差贴图 (Parallax Mapping) | 1 | 低 | 最快 | 简单表面、性能敏感 |
| 陡峭视差映射 (Steep Parallax Mapping) | 8-32 | 中 | 中等 | 一般场景 |
| 视差遮蔽映射 (Parallax Occlusion Mapping) | 8-32 + 插值 | 高 | 较慢 | 高质量需求 |
| Relief Parallax Mapping | 更多 + 二分搜索 | 最高 | 最慢 | 极高质量需求 |
---
name: write-json-model
description: 为 Minecraft 资源包编写/校验 assets/minecraft/models/ 下的 JSON 模型文件（block + item），支持 26.x 新字段。当用户请求新建、修改、修复、审阅 Minecraft 模型 JSON，或提到 "模型/json model/方块模型/物品模型/trim/分层贴图" 时触发。
version: 1.0.0
scope: project
applies_to: [CodeArts, Claude Code]
---

# Skill: write-json-model

> 为 Minecraft 26.x 资源包生成符合规范的 `assets/minecraft/models/**/*.json` 模型文件。
> 数据基线：`official-packs/26.3-Fabric`（pack_format 97.1, Java 25）。

---

## 1. Objective

根据用户需求，在 `assets/minecraft/models/block/` 或 `assets/minecraft/models/item/` 下产出**语法合法、字段合规、继承正确、贴图引用可解析**的模型 JSON，并通过项目校验。

## 2. Scope

- **覆盖**：`models/block/**`（cube/stairs/slab/cross/wall/column/template_* 等模板派生与自定义几何）、`models/item/**`（generated/handheld/trim 分层、in_hand 变体）
- **不覆盖**：blockstates、items 定义、atlases、shaders、data 包、PNG 贴图本身、Java class
- **版本**：默认目标 26.3（pack_format 97.1）。若用户指定旧版本，关闭 26.x 新字段并提示差异

## 3. Constraints（强制）

### 3.1 通用 JSON 规则

- 2 空格缩进、无 BOM、LF 换行、UTF-8
- 顶层只允许出现以下键，多余键必须删除：`parent` `textures` `elements` `display` `ambientocclusion` `gui_light` `texture_size` `groups`
- `parent` 与 `elements` 可同时存在（继承父几何并追加），但若父模型已含 `elements` 则子模型 `elements` **完全覆盖**而非合并——需在 PR 说明中点出
- 贴图引用两种形式：`"minecraft:block/stone"`（绝对路径）或 `"#all"`（引用本模型 `textures` 内的槽位）。禁止裸文件名、禁止反斜杠
- 所有贴图路径必须以 `minecraft:` 开头（本包内资源）；跨包引用需用 `<namespace>:<path>` 并确认目标存在

### 3.2 字段合规

| 字段                  | 类型                  | 约束                                                                                                                                                                                                 |
| --------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parent`              | string                | 必须是已存在的模型路径；`minecraft:` 前缀可省略同包引用                                                                                                                                              |
| `textures`            | object<string,string> | 键为槽位名（`all/side/top/bottom/end/north/.../layer0/layer1/particle/...`），值为贴图引用                                                                                                           |
| `elements`            | array                 | 每个元素 `from`/`to` 为 `[x,y,z]`，坐标 ∈ [0,16]（允许超出但需说明原因，如碰撞箱模型）                                                                                                               |
| `elements[].faces`    | object                | 键 ∈ {`north`,`south`,`east`,`west`,`up`,`down`}；每面 `texture` 必填，`uv`/`rotation`/`tintindex`/`cullface` 可选                                                                                   |
| `elements[].rotation` | object                | `axis` ∈ {x,y,z}，`angle` ∈ {0,±22.5,±45,...±180}（22.5° 倍数），`origin` 为 `[x,y,z]`，`rescale` boolean                                                                                            |
| `display`             | object                | 键 ∈ {`thirdperson_righthand`,`thirdperson_lefthand`,`firstperson_righthand`,`firstperson_lefthand`,`gui`,`head`,`ground`,`fixed`,`on_shelf`}；每值含 `rotation`/`translation`/`scale`（均 [x,y,z]） |
| `gui_light`           | string                | ∈ {`side`,`front`,`front_back`}                                                                                                                                                                      |
| `ambientocclusion`    | boolean               | 默认 true                                                                                                                                                                                            |
| `texture_size`        | [int,int]             | 仅当贴图非 16×16 时使用                                                                                                                                                                              |

### 3.3 26.x 新增字段（仅当目标版本 ≥ 26.0）

| 字段                       | 位置                                  | 说明                                                                     |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| `shade_direction_override` | `elements[].shade_direction_override` | [x,y,z] 单位向量，覆盖该元素着色法线方向（修复 AO/光照锯齿）。350 处用例 |
| `light_emission`           | `elements[].light_emission`           | int 0–15，元素级自发光强度（替代旧 `emissivity` 贴图属性）。4 处用例     |
| `on_shelf`                 | `display.on_shelf`                    | 货架展示变换，结构与其它 display 阶段一致。15 处用例                     |

### 3.4 风格禁令

- **禁止**留空 `textures`（要么省略要么至少一个键值）
- **禁止** `elements` 与 `parent` 同时缺失（模型无几何无继承 = 不可见）
- **禁止** `uv` 越界（默认 UV 空间 [0,16]，`texture_size` 非默认时按比例换算）
- **禁止**复制父模型全部 `elements` 到子模型（除非确实要覆盖几何；否则只写差异）
- **禁止**引入注释键 `__comment` 到生产文件（仅建模工具中间产物可用）

## 4. 模板库（按需复制改造）

### 4.1 block/cube_all（六面同贴图）

```json
{
  "parent": "minecraft:block/cube_all",
  "textures": { "all": "minecraft:block/my_block" }
}
```

### 4.2 block/cube_column（柱状，如原木）

```json
{
  "parent": "minecraft:block/cube_column",
  "textures": {
    "end": "minecraft:block/my_block_top",
    "side": "minecraft:block/my_block"
  }
}
```

### 4.3 block/cube_directional（朝向敏感）

```json
{
  "parent": "minecraft:block/cube_directional",
  "textures": {
    "front": "minecraft:block/my_block_front",
    "side": "minecraft:block/my_block_side",
    "top": "minecraft:block/my_block_top",
    "bottom": "minecraft:block/my_block_bottom"
  }
}
```

### 4.4 block/cross（交叉植物/花苗）

```json
{
  "parent": "minecraft:block/cross",
  "textures": { "cross": "minecraft:block/my_plant" }
}
```

### 4.5 block/slab（半砖，需同时产出 `_top` 变体或继承 slab_top）

```json
{
  "parent": "minecraft:block/slab",
  "textures": { "bottom": "#all", "top": "#all", "side": "#all", "all": "minecraft:block/my_block" }
}
```

### 4.6 block/stairs（楼梯，仅贴图槽位即可）

```json
{
  "parent": "minecraft:block/stairs",
  "textures": {
    "bottom": "minecraft:block/my_block",
    "top": "minecraft:block/my_block",
    "side": "minecraft:block/my_block"
  }
}
```

### 4.7 block/wall（墙，需 post/side/side_tall 三件套，通常由 blockstates 组合）

```json
{
  "parent": "minecraft:block/template_wall_post",
  "textures": { "wall": "minecraft:block/my_wall", "particle": "#wall" }
}
```

### 4.8 item/generated（平面物品图标）

```json
{
  "parent": "minecraft:item/generated",
  "textures": { "layer0": "minecraft:item/my_item" }
}
```

### 4.9 item/handheld（手持工具）

```json
{
  "parent": "minecraft:item/handheld",
  "textures": { "layer0": "minecraft:item/my_tool" }
}
```

### 4.10 item/trim 分层（盔甲纹饰，26.x 标准三层）

```json
{
  "parent": "minecraft:item/generated",
  "textures": {
    "layer0": "minecraft:item/iron_helmet",
    "layer1": "minecraft:item/iron_helmet_overlay",
    "layer2": "minecraft:trims/items/helmet_trim_resin"
  }
}
```

### 4.11 自定义几何 + 26.x 光照（带 light_emission / shade_direction_override）

```json
{
  "parent": "minecraft:block/block",
  "ambientocclusion": true,
  "textures": { "particle": "#lamp", "lamp": "minecraft:block/lamp_on" },
  "elements": [
    {
      "from": [0, 0, 0],
      "to": [16, 16, 16],
      "light_emission": 15,
      "shade_direction_override": [0, 1, 0],
      "faces": {
        "down": { "texture": "#lamp", "uv": [0, 0, 16, 16], "cullface": "down" },
        "up": { "texture": "#lamp", "uv": [0, 0, 16, 16], "cullface": "up" },
        "north": { "texture": "#lamp", "uv": [0, 0, 16, 16], "cullface": "north" },
        "south": { "texture": "#lamp", "uv": [0, 0, 16, 16], "cullface": "south" },
        "west": { "texture": "#lamp", "uv": [0, 0, 16, 16], "cullface": "west" },
        "east": { "texture": "#lamp", "uv": [0, 0, 16, 16], "cullface": "east" }
      }
    }
  ]
}
```

### 4.12 display.on_shelf（26.x 货架展示）

```json
{
  "parent": "minecraft:item/generated",
  "textures": { "layer0": "minecraft:item/my_item" },
  "display": {
    "on_shelf": { "rotation": [0, 180, 0], "translation": [0, 0, 0], "scale": [1, 1, 1] }
  }
}
```

## 5. Workflow

1. **定位需求**：确认目标路径（`block/` or `item/`）、目标版本（默认 26.3）、是否需配套 blockstates/items 定义（本 skill 不生成，但需提示用户）
2. **选模板**：从 §4 模板库选最接近的父模型；优先继承而非自定义 `elements`
3. **填贴图**：替换 `minecraft:block/xxx` 为真实贴图路径；确认贴图文件存在于 `assets/minecraft/textures/`（用 Glob 校验）
4. **校验父模型**：用 Glob 确认 `parent` 指向的模型文件存在（解析 `minecraft:` 前缀 → `assets/minecraft/models/`）
5. **写文件**：用 Write 工具落盘，文件名 = 模型名.json，路径 = `assets/minecraft/models/<block|item>/<name>.json`
6. **自检**：执行 §6 校验清单
7. **项目验证**：运行 `npm run lint` 与 `npm test`（若改动触及测试夹具）；新增模型若需纳入对比基线，提示用户更新 official-packs 索引
8. **报告**：输出最终 JSON 路径 + 继承链 + 贴图清单

## 6. Done When

- [ ] 文件已写入 `assets/minecraft/models/{block,item}/*.json`
- [ ] JSON 可被 `JSON.parse` 解析（无尾逗号、无单引号）
- [ ] 顶层键全部 ∈ §3.1 白名单
- [ ] `parent` 路径存在（Glob 命中）
- [ ] 每个 `textures` 值要么以 `minecraft:` 开头且对应 PNG 存在，要么以 `#` 引用本模型内槽位
- [ ] `elements[].from/to` 坐标为数字数组长度 3
- [ ] `display` 阶段键全部 ∈ §3.2 白名单
- [ ] 26.x 字段仅在目标版本 ≥ 26.0 时使用
- [ ] `npm run lint` 通过

## 7. Stop If

- 用户要求生成 **blockstates** / **items 定义** / **atlases** → 停止并说明超出 scope，建议另起 skill
- 用户要求修改 `official-packs/26.3-Fabric/` 内既有官方模型 → 停止，提示官方包只读，应在用户自定义包路径下覆盖
- 目标版本 < 26.0 但用户要求使用 `light_emission`/`shade_direction_override`/`on_shelf` → 停止，确认版本或降级为传统字段
- 贴图路径指向不存在的 PNG 且用户未声明将后续补图 → 停止，列出缺失文件
- `parent` 形成循环继承链 → 停止，报告链路

## 8. 常见陷阱（反例）

❌ **子模型重复父几何**：`cube_all` 已含 `elements`，子模型不要再写一遍 0..16 立方体，只写 `textures`。
❌ **UV 空间混淆**：默认 UV ∈ [0,16]（不是 [0,1] 也不是像素 [0,16] 贴图坐标）。`texture_size` 非默认时仍按 [0,16] 归一化。
❌ **`#引用` 未定义**：`"particle": "#all"` 但 `textures` 内无 `all` 键 → 运行时回退到 missing_texture 紫黑格。
❌ **`cullface` 滥用**：`cullface` 仅用于该面与相邻方块面重合时做面剔除；非重合面写 `cullface` 会导致内部面被剔除出现空洞。
❌ **`tintindex` 默认**：省略时为 -1（不染色）；写 `0` 会应用方块 tint（如草地顶层变色），物品 trim 用 `1`/`2`。
❌ **`rotation.angle` 非法**：必须是 22.5° 的整数倍，否则游戏报错。
❌ **`display.scale` 为 0**：任一轴 scale=0 会导致模型在该阶段不可见。

## 9. 参考基线

- 父模型定义：`official-packs/26.3-Fabric/assets/minecraft/models/block/{cube_all,cube_column,stairs,slab,cross,template_wall_*}.json`
- 物品基类：`official-packs/26.3-Fabric/assets/minecraft/models/item/{generated,handheld}.json`
- 26.x 新字段用例：`rg "shade_direction_override|light_emission|on_shelf" official-packs/26.3-Fabric/assets/minecraft/models/`
- 版本元信息：`official-packs/26.3-Fabric/version.json`

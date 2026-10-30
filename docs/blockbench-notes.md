# Blockbench 资料汇总

> 抓取自 Blockbench 官网与 Wiki（2026-10-28）。供 matoga 解析/对比 .bbmodel 与贴图时参考。

---

## 一、项目概览

**定位**：免费开源的低多边形（low-poly）3D 模型编辑器，主打 Minecraft 风格建模、像素贴图与动画。
源码 https://github.com/JannisX11/blockbench （GPL-3.0，6.1k★，530 fork，5990 commits）。

**技术栈**：JavaScript + TypeScript；3D 预览用 WebGL + THREE.JS；界面部分用 Vue.js 2；桌面端用 Electron；可作为 PWA 在 Android/iOS/Chromebook 运行。Web 在线版 https://web.blockbench.net 。

**许可证要点**：源码 GPL-3.0；但**插件和主题可作为开源/闭源/付费软件发布**；用户用 Blockbench 创作的模型/贴图/动画归用户所有，可商用。

**知名使用方**：Mojang（内部用它做 mob 建模动画，如 Axolotl/Goat/Camel/Sniffer）、Hytale、Noxcrew、Spark Universe、Cyclone、Oreville Studios、Gamemode One。

---

## 二、核心功能

| 模块 | 说明 |
|------|------|
| 低模建模 | 立方体（cuboid）做 MC 风格；mesh 工具做复杂低模 |
| 贴图 | 内置画板、调色板导入、3D 直接绘制、2D 编辑器、自动 UV 展开/模板；可对接外部图像编辑器 |
| 动画 | 骨骼绑定 + 位置/旋转/缩放关键帧 + 曲线图编辑器 + MoLang 表达式 |
| 插件 | 内置插件商店，JS 插件扩展工具/导出格式/生成器 |
| 主题 | `.bbtheme` 文件可拖入加载，自定义外观 |

---

## 三、界面与操作（Overview & Tips）

**四种界面模式**：Edit（建模+UV+骨骼）、Paint（贴图绘制）、Animate（动画）、Display（MC 方块显示槽位）。

**坐标系**：X=宽，Y=高，Z=长；原点 (0,0,0)；默认 1 像素 = 1/16 米。

**视口导航默认键位**（可切换 Default/Blender/C4D/Maya 键位）：
- Trackpad：旋转=左键，拖拽=右键，缩放=Shift+左键
- Mouse：旋转=中键，拖拽=Shift+中键，缩放=Ctrl+中键

**术语**：Group（组织结构）、Bone（可旋转的组）、Element（非组元素）、Cube（立方体，泛指长方体）、Plane（2 面立方体）、Locator（无尺寸参考点）。

**滑块输入**：支持滑动/箭头/手动输入/双击归零/**MoLang 表达式**（如 `math.random(-30,30)`、`*2`、`val`/`n` 占位符）。

**实用功能**：Vertex Snap（顶点对齐+当卷尺用）、Inflate/Deflate（保持 UV 等比缩放）、Z-Fighting 规避、Flip（镜像并自动改名 `leg_left`↔`leg_right`）、Center（坐标轴对齐）、自动备份（默认 10 分钟）、Streamer Mode。

---

## 四、贴图与 UV 编辑（Paint Mode）

**UV 面板**：UV 编辑器 + 贴图尺寸 + Full View + UV Window（所有面并排）。Box UV 模式有 UV Overlay（显示全部 UV）和 Mirror UV（X 轴镜像）。Per-Face UV 模式每面一个 tab，含位置+缩放共 4 个滑块。

**贴图面板**：贴图列表 + Import Texture / Create Texture。

**颜色面板**：Color Bar（HEX + 历史色）+ 三 tab：Picker（HSV）、Palette（导入/导出/生成/排序/加载）、Both。支持 Pick Screen Color。

**Paint 工具栏工具**：Paint Brush、Paint Bucket、Eraser、Color Picker（按住 Alt 临时切换，Space 切换）、Draw Shape（矩形/椭圆，实心/空心）、Gradient、Copy Paste。可调 Size/Opacity/Softness；Shift 画直线。

**加速动作**：Mirror Painting（X 轴镜像同步绘制）、Lock Alpha Channel、Painting Grid。

**外部编辑**：可用外部图像编辑器，Blockbench 做 3D 实时预览；纯像素贴图可直接用内置工具。

---

## 五、动画模式（Animate Mode）

**面板**：Animations（列表+长度滑条）、Keyframe（时间码+插值+三轴数值）、Bone（仅骨骼属性）、Timeline（Header + Main View）。

**Timeline Header**：Toggle Graph Editor、Filter Channels、Clear Timeline、Animate Effects（粒子/声音/指令通道）、Set Marker、Playback Speed、Prev/Next Keyframe、Play。

**Main View**：Keyframe View（多通道同时显示）或 Graph Editor View（曲线编辑）。Time Ruler + Playhead（Ctrl 取消吸附）+ Timecode + Markers + Timeline Tracks。关键帧菱形=线性、圆形=平滑；可颜色编码。

---

## 六、Display Mode（MC 方块专用）

**Slots**：Thirdperson(left/right)、Firstperson(left/right)、Head、Ground、Frame、GUI。每槽位独立设置 rotation/translation/scale。GUI 有 Side Light / Front Light 两种光照。支持 Copy/Paste/Apply Preset/New Preset。Thirdperson/Head 可切换参考模型（player/zombie/baby zombie/armor stand/small armor stand）。

---

## 七、内置格式功能矩阵（Formats）

8 种内置格式：Java Block/Item、Bedrock Model、Bedrock Legacy、Modded Entity、OptiFine Entity、OptiFine Part、Generic Model、GeckoLib Model。

**关键差异**：
- **Size limit**：Java Block/Item 限 3×3×3，其余 Unlimited
- **Per-face UV**：除 Java Block/Item 外都支持
- **Box UV**：全部支持
- **UV face rotations**：仅 Bedrock Legacy、Modded Entity、OptiFine Entity、OptiFine Part
- **Parent models**：仅 Java Block/Item
- **Unrestricted cube sizing**：除 Java Block/Item 外（其余只能整数尺寸）
- **Bone rotations / Individual cube rotations**：除 Java Block/Item 外
- **Cube axis rotations**：Java=1，其余=3
- **Multiple textures**：仅 Bedrock Model、Generic Model
- **Model animations**：除 Java Block/Item 外
- **MoLang**：Bedrock Model、Modded Entity、OptiFine Entity、GeckoLib
- **Snowstorm 粒子**：Bedrock Model、Modded Entity、GeckoLib
- **导出**：.json(java blockmodel)、.json(bedrock geo)、.json(bedrock anim)、.java、.jem、.jpm、.obj、.gltf、.bbmodel

**导出格式推荐**：

| 用途 | 格式 |
|------|------|
| Blender 建模 | DAE |
| Blender 渲染 | glTF |
| Unity | FBX/DAE |
| Unreal | FBX |
| Godot | glTF |
| Sketchfab | glTF |
| 3D 打印 | STL |

**注意**：Blockbench 只能导出 ASCII FBX，Blender 只能导入 binary FBX，二者不兼容 → 用 DAE 互导。

---

## 八、.bbmodel 文件格式

**本质**：JSON，但内部格式，不保证与其他 JSON 兼容。含 `meta.format_version` 字段标识版本。官方建议：要做模型加载器，**优先用插件自定义格式**，而非直接解析 .bbmodel。

**近期破坏性变更**：
- **5.0**（2025-10-12，随 Blockbench 5.0 发布）：groups 与 outliner 分离存储——`groups` 只存组数据，`outliner` 只存层级树（uuid+isOpen+children）；关键帧方向修正（X 轴 position、X/Y 轴 rotation 不再反转）。
- **4.10**（2024-05-09）：相对贴图路径改为相对于 .bbmodel 所在目录（而非文件本身）；`name` 字段被文件名覆盖；默认贴图格式不再逐面指定未显式分配的贴图。
- **4.9**（2023-12-02）：开启 `per_texture_uv_size` 的格式，UV 尺寸改为按贴图存储（`uv_width`/`uv_height`）而非全局 `resolution:{width,height}`。

**完整规范**：目前无完整 JSON schema。建议看示例文件 + 源码 `js/formats/bbmodel.js`。

---

## 九、插件开发

**前置**：JS 基础 + Git + VS Code + Blockbench。

**文件结构**：单 JS 文件 `[plugin-id].js`，ID 必须等于文件名（去扩展名）。用 `Plugin.register(id, meta)` 注册。

**元数据字段**：`title`、`author`、`description`、`icon`（Blockbench 图标串）、`tags`（最多 3 个；MC 相关须用 'Minecraft'/'Minecraft: Java Edition'/'Minecraft: Bedrock Edition'）、`version`（semver）、`variant`（desktop/web/both）、`min_version`、`await_loading`、`onload/onunload/oninstall/onuninstall`。

**类型支持**：`npm i --save-dev blockbench-types` 获取 TS 类型与 VS Code 自动补全（比 Wiki 更新）。

**测试**：拖入 Blockbench 或从插件菜单加载；Ctrl/Cmd+J 重载。

**完整示例**（随机化选中立方体高度）：

```javascript
let button;
Plugin.register('height_randomizer', {
  title: 'Height Randomizer',
  author: 'YourName',
  description: 'This plugin can randomize the height of all selected cubes',
  icon: 'bar_chart',
  version: '0.0.1',
  variant: 'both',
  onload() {
    button = new Action('randomize_height', {
      name: 'Randomize Height',
      description: 'Randomize the height of all selected elements',
      icon: 'bar_chart',
      click: function() {
        Undo.initEdit({elements: Cube.selected});
        Cube.selected.forEach(cube => {
          cube.to[1] = cube.from[0] + Math.floor(Math.random()*8);
        });
        Canvas.updateView({
          elements: Cube.selected,
          element_aspects: {geometry: true},
          selection: true
        });
        Undo.finishEdit('Randomize cube height');
      }
    });
    MenuBar.menus.tools.addAction(button);
  },
  onunload() { button.delete(); }
});
```

**核心 API 模式**：`Undo.initEdit` → 改数据 → `Canvas.updateView` → `Undo.finishEdit`。

**提交**：fork https://github.com/JannisX11/blockbench-plugins ，放 `/plugins` + 改 `plugins.json`，提 PR。先读该仓库 README 的提交要求。

**完整 API 参考**：https://web.blockbench.net/docs （主要类：Action、Cube、Undo、Canvas 等）。Wiki 技术文档另有 Blockbench 对象、Properties、Interface、Undo、Utils、URL Parameters、Upgrading Plugins to 5.0 等页。

---

## 十、FAQ 要点

- 完全免费，任何用途；作品归用户，可商用
- 报 bug：https://github.com/JannisX11/blockbench/issues
- 错误信息：Ctrl+Shift+I 打开控制台
- Web app 需 WebGL；部分导入导出因浏览器安全限制需手动加载贴图
- 移动端：PWA，从浏览器安装
- 参考图：右键视口 → Add Reference Image；正交视角下可作蓝图
- 界面闪烁模糊：Nvidia 控制面板关闭 "Antialiasing - FXAA"
- Discord：https://discord.gg/blockbench

---

## 关键链接索引

| 资源 | URL |
|------|-----|
| 官网 | https://www.blockbench.net/ |
| 下载 | https://www.blockbench.net/downloads |
| Quickstart | https://www.blockbench.net/quickstart |
| 画廊 | https://www.blockbench.net/gallery |
| 插件商店 | https://www.blockbench.net/plugins |
| Wiki | https://www.blockbench.net/wiki |
| API 参考 | https://web.blockbench.net/docs |
| 源码 | https://github.com/JannisX11/blockbench |
| 插件仓库 | https://github.com/JannisX11/blockbench-plugins |
| .bbmodel 源码 | https://github.com/JannisX11/blockbench/blob/master/js/formats/bbmodel.js |
| TS 类型 | `npm i --save-dev blockbench-types` |
| Discord | https://discord.gg/blockbench |
| Reddit | https://reddit.com/r/blockbench |
| 比赛 | https://contests.blockbench.net |

---

## Wiki 完整目录（供后续按需深挖）

**Guides**
- Animation Expressions `/wiki/guides/animation-expressions`
- Bedrock Modeling and Animation `/wiki/guides/bedrock-modeling`
- Blockbench Overview & Tips `/wiki/guides/blockbench-overview-tips`
- Emissive Textures in Renders `/wiki/guides/emissive-textures-renders`
- 3D Export `/wiki/guides/export-formats`
- Particles and Sounds in MC Bedrock `/wiki/guides/minecraft-particles-sounds`
- Minecraft Style Guide `/wiki/guides/minecraft-style-guide`
- Rendering Models `/wiki/guides/model-rendering`

**Blockbench**
- FAQ `/wiki/blockbench/faq`
- Formats `/wiki/blockbench/formats`
- Legacy Versions `/wiki/blockbench/legacy-versions`
- Localization `/wiki/blockbench/localization`
- Logos and Brand Assets `/wiki/blockbench/logos`
- Custom Themes `/wiki/blockbench/themes`

**Technical Documentation**
- The .bbmodel format `/wiki/docs/bbmodel`
- Blockbench（全局对象）`/wiki/docs/blockbench`
- Upgrading Plugins to 5.0 `/wiki/docs/plugin-upgrade-to-5.0`
- Creating a Plugin `/wiki/docs/plugin`
- Properties `/wiki/docs/property`
- Interface `/wiki/docs/ui`
- Undo `/wiki/docs/undo`
- Web App URL Parameters `/wiki/docs/url-parameters`
- Utils `/wiki/docs/utility`
- API Reference Docs https://web.blockbench.net/docs
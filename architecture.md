# matoga — Minecraft 材质贴图对比工具

matoga（v3.2.0，作者 芝世 / xiongmiaozai）用于对比 Minecraft 资源包与材质贴图的差异：并排比对、像素级差异、模型与 PBR 贴图的三维预览。仓库当前处于**双后端并行**阶段 —— 原有 Node.js + Express 服务仍在运行，Go 后端已完整实现全部端点但尚未接管默认启动入口；前端正在由原生 ES Modules 向模块化目录结构收敛，Vue 化尚未开始。

## 1 项目目标与范围

<!-- archside: {"id":"ch-goals","color":"blue","status":"implemented","files":["README.md","docs/modularization-plan.md","docs/migration-go-vue.md"],"summary":"产品定位、核心能力与两项结构性迁移目标"} -->

本项目的需求分两条线：**功能线**是做一个能对比 MC 材质包/贴图的工作台（并排比对、像素差异、模型与 PBR 三维预览、制作包与导出）；**结构线**是两项已立项的迁移 —— 后端由 Node 换成 Go、前端由原生 ESM 换成 Vue，并在此过程中完成全项目模块化。

### 1.1 产品定位与核心能力

<!-- archside: {"id":"sec-capabilities","color":"blue","status":"implemented","files":["web/index.html","web/node-editor.html","server/routes"],"summary":"六大功能域：文件对比、贴图/资产库、3D 视口、UV 编辑、节点画布、制作包导出"} -->

| 功能域 | 说明 | 入口 |
| --- | --- | --- |
| 文件对比 | 左右目录树扫描、哈希/AHash/DHash 比对、分组差异表 | `web/index.html` |
| 贴图与资产库 | MC 包内贴图浏览分页、HDRI 预设、模型资产聚合 | `web/src/asset-library.js` |
| 3D 视口 | MC 方块模型与导入模型渲染、PBR 贴图、生物群系染色、贴图动画 | `web/src/m3d`、`web/src/mcv` |
| UV 贴图编辑 | 面 UV 拖拽/旋转/镜像、贴图库替换、PBR 配套贴图 | `web/src/uv-editor-core.js`、`web/src/uvc` |
| 节点画布 | ComfyUI 风格节点图（噪声/混合/特效），可产出贴图 | `web/src/node-canvas.js` |
| 制作包与导出 | 自选清单、整包/单文件复制、导出 `.mcpack`、工程导出 | `backend/internal/craftpack` |

### 1.2 运行形态与交付

<!-- archside: {"id":"sec-runtime","color":"slate","status":"implemented","files":["package.json","electron/main.js","build/installer.nsh","build/license.txt"],"summary":"Web 服务 + Electron 桌面壳两种形态；NSIS 安装器交付"} -->

- **Web 服务**：默认 `127.0.0.1:5273`（Node）/ `5123`（Go），`--port` 可覆盖，占用时自动顺延。
- **桌面端**：Electron 主进程 `electron/main.js` 加载本地服务页面（上游 v3.2.0 起桌面入口为 `electron.html`）。
- **打包**：npm workspaces（`server` / `web` / `electron` 三个子包，均为 `@matoga/* 3.2.0`）；Windows 交付走 electron-builder 的 NSIS target，支持自选安装目录与用户许可协议页，脚本在 `build/installer.nsh`。

## 2 系统架构总览

<!-- archside: {"id":"ch-arch","color":"purple","status":"unknown","files":[],"summary":"请求从桌面壳或浏览器经 /api 进入后端，后端读写资源包与运行时数据目录"} -->

系统按「前端（浏览器）→ HTTP /api + WebSocket → 后端服务 → 资源包与 data 目录」四段组织。前端不引入构建工具（原生 ES Modules 直跑），静态资源由后端直接托管；长任务（批量复制、缩略图生成）走 WebSocket 推送进度。

### 2.1 运行时拓扑

<!-- archside: {"id":"sec-topology","color":"purple","status":"implemented","files":["server/app.js","backend/internal/api/router.go","web/index.html"],"summary":"静态托管 + /api 路由 + /vendor 依赖 + WS 进度通道"} -->

- `web/` 与 `/vendor/{three,golden-layout}` 由后端静态托管（`Cache-Control: no-store`）。
- 业务统一走 `/api/*`；`/api/health` 位于鉴权之前，其余端点经 token 中间件（`?token=` 或 `x-matoga-token`）。
- LAN 模式会生成随机 token，并禁用 `shell` 类本地能力（返回 `ERR_LAN_FORBIDDEN`）。
- 同步/复制进度经 WebSocket：客户端发 `{type:'sync'|'cancel'}`，服务端回 `progress` / `done`。

### 2.2 双后端并行状态

<!-- archside: {"id":"sec-dual-backend","color":"orange","status":"unknown","files":["server/index.js","backend/cmd/matoga/main.go"],"summary":"Node 服务仍在服役，Go 后端已端点齐备但未接管默认启动"} -->

两套后端**同时存在且都能独立起服务**，端点集合已逐条比对为 94 : 83 的覆盖关系（Go 侧含三组包路由展开）。`npm start` 仍指向 Node 服务，Go 侧通过 `go run ./cmd/matoga` 单独启动。

#### 2.2.1 Go 后端（迁移目标）

<!-- archside: {"id":"leaf-go-backend","color":"teal","status":"implemented","files":["backend/cmd/matoga/main.go","backend/internal/api/router.go","backend/internal/fsx","backend/internal/mcmeta","backend/internal/media","backend/internal/store","backend/internal/craftpack","backend/internal/upload","backend/internal/httpx","backend/internal/platform"],"summary":"chi 路由 + 9 个领域包，94 个端点，137 个 Go 测试全绿"} -->

- 模块 `github.com/xiongmiaozai/matoga/backend`，Go 1.26；路由用 `chi` v5，WebSocket 用 `gorilla` 系或标准库升级。
- `cmd/matoga/main.go` 只做装配：flag（`-port` / `-lan` / `-data-root` / `-web`）→ 解析路径 → 信任根注册 → `api.Mount`。
- 关键取舍：ZIP 用标准库 `archive/zip`（替掉 Node 侧 300 行手写中央目录解析）；PNG 用 `image/png`；原子写用 `temp + rename`；EXR 解码与 blurhash 改用现成库（`go-openexr`、`go-blurhash`），替换时顺带修正了手写 blurhash 的 sizeFlag 与 maximumValue 缺陷。
- 已验证：`go test ./...` 137 通过、`gofmt`/`go vet` 干净、端到端 36/36 通过。

#### 2.2.2 Node 遗留服务（当前默认）

<!-- archside: {"id":"leaf-node-server","color":"slate","status":"implemented","files":["server/index.js","server/app.js","server/routes","server/services","server/config","server/middleware","server/ws.js"],"summary":"Express 5 + ws 的现行实现，48 个 js 文件，仍在默认启动路径上"} -->

分层为 `routes → services → config`：路由薄、服务厚，不跨层调用。手写实现中已被 Go 侧取代的包括 ZIP 中央目录解析、PNG 编码与降采样、HDR/EXR 解码；这部分是迁移完成后的可删代码。

## 3 后端

<!-- archside: {"id":"ch-backend","color":"teal","status":"implemented","files":["backend","server"],"summary":"Go 领域分层与 Node 遗留分层，共享同一套资源包与数据目录约定"} -->

两端共用同一份数据约定：`DATA_ROOT`（运行时数据，含 `data/`）、`PRESET_ROOT`（预设资源包根）、`RES_ROOT`（静态资源根）。Go 侧 `ResolvePaths` 在开发态会向上探测含 `web/` 的目录，避免 `go run` 时静态资源落空。

### 3.1 Go 领域分层

<!-- archside: {"id":"sec-go-layers","color":"teal","status":"implemented","files":["backend/internal/httpx","backend/internal/fsx","backend/internal/store","backend/internal/media","backend/internal/mcmeta","backend/internal/craftpack","backend/internal/upload","backend/internal/platform"],"summary":"httpx 契约层 / fsx 文件安全 / store 配置与资产 / media 图像 / mcmeta 包分析 / craftpack 制作包"} -->

| 包 | 职责 |
| --- | --- |
| `httpx` | 路由封装、统一响应信封、错误码映射、鉴权中间件 |
| `fsx` | 信任根（`Trust`）、路径越界校验（`GuardRead`/`GuardWrite`）、扫描、哈希与 AHash/DHash |
| `store` | 配置读写（原子写 + 串行队列）、资产聚合、导入模型、节点工程 |
| `media` | HDR/EXR 解码、tonemap、PNG/缩略图编码、blurhash、HDRI 列表与缓存 |
| `mcmeta` | 包元数据解析、包列表/重命名、贴图与条目浏览、zip 读取 |
| `craftpack` | 自选清单、单文件/整包复制、导出制作包 |
| `upload` | 分片上传会话 |

#### 3.1.1 API 路由与端点

<!-- archside: {"id":"leaf-go-routes","color":"teal","status":"implemented","files":["backend/internal/api/router.go","backend/internal/api"],"summary":"94 个端点：health/config/fs/file/hdri/asset/shell/upload/compare/panels/ws/node-projects/imported-models/custom-models/craft-pack + 三组包路由"} -->

`api.Mount(r, s Services)` 集中装配所有路由，`Services` 中路径类依赖用 `func() string` 而非字符串，以便运行时改配置后立即生效。三组包路由（`/craft-packs`、`/mc-packs`、`/mc-official`）由 `mountPackGroup` 复用同一实现展开，仅 `mc-official` 额外暴露 `version-map`。

#### 3.1.2 领域服务

<!-- archside: {"id":"leaf-go-services","color":"teal","status":"implemented","files":["backend/internal/media/hdr.go","backend/internal/media/thumb_encode.go","backend/internal/mcmeta/analyze.go","backend/internal/mcmeta/browse.go","backend/internal/craftpack/craftpack.go"],"summary":"手写改为复用：EXR/blurhash 换库，ZIP/PNG 用标准库，保留像素级一致性约束"} -->

- 主动换库的边界经过论证：降采样与灰度换算**不换**（注释明确要求与 Node 版逐位一致，换插值会改变输出像素），哈希输出格式**不换**（已是十六进制字符串，换库会破坏既有对比记录）。
- `mcmeta.readZipEntries` 返回的 `*zip.File` 只能读元数据；要读内容必须走 `openZipReader` 由调用方持有关闭，否则 `file already closed`。

### 3.2 存储与数据目录

<!-- archside: {"id":"sec-storage","color":"slate","status":"implemented","files":["server/config","backend/internal/store","backend/internal/platform/paths.go"],"summary":"配置原子写、缩略图缓存命名规则、资源包根与运行时数据分离"} -->

- 配置：`config.json` 用 `temp + rename` 原子写，写入走串行队列；`get()` 会补齐默认目录项。
- 缩略图缓存名 = 路径小写归一后的 md5（贴图 `.jpg`、HDRI `.png`、模型独立目录），带 `stale` 判定与孤儿清理。
- 资源包根（`mc-packs` / `official-packs` / `craft-packs` / `hdri-presets`）与运行时数据（`data/`）分离，前者不入版本控制。

## 4 前端

<!-- archside: {"id":"ch-frontend","color":"blue","status":"implemented","files":["web/index.html","web/node-editor.html","web/src","web/css","web/renderer.js"],"summary":"无构建工具的原生 ESM 应用，两页面 + 11 个已拆分模块目录"} -->

前端刻意不引入 webpack/vite/rollup，浏览器直接加载 ES Modules。两个页面：`web/index.html`（主对比界面）与 `web/node-editor.html`（节点编辑器）；布局停靠使用 golden-layout 2.6，三维使用 three 0.186。

### 4.1 应用外壳与入口

<!-- archside: {"id":"sec-shell","color":"blue","status":"implemented","files":["web/renderer.js","web/src/workspace.js","web/src/core.js","web/src/i18n.js"],"summary":"renderer 分步初始化，workspace 负责停靠布局与预设，core 提供共享状态与 DOM 引用"} -->

`web/renderer.js` 按 `step()` 顺序初始化（含 `initWorkspace`）。`web/src/workspace.js` 管理 golden-layout 停靠布局、面板注册与布局预设（保存/重命名/导入导出）；`web/src/core.js` 提供全局 `state`、DOM 引用与角色常量 `ROLES`。

### 4.2 模块化拆分

<!-- archside: {"id":"sec-modules","color":"blue","status":"implemented","files":["web/src/m3d","web/src/mcv","web/src/uvc","web/src/rnd","web/src/node-canvas","web/src/asset-lib","web/src/ws","web/src/actions","web/src/node-preview"],"summary":"大文件按职责拆入目录，主文件退化为门面（re-export）以保持导入路径不变"} -->

拆分遵循统一手法：**主文件保留为门面并原样 re-export**，这样既有的 `import ... from './xxx.js'` 路径全部继续可用，拆分对调用方透明。每个子模块头部保留版权注释。

#### 4.2.1 3D 与模型视口

<!-- archside: {"id":"leaf-3d","color":"purple","status":"implemented","files":["web/src/material3d.js","web/src/m3d","web/src/mc-model-viewer.js","web/src/mcv","web/src/m3d/pbr.js"],"summary":"material3d 门面 + m3d 16 模块；mc-model-viewer 门面 + mcv 10 模块（含生物群系染色）"} -->

- `m3d/`：场景/相机/控制器、光照预设、材质与 PBR、贴图抽取（高度/法线/粗糙/金属/自发光）、HDRI 环境、宿主挂载、API 设置器。
- `mcv/`：MC 模型解析（parent 继承链、1.21.4+ `items/*.json` 引用树）、几何构建、贴图引用与动画（`.mcmeta` 帧采样）、面编辑、视口渲染；`biome.js` 负责生物群系染色（colormap 采样 + `tintindex`/`tints` 解析）。
- 共享可变状态（如 `lastLayout`）通过 `setLastLayout()` 访问器跨越模块边界 —— ESM 导入绑定只读，直接赋值会抛 `Assignment to constant variable`。

#### 4.2.2 UV 贴图编辑器

<!-- archside: {"id":"leaf-uv","color":"purple","status":"implemented","files":["web/src/uv-editor-core.js","web/src/uvc","web/src/uvc/texture-io.js","web/src/uvc/ui-build.js"],"summary":"uv-editor-core 门面 + uvc 16 模块；贴图替换支持透传 normal/specular 做 PBR 预览"} -->

`uvc/` 覆盖常量和、拖拽、绘制辅助、导出、面操作、命中测试、历史、选择、状态、贴图缓存与 IO、UI 构建。贴图替换链路带 `extra: {normal, specular}` 参数透传到宿主，用于替换主图后同步 3D 视口的 PBR 预览。

#### 4.2.3 对比结果渲染

<!-- archside: {"id":"leaf-render","color":"purple","status":"implemented","files":["web/src/render.js","web/src/rnd","web/src/rnd/rows.js","web/src/rnd/sidebar.js"],"summary":"render.js 门面 + rnd 10 模块；角色遍历统一走 core.js 的 ROLES 常量"} -->

`rnd/` 负责结果表、分组行、侧栏、图表、缩略图单元格、模型卡片/差异/结果与模型预览。角色集合（main/normal/specular/height/emissive）统一由 `core.js` 的 `ROLES` 导出，避免各处硬编码。

#### 4.2.4 节点画布

<!-- archside: {"id":"leaf-nodecanvas","color":"purple","status":"implemented","files":["web/src/node-canvas.js","web/src/node-canvas","web/src/node-canvas/algorithms.js"],"summary":"node-canvas 门面 + 27 模块；纯算法层（噪声/混合/特效/simplex）独立成 algorithms.js"} -->

27 个模块覆盖节点定义、创建与渲染、连线几何、事件、右键菜单、节点库、工具栏、布局、剪贴板、图序列化、导入对话框、示例图、自动保存与对外查询 API。门面末尾统一调用 `set*Hooks` 完成依赖注入（必须放在文件末尾，因为单测会直接调 `createNode`/`getNodeDetail` 而不走 `initNodeCanvas`）。

#### 4.2.5 资产库、工作区与动作

<!-- archside: {"id":"leaf-assetws","color":"purple","status":"implemented","files":["web/src/asset-library.js","web/src/asset-lib","web/src/ws","web/src/actions","web/src/node-preview","web/src/locales"],"summary":"asset-lib 19 模块承载资产库，actions 8 模块承载操作，node-preview 5 模块承载预览窗，locales 按域分片"} -->

- `asset-lib/`：卡片、折叠、右键菜单、详情、过滤、加载器、包浏览器、预设、工程、分区（模型/官方/贴图）与状态单例 `S`。
- `actions/`：加载、历史、复制、文件操作、选项、导出、像素差异、交换 —— 依赖序为 DAG（`reloadAndCompare` 放在 load 避免成环）。
- `node-preview/`：节点详情、资产详情、包内贴图与共享状态访问器。
- `locales/`：`zh`/`en` 各按域切 5 片后由入口 spread 合并，导出形状不变。

### 4.3 样式分片

<!-- archside: {"id":"sec-css","color":"blue","status":"implemented","files":["web/styles.css","web/mc-theme.css","web/node-canvas.css","web/node-editor.css","web/css","tools/split-css-auto.mjs"],"summary":"四个大 CSS 拆为 @import 入口 + 分片目录，按原行号升序保证层叠等价"} -->

`styles.css`、`mc-theme.css`、`node-canvas.css`、`node-editor.css` 均退化为 `@import` 入口，分片落在 `web/css/<name>/`。HTML 的 `<link>` 路径不变。等价性以「展开分片后与原文件逐字符/去空白一致」为验收口径。

## 5 桌面壳与打包

<!-- archside: {"id":"ch-desktop","color":"orange","status":"implemented","files":["electron/main.js","electron/launch.js","electron/package.json","build/installer.nsh","build/license.txt"],"summary":"Electron 主进程拉起本地服务；Windows 走 NSIS 安装器，含许可协议页"} -->



### 5.1 Electron 主进程

<!-- archside: {"id":"leaf-electron","color":"orange","status":"implemented","files":["electron/main.js","electron/launch.js"],"summary":"启动内置服务并加载页面，窗口尺寸由配置持久化"} -->

主进程负责启动后端、等待端口就绪后加载页面，并把窗口状态持久化到配置（卸载时按配置决定是否清除应用数据）。

### 5.2 安装器与许可

<!-- archside: {"id":"leaf-installer","color":"orange","status":"implemented","files":["build/installer.nsh","build/license.txt","package.json"],"summary":"NSIS：自选安装目录、桌面/开始菜单快捷方式、中文用户许可协议页"} -->

electron-builder 的 `nsis` 配置开启 `allowToChangeInstallationDirectory`、创建桌面与开始菜单快捷方式，并以 `build/license.txt` 作为安装期许可页（该文件为 UTF-16 LE + BOM，Unicode NSIS 的 `LicenseData` 需要此编码，UTF-8 无 BOM 会按系统代码页显示乱码）。

## 6 质量保障

<!-- archside: {"id":"ch-quality","color":"teal","status":"implemented","files":["test/unit","test/smoke","backend/internal","eslint.config.js","tools"],"summary":"Node 单测/冒烟 + Go 单测；ESLint、Prettier 与 CSS 拆分工具链"} -->



### 6.1 测试体系

<!-- archside: {"id":"sec-tests","color":"teal","status":"implemented","files":["test/unit","test/smoke","backend/internal/api","backend/internal/fsx","backend/internal/mcmeta","backend/internal/media"],"summary":"Node 617 单测 + 29 冒烟 + 10 WS；Go 137 测试，两端各自覆盖所辖域"} -->

- Node：`npm test`（`node:test`，`test/unit/` 59 个文件）、`npm run test:smoke`（真实起服务，含 WebSocket 集成）。
- Go：`go test ./...`，覆盖 api / fsx / mcmeta / media 四个包。
- 已知 flaky：并行跑时配置写入与缩略图清理存在竞态，单独跑或 `--test-concurrency=1` 串行即通过。

### 6.2 工具链

<!-- archside: {"id":"sec-tools","color":"teal","status":"implemented","files":["tools/split-css-auto.mjs","tools/run-split-css.mjs","eslint.config.js",".prettierrc"],"summary":"CSS 自动分片器（按分节标记切、入口写 @import、覆盖校验）；ESLint 分环境配置"} -->

- `tools/split-css-auto.mjs` + `tools/run-split-css.mjs`：按 `/* ═══` / `/* ──` 分节标记自动切分，产物为分片 + `@import` 入口，并校验分片行数与原正文行数一致。
- ESLint 按目录分环境：`web/**` 用 browser/worker globals，`server|electron` 用 commonjs + node，`test|scripts|tools` 用 esm + node。

## 7 待实现

<!-- archside: {"id":"ch-planned","color":"slate","status":"planned","files":["docs/migration-go-vue.md"],"summary":"两项已立项但未完成的迁移：Go 后端接管默认入口、前端 Vue 化"} -->

本节记录**尚未实现**的目标，与上文已实现部分严格区分。

### 7.1 Go 后端接管默认启动

<!-- archside: {"id":"leaf-planned-goswitch","color":"slate","status":"planned","files":["package.json","server"],"summary":"待办：把默认启动从 Node 切到 Go，并移除被取代的 Node 手写实现"} -->

Go 侧端点已齐备且测试通过，但 `npm start` 仍指向 `server/index.js`。剩余工作：切换默认入口、逐项核对行为一致性、移除已被取代的 Node 手写实现（ZIP/PNG/HDR 解码等），最后删除 `server/` 遗留目录。

### 7.2 前端 Vue 化

<!-- archside: {"id":"leaf-planned-vue","color":"slate","status":"planned","files":[],"summary":"待办：Vue 3 + Vite + Pinia + dockview 重写 UI 外壳；Three.js 与画布相关模块只搬不改"} -->

规划为 F0–F7 阶段推进。原则：Three.js/canvas 相关代码（`m3d`/`mcv`/`uvc`/`node-canvas`）与框架无关，整体搬运并包一层 Vue 组件；真正重写的是 DOM 操作密集的 UI 外壳；停靠布局由 golden-layout 换成 `dockview-vue`（golden-layout 2.x 无官方 Vue 封装），并需要一个布局 JSON 转换器。**尚未开始编码。**

```archside
{
  "version": 1,
  "edges": [
    {
      "id": "edge-goals-capabilities",
      "source": "ch-goals",
      "target": "sec-capabilities",
      "label": "需求分解为功能域",
      "kind": "dependency"
    },
    {
      "id": "edge-goals-runtime",
      "source": "ch-goals",
      "target": "sec-runtime",
      "label": "交付形态",
      "kind": "dependency"
    },
    {
      "id": "edge-arch-topology",
      "source": "ch-arch",
      "target": "sec-topology",
      "label": "运行时拓扑",
      "kind": "dependency"
    },
    {
      "id": "edge-arch-dual",
      "source": "ch-arch",
      "target": "sec-dual-backend",
      "label": "双后端并行约束",
      "kind": "dependency"
    },
    {
      "id": "edge-topology-go",
      "source": "sec-topology",
      "target": "leaf-go-backend",
      "label": "/api 与静态资源",
      "kind": "data"
    },
    {
      "id": "edge-topology-node",
      "source": "sec-topology",
      "target": "leaf-node-server",
      "label": "当前默认服务",
      "kind": "data"
    },
    {
      "id": "edge-dual-goroutes",
      "source": "sec-dual-backend",
      "target": "leaf-go-routes",
      "label": "端点覆盖关系",
      "kind": "data"
    },
    {
      "id": "edge-backend-golayers",
      "source": "ch-backend",
      "target": "sec-go-layers",
      "label": "领域分层",
      "kind": "dependency"
    },
    {
      "id": "edge-golayers-goroutes",
      "source": "sec-go-layers",
      "target": "leaf-go-routes",
      "label": "httpx 装配路由",
      "kind": "dependency"
    },
    {
      "id": "edge-golayers-goservices",
      "source": "sec-go-layers",
      "target": "leaf-go-services",
      "label": "领域实现",
      "kind": "dependency"
    },
    {
      "id": "edge-goroutes-goservices",
      "source": "leaf-go-routes",
      "target": "leaf-go-services",
      "label": "handler 调用服务",
      "kind": "data"
    },
    {
      "id": "edge-backend-storage",
      "source": "ch-backend",
      "target": "sec-storage",
      "label": "共享数据目录约定",
      "kind": "data"
    },
    {
      "id": "edge-frontend-shell",
      "source": "ch-frontend",
      "target": "sec-shell",
      "label": "外壳入口",
      "kind": "dependency"
    },
    {
      "id": "edge-frontend-modules",
      "source": "ch-frontend",
      "target": "sec-modules",
      "label": "模块化拆分",
      "kind": "dependency"
    },
    {
      "id": "edge-shell-modules",
      "source": "sec-shell",
      "target": "sec-modules",
      "label": "renderer 初始化各模块",
      "kind": "dependency"
    },
    {
      "id": "edge-modules-3d",
      "source": "sec-modules",
      "target": "leaf-3d",
      "label": "3D 视口模块",
      "kind": "data"
    },
    {
      "id": "edge-modules-uv",
      "source": "sec-modules",
      "target": "leaf-uv",
      "label": "UV 编辑模块",
      "kind": "data"
    },
    {
      "id": "edge-modules-render",
      "source": "sec-modules",
      "target": "leaf-render",
      "label": "结果渲染模块",
      "kind": "data"
    },
    {
      "id": "edge-modules-nodecanvas",
      "source": "sec-modules",
      "target": "leaf-nodecanvas",
      "label": "节点画布模块",
      "kind": "data"
    },
    {
      "id": "edge-modules-assetws",
      "source": "sec-modules",
      "target": "leaf-assetws",
      "label": "资产与工作区模块",
      "kind": "data"
    },
    {
      "id": "edge-frontend-css",
      "source": "ch-frontend",
      "target": "sec-css",
      "label": "样式分片",
      "kind": "data"
    },
    {
      "id": "edge-css-tools",
      "source": "sec-css",
      "target": "sec-tools",
      "label": "分片由工具生成",
      "kind": "dependency"
    },
    {
      "id": "edge-3d-uv",
      "source": "leaf-3d",
      "target": "leaf-uv",
      "label": "PBR 贴图透传",
      "kind": "data"
    },
    {
      "id": "edge-desktop-electron",
      "source": "ch-desktop",
      "target": "leaf-electron",
      "label": "主进程",
      "kind": "dependency"
    },
    {
      "id": "edge-desktop-installer",
      "source": "ch-desktop",
      "target": "leaf-installer",
      "label": "打包交付",
      "kind": "dependency"
    },
    {
      "id": "edge-electron-topology",
      "source": "leaf-electron",
      "target": "sec-topology",
      "label": "加载本地服务页面",
      "kind": "data"
    },
    {
      "id": "edge-quality-tests",
      "source": "ch-quality",
      "target": "sec-tests",
      "label": "测试体系",
      "kind": "dependency"
    },
    {
      "id": "edge-quality-tools",
      "source": "ch-quality",
      "target": "sec-tools",
      "label": "静态检查与生成工具",
      "kind": "dependency"
    },
    {
      "id": "edge-tests-backend",
      "source": "sec-tests",
      "target": "sec-go-layers",
      "label": "覆盖各领域包",
      "kind": "data"
    },
    {
      "id": "edge-modules-plannedvue",
      "source": "leaf-planned-vue",
      "target": "sec-modules",
      "label": "复用已拆模块",
      "kind": "optional"
    },
    {
      "id": "edge-planned-go",
      "source": "ch-planned",
      "target": "leaf-planned-goswitch",
      "label": "迁移遗留",
      "kind": "dependency"
    },
    {
      "id": "edge-planned-vue",
      "source": "ch-planned",
      "target": "leaf-planned-vue",
      "label": "迁移遗留",
      "kind": "dependency"
    },
    {
      "id": "edge-goswitch-node",
      "source": "leaf-planned-goswitch",
      "target": "leaf-node-server",
      "label": "完成后删除遗留",
      "kind": "optional"
    },
    {
      "id": "edge-goswitch-go",
      "source": "leaf-planned-goswitch",
      "target": "leaf-go-backend",
      "label": "接管默认入口",
      "kind": "dependency"
    }
  ]
}
```

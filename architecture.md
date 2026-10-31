# matoga — Minecraft 材质贴图对比工具

matoga（v3.3.0，作者 芝世 / xiongmiaozai）用于对比 Minecraft 资源包与材质贴图的差异：并排比对、像素级差异、模型与 PBR 贴图的三维预览。仓库当前处于**双后端并行**阶段 —— Go 后端已实现 Node 侧全部 92 个端点，但默认启动入口仍是 Node 服务；前端为无构建工具的原生 ES Modules，Vue 化尚未开始。

## 1 项目目标与范围

<!-- archside: {"id":"ch-goals","color":"blue","status":"implemented","files":["README.md","docs/modularization-plan.md","docs/migration-go-vue.md"],"summary":"产品定位、六大功能域与两项结构性迁移目标"} -->

本项目分两条线：**功能线**是做一个能对比 MC 材质包/贴图的工作台（并排比对、像素差异、模型与 PBR 三维预览、制作包与导出）；**结构线**是两项已立项的迁移 —— 后端由 Node 换成 Go、前端由原生 ESM 换成 Vue。

### 1.1 产品定位与核心能力

<!-- archside: {"id":"sec-capabilities","color":"blue","status":"implemented","files":["web/index.html","web/node-editor.html","web/src/asset-library.js","web/src/material3d.js","web/src/uv-editor-core.js","web/src/node-canvas.js"],"summary":"六大功能域：文件对比、贴图/资产库、3D 视口、UV 编辑、节点画布、制作包导出"} -->

| 功能域 | 说明 | 前端入口 | 后端支撑 |
| --- | --- | --- | --- |
| 文件对比 | 左右目录树扫描、哈希/AHash/DHash 比对、分组差异表 | `web/index.html`、`web/src/render.js` | `api/compare`、`fsx` |
| 贴图与资产库 | MC 包内贴图浏览分页、HDRI 预设、模型资产聚合 | `web/src/asset-library.js` | `api/asset`、`mcmeta`、`media` |
| 3D 视口 | MC 方块模型与导入模型渲染、PBR 贴图、生物群系染色、贴图动画 | `web/src/material3d.js`、`web/src/mc-model-viewer.js` | `api/imported-models`、`media` |
| UV 贴图编辑 | 面 UV 拖拽/旋转/镜像、贴图库替换、PBR 配套贴图 | `web/src/uv-editor-core.js`、`web/src/panels/uvEditor` | `api/file`、`media` |
| 节点画布 | ComfyUI 风格节点图（噪声/混合/特效），可产出贴图 | `web/src/node-canvas.js`、`web/node-editor.html` | `api/node-projects`、`api/pack-builder` |
| 制作包与导出 | 自选清单、整包/单文件复制、导出 zip 资源包 | `web/src/create-pack-dialog.js` | `api/craft-pack`、`packbuilder` |

### 1.2 运行形态与交付

<!-- archside: {"id":"sec-runtime","color":"blue","status":"implemented","files":["package.json","electron/main.js","build/installer.nsh","build/license.txt"],"summary":"Web 服务 + Electron 桌面壳两种形态；NSIS 安装器交付"} -->

- **Web 服务**：Node 默认 `127.0.0.1:5273`，Go 默认 `5123`，均可 `--port` 覆盖。
- **桌面端**：Electron 主进程 `electron/main.js` 拉起本地服务并加载页面。
- **打包**：npm workspaces（`server` / `web` / `electron`，均为 `@matoga/* 3.2.0`）；Windows 走 electron-builder NSIS，支持自选安装目录与许可协议页。

## 2 系统架构总览

<!-- archside: {"id":"ch-arch","color":"purple","status":"implemented","files":["server/app.js","backend/internal/api/router.go","web/index.html"],"summary":"前端 → HTTP /api + WebSocket → 后端服务 → 资源包与 data 目录"} -->

系统按「前端（浏览器）→ HTTP `/api` + WebSocket → 后端服务 → 资源包与 `data/` 目录」四段组织。前端不引入构建工具，静态资源由后端直接托管；长任务（批量复制、缩略图生成）走 WebSocket 推送进度。

### 2.1 运行时拓扑

<!-- archside: {"id":"sec-topology","color":"purple","status":"implemented","files":["server/app.js","backend/internal/api/router.go","backend/internal/httpx","web/index.html"],"summary":"静态托管 + /api 路由 + /vendor 依赖 + WS 进度通道 + LAN 鉴权"} -->

- `web/` 与 `/vendor/{three,golden-layout}` 由后端静态托管。Go 侧由 `Router.Vendor(nodeModules)` 挂载四个前缀（含 golden-layout 省略 `.js` 的补齐）；缺失的带扩展名资源必须返回 404 而非 SPA 回退的 HTML，否则浏览器会报 `Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"`，页面完全无法启动。
- 业务统一走 `/api/*`；`/api/health` 位于鉴权之前，其余端点经 token 中间件（`?token=` 或 `x-matoga-token`）。
- LAN 模式生成随机 token，并禁用 `shell` 类本地能力（返回 `ERR_LAN_FORBIDDEN`）。
- 同步/复制进度经 WebSocket：客户端发 `{type:'sync'|'cancel'}`，服务端回 `progress` / `done`。
- **中间件包装 ResponseWriter 必须透传 `http.Hijacker`**：否则 WebSocket 握手一律返回 501 Not Implemented（Go 侧 `statusRecorder` 曾踩此坑）。
- `/api/*.js` 一类静态文件（实为 `web/api/`）必须在 `/api` 404 兜底**之前**查找，Node 侧靠 `express.static` 的顺序天然满足。

### 2.2 双后端并行状态

<!-- archside: {"id":"sec-dual-backend","color":"purple","status":"implemented","files":["server/index.js","backend/cmd/matoga/main.go","electron/main.js","docs/migration-go-vue.md"],"summary":"Go 已覆盖 Node 全部 92 个端点；Electron 优先启动 Go、失败回退 Node"} -->

两套后端**同时存在且都能独立起服务**。端点覆盖已逐条比对为 **92 : 92**（Go 侧另有 18 个 Node 没有的端点，主要是三组包路由的 `list`/`version-map` 展开）。

`electron/main.js` 的 `resolveGoBackend()` 按序查找 `<resources>/matoga-backend(.exe)` → `<projectRoot>/backend/` → `<projectRoot>/dist-go/`，优先启动 Go，**启动失败自动回退 Node**；两者共用 `startWithError(cmd, args, env)` 等待 stdout 的 `MATOGA_LISTENING:<port>` 行。Go 侧必须**先显式 `net.Listen` 成功再宣布就绪**，否则存在「日志已打印但端口未监听」的窗口期。

#### 2.2.1 Go 后端（迁移目标，端点已齐备）

<!-- archside: {"id":"leaf-go-backend","color":"purple","status":"implemented","files":["backend/cmd/matoga/main.go","backend/internal/api","backend/internal/platform","backend/go.mod"],"summary":"73 个 Go 文件 / 16625 行，13 个领域包，92/92 端点覆盖，143 个测试全绿"} -->

- 模块 `github.com/xiongmiaozai/matoga/backend`；路由用 `chi` v5。
- `cmd/matoga/main.go` 只做装配：flag（`-port` / `-lan` / `-data-root` / `-web`）→ 解析路径 → 构造 store/media 服务 → `api.Mount`。
- 主动换库的边界：ZIP 用标准库 `archive/zip`（替掉 Node 侧手写中央目录与 CRC）、PNG 用 `image/png`、EXR 用 `go-openexr`、blurhash 用 `go-blurhash`、WebSocket 用 `coder/websocket`（`nhooyr.io/websocket` 已弃用）；而**降采样与灰度换算不换**（要求与 Node 版逐位一致）、**哈希输出格式不换**（已是十六进制串，换库会破坏既有对比记录）。
- 已验证：`go vet` 干净、`go build ./...` 通过、`go test ./...` 143 个测试全绿。
- 本机无 gcc，`go test -race` 不可用，并发正确性靠代码审查（WS send 走 `writeMu`、active map 走 `mu`）。

#### 2.2.2 Node 遗留服务（当前默认）

<!-- archside: {"id":"leaf-node-server","color":"purple","status":"implemented","files":["server/index.js","server/app.js","server/routes","server/services","server/config","server/middleware","server/ws.js"],"summary":"Express 5 + ws 的现行实现，仍在默认启动路径上"} -->

分层为 `routes → services → config`：路由薄、服务厚，不跨层调用。手写实现中已被 Go 侧取代的部分（ZIP 中央目录解析、PNG 编码与降采样、HDR/EXR 解码、手写 zip 打包）是 Go 切换完成后的可删代码。

## 3 后端

<!-- archside: {"id":"ch-backend","color":"teal","status":"implemented","files":["backend","server"],"summary":"Go 13 个领域包与 Node 遗留分层，共享同一套资源包与数据目录约定"} -->

两端共用同一份数据约定：`DATA_ROOT`（运行时数据，含 `data/`）、`PRESET_ROOT`（预设资源包根）、`RES_ROOT`（静态资源根）。

### 3.1 Go 领域分层

<!-- archside: {"id":"sec-go-layers","color":"teal","status":"implemented","files":["backend/internal/httpx","backend/internal/fsx","backend/internal/store","backend/internal/media","backend/internal/mcmeta","backend/internal/lang","backend/internal/theme","backend/internal/packbuilder","backend/internal/syncpack"],"summary":"契约层 httpx / 文件安全 fsx / 持久化 store / 图像 media / 包分析 mcmeta / 生成 packbuilder / 域服务 lang·theme·syncpack·craftpack·upload·syncjob"} -->

| 包 | 职责 |
| --- | --- |
| `httpx` | 路由封装、统一响应信封、错误码映射、鉴权中间件、Hijacker 透传 |
| `fsx` | 信任根、路径越界校验（`GuardRead`/`GuardWrite`）、扫描、哈希与 AHash/DHash |
| `store` | 配置（原子写 + 串行队列）、资产、导入模型、自定义模型、节点工程、工作区、主题持久化 |
| `media` | HDR/EXR 解码、tonemap、PNG/缩略图编码、blurhash、HDRI 列表、缓存统计与清理 |
| `mcmeta` | 包元数据解析、包列表/重命名、贴图与条目浏览、模型遍历、多包交叉对比、贴图索引 |
| `packbuilder` | 资源包生成（目录 / zip），`pack.mcmeta` 两种写法、自动归类、同名改名 |
| `syncpack` | 把模型 JSON 同步进资源包目录（强制 `assets/` 前缀校验） |
| `syncjob` | 批量复制的进度推送与取消（串行执行、失败不中止、取消只在项与项之间生效） |
| `lang` | 中文译名映射（内置表 + 各包 `zh_cn.json`，懒加载缓存，实测 1706 条） |
| `theme` | 界面主题（4 内置 + 自定义，65 项 CSS 变量白名单） |
| `craftpack` | 自选清单、单文件/整包复制、导出制作包 |
| `upload` | 分片上传会话 |
| `platform` | 资源/数据/预设根路径解析 |
| `api` | 18 个 handler 与路由装配 |

#### 3.1.1 API 路由与端点

<!-- archside: {"id":"leaf-go-routes","color":"teal","status":"implemented","files":["backend/internal/api/router.go","backend/internal/api"],"summary":"92/92 端点覆盖；18 个分组，三组包路由由 mountPackGroup 复用展开"} -->

`api.Mount(r, s Services)` 集中装配。`Services` 中路径类依赖用 `func() string` 而非字符串，运行时改配置后立即生效。三组包路由（`/craft-packs`、`/mc-packs`、`/mc-official`）由 `mountPackGroup` 展开，仅 `mc-official` 额外暴露 `version-map` 与 `tex-index`。

**一个必须遵守的注册顺序约束**：静态路径（`version-map`、`tex-index`）必须注册在 `/{name}` 通配**之前**，否则 chi 会把 `tex-index` 当成 `name` 匹配掉，导致 404。

| 分组 | 端点数 | 说明 |
| --- | --- | --- |
| health / config | 1 + 3 | 含 GET/PUT/DELETE config |
| fs / file | 3 + 9 | browse/search/create；hash/copy/backup/delete/raw/thumb/thumb-info/thumb-info-batch/write |
| hdri / asset | 5 + 11 | 预设与缩略图；列表/type/tex/model/model-cross/info/model-thumb×3/favorites/recent |
| shell / upload / compare / panels | 2 / 3 / 1 / 1 | 本地能力、分片上传、目录扫描、面板清单 |
| workspace / node-projects | 5 + 6 | 布局预设与节点工程 |
| imported-models / custom-models | 10 + 9 | 含贴图增删查与 sync-pack |
| craft-pack | 9 | 清单、复制、导出 |
| craft-packs / mc-packs / mc-official | 各 7 | list/version-map/rename/textures/entries/raw(+tex-index) |
| **pack-builder** | 2 | formats / build |
| **cache** | 4 | stats / clear / clear-all / hdri-orphans |
| **themes** | 5 | list / get / put / delete / import |
| **lang** | 1 | zh |
| **ws** | 2 | `/api/ws` 与 `/api/ws/` 两条握手路径 |

#### 3.1.2 领域服务

<!-- archside: {"id":"leaf-go-services","color":"teal","status":"implemented","files":["backend/internal/media/hdr.go","backend/internal/media/thumb_encode.go","backend/internal/mcmeta/analyze.go","backend/internal/mcmeta/browse.go","backend/internal/mcmeta/crosscompare.go","backend/internal/mcmeta/texindex.go","backend/internal/packbuilder/packbuilder.go","backend/internal/lang/lang.go","backend/internal/syncjob/syncjob.go"],"summary":"图像与包分析实现；交叉对比、贴图索引、包生成、译名映射与批量同步作业"} -->

- `mcmeta.readZipEntries` 返回的 `*zip.File` 只能读元数据；要读内容必须重新 `zip.OpenReader`（`readZipEntryBytes`），否则 `file already closed`，症状是 zip 包 `valid=false` 且 `error` 为空。
- `CrossCompareModels` 按模型路径聚合多包，标注每包存在性与大小差异；`ListAllTexPaths` 目录递归 + zip 中央目录，去重排序供前端校验贴图引用。
- `packbuilder.Build` 用 `archive/zip` 生成，包内同名路径自动改名（`-2`/`-3`）而非覆盖。
- `syncjob.Runner` 串行执行、失败不中止；`wsConn` 的 `writeMu` 保证 websocket 不并发写。
- `platform.resolveResRoot` **先查工作目录再查 execDir**：`go run` 时二进制在系统临时目录，只查 execDir 会找不到资源根（曾导致 `lang` 返回空映射、`/api/panels` 返回空列表）。
- **路径比较必须统一分隔符**：`withinTrusted` 若只按 `\` 比较，Windows 下前端传 `C:/a/b` 会被误判越界（`path outside trusted roots`），导致批量复制全部失败。

### 3.2 存储与数据目录

<!-- archside: {"id":"sec-storage","color":"teal","status":"implemented","files":["server/config","backend/internal/store","backend/internal/platform/paths.go"],"summary":"配置原子写、缩略图缓存命名规则、资源包根与运行时数据分离"} -->

- 配置：`config.json` 用 `temp + rename` 原子写，写入走串行队列；`Get()` 补齐默认目录项。
- 缩略图缓存名 = 路径小写归一后的 md5（贴图 `.jpg`、HDRI `.png`、模型独立目录），带 `stale` 判定与孤儿清理。
- **缓存失效必须「返回即已生效」**：`invalidate` 里的删除若用未 await 的 `fs.promises.unlink`，失效后立刻读缩略图仍会命中待删除的旧文件（Windows 上表现为测试偶发失败）。
- 资源包根（`mc-packs` / `official-packs` / `craft-packs` / `hdri-presets`）与运行时数据（`data/`）分离，前者不入版本控制。

## 4 前端

<!-- archside: {"id":"ch-frontend","color":"orange","status":"implemented","files":["web/index.html","web/node-editor.html","web/src","web/css","web/renderer.js"],"summary":"无构建工具的原生 ESM 应用，两页面 + 11 个模块目录，四大主文件均已拆分达标"} -->

前端刻意不引入 webpack/vite/rollup，浏览器直接加载 ES Modules。两个页面：`web/index.html`（主对比界面）与 `web/node-editor.html`（节点编辑器）；布局停靠用 golden-layout，三维用 three。

### 4.1 应用外壳与入口

<!-- archside: {"id":"sec-shell","color":"orange","status":"implemented","files":["web/renderer.js","web/src/workspace.js","web/src/core.js","web/src/i18n.js","web/src/header.js"],"summary":"renderer 分步初始化，workspace 管停靠布局与预设，core 提供共享状态与 DOM 引用"} -->

`web/renderer.js` 按 `step()` 顺序初始化（含 `initWorkspace`）。`web/src/workspace.js` 管理 golden-layout 停靠布局、面板注册与布局预设；`web/src/core.js` 提供全局 `state`、DOM 引用与角色常量 `ROLES`。

### 4.2 模块化拆分

<!-- archside: {"id":"sec-modules","color":"orange","status":"implemented","files":["web/src/node-canvas","web/src/hpre","web/src/nrel","web/src/panels","web/src/locales","web/src/theme","web/src/asset-lib","web/src/m3d","web/src/mcv","web/src/rnd","web/src/uvc","web/api"],"summary":"11 个模块目录 + web/api 适配层；本轮重新拆出 asset-lib/m3d/mcv/rnd/uvc 五组，并删除了孤立的 ws/"} -->

当前实际存在的 `web/src/` 子目录共 11 个：`asset-lib`、`hpre`、`locales`、`m3d`、`mcv`、`node-canvas`、`nrel`、`panels`、`rnd`、`theme`、`uvc`；另有一组 `web/api/folder-tree-*` 适配层模块。

**状态说明**：上游 v3.2.0 曾把 `node-canvas.js`、`asset-library.js`、`material3d.js`、`mc-model-viewer.js`、`render.js`、`workspace.js`、`uv-editor-core.js` 等改回单文件，原拆分目录在合并时被移除。本轮已重新拆出 `asset-lib`/`m3d`/`mcv`/`rnd`/`uvc` 五组，各主文件行数见 §7.3；同时删除了 `ws/`（11 个模块 1332 行，全仓零引用）。

#### 4.2.1 节点画布

<!-- archside: {"id":"leaf-nodecanvas","color":"orange","status":"implemented","files":["web/src/node-canvas.js","web/src/node-canvas/math.js","web/src/node-canvas/noise.js","web/src/node-canvas/ps-blend.js","web/src/node-canvas/texture.js","web/src/node-canvas/widgets.js","web/src/node-canvas/node-defs.js","web/src/node-canvas/preview-sync.js","web/src/node-canvas/import-dialog.js","web/src/node-canvas/library.js","web/src/node-canvas/persist.js","web/src/node-canvas/clipboard.js"],"summary":"node-canvas.js 2672 行；上游保留 math/noise/ps-blend/texture 四个算法模块，本次新增 widgets/node-defs/preview-sync/import-dialog/library/persist/clipboard"} -->

`web/src/node-canvas/` 下 12 个模块：上游自带的 `math`（数值/颜色/插值）、`noise`（噪声与场函数）、`ps-blend`（27 种 PS 混合模式）、`texture`（贴图合成算子），以及本次抽出的 `widgets.js`（滑条/取色/向量等控件构建，经 `setWidgetHooks` 注入 `evaluate`/`_markDirty`）、`node-defs.js`（NODE_DEFS 节点类型定义 + 噪波纹理输出队列，两段必须同模块，经 `setTexHooks({state, evaluate})` 注入）、`preview-sync.js`（联动预览 7 函数，经 `setStateHooks({state})` 注入）、`import-dialog.js`（导入贴图对话框 13 个声明，经 `setImportHooks({canvasWrap, screenToWorld, createNode, toast})` 注入）、`library.js`（节点库面板 11 函数，经 `setNodeCanvasLibraryHooks` 注入 12 只读 + 4 可写状态）、`persist.js`（项目持久化 8 函数：拓扑排序 / Comfy 转换 / 保存加载，经 `setNodeCanvasPersistHooks` 注入 `_currentProject`/`_suspendAutoSave`）、`clipboard.js`（剪贴板 3 函数，经 `setNodeCanvasClipboardHooks` 注入 `_clipboard`）。主文件 4144 → 2672 行（−36%）。

**hooks 接线铁律**：所有 `set*Hooks(...)` 调用必须放在主文件**末尾**（所有定义之后），不能放进 `initNodeCanvas()`。否则 `test/unit/fxnodes.test.js` 直接调 `mod.createNode()` 时求值引擎拿到空 `NODE_DEFS`，会挂 20 个测试。

#### 4.2.2 资产库、面板与适配层

<!-- archside: {"id":"leaf-assetws","color":"orange","status":"implemented","files":["web/src/asset-library.js","web/src/asset-lib","web/src/panels","web/src/node-preview.js","web/src/mcv","web/src/rnd","web/api"],"summary":"asset-library.js 1879 行；asset-lib/ 承接导出/浏览/收集/工具栏/详情，rnd/ 承接模型卡片渲染；panels 为 manifest 驱动的动态面板"} -->

- `panels/`：manifest 驱动，含 assetLibrary / categoryFilter / compare / folderCard / material3d / modelCategory / nodeCanvas / nodeLibrary / nodePreview / nodeRel / preview / uvEditor 共 12 个面板。
- `asset-lib/`：资产库的导出对话框（`export-dialog.js`，批量选包 + zip 下载），本轮新增 `browse.js`（包内容浏览 20 函数）、`collect.js`（收集分组与分区构建 9 函数）、`toolbar.js`（工具栏与过滤 5 函数）、`detail.js`（资产详情面板与元信息 8 函数），主文件 3017 → 1879 行（−38%）。
- `rnd/`：`model-cards.js`，模型类型的卡片网格与详情/对比/预览渲染（从 `render.js` L530-754 逐字搬出，段外符号经 `setHooks` 注入）。
- `mcv/`：`geometry.js`，`defaultFaceUv` 按 MC 像素坐标算六面默认 UV、`resolveItemDefs` 递归解析 item 定义。
- `hpre/`：HDRI 预设的状态、缩略图、预览与对接。
- `nrel/`：节点关系图的森林、布局、渲染与交互。
- `web/api/`：`api-client.js` 是 `window.api` 实现；`folder-tree.js` 及其 8 个 `folder-tree-*` 模块构成目录选择器（已 ESM 化，`index.html` 以 `type="module"` 加载）。

> 已删除：原 `web/src/ws/` 的 11 个模块（1332 行）从未被任何文件 import（静态 import / 动态 import / HTML script / 测试覆盖四路核实均为 0），是一次中止的拆分留下的孤儿代码，已整体移除。

### 4.3 样式分片

<!-- archside: {"id":"sec-css","color":"orange","status":"implemented","files":["web/styles.css","web/mc-theme.css","web/node-canvas.css","web/workspace.css","web/css","tools/split-css-auto.mjs"],"summary":"五个大 CSS 拆为 @import 入口 + 分片目录，按原行号升序保证层叠等价"} -->

`styles.css`、`mc-theme.css`、`node-canvas.css`、`workspace.css`、`node-editor.css` 均退化为 `@import` 入口，分片落在 `web/css/<name>/`。HTML 的 `<link>` 路径不变。

**分片入口的 `@import` 必须写 `./css/<name>/xxx.css`**：曾写成 `./<name>/xxx.css`，而分片实际在 `web/css/<name>/`，导致 5 个入口 40 条 import 全部 404（实测 229 失败请求 / 119 控制台错误、页面完全无样式）。

等价性验收口径：**递归展开 `@import` → 去注释与全部空白后逐字符一致 + 顶层规则块计数一致**（比"去空行"更强；只看一层会误判"丢样式"）。实测四个文件全部通过：

| 文件 | 分片数 | 字符数（归一后） | 规则块 |
| --- | --- | --- | --- |
| `styles.css` | 19 | 96736 | 1022 |
| `node-canvas.css` | 6 | 56723 | 549 |
| `mc-theme.css` | 6 | 34321 | 351 |
| `workspace.css` | 4 | 16411 | 185 |

注意 prettier 会把 `cubic-bezier(.2,.7,.2,1)` 归一为 `cubic-bezier(0.2, 0.7, 0.2, 1)` 并补块尾分号，CSS 语义等价但改变字符序列 —— 与上游对比时两边都必须先经 prettier 归一。

## 5 桌面壳与打包

<!-- archside: {"id":"ch-desktop","color":"slate","status":"implemented","files":["electron/main.js","electron/launch.js","electron/package.json","build/installer.nsh","build/license.txt"],"summary":"Electron 主进程拉起本地服务；Windows 走 NSIS 安装器，含许可协议页"} -->



### 5.1 Electron 主进程

<!-- archside: {"id":"leaf-electron","color":"slate","status":"implemented","files":["electron/main.js","electron/launch.js"],"summary":"启动内置服务并加载页面，窗口尺寸由配置持久化，后端优先 Go、失败回退 Node"} -->

主进程负责启动后端、等待端口就绪后加载页面，并把窗口状态持久化到配置（卸载时按配置决定是否清除应用数据）。后端选择见 §2.2。

### 5.2 安装器与许可

<!-- archside: {"id":"leaf-installer","color":"slate","status":"implemented","files":["build/installer.nsh","build/license.txt","package.json"],"summary":"NSIS：自选安装目录、桌面/开始菜单快捷方式、中文用户许可协议页"} -->

electron-builder 的 `nsis` 配置开启 `allowToChangeInstallationDirectory`、创建桌面与开始菜单快捷方式，并以 `build/license.txt` 作为安装期许可页。**编码要求**：Unicode NSIS 的 `LicenseData` 需要 **UTF-16 LE + BOM**；UTF-8 无 BOM 会按系统代码页显示乱码。为让 GitHub PR 预览正常，仓库内改为 **UTF-8 BOM**（两种编码实测都能让安装向导的中文正常显示）。

## 6 质量保障

<!-- archside: {"id":"ch-quality","color":"rose","status":"implemented","files":["test/unit","test/smoke","backend/internal","eslint.config.js","tools","scripts"],"summary":"Node 755 单测/29 冒烟 + Go 143 测试；ESLint、Prettier、CSS 拆分器与三层验证脚本"} -->



### 6.1 测试体系

<!-- archside: {"id":"sec-tests","color":"rose","status":"implemented","files":["test/unit","test/smoke","backend/internal/api","backend/internal/fsx","backend/internal/mcmeta","backend/internal/media","scripts/run-unit-tests.mjs"],"summary":"Node 755 单测 + 29 冒烟（API 19 + WS 10）；Go 143 测试，两端各自覆盖所辖域"} -->

- Node：`npm test`（`node:test`，`test/unit/` 71 个文件、755 用例）、`npm run test:smoke`（真实起服务，含 WebSocket 集成）。
- Go：`go test ./...`，143 个测试函数。
- **单测必须串行**：并行跑时多测试文件争用真实 `data/config.json`，报 `EPERM: rename 'data/config.json.<uuid>.tmp'`，用 `--test-concurrency=1` 即稳定。
- **单测必须限定 `test/unit`**：裸 `node --test` 会误纳非 unit 测试（实测多出 13 个）。
- **跨平台 runner**：`node --test "test/unit/**/*.test.js"` 的 `**` 在 Linux CI 上 shell 不展开、Node 24 也不展开，报 `Could not find ...`；改用 `scripts/run-unit-tests.mjs` 由 Node 自己枚举。
- **冒烟测试不能依赖本机资源包目录**：`hdri-presets/` 在 `.gitignore` 里，CI 上不存在会导致 `ERR_FS`；应传隔离的 `presetRoot` 让测试自建空目录。
- 已修复的 flaky 根因：`model-thumb-service.invalidate` 用未 await 的异步删除，导致失效后仍可能读到旧缩略图，已改为同步 `fs.unlinkSync`（连跑 6 次从挂 4 次变为全过）。

### 6.2 工具链与验证脚本

<!-- archside: {"id":"sec-tools","color":"rose","status":"implemented","files":["tools/split-css-auto.mjs","tools/run-split-css.mjs","scripts/audit-web-refs.mjs","scripts/browser-e2e.mjs","scripts/browser-shots.mjs","eslint.config.js","scripts/run-unit-tests.mjs"],"summary":"CSS 自动分片器；引用审计、浏览器实测与截图三个验证脚本；跨平台单测 runner"} -->

- `tools/split-css-auto.mjs` + `tools/run-split-css.mjs`：按分节标记自动切分，产物为分片 + `@import` 入口，并校验行数。**Windows 上不能靠 `import.meta.url === file://${process.argv[1]}` 判断入口**（路径反斜杠导致永假，脚本会静默不执行），必须另建显式驱动脚本。
- `scripts/audit-web-refs.mjs`：静态扫描 `web/` 全部 ESM，找出「用到但未 import 且别处有导出」的标识符（去注释与字符串后匹配，避免误报）。**它的盲区是全大写常量与漏加 `S.` 前缀的模块级状态**，这两个只能靠 ESLint 的 `no-undef` 兜底。
- `scripts/browser-e2e.mjs`：真实 Chromium 走 9 步核心流程，收集控制台错误/未捕获异常/4xx，以退出码表达结果。
- `scripts/browser-shots.mjs`：同流程逐页截图，产物属本地产物（已 gitignore）。
- `scripts/run-unit-tests.mjs`：跨平台递归枚举 `test/unit/**/*.test.js` 后串行执行。
- ESLint 按目录分环境：`web/**` 用 browser globals，`server|electron` 用 commonjs + node，`test|scripts|tools` 用 esm + node。**新增脚本目录必须同步加入 `files`**，否则 `process`/`console` 会报 `no-undef` error 让 CI 变红。
- Prettier：存量未格式化文件列入 `.prettierignore`（清一个删一行，债务只减不增），保证 `format:check` 能反映新增文件的问题。
- **禁止用正则批量剔 import**：实测一次 `tools/prune-unused-imports.mjs` 破坏了 42 个文件的 import 语法，只能立即 `git checkout --` 全量回退；此类清理必须 AST 级工具或逐文件人工确认。

## 7 待实现

<!-- archside: {"id":"ch-planned","color":"olive","status":"planned","files":["docs/migration-go-vue.md"],"summary":"两项未完成：Go 接管默认入口、Vue 化；前端大文件拆分已全部完成"} -->

本节记录**尚未实现**的目标，与上文已实现部分严格区分。

### 7.1 Go 后端接管默认启动

<!-- archside: {"id":"leaf-planned-goswitch","color":"olive","status":"planned","files":["package.json","server","electron/main.js"],"summary":"待办：把默认启动从 Node 切到 Go，并移除被取代的 Node 手写实现"} -->

Go 侧 92/92 端点齐备且测试通过，Electron 已优先启动 Go 并支持回退，但 `npm start` 仍指向 Node。剩余工作：切换默认入口、逐项核对行为一致性（尤其 WebSocket 进度与鉴权）、移除已被取代的 Node 手写实现，最后删除 `server/` 遗留目录。

### 7.2 前端 Vue 化

<!-- archside: {"id":"leaf-planned-vue","color":"olive","status":"planned","files":["docs/migration-go-vue.md"],"summary":"待办：Vue 3 + Vite + Pinia + dockview 重写 UI 外壳；Three.js 与画布相关模块只搬不改"} -->

规划为 F0–F7 阶段。原则：Three.js/canvas 相关代码（`node-canvas`、`material3d`、`uv-editor-core`、`mc-model-viewer`）与框架无关，整体搬运并包一层 Vue 组件；真正重写的是 DOM 操作密集的 UI 外壳；停靠布局由 golden-layout 换成 `dockview-vue`（golden-layout 2.x 无官方 Vue 封装），需要布局 JSON 转换器。**尚未开始编码。**

### 7.3 前端大文件重新拆分

<!-- archside: {"id":"leaf-planned-resplit","color":"olive","status":"implemented","files":["web/src/node-canvas.js","web/src/asset-library.js","web/src/material3d.js","web/src/mc-model-viewer.js","web/src/render.js","web/src/workspace.js","web/src/uv-editor-core.js","web/src/rnd","web/src/uvc","web/src/m3d","web/src/mcv","web/src/asset-lib"],"summary":"上游合并回退了部分拆分，本轮已重新抽出 rnd/uvc/m3d/mcv/asset-lib 等模块，四大主文件全部达标（≤上游×0.6）"} -->

上游 v3.2.0 把多个已拆分的文件重写为单文件，合并时移除了对应模块目录。本轮已重新拆分并更新实测行数（拆分前 → 当前，均达 ≤上游×0.6 目标）：

| 文件 | 拆分前 | 目标 | 当前 | 新抽出的模块 |
| --- | --- | --- | --- | --- |
| `web/src/node-canvas.js` | 4144 | ≤2727 | **2672** | `node-canvas/{node-defs,preview-sync,import-dialog,library,persist,clipboard}.js` |
| `web/src/asset-library.js` | 3017 | ≤1887 | **1879** | `asset-lib/{export-dialog,browse,collect,toolbar,detail}.js` |
| `web/src/material3d.js` | 2893 | ≤1735 | **1712** | `m3d/{geometry,presets,geo-utils,material,controls,channel-extract,material-filters,height-extract,env-light}.js` |
| `web/src/mc-model-viewer.js` | 2041 | ≤1295 | **1287** | `mcv/{paths,geometry,geo-tools,tex-tools,tex-ref-tools,asset-resolve,layout-build,misc-tools,model-export}.js` |
| `web/src/render.js` | 1765 | — | **1560** | `rnd/{model-cards,sidebar,category-bar,preview-bind,empty-cell,result-search-bind,diff-grid,model-type-result,view-tabs}.js` |
| `web/src/uv-editor-core.js` | 1476 | — | **1459** | `uvc/` 14 模块 |
| `web/src/workspace.js` | 1797 | — | 1797 | 未拆（内部函数与 render.js 高度耦合） |

四个待拆主文件已全部达标（`node-canvas` 2672、`asset-library` 1879、`material3d` 1712、`mc-model-viewer` 1287），本轮共新增 27 个模块（mcv 9 + m3d 9 + asset-lib 4 + node-canvas 3，另有 rnd/uvc 前序批次）。

拆分手法沿用已验证的路径：先做**分节依赖分析**（统计每段行数与该段对外部符号的依赖数），优先抽出「行数大、外部依赖少」的段；跨模块的可变状态与回调通过 `set*Hooks` 注入，避免子模块反向 import 主文件形成循环。

**拆分契约（踩过两次的坑）**：拆出的函数若原本对外可见，必须从主文件 re-export（门面模式），否则 `test/unit/*` 通过主文件 import 会拿到 `undefined`。

**依赖分析器的三个陷阱**（都实际踩过）：① 只匹配后跟 `(` 或 `.` 的标识符会漏掉 `state`/`onlyMissingChk` 这类裸值引用；② import 区只扫前 30 行会漏掉多行 import 块，导致把已 import 的符号误判为"段外依赖"需要 hooks 注入；③ 会把正则字面量里的片段（`/^assets\/[^/]+\/models\//` 的 `models`）和对象键（`rel: le.name` 的 `rel`）误判成标识符 —— 必须只对真实标识符替换，或改用「模块级 `let` + setHooks 逐条赋值」方案让正文零改写。

**剩余待拆（可选，不在本轮验收范围）**：`workspace.js`（1797）与 `uv-editor-core.js`（1459 行，单 1421 行 `createUvEditor` 闭包，50 个内部函数共享 30+ 个闭包变量）。后者必须用懒初始化工厂（`let _x = null; getX()` 惰性创建，闭包内回调用 `(...a) => fn(...a)` 延迟绑定避开 TDZ，并保留 `function` 声明以利用提升）才能拆，工作量与风险都远高于普通模块，留待单独处理。

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
      "label": "92:92 端点覆盖",
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
      "label": "资产与面板模块",
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
      "id": "edge-tests-frontend",
      "source": "sec-tests",
      "target": "sec-modules",
      "label": "覆盖前端模块加载",
      "kind": "data"
    },
    {
      "id": "edge-tools-tests",
      "source": "sec-tools",
      "target": "sec-tests",
      "label": "浏览器实测补充单测盲区",
      "kind": "data"
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
      "id": "edge-planned-resplit",
      "source": "ch-planned",
      "target": "leaf-planned-resplit",
      "label": "合并回退后的补拆",
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
    },
    {
      "id": "edge-resplit-nodecanvas",
      "source": "leaf-planned-resplit",
      "target": "leaf-nodecanvas",
      "label": "继续拆分",
      "kind": "dependency"
    },
    {
      "id": "edge-resplit-assetws",
      "source": "leaf-planned-resplit",
      "target": "leaf-assetws",
      "label": "继续拆分",
      "kind": "dependency"
    },
    {
      "id": "edge-plannedvue-modules",
      "source": "leaf-planned-vue",
      "target": "sec-modules",
      "label": "复用已拆模块",
      "kind": "optional"
    }
  ]
}
```

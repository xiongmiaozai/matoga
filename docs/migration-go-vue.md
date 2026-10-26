# matoga 迁移方案：Go 后端 + Vue 前端

> 状态：方案稿（DRAFT）· 编写日期 2026-10-26
> 决定：**后端优先**（Go 全量重写）→ 前端 Vue 逐步迁移
> 原则：**不重复造轮子**。现有很多手写实现（ZIP 解析、PNG 编码、HDR 解码、Git 式存储）在 Go/生态里都有成熟库，迁移时一律用库替换，不再逐行翻译。

---

## 1. 现状盘点

### 1.1 后端（Node.js + Express）

| 指标 | 数值 |
| --- | --- |
| 代码量 | 4784 行（`server/`） |
| API 端点 | **72 个** |
| 第三方依赖 | **仅 2 个**：`express`、`ws`（其余 fs / path / crypto / zlib / http / child_process 全是内置） |
| 图像处理依赖 | **无**（缩略图由前端 canvas 生成后回传 base64，后端只存盘） |
| 个人手写实现 | ZIP 中央目录解析（`mcmeta-service.js`）、PNG 编码（`thumb-encode.js`）、HDR/EXR 解码（`hdr-decode.js`）、Git 式内容寻址（`asset-store.js`） |

目录结构：

```
server/
├─ index.js (91)  app.js (92)  paths.js (18)  ws.js (51)  shutdown.js (44)
├─ middleware/    auth(32) errors(33) logger(59) validate(53)
├─ config/        config-store(84) asset-store(163) workspace-store(204) node-project-store(301)
├─ routes/        25 个文件，共 72 端点
└─ services/      mcmeta(906) craft-pack(541) custom-model(423) hdr-decode(265)
                   thumb-encode(175) imported-model(148) file(140) hdri(133)
                   model-thumb(156) scan(76) sync(66) upload(71) thumb(47)
```

### 1.2 前端（原生 JS + Three.js）

| 指标 | 数值 |
| --- | --- |
| 代码量 | 21441 行（`web/src/`） |
| 文件数 | 142 个 `.js` |
| 第三方依赖 | `three` 0.186、`golden-layout` 2.6 |
| 页面 | `index.html`（主界面）、`node-editor.html`（节点编辑器） |
| 布局系统 | Golden-Layout 2.6（浮动面板 / 预设 / 拖拽停靠） |
| 已完成模块化 | node-canvas(141)、asset-library、material3d(98)、mc-model-viewer(32)、render(44)、uv-editor-core(395) |

### 1.3 数据

- `data/config.json`（配置）、`data/thumbs/`（缩略图缓存）、`data/craft-pack/selection.json`（制作包选择）
- `mc-packs/`、`official-packs/`、`hdri-presets/`、`craft-packs/`：用户资源目录
- 附件命名的内容寻址区（`asset-store`）

---

## 2. 目标架构

```
matoga/
├─ backend/                    # Go 1.24+
│   ├─ cmd/matoga/main.go      # 入口（flag: --lan / --port / --data-root）
│   ├─ internal/
│   │   ├─ httpx/              # 路由装配、中间件（auth/log/validate/errors）
│   │   ├─ api/                # 每资源一个 handler 文件（对应 72 端点）
│   │   ├─ store/              # config / asset / workspace / node-project
│   │   ├─ pack/               # mcmeta、craftpack（archive/zip）
│   │   ├─ media/              # thumb、hdr、model-thumb
│   │   ├─ fsx/                # 文件操作、扫描、哈希
│   │   ├─ wss/                # WebSocket 批量复制进度
│   │   └─ platform/           # shell open/reveal、路径
│   ├─ go.mod
│   └─ webdist/                # 前端构建产物（go:embed 内嵌）
├─ frontend/                   # Vue 3 + Vite
│   ├─ src/
│   │   ├─ main.ts
│   │   ├─ api/                # 按后端资源分文件，typed client
│   │   ├─ stores/             # Pinia
│   │   ├─ components/         # 面板组件
│   │   ├─ views/              # 主界面 / 节点编辑器
│   │   ├─ three/              # Three.js 视口封装（保留现有渲染逻辑）
│   │   └─ types/
│   ├─ vite.config.ts
│   └─ package.json
└─ legacy/                     # 迁移期旧代码只读保留（当前 server/ web/），完成后删除
```

### 2.1 技术选型（每项都优先用成熟库）

| 关注点 | 选型 | 理由（不造轮子的落点） |
| --- | --- | --- |
| HTTP 路由 | `net/http` + `chi` | 单二进制、路由分组天然对应现有 `api.use('/fs')` 结构 |
| WebSocket | `gorilla/websocket` | 替代 `ws`，协议不变 |
| ZIP 读取 | **`archive/zip`（标准库）** | 直接干掉 300+ 行手写中央目录解析 |
| PNG 编码 | **`image/png`（标准库）** | 直接干掉 `thumb-encode.js` 175 行 |
| 图像缩放 | `golang.org/x/image/draw` | 替代手写 `downsample` |
| HDR 解码 | `github.com/oov/psd`? → 先用 `github.com/lucasb-eyer/go-colorful` + 自实现 Radiance RGBE 解析（约 80 行） | 标准库无；EXR 用 `github.com/mokiat/gog` 暂无成熟库，EXR 支持降级为「暂不支持，返回明确错误」 |
| JSON | `encoding/json` | 标准库 |
| 原子写 | `os.CreateTemp` + `os.Rename` | 替代手写 `atomicWrite` |
| 内容寻址 | `crypto/sha256` + 目录分片 | 保留现有设计，实现换语言 |
| 日志 | `log/slog` | 标准库结构化日志 |
| 测试 | `go test` + `net/http/httptest` | 替代 54 个 node:test 文件的部分覆盖 |

前端：

| 关注点 | 选型 | 理由 |
| --- | --- | --- |
| 框架 | Vue 3 + `<script setup>` + TypeScript | 用户指定 |
| 构建 | Vite | 快，原生 ESM |
| 状态 | Pinia | 替代散落的模块级 `let` |
| 路由 | Vue Router（主界面 / 节点编辑器两页） | — |
| 3D | Three.js 0.186（沿用现有版本） | 渲染逻辑是核心资产，只包组件不重写 |
| 停靠布局 | **`dockview-vue`**（首选）或 `grid-layout-plus` | Golden-Layout 2.x 无官方 Vue 封装；dockview 原生支持 Vue 且 API 接近 |
| 图表 | 现有手写 SVG 图表（donut/gauge/bar）→ **ECharts** | 干掉 `rnd/charts.js` 240 行手写绘制 |
| 虚拟滚动 | `vue-virtual-scroller` | 替代手写 `applyEntries` 分片渲染 |

---

## 3. 后端迁移：72 端点映射

所有端点保持**路径、方法、响应结构不变**，前端可逐屏切换，不必等前端完成。

### 3.1 路由分组与 Go 文件对照

| 现有挂载 | 端点数 | Go 文件 | 说明 |
| --- | --- | --- | --- |
| `/api/health` | 1 | `api/health.go` | 无鉴权 |
| `/api/fs` | 3 | `api/fs.go` | browse / search / create |
| `/api/compare` | 1 | `api/compare.go` | scan（核心：双侧目录对比） |
| `/api/file` | 8 | `api/file.go` | raw / thumb / thumb-info / write / delete / copy / backup / hash |
| `/api/hdri` | 5 | `api/hdri.go` | list / thumb / thumb-info / cleanup |
| `/api/config` | 3 | `api/config.go` | get / put / delete |
| `/api/workspace` | 5 | `api/workspace.go` | 布局预设 CRUD |
| `/api/asset` | 9 | `api/asset.go` | 资产库检索（type/model/tex/info…） |
| `/api/craft-pack` | 7 | `api/craftpack.go` | 制作包选择 / 导出 |
| `/api/craft-packs` + `/api/mc-packs` + `/api/mc-official` | 2+2+1 | `api/packs.go` | 通用包浏览（`create-pack-router` 工厂 → Go 接口） |
| `/api/node-projects` | 5 | `api/nodeproj.go` | 节点工程 CRUD |
| `/api/shell` | 2 | `api/shell.go` | open / reveal（**仅本地模式**） |
| `/api/upload` | 3 | `api/upload.go` | begin / file / end |
| `/api/imported-models` | 5 | `api/imported.go` | 导入模型 CRUD |
| `/api/custom-models` | 8 | `api/custommodel.go` | 自建模型 CRUD + 模板 |
| `/api/panels` | 1 | `api/panels.go` | 面板定义 |
| `/api/vendor/*` + 静态 | — | `httpx/static.go` | 迁移期继续发 `web/`，Vue 完成后发 `webdist/` |

### 3.2 服务层迁移要点

| 现有模块 | 行数 | Go 落点 | 关键处理 |
| --- | --- | --- | --- |
| `mcmeta-service.js` | 906 | `pack/mcmeta.go` | **手写 ZIP 解析全部删除**，改用 `archive/zip`。真正的业务逻辑只有：pack.mcmeta 解析、贴图/模型遍历、别名模糊匹配（约 250 行 Go） |
| `craft-pack-service.js` | 541 | `pack/craftpack.go` | 选择集 JSON 读写 + 导出 ZIP；`archive/zip` 写入 |
| `custom-model-service.js` | 423 | `media/custommodel.go` | bbmodel / json 模型 CRUD |
| `hdr-decode.js` | 265 | `media/hdr.go` | Radiance `.hdr` 自实现（RGBE 解析约 80 行）；**`.exr` 一期不支持**，返回 `ERR_UNSUPPORTED_FORMAT` |
| `thumb-encode.js` | 175 | `media/thumb.go` | `image/png` + `x/image/draw`（约 60 行） |
| `model-thumb-service.js` | 156 | `media/modelthumb.go` | 缓存目录 + 元数据 |
| `imported-model-service.js` | 148 | `media/imported.go` | — |
| `file-service.js` | 140 | `fsx/file.go` | aHash / dHash 感知哈希保留（约 40 行） |
| `hdri-service.js` | 133 | `media/hdri.go` | 列表 + 缩略图 |
| `scan-service.js` | 76 | `fsx/scan.go` | 目录扫描 + ignore 规则 |
| `upload-service.js` | 71 | `fsx/upload.go` | 分片上传 |
| `sync-service.js` | 66 | `wss/sync.go` | 批量复制任务 + 取消 |
| `thumb-service.js` | 47 | `media/thumb.go` | — |
| `asset-store.js` | 163 | `store/asset.go` | 内容寻址 |
| `workspace-store.js` | 204 | `store/workspace.go` | — |
| `node-project-store.js` | 301 | `store/nodeproj.go` | — |
| `config-store.js` | 84 | `store/config.go` | 原子写 + 默认值补全 |

### 3.3 兼容性保证

1. **响应契约冻结**：先对现网跑一遍「端点快照」（对 72 个端点各发一次请求，存响应 JSON 到 `test/golden/`），Go 版本逐条比对。
2. **错误码一致**：`ERR_INVALID_PARAM` / `ERR_UNAUTHORIZED` / `ERR_UNKNOWN` 等字符串保持一致。
3. **静态资源**：Go 版在迁移期同样服务 `web/` 目录，前端可继续用旧版联调。
4. **Electron 集成**：`electron/main.js` 当前 spawn Node 进程，改成 spawn Go 二进制（接口就一条 spawn，改动极小）。

---

## 4. 前端迁移：Vue 3

### 4.1 迁移顺序（按依赖与风险）

| 阶段 | 范围 | 说明 |
| --- | --- | --- |
| F0 | 工程骨架 | Vite + Vue 3 + TS + Pinia + Router；`api/` 层按后端资源分文件生成 typed client |
| F1 | 布局壳 | dockview-vue 替换 Golden-Layout；面板注册/预设/拖拽停靠；**先只做空面板** |
| F2 | 简单面板 | 文件夹选择、对比设置、操作按钮、详情、模型分类 → Vue 组件 |
| F3 | 数据面板 | 贴图对比（虚拟滚动）、可视化（ECharts）、总资产库、节点库 |
| F4 | Three.js 视口 | `Material3DViewport.vue` 封装现有 `m3d/` 逻辑（16 模块原样搬进 `frontend/src/three/`）；`McModelViewer.vue` 同理（`mcv/` 10 模块） |
| F5 | UV 编辑器 | `uvc/` 16 模块搬入，用 Vue 重写浮窗外壳，画布逻辑（painter/selection/history）原样保留 |
| F6 | 节点编辑器 | 独立页 `node-editor.html` → Vue Router 第二路由；`node-canvas/` 27 模块搬入，DOM 直写部分逐步改响应式 |
| F7 | 收尾 | 删除 `web/`，Electron 指向新构建产物 |

**关键约束**：Three.js / canvas 相关的 4000+ 行是核心资产且与框架无关，**全程只搬不改**，包一层 Vue 组件即可。真正需要 Vue 重写的是 DOM 操作密集的 UI 外壳（约 6000 行）。

### 4.2 状态迁移

现有模块级 `let` + `setXxx()` 的模式，在 Vue 里对应 Pinia store：

| 现有 | Pinia |
| --- | --- |
| `web/src/state.js`、各模块 `S` 对象 | `stores/editor.ts`、`stores/workspace.ts` |
| `setXxx(v)` / `getXxx()` 访问器 | store 的 `state` + `actions` |
| 事件总线（`window.dispatchEvent`） | store 订阅 / `watch` |

### 4.3 与后端并行

后端先完成 → 前端先做「新旧双跑」：Vue 版对 Go 后端，旧版对 Node 后端，逐屏切换比对。

---

## 5. 分阶段路线图

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **M0** 冻结基线 | 72 端点 golden 快照；`legacy/` 归档旧代码 | 快照 72/72 通过 |
| **M1** Go 骨架 | chi + 中间件 + health + 静态服务 + config store | `go test` 绿；旧前端能跑在 Go 后端上 |
| **M2** 文件域 | fs / file / shell / upload（13 端点） | golden 比对通过 |
| **M3** 资源域 | hdri / asset / packs / craftpack（24 端点） | ZIP 读统一走 `archive/zip`；缩略图走 `image/png` |
| **M4** 对比域 | compare/scan + 模型域（imported / custom / node-projects，18 端点） | 核心扫描结果与 Node 版逐字段一致 |
| **M5** 实时 | WebSocket 批量复制 | 进度事件与旧协议逐字一致 |
| **M6** 切换 | Electron spawn Go 二进制；Node 后端下线 | 打包产物可运行；安装器回归 |
| **M7** 前端骨架 | Vue 工程 + dockview 布局 | 空面板可拖拽停靠 |
| **M8** 前端面板 | F2–F3 面板 | 逐面板比对 |
| **M9** 视口 / UV / 节点 | F4–F6 | 渲染结果像素级比对 |
| **M10** 收尾 | 删旧代码、CI、文档 | 全量测试 + 打包 |

每个阶段独立可交付、可回滚（`legacy/` 保留）。

---

## 6. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| EXR 解码无成熟 Go 库 | HDR 预设丢失 EXR 支持 | 一期只支持 `.hdr`；EXR 返回明确错误；或等 `go-exr` 成熟 |
| Golden-Layout → dockview 行为差异 | 布局预设 JSON 不兼容 | 写一次性转换器（树形结构简单，约 100 行） |
| Three.js 场景与 Vue 生命周期 | 内存泄漏 / 重复 init | 只用 `onMounted`/`onBeforeUnmount` 各一次；渲染循环用 `requestAnimationFrame` 独立管理 |
| 节点编辑器的 DOM 直写 | 改响应式成本高 | 一期保留 DOM 直写，仅外层用 Vue；后续逐步替换 |
| 前端 21K 行迁移周期长 | 新旧并存混乱 | 强制「一屏迁移完就删旧代码」，`legacy/` 只读不写 |
| 打包体积 | Go 二进制 + 前端资源 | `go:embed` 内嵌，单文件约 25MB；比 pkg 产物小 |
| 感知哈希 / 模糊匹配结果漂移 | 对比结果不一致 | 哈希与匹配算法逐位对齐，golden 测试兜底 |

---

## 7. 不重复造轮子：可直接删除的手写代码

| 现有手写 | 行数 | 替换为 |
| --- | --- | --- |
| `parseZipCentralDirectory` / `readZipEntry` / `findZipEntry` | ~300 | `archive/zip` |
| `encodePNG` / `downsample` / `tonemapToRGBA` | ~120 | `image/png` + `x/image/draw` |
| `atomicWrite`（4 处重复） | ~40 | 一个 `fsx.AtomicWrite` 工具函数 |
| `parseZipByteRanges` 类工具 | — | 标准库 |
| `rnd/charts.js` 手写 SVG 图表 | 242 | ECharts |
| `route-utils` 手工参数校验 | ~150 | `go-playground/validator` 或手写但集中一处 |
| `splitter.mjs` 拆分脚本 | 工具链 | 迁移后不再需要（新代码直接按模块写） |

---

## 8. 立即下一步（M0）

1. 生成 72 端点 golden 快照（Node 版当前行为）
2. 建 `backend/` Go 模块骨架 + `chi` 路由 + health
3. `git mv server web … legacy/`（或复制到 `legacy/` 保留 git 历史）
4. 首个可跑通的垂直切片：`/api/health` + `/api/config` + `/api/fs/browse`

---

## 9. 与现有模块化工作的关系

已完成的模块化拆分（node-canvas / asset-library / material3d / mc-model-viewer / render / uv-editor-core）**不浪费**：

- `m3d/`(16)、`mcv/`(10)、`uvc/`(16)、`node-canvas/`(27) 这些子模块**与框架无关**，整体搬进 `frontend/src/three/`、`frontend/src/uv/`、`frontend/src/nodecanvas/`
- 拆分过程产出的边界划分正好是 Vue 组件的切分依据
- 剩余未拆的大文件（`workspace.js` 863 行）**不再继续拆** —— 它会被 dockview 方案整体替换

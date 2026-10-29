# 核查报告 — 上游同步 + 既有改动复审 + 浏览器全流程验证

> 日期：2026-10-29 · 基准：`af48cfe1`（上游 main）· HEAD：`ecd8b4ea` + 本轮修复
> 范围：不推送、不开 PR，全部改动仅留本地并完成验证

## 1. 上游同步

| 项 | 结果 |
| --- | --- |
| 上游 `main` 最新提交 | `af48cfe1` build(mac): ad-hoc 签名并补全运行时 dependencies |
| 本地是否落后 | **否** — `git merge-base HEAD origin/main` = `af48cfe1` |
| 是否已合并 v3.2.0 | **是** — merge commit `8d7d65d7` |
| 结论 | 上游已是最新，**无需合并、无冲突** |

本地领先上游 112 个提交（模块化拆分工作），上游无新提交待同步。

## 2. 复审发现并修复的问题

浏览器实测暴露出一类单测覆盖不到的缺陷：**拆分出的子模块漏 import，模块加载不报错、只有运行到该代码路径才抛 ReferenceError**。共修复 **12 类 30 处**：

### 2.1 样式分片路径全部失效（最严重）

`web/{mc-theme,node-canvas,styles,workspace,node-editor}.css` 五个入口的 `@import` 写作 `./<name>/xxx.css`，但分片实际落在 `web/css/<name>/`，浏览器解析全部 404。

- 影响：页面**完全丢失样式**，首次实测 229 个失败请求、119 个控制台错误
- 修复：路径改为 `./css/<name>/xxx.css`，40 条 import 全部恢复可解析

### 2.2 缺失 import（20 处）

| 文件 | 缺失符号 | 来源 |
| --- | --- | --- |
| `server/config/nps/crud.js` | `logger`, `AppError` | `../../middleware/logger`、`../../lib/errors` |
| `server/config/nps/meta.js` | `logger` | 同上 |
| `web/src/ws/panels.js` | `$` | `../core.js` |
| `web/src/m3d/{custom-model,hdr,lighting,pbr,sky,texture-extract,textures,geometry,material}.js` | `THREE`（9 个文件） | `three` |
| `web/src/asset-lib/{card,detail,filters,items,pack-browser,sections-model,sections-official,sections-tex}.js` | `roleText`/`packApiFor`/`parsePackModelPath`/`QUICK_CATS`/`isValidAssetKey` 等 24 个 | `./helpers.js` |
| `web/src/asset-lib/presets.js` | `PRESETS`, `presetName` | `./helpers.js` |
| `web/src/uvc/status.js` | `t` | `../i18n.js` |
| `web/src/renderer.js` | `initCtxMenu` | `./src/renderer-ctxmenu.js` |
| `web/src/renderer-ctxmenu.js` | `$` | `./core.js` |

### 2.3 循环依赖（2 处）

计划 §4 规则 1 明确禁止子模块反向 import 主文件，实测确认存在两例：

- `ws/{layout,presets}.js` → `workspace.js` 取 `call`：`call` 下沉到 `ws/call.js`
- `ws/presets.js` → `workspace.js` 取 `renderWorkspaceBar`：改注册回调 `setWorkspaceBarRenderer` / `renderWorkspaceBarVia`
- `asset-lib/sections-model.js` → `asset-library.js` 取 `refreshAssetLibrary`：改注册回调 `setRefreshHooks` / `refreshVia`（挂在 `asset-lib/store.js`）

### 2.4 空值防护（4 处）

实测中这些路径在特定时序下抛 `TypeError: Cannot read properties of null`：

- `ws/layout.js applyConfig`：`S.cloneObservers` 初值为 `null`，`forEach` 前加 `Array.isArray` 判断
- `node-canvas/status.js updateStats`：`#stat-nodes` / `#stat-edges` 可能不存在，加判空
- `node-canvas/status.js toast`：`#toast` 不存在时静默返回
- `node-canvas/edges.js renderEdges`：`edgesSvg` 为 `null` 时提前返回
- `panels/uvEditor/up/context.js currentLayout`：`S.source` 为 `null` 时返回 `null`

### 2.5 暴露的导出缺失（1 处）

`ws/menus.js` 的 `openPresetManager` 未加 `export`，`workspace.js` import 时报“不提供该导出”。

### 2.6 响应结构解包错误（1 处）

`asset-lib/loaders.js` 对 `/api/hdri/list` 读 `data.entries`，但该端点返回的是**数组**（`{ok:true, data:[...]}`），导致 `S.hdriEntries` 拿到 `undefined` 并在 `sections-model.js` 触发 `.map is not a function`。改为兼容两种形状。

### 2.7 健壮性缺陷（1 处，上游既有）

`server/services/hdri-service.js list()` 对配置里的 HDRI 目录直接 `stat`，目录不存在时抛 ENOENT 使整个端点 500。改为目录缺失返回空列表。

### 2.8 vendor 资源 404（1 处，上游既有）

golden-layout 主题 CSS 用相对路径 `url('../../img/lm_close_white.png')`，从 `/vendor/golden-layout-css/themes/` 解析后落到 `/vendor/img/`，但 `server/app.js` 未挂载该路径 → 面板工具栏关闭/最大化/图标全部 404。已补 `app.use('/vendor/img', ...)` 指向 `node_modules/golden-layout/dist/img`。

## 3. 浏览器实测结果

环境：真实 Chromium（Playwright 1.64.1 headless）+ 本地服务，1600×950 视口。
脚本：`scripts/browser-e2e.mjs`（可重复执行）。

### 3.1 操作路径与结果

| # | 操作 | 结果 |
| --- | --- | --- |
| 1 | 打开首页 `/` | title=`matoga`，header 渲染，主区挂载 |
| 2 | 检查关键 DOM | `compareBtn`=1、`resultTable`=1、`statusbar`=1 |
| 3 | 停靠布局初始化 | 布局根 1 个、面板 **9 个** |
| 4 | 资产库面板 | `#assetLibraryBody` 渲染 |
| 5 | 打开 `/node-editor.html` | canvas=1、library=1、status=1、初始节点 **11 个** |
| 6 | 节点库点击「添加节点」 | 节点数 11 → **13**（正常新增） |
| 7 | 回到首页触发对比 | `compareBtn` 可点击、目录选择入口存在 |
| 8 | 页面内 API 探测 | `/api/health`、`/api/config`、`/api/panels`、`/api/asset` 全部 **200** |
| 9 | 主题编辑器面板 | 卡片渲染 5 个 |

### 3.2 错误统计（修复前后对比）

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 控制台错误 | 119 | **0** |
| 页面异常（未捕获） | 3 | **0** |
| 失败请求 | 229 | **0** |

## 4. 验证结果清单

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `node --test --test-concurrency=1 "test/unit/**/*.test.js"` | **617 pass / 0 fail** |
| 冒烟测试 | `node test/smoke/run.mjs` | **29 通过 / 0 失败**（含 WS 集成 10/0） |
| ESLint | `npm run lint` | **0 errors**（1426 warnings，均为既有 `no-unused-vars` 等） |
| 打包 | `npm run dist:win` | **成功** — `dist-electron/matoga Setup 3.2.0.exe`，107.5 MB |
| 浏览器实测 | `node scripts/browser-e2e.mjs <url>` | **9 步全通过，0 错误 0 失败请求** |
| 引用审计 | `node scripts/audit-web-refs.mjs` | **未发现跨模块缺失引用** |

## 5. 新增的回归防线

本次问题的共同特征是「单测不覆盖、只有浏览器跑到才暴露」，为此新增两个可重复执行的检查：

1. **`scripts/audit-web-refs.mjs`** — 静态扫描 `web/` 全部 ESM 文件，找出「函数体用到、但本文件未 import 也未声明、且别处确有此导出」的标识符。去注释与字符串后匹配，避免 `'toast.xxx'` 这类误报。本轮用它一次性定位了 `asset-lib/` 的 24 个缺失符号。
2. **`scripts/browser-e2e.mjs`** — 真实 Chromium 走核心流程，收集控制台错误 / 未捕获异常 / 4xx 失败请求。以退出码表达结果，可直接进 CI。

## 6. 剩余风险

| 风险 | 说明 | 建议 |
| --- | --- | --- |
| `uv-view.test.js` 等 4 个测试不可拆 | 顶层 `let` + setup 赋值形成状态机的顺序依赖，拆到独立进程即断链（已实测两次） | 保持现状，或改为显式 `beforeEach` 重建环境（会改动断言前提，需评审） |
| 4 个单闭包文件未拆 | `preview-panel`/`folder-tree`/`uv-editor-core`/`uvc/ui-build` 为单工厂大闭包，拆需参数化改写 | 计划 §3.6 已注明这是唯一允许改逻辑形态的地方，需专门批次 |
| 1426 条 lint warning | 多为既有 `no-unused-vars` | 可分批清理，不影响功能 |
| 安装器未做静默装/卸回归 | 本轮仅验证打包产物生成 | 计划 B13 要求，需在真实环境执行 `/S` 静默安装与卸载 |
| 未推送 / 未开 PR | 按要求本次取消 | 如需推送，仍需 token 具备 `workflow` scope（历史含 `.github/workflows` 改动） |
| 浏览器实测为无头模式 | 覆盖 JS/DOM 逻辑与请求，未覆盖真实 GPU 渲染的视觉正确性 | 需要视觉验收时补有头截图比对 |

## 7. 本轮未做的事

按用户要求第 2 条，**未推送 fork、未开 PR、未合并 PR**。所有改动仅存于本地 `main` 分支。

# Modularization Plan — 全项目多模块化（全量版）

> Date: 2026-10-26 · Base: `1c02440` (branch `main`) · Status: PROPOSED / IN PROGRESS
> 前置文档：[module-plan.md](module-plan.md)（目录分层，已完成）、[refactor-report.md](refactor-report.md)（分层执行报告）、[node-canvas-modules.md](node-canvas-modules.md)（首轮文件拆分）

## 0. 目标与硬约束

把整个工程按文件拆成多模块版本，**范围是全部 187 个 `.js` / `.mjs` / `.css` / `.html` 文件，共 42007 行，无豁免、无行数阈值**。

硬约束：

1. **只搬代码，不改逻辑。** 拆分是物理搬运 + import 接线，不允许改行为、改默认值、改 API 形状。
2. **每拆完一个文件就验证一次。** 单测全绿 + 冒烟通过 + 服务能启动，三者缺一不算完成。验证失败先修，不进入下一个文件。
3. **全部拆完并自动化验证通过后**，才推送分支、提 PR、合并。
4. **稳定接口优先。** 拆分后主文件/入口的导出名单与拆分前完全一致，调用方零改动。
5. **不引入构建工具。** 无 bundler 的原生 ESM（web）+ CommonJS（server），拆分只用静态 `import` / `require`。

## 1. 现状实测

### 1.1 已完成

| 范围 | 状态 |
| --- | --- |
| 目录分层（core/ server/ web/ electron/ tools/ 资产根英文名） | DONE `ae9d346` |
| NSIS 安装器（EULA 页 + 进程检测宏） | DONE `ab1818f` |
| `web/src/node-canvas.js` 首轮拆分（9 子模块，3950 → 2644 行） | DONE `dad0a8c` |
| 本计划文档 | DONE `1c02440` |

### 1.2 验证基线（实测）

| 项 | 结果 | 耗时 |
| --- | --- | --- |
| `node --test --test-concurrency=1 "test/unit/**/*.test.js"` | 550 pass / 0 fail（53 个测试文件） | 47.4 s |
| `node test/smoke/run.mjs` | api-smoke + ws-sync 通过 | 1.3 s |
| `node server/index.js` 启动 + `/api/health` | 待每次拆分后实测 | ~3 s |

单文件验证一轮 ≈ 55 s。187 个文件全量验证 ≈ 2.9 小时纯验证时间。

### 1.3 全量文件清单（187 个 / 42007 行）

按目录：

| 目录 | 文件数 | 行数 | 说明 |
| --- | --- | --- | --- |
| `web/` | 78 | 26983 | 前端：src/ 45 js + api/ 2 + 根 10 css/html + panels/ 21 |
| `test/` | 59 | 8964 | 单测 53 + 冒烟 4 + helpers 2 |
| `server/` | 45 | 4784 | 后端 CommonJS |
| `electron/` | 2 | 118 | 桌面壳 |
| `core/` | 1 | 28 | 共享错误类型 |
| `tools/` | 1 | 70 | 仓库脚本 |
| `website/` | 1 | 1060 | landing page |

按体积分档（拆分难度递增）：

| 档 | 行数区间 | 文件数 | 拆分手法 |
| --- | --- | --- | --- |
| S | 0–49 | 约 40 | 抽出常量/纯函数到一个兄弟文件 + 薄入口 |
| M | 50–149 | 约 55 | 按职责切 2–4 个 part + 薄入口 |
| L | 150–499 | 约 60 | 按职责切 3–7 个 part + 薄入口 |
| XL | 500–999 | 约 22 | 按域切 4–8 个模块 + 门面 |
| XXL | ≥1000 | 10 | 按域切 6–12 个模块 + 纯门面 |

XXL 清单（优先级最高）：

| 文件 | 行数 |
| --- | --- |
| `web/src/node-canvas.js` | 2644 |
| `web/src/asset-library.js` | 1958 |
| `web/src/material3d.js` | 1603 |
| `web/src/mc-model-viewer.js` | 1356 |
| `web/mc-theme.css` | 1268 |
| `web/node-canvas.css` | 1243 |
| `web/src/render.js` | 1213 |
| `web/styles.css` | 1202 |
| `web/src/uv-editor-core.js` | 1164 |
| `website/landing.html` | 1060 |

## 2. 统一拆分规则（适用于全部 187 个文件）

### 2.1 目录约定

对文件 `path/foo.js`：

```
path/foo/            # 新建，与主文件同名
  ├── <part-a>.js    # 按职责切的子模块
  ├── <part-b>.js
  └── ...
path/foo.js          # 保留：薄入口（门面 / 接线 / 导出名单不变）
```

- 子模块文件命名 kebab-case，名字描述职责（`pack-paths.js`、`tex-refs.js`），不用 `a.js` / `part1.js` 这类无信息名。
- 已有目录的文件（`web/src/node-canvas/*.js`、`web/src/panels/*`）在原地继续细化，不重复套壳。

### 2.2 分档手法

**S 档（0–49 行）**——文件本身已很小，拆法固定为"抽出可独立命名的常量/纯函数"：

- 若有魔法值/配置常量 → `foo/constants.js`。
- 若有 2 个以上可独立命名的纯函数 → 按函数拆到 `foo/<name>.js`。
- 主文件保留唯一的对外入口（CommonJS 保持 `module.exports` 形状，ESM 保持 `export` 名单）。
- **判定规则（可复现）**：主文件拆分后必须 ≤ 原行数 × 0.6，否则视为"未拆"，需再切一刀。若某文件确实只有一个函数且无内聚可切（例：`web/src/hdr-preview-worker.js` 27 行的 worker），则拆出该函数的**纯计算部分**与**消息处理部分**两半。

**M 档（50–149 行）**：按"输入解析 / 核心逻辑 / 输出/副作用"三段切，通常 2–4 个 part。

**L 档（150–499 行）**：先 `grep` 出函数清单，按前缀或领域聚类成 3–7 个 part；典型切法：路径/字符串工具、状态读写、DOM 渲染、事件绑定、对外 API。

**XL 档（500–999 行）**：按域切 4–8 个模块；主文件只留装配与对外导出。

**XXL 档（≥1000 行）**：按 §3 的逐文件设计执行，主文件退化为纯门面。

### 2.3 语言差异

| 类型 | 主文件保留 | 子模块导出 | 注意 |
| --- | --- | --- | --- |
| web ESM | `export` 名单完全不变 | `export function` | 循环依赖会静默变空绑定，见 §4 |
| server CJS | `module.exports` 形状完全不变 | `module.exports = {...}` | 用 `Object.assign(module.exports, require('./foo/x'))` 合并 |
| CSS | 主文件保留为 `@import` 入口 | 纯规则片段 | 顺序 = 原行号升序，只在顶层选择器间切 |
| HTML | 保留结构 + 外链 | `*-boot.js` / part 片段 | 内联 `type="module"` 抽成外链 module，不能降级成经典 script |
| 测试 | 按 `describe` 拆文件，文件名 `被测对象-场景.test.js` | — | 只搬断言，不改断言；总数不变 |

## 3. XXL 文件逐文件设计

### 3.1 `web/src/node-canvas.js`（2644）→ `web/src/node-canvas/`

已抽走 algorithms/widgets/viewport/edges/evaluate/history/gestures/status/state 九模块，剩下是编辑器外壳。

| 新模块 | 内容 |
| --- | --- |
| `graph.js` | 图状态读写、节点增删、连线增删、选中态 |
| `node-dom.js` | 节点 DOM 构建、端口渲染、折叠、拖拽定位 |
| `menus.js` | 右键菜单、节点库菜单、上下文动作绑定 |
| `panels.js` | 右侧属性面板装配、面板 ↔ 节点同步 |
| `node-canvas.js` | 初始化、事件总线、接线、对外导出（15 个） |

### 3.2 `web/src/asset-library.js`（1958）→ `web/src/asset-library/`

| 新模块 | 内容（依据实测函数位置） |
| --- | --- |
| `pack-api.js` | `packApiFor` / `detectTypeFromPath` / `classifyByRole` / `isValidAssetKey` / `categoryLabel` / `presetName` / `roleText` |
| `pack-paths.js` | `isImg` / `thumbUrl` / `hdriThumbUrl` / `parsePackTexPath` / `packTexThumbUrl` / `parsePackModelPath` / `isVirtualAssetPath` / `userModelFilePath` / `virtualToRealPath` / `resolveLocatePath` |
| `asset-view.js` | `tryActivateModelViewport` / `viewMcModelAsset` / `viewImportedModelAsset` |
| `asset-store.js` | `loadAssetStore` / `assetApiCall` / `itemFromStored` / `storeFromItem` / `sortItems` / 收藏·最近记录持久化 |
| `asset-card.js` | `el` / `shade` / `makeCard` / `droppedOnCanvas` / `buildSection` |
| `asset-collapse.js` | 三组折叠态读写 |
| `canvas-presets.js` | `loadCanvasPresets` / `saveCanvasPresetAs` |
| `asset-library.js` | 导出既有公开 API，装配以上模块 |

### 3.3 `web/src/material3d.js`（1603）→ `web/src/material3d/`

| 新模块 | 内容 |
| --- | --- |
| `loader-ui.js` | `_loadingEls` / `showLoading` / `hideLoading` / `setLoadingProgress` |
| `geometry.js` | `scaleUV` / `computeTangents` / `withTangents` |
| `env-lighting.js` | `createEnvTexture` / 灯光配置克隆重建 / 预设应用 / 程序化天空 / HDR 环境切换 / 纹理旋转 |
| `texture-channels.js` | `imgW`/`imgH` / `extractChannel` / `detectFormat` / 粗糙度·金属度·自发光·法线·高度提取 |
| `texture-filter.js` | `applyOpacityMode` / `applyHeightFilter` / `applyTextureFilter` / `collectMaterialTextures` / `applyFilterToAllTextures` |
| `viewport-host.js` | 宿主探测 / `moveViewportWidgets` / `setContainer` / `activateMaterial3DHost` / `registerMaterial3DHost` / `ensureHostObserver` |
| `camera.js` | 自由视角、飞行移动、`handleResize`、`animate` |
| `material3d.js` | `initMaterial3D` / `setupControls` / 材质构建 / 纹理装配 / 全部对外 setter |

> 该文件可变单例最多（材质、网格、渲染器、各参数）。原则：**状态留主文件，行为搬子模块，通过参数或 getter 取状态**。

### 3.4 `web/src/mc-model-viewer.js`（1356）→ `web/src/mc-model/`

| 新模块 | 内容 |
| --- | --- |
| `paths.js` | `fileUrl` / `joinPath` / `apiUrl` / `rawUrl` / `texCacheKey` / `fetchJson` / `fetchOkData` / `parentModelPath` |
| `tex-refs.js` | `textureAssetPath` / `texPathForRef` / `packRelToMcRef` / `texUrlToRef` / `writeMcTexRef` / `resolveTextureRef` / `expandTextureAliases` |
| `model-resolve.js` | `resolveMcModelRaw` / `resolveMcModel` / `resolveItemDefRefs` / `isItemDefPath` / `isTemplateModelName` / `borrowTemplateTextures` / `resolveMcModelAsset` |
| `geometry.js` | `applyItemTransformation` / `parseVec3` / `parseUv` / `defaultFaceUv` / `applyFaceUvs` / `applyElementTransform` / `expandElementFaces` / `buildModelGroup` |
| `materials.js` | `applyTexParams` / `makeModelMaterial` / `loadTextureCached` / `attachPackTexture` / `mcMatFor` / `bbMatFor` / `spriteTexKey` |
| `anim.js` | `parseAnimMeta` / `animFrameIndexAt` / `applyTexAnimFrame` / `loadAnimMetaCached` / `scheduleAnimTick` / `getModelTexAnims` |
| `layouts.js` | `buildItemSpriteGroup` / `buildMcLayout` / `buildSpriteLayout` / `buildBbLayout` / `bindActiveModel` |
| `uv-face.js` | `normFaceRotation` / `ensureExplicitFace` / `remapMeshFaceUv` / `texDisplayName` |
| `mc-model-viewer.js` | **纯 re-export 门面**，保持 43 个导出名 |

### 3.5 `web/src/render.js`（1213）→ `web/src/render/`

| 新模块 | 内容 |
| --- | --- |
| `thumbs.js` | `setLoading` / `applyEntries` / `statusBadge` / `renderThumbPair` / `modelThumbSpec` / 模型缩略图单元格 |
| `model-card.js` | `modelTexRoleThumbs` / `loadModelCardTexs` / `appendModelCard` / `renderModelTypeResult` |
| `category-bar.js` | `applyCategoryFilter` / `buildCatRow` / `renderCategoryBar` |
| `diff-grid.js` | `fetchModelText` / `modelSumLine` / `mdRow` / `renderModelDiffGrid` / `loadModelDiffView` |
| `tex-effect.js` | `loadModelPreview` / `loadModelTexEffectPreview` / `loadModelTexList` / `renderModelTexListHtml` |
| `charts.js` | `donutChart` / `gaugeChart` / `barChart` / `renderChart` |
| `sidebar.js` | `renderSidebar` / `updateSortIndicators` / `initViewTabs` |
| `result.js` | `renderResult` / `selectGroup` / `appendGroupRows` / `appendSubRows` / `pvCell` / `bindEmptyCellActions` |
| `render.js` | 门面，保持 12 个导出 |

### 3.6 `web/src/uv-editor-core.js`（1164）

`createUvEditor(opts)` 单工厂 + 大闭包。按**闭包内职责**切成参数化纯函数：

| 新模块 | 内容 |
| --- | --- |
| `uv-editor/render.js` | 画布与图元绘制 |
| `uv-editor/events.js` | 指针/滚轮/键盘事件处理纯函数 |
| `uv-editor/ops.js` | UV 变换运算（缩放/旋转/翻转/对齐/吸附） |
| `uv-editor-core.js` | `createUvEditor` 工厂 + 闭包状态 + 接线 |

> 状态在闭包里，子模块只收显式参数，不碰闭包变量。这是 XXL 里唯一"不能靠搬函数"完成的——需逐段改写为参数化函数，属**本计划唯一允许触碰逻辑形态的地方**，但必须行为与测试不变。

### 3.7 CSS（`mc-theme.css` 1268 / `node-canvas.css` 1243 / `styles.css` 1202）

主文件保留为 `@import` 入口，part 按分节注释切，**顺序 = 原行号升序**：

- `web/css/node-canvas/` ← 12 part：设计 token / 顶栏工具按钮 / 项目指示器 / 状态栏 / 搜索框 / 分组头 / 节点条目 / 节点库缩略图 / 网格 / 连线层 / 端口 / widget 区 / 折叠
- `web/css/styles/` ← 25 part：Header / Workspace 三栏 / 卡片 / 快速选包 / 按钮 / 主区 / 右栏面板 / 2D 预览 / 模型对比 / 3D 面板 / Header search / 图标变体 / 预览 Tabs / 选项行 / 折叠卡片 / 空态 / 状态徽章 / 类型图标 / 详情 / 设置抽屉 / Toast·Modal / 滚动条 / 响应式 / HDRI / UV 选择器
- `web/css/mc-theme/` ← 变量层（`--mc-*` token）+ 组件层

风险控制：只在**顶层选择器之间**切，不跨 `@media` / `@keyframes` 块切断。切完做一次视觉比对。

### 3.8 `website/landing.html`（1060）

抽内联 `<style>` → `website/css/landing/*.css`；抽内联 `<script>` → `website/js/*.js`；HTML 只留结构。

## 4. 拆分造型规范（首轮经验）

1. **子模块不反向 import 主文件。** 需要主文件能力时用 `set*Hooks()` 注入回调；否则循环依赖在 ESM 里静默变空绑定。
2. **注入调用放主文件末尾，不放初始化函数里。** 首轮踩过：放 `initNodeCanvas()` 内导致不走初始化的单测拿到空节点定义，一次挂 20 个测试。
3. **跨模块可变绑定用访问器。** ESM 导入绑定只读，`let pinch` 这类需重新赋值的变量改成 `getPinch()` / `setPinch()`。
4. **状态归属单一。** 可变闭包/单例状态只留主文件，子模块通过参数或 getter 读，禁止跨文件写同一变量。
5. **导出名单不变。** 拆分前后对主文件做导出符号 diff（`node -e "console.log(Object.keys(require('./x')))"` 或 ESM 导入后 `Object.keys`），必须完全一致。
6. **文件命名 kebab-case**，子模块目录与主文件同名。

## 5. 批次划分

按"风险从低到高、依赖从叶到根"排序。同一批次内仍严格一个文件一轮验证。

| 批次 | 范围 | 文件数 | 重点 |
| --- | --- | --- | --- |
| **B0** | 基线复测 | — | 确认 550/0 + smoke + health |
| **B1** | `web/src/node-canvas.js` 二次拆分 + `web/src/node-canvas/*` 九个模块细化 | 10 | 已有经验，最低风险 |
| **B2** | `web/src/render.js`、`asset-library.js` | 2 | 跨模块共享状态多 |
| **B3** | `web/src/mc-model-viewer.js`、`uv-editor-core.js` | 2 | three.js 生命周期 / 闭包改写 |
| **B4** | `web/src/material3d.js` | 1 | 可变单例最多，单独成批 |
| **B5** | web/src 其余 L/XL 档（workspace/actions/node-preview/node-rel/preview-panel/hdri-preset/model-thumb/panels） | 12 | 面板与动作互有调用 |
| **B6** | web/src S/M 档其余全部 | 约 25 | 逐个小步 |
| **B7** | `web/` 根 CSS 4 个 + `web/src/panels/*/panel.css` 2 个 | 6 | 级联顺序 |
| **B8** | `web/` 根 HTML 2 个 + `web/src/panels/*/panel.html` 16 个 + `website/landing.html` | 19 | 内联抽离 / 结构片段 |
| **B9** | `web/locales/en.js`、`zh.js` + `web/api/*` | 4 | 词条按域切，加 key 一致性断言 |
| **B10** | `server/` 全部 45 个（先 services 大文件，后 routes/config/middleware） | 45 | CJS 导出形状不变 |
| **B11** | `test/` 全部 59 个（先 unit 大文件，后 smoke/helpers） | 59 | 只搬断言，总数不变 |
| **B12** | `electron/` 2 + `core/` 1 + `tools/` 1 | 4 | 最小，最后收尾 |
| **B13** | 全量验证 + 打包 + 推送 + PR | — | 见 §6 |

总计 187 个文件。

> B7/B8 的 `panel.html` 多为 8–54 行的结构片段，按 S/M 档规则切分（抽出重复结构块、把内联样式/脚本外置）。

## 6. 验证协议

### 6.1 每个文件拆完必跑（缺一不可）

```powershell
# 1) 单测（串行，避免抢 data/ 目录）—— 47s
node --test --test-concurrency=1 "test/unit/**/*.test.js"     # 期望 pass ≥550 / fail 0

# 2) 冒烟（api-smoke + ws-sync）—— 1.3s
node test/smoke/run.mjs

# 3) 服务启动 + 真实请求 —— ~3s
#    起 node server/index.js，GET /api/health 必须返回 200，然后关闭
```

**只看到 "listening" 不算通过**，必须拿到 HTTP 200 响应体。

### 6.2 每批次结束额外跑

- 导出符号 diff（与批次基线 commit 对比）。
- 前端页面无头加载：`node-editor.html` / `index.html` 控制台零报错。
- CSS/HTML 批次：视觉比对（拆分前后同机位截图）。

### 6.3 全部完成后（B13）

```powershell
npm test
node test/smoke/run.mjs
node server/index.js + /api/health
node tools/verify-changelog.mjs
npm run dist:win                  # 打包契约不被破坏
静默安装 /S /D= + 静默卸载 /S       # 安装器回归
```

## 7. 风险与回滚

| 风险 | 应对 |
| --- | --- |
| ESM 循环依赖导致静默空绑定 | §4 规则 1/2 + 冒烟覆盖真实加载顺序 |
| 闭包状态被跨文件污染（material3d / uv-editor） | 状态留主文件，子模块只收参数；两者单独成批、验证更细 |
| CSS `@import` 顺序错乱 | part 按原行号升序，只在顶层选择器间切，批次内视觉比对 |
| 拆分中途失败 | **每个文件一个 commit**，`git checkout -- <file>` 可单文件回滚 |
| 打包契约破坏（pkg assets / electron-builder files glob） | 不移动 web/ 与 server/ 对外路径，只在目录内增子模块；B13 跑 dist:win |
| 187 文件工作量大、中间态不可用 | 严格「一文件 → 验证 → 提交」，任何时刻 HEAD 可运行 |
| 小文件（<30 行）拆完收益低 | 按 §2.2 S 档规则执行（必须 ≤ 原行数 × 0.6），保证确实拆开 |

## 8. 完成定义（DoD）

1. §1.3 中 187 个文件全部处理完毕（拆分完成，主文件满足 §2.2 的缩减比例）。
2. 每个文件有验证记录（单测计数 + 冒烟 + health 状态）。
3. `npm test` 全绿，用例数 ≥ 550（不得删测试）。
4. `node test/smoke/run.mjs` 通过；服务能启动并响应 `/api/health`。
5. `npm run dist:win` 成功，安装/卸载回归通过。
6. 文档：本文档标记 DONE + 新增 `docs/modularization-report.md`（逐文件拆分前后行数与验证结果）。
7. 推送分支 `refactor/v3-full-modularization` 到 fork，PR 描述含全量拆分清单与验证证据，提交合并。

### 8.1 PR 前置：workflow scope

当前 `gh` token scope 为 `gist, read:org, repo`，**缺 `workflow`**。待推历史里改过 `.github/workflows/pages.yml`，fork 的 `main` 又是旧 v1.0.2 独立历史，推送会被 GitHub 拒绝。

**用户已选择：提供带 `workflow` scope 的 PAT。** 在 B13 开始前提供即可，B1–B12 期间不阻塞。

## 9. 执行记录

| 批次 | 文件 | 状态 | 验证 | commit |
| --- | --- | --- | --- | --- |
| — | node-canvas.js 首轮（9 模块，3950→2644） | DONE | 550 pass / 冒烟通过 | `dad0a8c` |
| B0 | 基线复测 | DONE | 550 pass / 0 fail（47.4s）、smoke（1.3s） | — |
| B1 | node-canvas.js 二次拆分（2324→141，27 模块） | DONE | 552 pass / 冒烟 19+5+10 | 多 commit（349fc5d…f11c6a4） |
| B1 | asset-library.js（→ `asset-lib/` 多模块） | DONE | 552 pass / 冒烟通过 | 多 commit |
| B1 | material3d.js（1697→98，`m3d/` 16 模块） | DONE | 552 pass / 冒烟通过 | 多 commit |
| B3 | mc-model-viewer.js（1452→32，`mcv/` 10 模块） | DONE | 552 pass / e2e 全绿 | 多 commit |
| B2 | render.js（1299→44，`rnd/` 10 模块） | DONE | 552 pass / 冒烟通过 | 多 commit（268f666…730541a） |
| B3 | uv-editor-core.js（1272→395，`uvc/` 16 模块） | DONE | 552 pass / 冒烟 19+5+10 | 多 commit（consts…highlight） |
| B2 | workspace.js | TODO | — | — |


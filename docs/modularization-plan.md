# Modularization Plan — 全项目多模块化

> Date: 2026-10-25 · Base: `dad0a8c` (branch `main`, 4 commits ahead of `origin/main`) · Status: PROPOSED
> 前置文档：[module-plan.md](module-plan.md)（目录分层，已完成）、[refactor-report.md](refactor-report.md)（分层执行报告）、[node-canvas-modules.md](node-canvas-modules.md)（首轮文件拆分）

## 0. 目标与硬约束

目标：把整个工程按文件拆成多模块版本。凡是单个文件职责混杂、体积过大，都要拆成一组高内聚的小模块 + 一个薄主文件（entry / index）。

硬约束（全部来自用户指令与本轮已定规则）：

1. **只搬代码，不改逻辑。** 拆分是物理搬运 + import 接线，不允许顺手改行为、改默认值、改 API 形状。
2. **每拆完一个文件就验证一次。** 单测全绿 + 冒烟通过 + 服务能启动，三者缺一不算完成。任何一步验证失败就先修，不进入下一个文件。
3. **全部拆完并自动化验证通过后**，才推送分支、提 PR、合并。
4. **稳定接口优先。** 拆分后主文件的导出名单（`export function ...`）保持与拆分前完全一致，调用方零改动。新增的内部模块不对调用方暴露。
5. **不引入构建工具。** 项目是无 bundler 的原生 ESM（web）+ CommonJS（server），拆分只能用 `import`/`require` 静态引用，不新增打包步骤。

## 1. 现状实测

### 1.1 已完成

| 范围 | 状态 |
| --- | --- |
| 目录分层（core/ server/ web/ electron/ tools/ 资产根英文名） | 已完成（`ae9d346`） |
| NSIS 安装器（EULA 页 + 进程检测宏） | 已完成（`ab1818f`） |
| `web/src/node-canvas.js` 首轮拆分（9 个子模块，主文件 3950 → 2644 行） | 已完成（`dad0a8c`） |
| 单测基线 | 550 pass / 0 fail（`--test-concurrency=1`） |
| 冒烟基线 | 19 smoke + 10 WS 通过 |

### 1.2 待拆文件清单（按体积分档）

判据：**≥ 300 行视为需要拆分**。低于 300 行的文件已属单一职责模块，保留不动（在 §6 逐条记录豁免理由）。

**P0 · 超大单文件（> 1000 行，必须拆）**

| 文件 | 行数 | 拆分后预期 |
| --- | --- | --- |
| `web/src/node-canvas.js` | 2644 | 二次拆分 → 4 模块 + 主文件 ≤ 900 |
| `web/src/asset-library.js` | 1958 | 7 模块 + 主文件 ≤ 300 |
| `web/src/material3d.js` | 1603 | 7 模块 + 主文件 ≤ 600 |
| `web/src/mc-model-viewer.js` | 1356 | 8 模块 + 主文件（re-export 门面）≤ 100 |
| `web/src/render.js` | 1213 | 8 模块 + 门面 ≤ 120 |
| `web/src/uv-editor-core.js` | 1164 | 4 模块 + 主文件 ≤ 300 |

**P1 · 大文件（300–1000 行）**

| 文件 | 行数 | 说明 |
| --- | --- | --- |
| `web/src/workspace.js` | 894 | GoldenLayout 布局 + 预设管理，职责明显可分 |
| `web/src/locales/zh.js` `en.js` | 738 / 738 | 按界面域拆成词条模块 |
| `web/src/actions.js` | 533 | 历史/加载/复制/导出/像素对比五类动作 |
| `web/src/node-preview.js` | 486 | 预览渲染 + 交互 |
| `web/src/node-rel.js` | 442 | 节点关系/自动布局 |
| `web/src/preview-panel.js` | 426 | 预览面板 |
| `web/src/hdri-preset.js` | 339 | HDRI 预设库 |
| `web/src/panels/uvEditor/panel.js` | 333 | UV 编辑器面板 |
| `web/node-canvas.css` | 1243 | 按分节注释切分 |
| `web/styles.css` | 1202 | 按分节注释切分 |
| `web/mc-theme.css` | 1268 | 主题变量 + 组件样式 |
| `web/node-editor.html` | 854 | 抽内联 script/style |
| `server/services/mcmeta-service.js` | 835 | 解析/校验/输出三段 |
| `test/unit/uv-view.test.js` | 766 | 按 describe 分组 |

**P2 · 中型文件（300–450 行）**

`server/services/craft-pack-service.js` (477)、`server/services/custom-model-service.js` (403)、`web/api/folder-tree.js` (419)、`web/workspace.css` (428)、`web/src/model-thumb.js` (305)、`server/config/node-project-store.js` (270)、`server/services/hdr-decode.js` (254)、`web/node-preview.css` (240)、`web/src/floating-window.js` (241)、`web/src/exr-loader.js` (216)、`web/src/uv-tex-picker.js` (216)、`web/src/create-model-dialog.js` (205)、`web/src/model-export.js` (193)、`web/src/pack-picker.js` (182)、`web/src/utils.js` (182)、`web/api/api-client.js` (201)、`web/src/preview2d.js` (155)、`web/index.html` (310)

## 2. 拆分批次

严格按此顺序推进，每一批内部也一样：一个文件 → 验证 → 提交，再下一个。

| 批次 | 内容 | 前置 | 风险 |
| --- | --- | --- | --- |
| **B1** | `node-canvas.js` 二次拆分 | 无（首个，先跑基线） | 低：已有 9 模块经验 |
| **B2** | `render.js`、`asset-library.js` | B1 | 中：跨模块共享状态较多 |
| **B3** | `mc-model-viewer.js`、`uv-editor-core.js` | B2 | 中：three.js 资源生命周期 |
| **B4** | `material3d.js` | B3 | 高：单例式可变状态最多 |
| **B5** | `workspace.js`、`actions.js`、`node-preview.js`、`node-rel.js`、`preview-panel.js` | B4 | 中 |
| **B6** | `hdri-preset.js`、`panels/uvEditor/panel.js`、其余 web/src 中文件 | B5 | 低 |
| **B7** | CSS：`node-canvas.css`、`styles.css`、`mc-theme.css`、`workspace.css` 等 | B6 | 中：级联顺序敏感 |
| **B8** | HTML：`node-editor.html`、`index.html` 抽内联脚本/样式 | B7 | 中：脚本加载顺序 |
| **B9** | `locales/zh.js`、`locales/en.js` 按域拆分 | B8 | 低：纯数据 |
| **B10** | server：`mcmeta-service.js`、`craft-pack-service.js`、`custom-model-service.js`、`node-project-store.js`、`hdr-decode.js`、`folder-tree.js` | B9 | 中：路由契约不变 |
| **B11** | 测试：`uv-view.test.js` 等按 describe 分组 | B10 | 低 |
| **B12** | 收尾：全量验证 + 打包校验 + 推送 + PR | 全部 | 见 §5 |

> 说明：B5 的五个文件是"面板/动作"一族，彼此互有调用，同批处理可以少一轮 import 修正。

## 3. 逐文件拆分设计

### 3.1 `web/src/node-canvas.js` → `web/src/node-canvas/`

现状：主文件 2644 行，已抽走 algorithms/widgets/viewport/edges/evaluate/history/gestures/status/state 九模块，剩下的是编辑器外壳。

| 新模块 | 内容 |
| --- | --- |
| `node-canvas/graph.js` | 图状态读写、节点增删、连线增删、选中态 |
| `node-canvas/node-dom.js` | 节点 DOM 构建、端口渲染、折叠、拖拽定位 |
| `node-canvas/menus.js` | 右键菜单、节点库菜单、上下文动作绑定 |
| `node-canvas/panels.js` | 右侧属性面板装配、面板 ↔ 节点同步 |
| `node-canvas.js`（主文件） | 初始化、事件总线、接线、对外导出 |

### 3.2 `web/src/asset-library.js` → `web/src/asset-library/`

| 新模块 | 内容（依据实测函数位置） |
| --- | --- |
| `pack-api.js` | `packApiFor` / `detectTypeFromPath` / `classifyByRole` / `isValidAssetKey` / `categoryLabel` / `presetName` / `roleText` |
| `pack-paths.js` | `isImg` / `thumbUrl` / `hdriThumbUrl` / `parsePackTexPath` / `packTexThumbUrl` / `parsePackModelPath` / `isVirtualAssetPath` / `userModelFilePath` / `virtualToRealPath` / `resolveLocatePath` |
| `asset-view.js` | `tryActivateModelViewport` / `viewMcModelAsset` / `viewImportedModelAsset` |
| `asset-store.js` | `loadAssetStore` / `assetApiCall` / `itemFromStored` / `storeFromItem` / `sortItems` / 收藏·最近记录持久化 |
| `asset-card.js` | `el` / `shade` / `makeCard` / `droppedOnCanvas` / `buildSection` |
| `asset-collapse.js` | 三组折叠态读写（`loadCollapsed`/`saveCollapsed` 等） |
| `canvas-presets.js` | `loadCanvasPresets` / `saveCanvasPresetAs` |
| `asset-library.js`（主文件） | 导出既有公开 API，装配以上模块 |

### 3.3 `web/src/material3d.js` → `web/src/material3d/`

| 新模块 | 内容 |
| --- | --- |
| `loader-ui.js` | `_loadingEls` / `showLoading` / `hideLoading` / `setLoadingProgress` |
| `geometry.js` | `scaleUV` / `computeTangents` / `withTangents` |
| `env-lighting.js` | `createEnvTexture` / 灯光配置克隆与重建 / 预设应用 / 程序化天空 / HDR 环境切换 / 纹理旋转 |
| `texture-channels.js` | `imgW`/`imgH` / `extractChannel` / `detectFormat` / 粗糙度·金属度·自发光·法线·高度提取 |
| `texture-filter.js` | `applyOpacityMode` / `applyHeightFilter` / `applyTextureFilter` / `collectMaterialTextures` / `applyFilterToAllTextures` |
| `viewport-host.js` | 可见宿主探测 / `moveViewportWidgets` / `setContainer` / `activateMaterial3DHost` / `registerMaterial3DHost` / `ensureHostObserver` |
| `camera.js` | 自由视角、飞行移动、`handleResize`、`animate` |
| `material3d.js`（主文件） | `initMaterial3D` / `setupControls` / 材质构建 / 纹理装配 / 全部对外 setter |

> 该文件的可变单例最多（材质、网格、渲染器、各种参数）。拆分原则：**状态留在主文件，行为搬到子模块，通过参数或 getter 拿状态**，避免把模块级 `let` 变成跨文件可写变量。

### 3.4 `web/src/mc-model-viewer.js` → `web/src/mc-model/`

| 新模块 | 内容 |
| --- | --- |
| `paths.js` | `fileUrl` / `joinPath` / `apiUrl` / `rawUrl` / `texCacheKey` / `fetchJson` / `fetchOkData` / `parentModelPath` |
| `tex-refs.js` | 贴图引用路径解析与重写：`textureAssetPath` / `texPathForRef` / `packRelToMcRef` / `texUrlToRef` / `writeMcTexRef` / `resolveTextureRef` / `expandTextureAliases` |
| `model-resolve.js` | 模型继承链解析：`resolveMcModelRaw` / `resolveMcModel` / `resolveItemDefRefs` / `isItemDefPath` / `isTemplateModelName` / `borrowTemplateTextures` / `resolveMcModelAsset` |
| `geometry.js` | `applyItemTransformation` / `parseVec3` / `parseUv` / `defaultFaceUv` / `applyFaceUvs` / `applyElementTransform` / `expandElementFaces` / `buildModelGroup` |
| `materials.js` | `applyTexParams` / `makeModelMaterial` / `loadTextureCached` / `attachPackTexture` / `mcMatFor` / `bbMatFor` / `spriteTexKey` |
| `anim.js` | 材质动画：`parseAnimMeta` / `animFrameIndexAt` / `applyTexAnimFrame` / `loadAnimMetaCached` / `scheduleAnimTick` / `getModelTexAnims` |
| `layouts.js` | `buildItemSpriteGroup` / `buildMcLayout` / `buildSpriteLayout` / `buildBbLayout` / `bindActiveModel` |
| `uv-face.js` | `normFaceRotation` / `ensureExplicitFace` / `remapMeshFaceUv` / `texDisplayName` |
| `mc-model-viewer.js`（主文件） | 纯 re-export 门面：保持全部既有导出名 |

> 该文件导出最多（实测 43 个 `export`），调用方（render.js / asset-library.js / 测试）依赖具体导出名，因此主文件做成**纯门面**，不承载逻辑。`render.js` 12 个导出、`node-canvas.js` 15 个导出同理。

### 3.5 `web/src/render.js` → `web/src/render/`

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
| `render.js`（主文件） | 门面，保持既有导出 |

### 3.6 `web/src/uv-editor-core.js`

单文件内含 `createUvEditor(opts)` 一个工厂，内部是大段闭包。拆分方式是按**闭包内职责**切成纯函数模块，主文件保留工厂与闭包状态：

| 新模块 | 内容 |
| --- | --- |
| `uv-editor/render.js` | 画布与图元绘制 |
| `uv-editor/events.js` | 指针/滚轮/键盘事件处理纯函数 |
| `uv-editor/ops.js` | UV 变换运算（缩放/旋转/翻转/对齐/吸附） |
| `uv-editor-core.js`（主文件） | `createUvEditor` 工厂 + 闭包状态 + 接线 |

> 因为状态在闭包里，子模块只接收显式参数，不碰闭包变量。这是四个 P0 里唯一"不能靠搬函数"完成的，需要逐段改写为参数化函数 —— 属于**本计划唯一允许触碰逻辑形态的地方**，但必须保持外部行为与测试不变。

### 3.7 `web/src/workspace.js` → `web/src/workspace/`

| 新模块 | 内容 |
| --- | --- |
| `dialogs.js` | `showPrompt` / `showConfirm` |
| `layout-factory.js` | `comp`/`stack`/`col`/`row` / `collectComponentTypes` / `isConfigComplete` / `createLayoutRoot` / `getDefaultConfig` |
| `panel-clone.js` | `extractPanels` / `restorePanelsToClassic` / `reconcileOrphanPanels` / `registerComponents` / `createPanelClone` / `stripCloneViewport` / `bindCloneDelegation` / `syncCloneFromOriginal` |
| `persist.js` | `sanitizeConfig` / `applyConfig` / `autoSavePreset` / `suppressAutoSaveBriefly` / `flushAutoSave` / `sanitizeSavedConfig` |
| `presets.js` | `loadPresets` / `saveCurrentAs` / `saveCurrent` / `deletePreset` / `activatePreset` / `resetCurrent` / `getPresetConfig` / `renamePresetDialog` / `duplicatePreset` / `exportPreset` / `exportAllPresets` / `importPreset` / `createNewPreset` |
| `bar.js` | `renderWorkspaceBar` / `notifyResize` / `onStateChanged` / `findComponentItem` / `focusPanel` / `addWindowMenu` / `openPresetManager` |
| `workspace.js`（主文件） | `initWorkspace` + 接线 |

### 3.8 `web/src/actions.js` → `web/src/actions/`

| 新模块 | 内容 |
| --- | --- |
| `history.js` | `pushHistory` / `updateUndoBtn` / `undo` |
| `load.js` | `loadFromPath` / `loadFolder` / `updateCompareButton` / `saveOptions` |
| `copy.js` | `copyToSide` / `collectCopyPairs` / `executeCopy` / `executeCopyBatch` / `executeCopySequential` / `copySingleToRight` / `addTextureToRight` / `batchCopyToSide` / `swapFolders` |
| `texture.js` | `replaceWithExternalFile` / `deleteTexture` / `blankTexDataUrl` / `createBlankTextureToRight` / `uploadModelToRight` |
| `export.js` | `exportResult` / `exportHtml` |
| `pixel-diff.js` | `showPixelDiff` |
| `tag.js` | `setGroupTag` / `clearGroupTag` |
| `actions.js`（主文件） | `handleAction` 分发器 + 门面 |

### 3.9 CSS 拆分

策略：**主文件保留为入口，内部按分节注释切成 part 文件，用 `@import` 顺序引入**，级联顺序与原文件完全一致（part 文件按原行号升序排列）。

- `web/node-canvas.css`（1243）→ `web/css/node-canvas/` 下 12 个 part（设计 token / 顶栏 / 项目指示器 / 状态栏 / 搜索框 / 分组头 / 节点条目 / 缩略图 / 网格 / 连线层 / 端口 / widget 区 / 折叠）
- `web/styles.css`（1202）→ 25 个 part（Header / 三栏 / 卡片 / 选包 / 按钮 / 主区 / 右栏 / 2D 预览 / 模型对比 / 3D 面板 / 图标 / Tabs / 选项行 / 卡片折叠 / 空态 / 徽章 / 类型图标 / 详情 / 设置抽屉 / Toast·Modal / 滚动条 / 响应式 / HDRI / UV 选择器）
- `web/mc-theme.css`（1268）→ 变量层 + 组件层
- `web/workspace.css`（428）→ 按组件分 part

风险控制：每个 part 只允许在**顶层选择器之间**切分，不允许跨 `@media`/`@keyframes` 块切断。切片后必须比对渲染（人工核验一次：打开 `node-editor.html`、`index.html`，截图与拆分前一致）。

### 3.10 HTML 拆分

- `web/node-editor.html`（854，含 1 段内联 `<script>` + 1 段 `<style>`）→ 抽出 `web/src/node-editor-boot.js` 与既有样式文件；HTML 只保留结构与外链。
- `web/index.html`（310，3 段内联 script）→ 同样抽出为 `web/src/index-boot.js` 等。
- 校验：脚本抽离后 `<script type="module">` 的执行时机必须与原来一致（内联 module 是延迟执行的，外链 module 同样延迟），不能改成经典 `<script>`。

### 3.11 locales 拆分

`zh.js` / `en.js` 各 738 行，是扁平词条对象。按界面域切分为 `locales/zh/{common,header,asset,canvas,preview3d,uv,settings,hdri,workspace,dialog}.js`，再在 `zh.js` 里合并成一个对象导出。

约束：**两份语言文件的 key 集合必须逐一相等**。当前 `test/unit/` 下**没有**任何 locales 一致性测试（已确认），所以拆分 B9 时需新增一个断言 `keys(zh) === keys(en)` 的单测，防止拆分过程中某一边漏搬词条。

### 3.12 server 拆分

| 文件 | 拆分 |
| --- | --- |
| `server/services/mcmeta-service.js` (835) | `mcmeta/parse.js`（解析）、`mcmeta/validate.js`（校验与纠错）、`mcmeta/merge.js`（合并/继承）、`mcmeta-service.js`（门面，导出名单不变） |
| `server/services/craft-pack-service.js` (477) | `craft-pack/scan.js` / `craft-pack/build.js` / 门面 |
| `server/services/custom-model-service.js` (403) | `custom-model/storage.js` / `custom-model/convert.js` / 门面 |
| `server/config/node-project-store.js` (270) | `node-project/io.js` / `node-project/schema.js` / 门面 |
| `server/services/hdr-decode.js` (254) | `hdr/decode.js` / `hdr/encode.js` |
| `web/api/folder-tree.js` (419) | `folder-tree/walk.js` / `folder-tree/filter.js` / 门面 |

服务端是 CommonJS，拆分后用 `module.exports = { ...require('./mcmeta/parse'), ... }` 保持导出形状；路由文件与 `app.js` 一行都不用改。

### 3.13 测试拆分

`test/unit/uv-view.test.js`（766）按 `describe` 分组拆成 `uv-view-*.test.js` 若干文件。只搬运，不改断言。

## 4. 拆分造型规范（沿用首轮经验）

1. **子模块不反向 import 主文件。** 需要主文件的能力时，用 `set*Hooks()` 注入回调；否则会形成循环依赖，ESM 会静默拿到空绑定。
2. **注入调用放在主文件末尾，不放初始化函数里。** 首轮踩过：放 `initNodeCanvas()` 内导致不走初始化的单测拿到空节点定义，一次挂 20 个测试。
3. **跨模块可变绑定用访问器。** ESM 导入绑定只读，`let pinch` 这类需要重新赋值的变量必须改成 `getPinch()` / `setPinch()`。
4. **状态归属单一。** 可变的闭包/单例状态只留在主文件，子模块通过参数或 getter 读取，禁止跨文件写同一变量。
5. **导出名单不变。** 拆分前后对主文件做导出符号 diff，必须完全一致（新增内部模块不在此列）。
6. **文件命名 kebab-case**，子模块目录与主文件同名（`foo.js` → `foo/`）。

## 5. 验证协议

### 5.1 每个文件拆完必跑（缺一不可）

```powershell
# 1) 单测（串行，避免抢 data/ 目录）
npx node --test --test-concurrency=1 "test/unit/**/*.test.js"     # 期望 550+ pass / 0 fail

# 2) 冒烟（19 smoke + 10 WS）
npm run test:smoke

# 3) 服务启动
node server/index.js                                              # 监听 5273，GET /api/health 返回 200
```

第 3 项要求真实发一次请求确认服务可用，然后关闭进程。**只看到 "listening" 不算通过。**

### 5.2 每个批次结束额外跑

- 前端页面加载校验：`node-editor.html`、`index.html` 在无头浏览器打开，控制台零报错。
- 导出符号 diff：`git show HEAD:old-file` 与拆分后的主文件对比 `export` 名单。
- CSS 批次额外做一次视觉比对（拆分前/后截图同机位）。

### 5.3 全部完成后（B12）

```powershell
npm test                       # 全量
npm run test:smoke
node server/index.js + health  # 启动校验
node tools/verify-changelog.mjs
npm run dist:win               # 打包仍成功（拆分不能破坏 packaging 契约）
静默安装 /S /D= + 静默卸载 /S   # 安装器回归
```

## 6. 豁免清单（不拆，并记录理由）

| 文件 | 行数 | 理由 |
| --- | --- | --- |
| `web/src/node-canvas/{algorithms,widgets,viewport,edges,evaluate,history,gestures,status,state}.js` | 24–614 | 首轮拆分产物，已是单一职责 |
| `web/src/core.js` (70) / `utils.js` (182) | < 300 | 通用工具，进一步切分只会增加 import 噪音 |
| `web/src/i18n.js` (61) / `layout-config.js` (71) / `blurhash.js` (64) | < 300 | 单一职责 |
| `server/*/` 下 < 300 行的服务与路由（约 35 个） | 12–160 | 每个文件已经只做一件事 |
| `test/unit/*` < 300 行 | — | 测试文件按被测对象组织，无需强行对齐模块 |
| `dist-electron/` 构建产物 | — | 生成物，不参与源码拆分 |

## 7. 风险与回滚

| 风险 | 应对 |
| --- | --- |
| ESM 循环依赖导致静默空绑定 | §4 规则 1/2 + 每个文件拆完必跑冒烟（冒烟覆盖真实加载顺序） |
| 闭包状态被跨文件污染（material3d / uv-editor） | 状态留主文件，子模块只收参数；该两文件单独成批，验证粒度更细 |
| CSS `@import` 顺序错乱导致样式回退 | part 按原行号升序，仅顶层选择器之间切分，批次内做视觉比对 |
| 拆分中途失败 | **每个文件一个 commit**，随时 `git checkout -- <file>` 回滚单个文件，不影响已完成的批次 |
| 打包契约被破坏（pkg assets / electron-builder files glob） | 不移动 web/ 与 server/ 的对外路径；只在目录内部增子模块；B12 跑 `dist:win` 验证 |
| 工作量过大导致中间态不可用 | 严格「一个文件 → 验证 → 提交」，任何时刻 HEAD 都是可运行状态 |

## 8. 完成定义（DoD）

1. §1.2 中 P0/P1/P2 全部文件处理完毕：拆分完成，或在 §6 有明确豁免记录并更新本文档。
2. 每个文件都有对应的验证记录（单测计数 + 冒烟结果 + 启动确认）。
3. `npm test` 全绿且用例数 ≥ 550（拆分不得删测试；若拆测试文件，总数不变）。
4. `npm run test:smoke` 通过；服务能启动并响应 `/api/health`。
5. `npm run dist:win` 成功，安装/卸载回归通过。
6. 文档：更新 `docs/modularization-plan.md`（标记 DONE）+ 新增 `docs/modularization-report.md`（逐文件拆分前后行数与验证结果）。
7. 推送分支 `refactor/v3-full-modularization` 到 fork，PR 描述含拆分清单与验证证据，提交合并。

### 8.1 PR 步骤的前置阻塞（必须提前解决）

当前 `gh` token 的 scope 是 `gist, read:org, repo`，**缺 `workflow`**。待推历史里有提交改过 `.github/workflows/pages.yml`，fork 的 `main` 又是旧的 v1.0.2 独立历史，推送这些提交会被 GitHub 拒绝。

三条路，按推荐排序：

1. 用户执行 `gh auth refresh -h github.com -s workflow`，浏览器点一次授权（最快）。
2. 提供一个带 `workflow` scope 的 PAT，用它作 push 凭据。
3. 把 fork 的旧 `main` 重命名归档，然后推送新分支（仍受 workflow scope 限制，解决不了根因，只解决"覆盖旧 main"的顾虑）。

该项在工作流上属于 B12 的硬前置，**在 B1–B11 期间不影响推进**，但需要在 B12 之前解决，否则无法完成"提交 PR 合并"。

## 9. 执行记录

| 批次 | 文件 | 状态 | 验证 |
| --- | --- | --- | --- |
| — | node-canvas.js 首轮（9 模块） | DONE | 550 pass / 冒烟通过 / `dad0a8c` |
| B1 | node-canvas.js 二次拆分 | TODO | — |
| B2 | render.js / asset-library.js | TODO | — |
| … | … | TODO | — |

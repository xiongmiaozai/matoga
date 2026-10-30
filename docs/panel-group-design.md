# 悬浮容器面板（panelGroup）技术设计

> 状态：草案待确认 · 2026-10-30
> 范围：新增一个可作为「集合/组」的容器面板，支持嵌套其他面板、页面内悬浮、
> 分离到独立 Electron 窗口并拖到其他显示器，三种形态可互转。

---

## 1. 需求拆解

| 能力 | 说明 | 涉及层 |
|------|------|--------|
| C1 容器嵌套 | 容器内可放入其他面板，内部拖拽/标签/停靠 | 前端（嵌套 Golden-Layout） |
| C2 页面内悬浮 | 脱离主停靠区，在主窗口内自由拖动浮窗 | 前端（floating-window） |
| C3 跨显示器 | 分离成独立窗口，可拖到其他屏幕 | Electron 多窗口 + IPC |
| C4 形态互转 | 停靠项 ⇄ 浮窗 ⇄ 独立窗口，布局/内容保持 | 前端 + IPC + 后端持久化 |
| C5 作为集合被放置 | 容器本身可被拖入主工作区当普通组件 | 前端（注册到主 GL） |

---

## 2. 现状约束（关键）

1. **Electron 单窗口**：`electron/main.js` 仅一个 `mainWindow`，无 `preload.js`，
   `contextIsolation: true` + `sandbox: true`，渲染进程**无任何 Electron API**。
   `window.api` 是 `web/api/api-client.js` 用 HTTP 实现的 B/S 适配层。
   → 跨屏必须新增 `preload.js` 暴露安全 IPC，并改造主进程支持多窗口。

2. **面板 DOM 单例**：`workspace.js:296-315` 用「DOM 迁移法」把唯一面板元素搬进 GL 容器，
   多次放置时克隆 + 事件代理（`createPanelClone` `workspace.js:317`）。
   → 容器内嵌套面板不能直接复用主窗口的面板 DOM 单例，需独立 fetch 注入或克隆代理。

3. **面板加载顺序**：`panel-loader.js` 必须在 `workspace.extractPanels()` 之前完成
   （`renderer.js:514` → `:517`）。容器内子面板的加载需在容器实例化时按需进行。

4. **布局持久化**：`server/config/workspace-store.js` + `server/routes/workspace.js`，
   存 `currentLayout` 和预设。容器组的状态需扩展存储。

5. **CSP**：`index.html:13` 的 CSP `script-src 'self' 'unsafe-inline'`，
   子窗口页面需同样 CSP；`connect-src 'self'` 已满足同源 REST。

---

## 3. 总体架构

```
┌─────────────────────────────────────────────────────┐
│  Electron 主进程 (electron/main.js)                  │
│  - mainWindow (主窗口, 加载 /)                        │
│  - groupWindows: Map<groupId, BrowserWindow>  [新增]  │
│  - preload.js  [新增] 暴露 window.electron IPC 桥     │
│  - IPC: group:create / group:close / group:focus ...  │
└──────────────┬──────────────────────────────────────┘
               │ Electron IPC (preload)
┌──────────────▼──────────────────────────────────────┐
│  后端 (Express)                                       │
│  - server/routes/panel-groups.js  [新增] REST CRUD    │
│  - server/config/workspace-store.js [扩展] 存 groups  │
│  - 单一真相源：group 状态 (layout/bounds/screen)      │
└──────────────┬──────────────────────────────────────┘
               │ REST (同源)
┌──────────────▼──────────────────────────────────────┐
│  主窗口渲染进程                                       │
│  - workspace.js [扩展] 注册 panelGroup 组件           │
│  - panel-group.js  [新增] 容器逻辑 + 嵌套 GL           │
│  - floating-window.js [复用] 浮窗形态宿主             │
│  - group-bridge.js [新增] 形态互转 + IPC 调度         │
└─────────────────────────────────────────────────────┘
               │ Electron IPC (跨窗口实时事件)
┌──────────────▼──────────────────────────────────────┐
│  子窗口渲染进程 (group-window.html)  [新增]           │
│  - 精简宿主：仅 GL + panel-loader 子集 + group-host.js │
│  - ?groupId=xxx&embed=1                               │
│  - 独立实例化 GL，按需 fetch 面板 HTML 注入           │
└─────────────────────────────────────────────────────┘
```

**状态同步策略**：后端为单一真相源（REST 读写），IPC 仅做轻量实时事件通知
（opened/closed/focused/changed），避免双窗口各自维护状态导致冲突。
子窗口 `stateChanged` → PUT 后端 → IPC 通知主窗口刷新该 group 的缩略/列表。

---

## 4. 容器面板内部机制（C1）

### 4.1 嵌套 Golden-Layout

容器内实例化一个**独立 GoldenLayout**（与主 GL 平行，不共享实例）：

```
panelGroup 容器 DOM
└── .pg-layout-root        ← 子 GoldenLayout 的 layoutRoot
    └── (子面板们，拖拽/标签/停靠)
```

子 GL 复用 `GL_SETTINGS` / `GL_DIMENSIONS`（`workspace.js:418-433`）。

### 4.2 子面板 DOM 来源（关键决策）

**方案对比**：

| 方案 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| A 克隆代理 | 复用 `createPanelClone` 克隆主窗口面板 DOM + 事件代理 | 复用现有代码 | 克隆不含动态状态（canvas/滚动位置），代理复杂，多容器叠加混乱 |
| B 独立注入 | 每个 group 实例独立 fetch 面板 HTML/CSS/JS，挂到子 GL | 状态独立、干净、可多实例 | 面板 JS 的 `init()` 需支持多实例/容器作用域；需改造面板 JS 入口 |
| C iframe 隔离 | 每个子面板用 iframe 加载独立页 | 完全隔离 | 通信成本高、样式不统一、性能重 |

**推荐方案 B（独立注入）**，理由：
- 跨屏子窗口本来就是独立页面，方案 B 在主窗口和子窗口里行为一致。
- 现有动态面板（material3d/nodeRel/nodePreview/uvEditor）的 `init()` 需改为
  接受 `{ container, scopeId }` 参数，在容器作用域内初始化（而非全局 `document`）。
- 静态面板（compare/preview 等）HTML 片段直接注入即可，事件通过全局 `state` +
  CustomEvent 联动（现有架构已大量依赖全局 state）。

**面板 JS 多实例化改造**（仅动态面板）：
- 约定 `init(ctx)` 协议：`ctx = { container: HTMLElement, scopeId: string }`
- `panel-loader.js` 的 `loadPanel` 增加可选 `mountEl` 参数，支持往指定容器注入
- 现有 `init()` 无参调用保持兼容（主窗口场景 `ctx` 缺省走全局）

### 4.3 子 GL 组件注册

`panel-group.js` 内的 `registerChildComponents(childLayout, container)`：
- 遍历 `getPanelDefs()`（排除 `panelGroup` 自身，防递归嵌套——或允许嵌套？见 §8）
- 每个组件工厂：fetch 面板 HTML → 注入到 `container.element` → 若动态则 `import(js)` 并 `init({container, scopeId})`
- 不依赖主窗口的 `panelEls` 单例

---

## 5. 双重形态与互转（C2/C4/C5）

### 5.1 三态F态定义

| 形态 | 宿主 | 几何 | 持久化 |
|------|------|------|--------|
| `docked` 停靠 | 主 GL 的 component | 由主 GL 管理 | group.layout 存子 GL 配置 |
| `floating` 浮窗 | floating-window.js | 浮窗 geom (x/y/w/h) | group.geom + group.layout |
| `detached` 独立窗口 | Electron 子 BrowserWindow | 窗口 bounds | group.bounds + group.layout |

### 5.2 形态互转流程

```
docked ──popout──→ floating ──detach──→ detached
   ▲                                  │
   └────────── dock ◀── dock ──────────┘
```

- **popout**（停靠→浮窗）：从主 GL 移除该 component → `createFloatingWindow` 包裹
  group 容器 → 子 GL 实例迁移（或重建并 `loadLayout(savedConfig)`）
- **detach**（浮窗→独立窗口）：关闭浮窗 → IPC `group:create` → 主进程创建子
  BrowserWindow 加载 `group-window.html?groupId=xxx` → 子窗口自行 fetch group 状态并渲染
- **dock**（任意→停靠）：关闭浮窗/子窗口 → 主 GL 新增 panelGroup component →
  子 GL 用保存的 layout 重建

### 5.3 容器标题栏工具按钮

容器顶部工具条（复用 `floating-window.addToolButton`）：
- 📌 popout/dock 切换
- 🖥 detach 到独立窗口（调用 IPC）
- ✕ 关闭（dock 回主 GL 或销毁）

---

## 6. Electron 多窗口改造（C3）

### 6.1 新增 `electron/preload.js`

```js
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('electron', {
  group: {
    create: (opts) => ipcRenderer.invoke('group:create', opts),
    close:  (groupId) => ipcRenderer.invoke('group:close', groupId),
    focus:  (groupId) => ipcRenderer.send('group:focus', groupId),
    onEvent: (cb) => ipcRenderer.on('group:event', (_e, payload) => cb(payload)),
  },
  screen: {
    getAllDisplays: () => ipcRenderer.invoke('screen:get-all-displays'),
  }
})
```

主窗口和子窗口都加载同一 preload。`window.electron` 在纯浏览器模式（`npm start`）
下不存在，`group-bridge.js` 需做能力探测降级（无 Electron 时 detach 按钮禁用并提示）。

### 6.2 `electron/main.js` 改造

新增：
- `const groupWindows = new Map()` 
- `ipcMain.handle('group:create', (e, { groupId, bounds, displayId }) => { ... })`
  创建子 `BrowserWindow`，`loadURL(\`http://127.0.0.1:${port}/group-window.html?groupId=${groupId}\`)`，
  同 `webPreferences: { contextIsolation: true, sandbox: true, preload }`，
  存入 `groupWindows`，监听 `closed` → 通知主窗口 → 清理
- `ipcMain.handle('group:close', ...)` / `ipcMain.on('group:focus', ...)`
- `ipcMain.handle('screen:get-all-displays', ...)` 返回 `screen.getAllDisplays()` 供前端选择目标屏
- `app.on('window-all-closed')` 改为：仅当 `mainWindow` 关闭且无 group 窗口时才 quit
  （macOS 本就不 quit；Windows 需调整：主窗口关闭时是否连带关 group 窗口？建议：主窗口关闭 → 关所有 group 窗口 → quit）

### 6.3 子窗口页面 `web/group-window.html`

精简宿主，**不含**主窗口的 header/侧栏/节点画布 iframe/搜索栏，只含：
- `<div id="groupRoot">` 容器
- GL vendor CSS/JS、panel-loader、group-host.js
- CSP 同主窗口
- `?groupId=xxx&embed=1`

`web/src/group-host.js`（子窗口入口）：
1. 解析 URL `groupId`
2. `await loadPanelManifests()`（复用 panel-loader）
3. `GET /api/panel-groups/:id` 取 group 状态
4. 实例化 GoldenLayout 于 `#groupRoot`
5. `registerChildComponents`（独立注入式，§4.2）
6. `layout.loadLayout(group.layout)`
7. `layout.on('stateChanged', debounce → PUT /api/panel-groups/:id { layout })`
8. `window.electron.group.onEvent` 监听主窗口指令（如 force-dock → 关闭自身）

---

## 7. 后端扩展

### 7.1 `server/config/workspace-store.js` 扩展

在现有 store 基础上增加 `groups` 字段：

```jsonc
{
  "currentLayout": { ... },
  "presets": { ... },
  "groups": {
    "g_1701234567890": {
      "id": "g_1701234567890",
      "name": "预览组",
      "form": "detached",        // docked | floating | detached
      "layout": { ... },          // 子 GL 配置
      "geom": { x, y, w, h },      // floating 形态几何
      "bounds": { x, y, width, height }, // detached 形态窗口 bounds
      "displayId": "DP1",          // 目标显示器标识
      "updatedAt": 1701234567890
    }
  }
}
```

原子读写（现有 store 已是原子写，复用）。

### 7.2 `server/routes/panel-groups.js` [新增]

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/panel-groups` | 列出所有 group |
| GET | `/api/panel-groups/:id` | 取单个 group |
| POST | `/api/panel-groups` | 新建 group（返回带 id） |
| PUT | `/api/panel-groups/:id` | 更新（layout/geom/bounds/form） |
| DELETE | `/api/panel-groups/:id` | 删除 |

挂载：`server/app.js` 增加 `api.use('/panel-groups', require('./routes/panel-groups'))`。

---

## 8. 关键决策点（需你确认）

### D1 是否允许 panelGroup 嵌套 panelGroup？

- **允许**：可造「组的组」，灵活但递归渲染/状态管理复杂度高，需防循环引用。
- **禁止（推荐）**：容器内只能放普通面板，一层。简单、够用、避免无限递归。

### D2 主窗口关闭时，独立 group 窗口如何处理？

- **A 全部关闭**（推荐）：主窗口是根，关则全关。简单符合直觉。
- **B 保持独立**：group 窗口升格为独立生命周期。需处理 server 进程归属（server 是主进程 spawn 的子进程，主窗口关但 app 不 quit）。复杂。

### D3 面板 JS 多实例化改造范围

动态面板（material3d / nodeRel / nodePreview / uvEditor）的 `init()` 需改为
`init(ctx)` 接受容器作用域。是否本次一并改造全部 4 个？
- **全改（推荐）**：容器内可放任意面板，体验一致。
- **仅改 1-2 个常用的**（如 preview/compare）：先跑通，其余后续。

### D4 浏览器模式（`npm start` 无 Electron）降级策略

无 `window.electron` 时：
- detach 按钮禁用 + tooltip「需桌面端」
- popout/dock 正常（纯前端）
- 这样 `npm start` 开发时仍可调试大部分逻辑

---

## 9. 文件清单

### 新增

| 文件 | 说明 |
|------|------|
| `electron/preload.js` | 安全 IPC 桥，暴露 `window.electron.group` / `window.electron.screen` |
| `web/group-window.html` | 子窗口精简宿主页 |
| `web/src/group-host.js` | 子窗口入口：加载 group 状态 + 实例化 GL |
| `web/src/panel-group.js` | 容器面板逻辑：嵌套 GL + 形态管理 |
| `web/src/group-bridge.js` | 形态互转调度 + IPC 调用 + 能力探测降级 |
| `web/src/panels/panelGroup/manifest.json` | 容器面板 manifest |
| `web/src/panels/panelGroup/panel.html` | 容器 HTML（工具条 + 容器 div） |
| `web/src/panels/panelGroup/panel.css` | 容器样式 |
| `web/src/panels/panelGroup/panel.js` | 容器 init 入口（调 panel-group.js） |
| `server/routes/panel-groups.js` | group REST CRUD |
| `test/unit/panel-groups.test.js` | 后端 group store/routes 单测 |
| `test/unit/panel-group-bridge.test.js` | 形态互转纯逻辑单测 |

### 修改

| 文件 | 改动 |
|------|------|
| `electron/main.js` | 多窗口管理 + IPC handler + preload 注入 + 关闭策略 |
| `server/app.js` | 挂载 `/panel-groups` 路由 |
| `server/config/workspace-store.js` | 增加 `groups` 字段读写 |
| `web/src/workspace.js` | `PANEL_DEFS` 加 panelGroup；`registerComponents` 处理容器组件 |
| `web/src/panel-loader.js` | `loadPanel` 增加可选 `mountEl` 参数支持容器内注入 |
| `web/index.html` | 引入 panel-group 相关 CSS/JS（若非动态加载） |
| `web/src/panels/{material3d,nodeRel,nodePreview,uvEditor}/panel.js` | `init()` → `init(ctx)` 多实例化（D3 范围） |
| `web/src/floating-window.js` | 可能微调以支持容器内容自适应 |

---

## 10. 数据流（典型场景）

### 场景 A：用户把「预览」面板拖进一个新建的 group 容器

```
用户从「+面板」菜单选 panelGroup → 主 GL 新增 component
  → panel-group.js init → 实例化子 GL（空）
用户拖「预览」tab 到子 GL
  → 子 GL registerChildComponents['preview'] 工厂触发
  → fetch /src/panels/preview/panel.html → 注入子 GL 容器
  → 子 GL stateChanged → PUT /api/panel-groups/:id { layout }
```

### 场景 B：把 group「分离到独立窗口」拖到第二显示器

```
用户点容器工具条 🖥 → group-bridge.js detach()
  → window.electron.screen.getAllDisplays() → 弹窗选目标屏
  → window.electron.group.create({ groupId, bounds, displayId })
  → 主进程 createGroupWindow → 子 BrowserWindow loadURL(group-window.html?groupId)
  → 主窗口移除 panelGroup component（或保留占位 stub）
  → 子窗口 group-host.js 加载 → fetch group 状态 → 渲染 GL
用户拖子窗口到第二屏（OS 级，无需我们处理）
```

### 场景 C：子窗口内布局变更同步回主窗口

```
子窗口内拖拽 → 子 GL stateChanged → PUT /api/panel-groups/:id { layout }
  → 后端存 → 子窗口 IPC send 'group:changed' → 主进程转发主窗口
  → 主窗口 group-bridge.js 收到 → 若该 group 有 docked stub 则更新缩略
```

---

## 11. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| 面板 JS 全局状态耦合（`state`/`$`/事件） | 容器内面板与主窗口面板状态打架 | 容器内面板只读全局 state，写操作经统一 action 派发；canvas 类（material3d）独立实例不共享 |
| 多实例面板 `init()` 重复执行副作用 | 重复绑定全局事件、重复 fetch | `init(ctx)` 幂等化 + 按 `scopeId` 去重 |
| Electron 子窗口 CSP/preload 与主不一致 | 子窗口加载失败 | preload 统一；子窗口 CSP 复制主窗口 |
| `window-all-closed` 误退 | 关 group 窗口时 app 退 | 仅 `mainWindow` closed 且无 group 窗口时退 |
| 嵌套 GL 性能 | 多个 GL 实例内存占用 | 限制 group 数量上限（如 8）；非可见 group 暂停渲染 |
| 跨屏 bounds 越界 | 子窗口跑到不可见区域 | 复用 `loadWindowBounds` 的 workArea 钳制逻辑（`main.js:152-156`） |
| 浏览器模式无 Electron | detach 报错 | `group-bridge.js` 探测 `window.electron`，无则禁用并提示 |

---

## 12. 测试策略

| 层 | 测试 | 框架 |
|----|------|------|
| 后端 group store/routes | CRUD、原子写、并发 | `node:test`（`test/unit/panel-groups.test.js`） |
| 形态互转纯逻辑 | docked↔floating↔detached 状态机合法性 | `node:test`（mock IPC/REST） |
| 嵌套 GL 配置 sanitize | 复用 `layout-config.js` 的 sanitize | 现有 `layout-config.test.js` 扩展 |
| Electron 多窗口 | 手动验证（无自动化 e2e，遵循 AGENTS.md「不写 e2e UI 测试」） | 人工 |
| 冒烟 | 子窗口加载、group 持久化 | `test/smoke/` 扩展（可选） |

---

## 13. 实施分期建议

| 期 | 内容 | 产出 |
|----|------|------|
| 一 | 后端 group store/routes + 单测；panel-loader `mountEl` 参数 | 可单测的持久化底座 |
| 二 | 容器面板 + 嵌套 GL（docked 形态）+ 静态面板注入 | 主窗口内可用的容器组 |
| 三 | floating 形态 + popout/dock 互转 | 页面内悬浮容器 |
| 四 | Electron preload + 多窗口 + group-window.html + detach | 跨屏独立窗口 |
| 五 | 动态面板 `init(ctx)` 多实例化（按 D3 范围） | 容器内可放动态面板 |
| 六 | 边界处理、性能上限、降级、人工验证 | 收尾 |

---

## 14. 待确认清单

- [ ] D1 是否允许 panelGroup 嵌套 panelGroup？（推荐禁止）
- [ ] D2 主窗口关闭时 group 窗口处理？（推荐全部关闭）
- [ ] D3 动态面板多实例化改造范围？（推荐全部 4 个）
- [ ] D4 浏览器模式降级策略？（推荐 detach 禁用+提示）
- [ ] 容器面板 id 命名：`panelGroup` / `floatDock` / `container`？默认 `panelGroup`
- [ ] group 数量上限？（默认 8）
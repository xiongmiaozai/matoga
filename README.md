# matoga · 材质贴图对比工具

一个基于 Node.js + Express + Three.js 的本地 Web 服务应用（B/S 架构），用于对比两个文件夹中的材质贴图内容，提供 3D 实时预览、节点材质编辑器与 Blockbench 集成。浏览器访问 `localhost:5273` 即可使用。

## 功能特性

### 文件夹对比
- 选择左右两个文件夹，按名称对比内容
- 支持递归读取子目录
- 支持 MD5 哈希校验，识别内容差异
- 支持忽略规则（系统文件 + 自定义通配符）
- 五种状态分类：✓ 一致 / ≈ 内容不同 / ◐ 部分缺失 / ✗ 右侧缺失 / ＋ 右侧多余
- 搜索（⌘K）、状态过滤、多字段排序、大小分布直方图
- 2D 像素差异对比：差异图 / 热力图 / 通道 / 直方图四种模式

### 材质贴图识别
- 按后缀自动分组：`_n` → 法线贴图，`_s` → 高光贴图
- 三种角色：主贴图 / 法线 _n / 高光 _s

### 3D 材质预览（Three.js）
- 几何体：球体、立方体、平面、圆环、圆柱、胶囊
- PBR 材质参数：金属度、粗糙度、法线强度、自发光强度
- **视差遮挡映射（POM）**：从法线贴图 alpha 通道提取高度图，或从法线 RGB 推算
- 法线重建：用 alpha 通道作为法线强度系数
- 高光贴图格式自动检测（旧版 / LabPBR）
- 通道提取：粗糙度（R 反相）、金属度（G）、自发光（A 掩膜）
- HDR 环境贴图加载（.hdr / .exr）
- 大气散射天空（turbidity / rayleigh / mie 等参数可调）
- 五种光照预设：工作室、户外阳光、柔和均匀、暖光、冷光
- 透明度模式：cutout（Alpha Test）/ blend（半透明）/ glass（玻璃透射）
- 交互：鼠标拖拽旋转、滚轮缩放、双击切换自动旋转
- 截图导出、全屏模式

### 动态面板工作区（v3.0）
- Adobe 风格浮动面板系统，基于 Golden-Layout（DOM 迁移法）
- 11 个 manifest 驱动的可组合面板：文件夹卡片、对比设置、操作、对比列表、预览、详情、3D 材质、节点画布、节点库、资产库、Blockbench
- 工作区预设：多布局保存 / 切换 / 重命名 / 激活
- 可拖拽浮动窗口，几何位置本地记忆

### 节点材质编辑器
- 可视化节点画布（独立 iframe 页面），JS 节点引擎
- 节点库、节点关系浮窗、节点预览浮窗
- `.mtgp` 自包含工程格式（project.json + 缩略图 + 贴图），支持保存 / 加载 / 管理

### Blockbench 集成
- 自托管 Blockbench Web 产物（`npm run bb:fetch` 拉取，缺失时显示占位页）
- matoga-bridge 桥接插件：发送模型到 matoga / 拉取 matoga 材质，postMessage 实时同步
- 模型与材质收件箱管理（服务端持久化）

### MC 模型预览
- Minecraft `.json` 模型渲染（parent 继承链解析）
- Blockbench `.bbmodel` 渲染
- UV 贴图布局视图（浮动窗口）

### 资产库与材质包管理
- 总资产库：聚合贴图 / 模型 / HDRI / MC 材质包 / 官方包 / 节点预设，收藏夹与最近使用服务端持久化
- MC 官方材质包：pack.mcmeta 版本分析（pack_format → MC 版本映射）、包内浏览、重命名
- 用户 MC 资源包「包媒体」库（路径可配置）
- 服务端贴图 / HDRI 缩略图生成，前端懒加载 + Blurhash + HDR 预览 Worker

### 文件操作
- 复制 / 备份 / 删除文件
- 批量同步到左 / 右侧（WebSocket 实时进度 + 可取消）
- 撤销操作
- 在系统文件管理器中打开

### 其他
- 对比结果导出（HTML）
- 深色 / 浅色主题切换
- 中 / 英文界面切换
- 配置持久化（4 项资源路径可配置：HDRI 预设 / MC 材质包 / 玩家材质包 / MC 官方材质包）
- 健康检查 API（`GET /api/health`：uptime / 内存 / Node 版本）

## 技术栈
- **Node.js + Express 5** — 本地 HTTP 服务端（REST API + 静态资源）
- **WebSocket (ws 8)** — 批量复制实时进度推送与取消
- **Three.js 0.186** — 3D 渲染与 PBR 材质
- **Golden-Layout 2.6** — 浮动面板布局系统
- **原生 JavaScript（ES Modules）** — 无构建工具、无前端框架

## 目录结构
```
matoga/
├── server/                # 后端服务
│   ├── index.js           # 入口（CLI 参数解析、启动 HTTP + WS 服务）
│   ├── app.js             # Express 应用（路由挂载、静态资源）
│   ├── ws.js              # WebSocket 服务（批量复制进度）
│   ├── paths.js           # 资源根 / 数据根路径解析
│   ├── shutdown.js        # 优雅停机（取消同步、关闭 WS、清理临时目录）
│   ├── config/            # 配置存储（主配置 / 工作区 / 资产库 / 节点工程，原子读写）
│   ├── middleware/        # 中间件（日志、错误、鉴权、校验）
│   ├── services/          # 业务服务（scan、file、sync、hdri、upload、mcmeta、blockbench、thumb 等）
│   └── routes/            # REST 路由（fs、compare、file、hdri、config、shell、upload、health、workspace、asset、mc-official、mc-packs、node-projects、blockbench、panels）
├── shared/                # 共享错误定义
├── web/                   # 前端（浏览器端，静态资源根）
│   ├── index.html         # 主界面
│   ├── node-editor.html   # 节点画布（独立 iframe 页面）
│   ├── renderer.js        # 渲染入口
│   ├── styles.css         # 主样式
│   ├── mc-theme.css       # Minecraft 主题样式
│   ├── blockbench-plugins/# Blockbench 桥接插件（matoga-bridge）
│   ├── assets/            # 静态资源（svg 图标、logo、字体、mc-icons）
│   ├── api/               # API 适配层
│   │   ├── api-client.js  # window.api 实现（HTTP + WS）
│   │   └── folder-tree.js # 目录树模态框（替代系统对话框）
│   └── src/               # 业务逻辑（对比、渲染、3D 预览、面板系统、节点编辑器、资产库、MC 模型查看等）
│       └── panels/        # manifest 驱动的动态面板（11 个）
├── test/                  # 测试
│   ├── unit/              # 单元测试（node:test）
│   └── smoke/             # 冒烟 + WebSocket 集成测试
├── docs/                  # 设计与算法文档（视差贴图、法线生成节点、纹理过滤、界面方案等）
├── electron/              # 桌面版（Electron 壳：启动 Express 服务 + BrowserWindow 加载本地页面）
├── archive/electron/      # 旧版 Electron（IPC preload 架构）归档
├── scripts/               # 脚本（fetch-blockbench.mjs：拉取 Blockbench Web 产物并注入桥接插件）
├── data/                  # 运行时数据（缩略图、工作区、资产库、节点工程、Blockbench 产物、日志）
├── hdri-presets/           # HDR 环境贴图预设
├── mc-packs/               # 用户 MC 材质包目录（包媒体库，路径可配置）
├── official-packs/         # MC 官方材质包目录（各版本官方资源包）
├── website/               # GitHub Pages 官网（独立）
├── dist/                  # 打包产物输出目录
└── package.json
```

## 安装与运行
```bash
# 安装依赖
npm install

# 启动本地 Web 服务（默认 127.0.0.1:5273，端口占用时自动递增重试）
npm start

# 自定义端口
npm start -- --port 8080

# 局域网模式（0.0.0.0 + token 鉴权）
npm run web:lan

# 桌面版（Electron 壳复用本地服务）
npm run electron

# 自托管 Blockbench Web（首次使用 Blockbench 集成前执行一次）
npm run bb:fetch

# 打包独立可执行文件（pkg，免安装，运行后自动打开浏览器）
npm run build:win    # Windows x64
npm run build:mac    # macOS arm64
npm run build:linux  # Linux x64

# 打包桌面安装包（electron-builder：NSIS / DMG / AppImage + deb）
npm run dist:win
npm run dist:mac
npm run dist:linux

# 运行测试
npm test
npm run test:smoke
```

环境变量（打包版常用）：
- `MATOGA_DATA_ROOT` — 运行时数据目录（默认 `data/`）
- `MATOGA_PRESET_ROOT` — 资源预设根目录

启动后在浏览器打开 `http://localhost:5273/` 即可使用。

## 使用说明
1. 启动服务后在浏览器打开 `http://localhost:5273/`
2. 点击左侧 / 右侧文件夹卡片，分别选择要对比的两个文件夹
3. 点击「对比」按钮，生成差异列表
4. 点击列表项查看 2D / 3D 预览
5. 在 3D 预览面板可调整材质参数、光照、几何体，并加载 HDR 环境贴图
6. 可对缺失文件执行复制 / 批量同步操作（批量复制时显示实时进度，可取消）
7. 顶栏可打开节点关系 / 节点预览 / Blockbench 浮动窗口，进入节点材质编辑与方块建模工作流

## 贴图约定
| 后缀 | 角色 | 说明 |
|------|------|------|
| 无后缀 | 主贴图（diffuse） | 基础色 / 漫反射 |
| `_n` | 法线贴图 | RGB 为法线方向，A 通道为法线强度 / 高度图 |
| `_s` | 高光贴图 | R=粗糙度，G=金属度，B=自发光，A=自发光掩膜（LabPBR） |

## 作者
芝世 (xiongmiaozai) - 2720596091@qq.com

## 许可证
MIT License - 详见 [LICENSE](LICENSE)

Copyright (c) 2026 芝世 (xiongmiaozai)
## 使用声明
他人使用本项目时，需保留并标明以下信息：
- **作者**：芝世 (xiongmiaozai)
- **来源地址**：https://github.com/xiongmiaozai/matoga
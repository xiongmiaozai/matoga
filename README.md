# matoga · 材质贴图对比工具

一个基于 Node.js + Express + Three.js 的本地 Web 服务应用，用于对比两个文件夹中的材质贴图内容，并提供 3D 实时预览。浏览器访问 `localhost:5273` 即可使用。

## 功能特性

### 文件夹对比
- 选择左右两个文件夹，按名称对比内容
- 支持递归读取子目录
- 支持 MD5 哈希校验，识别内容差异
- 支持忽略规则（系统文件 + 自定义通配符）
- 五种状态分类：✓ 一致 / ≈ 内容不同 / ◐ 部分缺失 / ✗ 右侧缺失 / ＋ 右侧多余
- 搜索、状态过滤、多字段排序

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
- 五种光照预设：工作室、户外阳光、柔和均匀、暖光、冷光
- 透明度模式：cutout（Alpha Test）/ blend（半透明）/ glass（玻璃透射）
- 交互：鼠标拖拽旋转、滚轮缩放、双击切换自动旋转
- 截图导出、全屏模式

### 文件操作
- 复制 / 备份 / 删除文件
- 批量同步到左 / 右侧（WebSocket 实时进度 + 可取消）
- 撤销操作
- 在系统文件管理器中打开

### 其他
- 对比结果导出（HTML）
- 深色 / 浅色主题切换
- 中 / 英文界面切换
- 配置持久化

## 技术栈
- **Node.js + Express 5** — 本地 HTTP 服务端（REST API + 静态资源）
- **WebSocket (ws 8)** — 批量复制实时进度推送与取消
- **Three.js 0.186** — 3D 渲染与 PBR 材质
- **原生 JavaScript（ES Modules）** — 无构建工具、无前端框架

## 目录结构
```
matoga/
├── server/                # 后端服务
│   ├── index.js           # 入口（启动 HTTP + WS 服务）
│   ├── app.js             # Express 应用（路由挂载、静态资源）
│   ├── ws.js              # WebSocket 服务（批量复制进度）
│   ├── config/            # 配置存储（原子读写、schema）
│   ├── middleware/        # 中间件（日志、错误、鉴权、校验）
│   ├── services/          # 业务服务（scan、file、hdri、upload、sync）
│   └── routes/            # REST 路由（fs、compare、file、hdri、config、shell、upload）
├── shared/                # 共享错误定义
├── web/                   # 前端（浏览器端，静态资源根）
│   ├── index.html         # 主界面
│   ├── renderer.js        # 渲染入口
│   ├── styles.css         # 主样式
│   ├── mc-theme.css       # Minecraft 主题样式
│   ├── assets/            # 静态资源（svg 图标、logo、字体、mc-icons）
│   ├── api/               # API 适配层
│   │   ├── api-client.js  # window.api 实现（HTTP + WS）
│   │   └── folder-tree.js # 目录树模态框（替代系统对话框）
│   └── src/               # 业务逻辑（对比、渲染、3D 预览等）
├── test/                  # 测试
│   ├── unit/              # 单元测试（node:test）
│   └── smoke/             # 冒烟 + WebSocket 集成测试
├── docs/                  # 设计与算法文档
├── archive/electron/      # 已归档的 Electron 版（main.js / preload.js / electron.html）
├── hdri-presets/           # HDR 环境贴图预设
├── mc-packs/               # 默认 MC 材质包目录（配置占位）
├── official-packs/         # MC 官方材质包目录（各版本官方资源包）
├── website/               # GitHub Pages 官网（独立）
└── package.json
```

## 安装与运行
```bash
# 安装依赖
npm install

# 启动本地 Web 服务（默认 127.0.0.1:5273）
npm start

# 局域网模式（0.0.0.0 + token 鉴权）
npm run web:lan

# 运行测试
npm test
npm run test:smoke
```

启动后在浏览器打开 `http://localhost:5273/` 即可使用。

## 使用说明
1. 启动服务后在浏览器打开 `http://localhost:5273/`
2. 点击左侧 / 右侧文件夹卡片，分别选择要对比的两个文件夹
3. 点击「对比」按钮，生成差异列表
4. 点击列表项查看 2D / 3D 预览
5. 在 3D 预览面板可调整材质参数、光照、几何体，并加载 HDR 环境贴图
6. 可对缺失文件执行复制 / 批量同步操作（批量复制时显示实时进度，可取消）

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
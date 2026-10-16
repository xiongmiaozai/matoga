# matoga · 材质贴图对比工具

一个基于 Electron + Three.js 的桌面应用，用于对比两个文件夹中的材质贴图内容，并提供 3D 实时预览。

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
- 批量同步到左 / 右侧
- 撤销操作
- 在系统文件管理器中打开

### 其他
- 对比结果导出（HTML）
- 深色 / 浅色主题切换
- 窗口尺寸与配置持久化

## 技术栈
- **Electron 31** — 桌面应用框架（主进程 + preload + 渲染进程）
- **Three.js 0.186** — 3D 渲染与 PBR 材质
- **原生 JavaScript（ES Modules）** — 无构建工具、无前端框架

## 目录结构
```
matoga/
├── main.js              # Electron 主进程（IPC、文件操作、对话框、配置）
├── preload.js           # 预加载脚本（contextBridge 安全暴露 API）
├── renderer.js          # 渲染进程入口
├── electron.html         # 主界面（Electron 渲染）
├── index.html            # 项目官网（GitHub Pages 落地页）
├── styles.css           # 样式
├── package.json
├── src/
│   ├── core.js          # 全局状态、常量、DOM 引用
│   ├── utils.js         # 工具函数
│   ├── compare.js       # 对比逻辑
│   ├── render.js        # 列表渲染
│   ├── actions.js       # 用户操作（复制/删除/批量/撤销等）
│   ├── layout.js        # 布局管理
│   ├── settings.js      # 设置面板
│   ├── preview2d.js     # 2D 贴图预览
│   ├── material3d.js    # 3D 材质预览（Three.js / PBR / 视差）
│   └── hdr-loader.js    # HDR 环境贴图加载器
├── amethyst_block_n.png # 示例法线贴图
├── 优化方案.md
└── 界面设计方案.md
```

## 安装与运行
```bash
# 安装依赖
npm install

# 启动应用
npm start

# 开发模式（自动打开 DevTools）
npm run dev
```

## 使用说明
1. 启动后点击左侧 / 右侧文件夹卡片，分别选择要对比的两个文件夹
2. 点击「对比」按钮，生成差异列表
3. 点击列表项查看 2D / 3D 预览
4. 在 3D 预览面板可调整材质参数、光照、几何体，并加载 HDR 环境贴图
5. 可对缺失文件执行复制 / 批量同步操作

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
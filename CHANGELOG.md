# 更新日志 / Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，
版本号采用 [语义化版本](https://semver.org/lang/zh-CN/)（`MAJOR.MINOR.PATCH`）。

---

## 变更类型说明

|  标记  | 含义       | 说明               |
| :----: | ---------- | ------------------ |
| `新增` | Added      | 新增功能           |
| `变更` | Changed    | 对已有功能的变更   |
| `弃用` | Deprecated | 即将移除的功能     |
| `移除` | Removed    | 本版本已移除的功能 |
| `修复` | Fixed      | Bug 修复           |
| `安全` | Security   | 安全相关修复       |

---

## [Unreleased] — 待发布

> 下一个版本的工作区，发布时将其归档为对应版本号。

### 新增

- `normalGen` 节点：高度图→法线贴图转换，支持 central / sobel / scharr / farid 四种梯度算子，附单元测试（`test/unit/nodegen.test.js` + `test/unit/nodegen-algo.test.js`，后者覆盖平坦/渐变/strength=0/四算子合法/smooth/幂等/回退 8 项算法管线测试）
- Blender 节点体系参考文档：`docs/blender-nodes-reference.md`（人类可读）+ `docs/blender-nodes.json`（机读，shader 137 / geo 201 / comp 109 节点）

### 变更

- `texture.js` 纹理颜色/Alpha 缓存由无界 `Map` 改为 LRU 淘汰（上限 64，批量删 16），避免长会话内存增长
- `texture.js` 法线生成算法管线抽为纯函数 `_normalGenFromHeight`（不依赖 canvas/Image），便于单测
- `normalGen` 缓存键对 strength / smooth 量化到两位小数，消除浮点抖动导致的缓存失效
- Go `nodeproject.go` 并发锁由 `sync.Mutex` 升级为 `sync.RWMutex`，List / Load 路径加 RLock
- Go `nodeproject.go` pending 导入补 `source` 字段，file 类型记录 `t.Path`
- Electron `openExternal` 增加协议白名单（仅允许 http/https）
- `web/index.html` CSP 收紧：新增 `object-src 'none'; base-uri 'self'`
- `eslint.config.js` ignores 排除 `android/**` 副本，lint 错误数从 2081 降至 0

### 修复

- 修复 `texture.js` 纹理缓存无上限导致长会话内存泄漏
- 修复 `texture.js` 多处 `clear()` 全量清空引起缓存抖动
- 修复 `normalGen` 缓存键浮点精度问题导致相同参数重复计算

---

## [3.2.0] — 2026-10-27

### 新增

- 主题编辑器面板：服务端主题存储（`theme-store.js`）+ REST 路由（`routes/themes.js`）+ 前端注册表（`web/src/theme/registry.js`）+ `themeEditor` 面板（manifest 驱动）
- 集中化快捷键映射系统（`web/src/keymap.js`）：单一数据源，供右键菜单提示与未来自定义键位复用，附单元测试
- CI 流水线（`.github/workflows/ci.yml`）：自动化 lint + 单元测试 + 冒烟测试
- 项目治理文档：`AGENTS.md`（AI 协作约束）、`CONTRIBUTING.md`（贡献指南）、`CHANGELOG.md`（更新日志）、`RELEASE_TEMPLATE.md`（发布模板）
- Issue / PR 模板（`.github/ISSUE_TEMPLATE/`、`.github/PULL_REQUEST_TEMPLATE.md`）
- 编辑器配置 `.editorconfig`、环境变量示例 `.env.example`、Node 版本约束 `.nvmrc`
- README 大幅重写：渲染架构（6 子系统）详解、版本管理、目录结构、界面预览截图（`demo/`）

### 变更

- 冒烟测试重构：单文件拆分为 `test/smoke/api/`、`test/smoke/ws/`、`test/smoke/lib/` 子模块，提升可维护性
- `hdri-presets/` 加入 `.gitignore`：HDR 二进制素材（约 73MB）不入库，运行时由本地 / 分发渠道提供

### 修复

- 修复 `custom-model-service.js` / `imported-model-service.js` 正则中不必要的转义字符（`no-useless-escape`）
- 修复 `hdr-loader.js` switch-case 内词法声明未加花括号（`no-case-declarations`）

---

## [3.1.1] — 2026-10-27

### 安全

- 修复 `saveModel` 路径遍历漏洞：未校验用户传入 `id`，可写入任意目录（`imported-model-service.js`）
- 修复 `POST /api/fs/create` 未授权写操作：误用 `guardRead` 而非 `guardWrite`，可在任意路径创建目录（`routes/fs.js`）
- 修复 `thumbPath` 路径遍历：未校验 `id` 可读取任意目录下 `thumbnail.png`（`node-project-store.js`）
- 修复 `ERR_UNKNOWN` 错误向客户端泄露内部错误消息（`middleware/errors.js`）

### 修复

- 修复 `shouldIgnore` 正则注入：ignorePatterns 含 `(`、`[` 等未配对特殊字符致 scan 崩溃（`scan-service.js`）
- 修复 `setSelection` 写入失败时静默吞掉错误、谎报成功（`craft-pack-service.js`）
- 修复 `fail` 不设置 HTTP 状态码：所有业务错误恒返回 200（`middleware/errors.js`）
- 修复 `wrap` 未检查 `res.headersSent`：流式响应中途抛错致重复响应（`middleware/errors.js`）
- 修复 WebSocket `JSON.parse` 后未校验 `msg` 结构：`null`/非对象致连接处理中断（`ws.js`）
- 修复面包屑导航闭包 bug：点击中间段总跳转到最终路径（`folder-tree.js`）
- 修复 `pickFile` 用户取消选择时 Promise 永不 settle（`api-client.js`）

---

## [3.1.0] — 2026-XX-XX

### 新增

- 资产库聚合视图增强（贴图 / 模型 / HDRI / MC 材质包 / 节点预设）
- 服务端贴图 / HDRI 缩略图生成，前端懒加载 + Blurhash + HDR 预览 Worker

### 变更

- 性能优化：批量同步与扫描路径处理

### 修复

- 稳定性修复若干

---

## [3.0.0] — 2026-XX-XX

### 新增

- **动态面板工作区**：基于 Golden-Layout 的 Adobe 风格浮动面板系统（DOM 迁移法）
- 11 个 manifest 驱动的可组合面板
- 工作区预设：多布局保存 / 切换 / 重命名 / 激活
- 可拖拽浮动窗口，几何位置本地记忆

### 变更

- 前端架构重构为 manifest 驱动的面板系统

---

## [2.x.x] — 2026-XX-XX

### 新增

- PBR 材质参数面板（金属度、粗糙度、法线强度、自发光强度）
- 视差遮挡映射（POM）：从法线 alpha 通道提取高度图
- HDR 环境贴图加载（.hdr / .exr）
- 大气散射天空（turbidity / rayleigh / mie 参数可调）
- 五种光照预设

---

## [1.x.x] — 2026-XX-XX

### 新增

- 文件夹对比核心功能（MD5 哈希校验、五种状态分类）
- 2D 像素差异对比（差异图 / 热力图 / 通道 / 直方图）
- 基础 3D 预览（Three.js）
- 材质贴图后缀识别（`_n` / `_s`）

---

<!-- 版本对比链接（按需补充） -->

[Unreleased]: https://github.com/xiongmiaozai/matoga/compare/v3.2.0...HEAD
[3.2.0]: https://github.com/xiongmiaozai/matoga/releases/tag/v3.2.0
[3.1.1]: https://github.com/xiongmiaozai/matoga/releases/tag/v3.1.1
[3.1.0]: https://github.com/xiongmiaozai/matoga/releases/tag/v3.1.0
[3.0.0]: https://github.com/xiongmiaozai/matoga/releases/tag/v3.0.0

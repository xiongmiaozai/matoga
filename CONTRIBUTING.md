# 贡献指南 / Contributing

感谢参与 matoga 项目！本文档规范了代码贡献的流程与标准。

---

## 📋 目录

- [开发环境](#-开发环境)
- [项目结构](#-项目结构)
- [开发流程](#-开发流程)
- [代码规范](#-代码规范)
- [提交规范](#-提交规范)
- [测试要求](#-测试要求)
- [发布流程](#-发布流程)

---

## 🛠️ 开发环境

| 依赖    | 版本             | 说明     |
| ------- | ---------------- | -------- |
| Node.js | ≥ 18（推荐 20+） | 运行时   |
| npm     | ≥ 9              | 包管理   |
| Git     | 任意             | 版本控制 |

```bash
git clone https://github.com/xiongmiaozai/matoga.git
cd matoga
npm install
npm start          # 启动开发服务 → http://localhost:5273
```

---

## 🗂️ 项目结构

```
server/    后端（Express + WS，分层：routes/services/middleware/config）
web/       前端（原生 ES Modules，无构建工具）
electron/  桌面壳（复用本地服务）
test/      测试（unit/ + smoke/）
docs/      设计与算法文档
scripts/   构建脚本
```

**关键约定**：

- 前端**不使用构建工具**，直接以 ES Modules 在浏览器运行
- 后端按 `routes → services → config` 分层，路由薄、服务厚
- 面板由 `web/src/panels/` 下 manifest 驱动，新增面板需提供 manifest 文件

---

## 🌿 开发流程

### 分支策略

```
main        稳定分支，始终可发布
develop     开发集成分支（如有）
feature/*   功能分支（如 feature/asset-library）
fix/*       修复分支（如 fix/port-conflict）
release/*   发布预备分支
```

### 提交 PR 流程

1. 从 `main` 拉取最新代码创建分支：`git checkout -b feature/your-feature`
2. 编码 → 测试 → lint 通过
3. 提交并推送：`git push origin feature/your-feature`
4. 在 GitHub 创建 PR，目标分支 `main`，按 [PR 模板](.github/PULL_REQUEST_TEMPLATE.md) 填写
5. 等待 CI 通过与 review
6. 合并后删除分支

---

## 📏 代码规范

### 检查命令

```bash
npm run lint           # ESLint 检查
npm run lint:fix       # ESLint 自动修复
npm run format         # Prettier 格式化
npm run format:check   # Prettier 检查（CI 用）
```

### 风格要点

- **缩进**：2 空格（Prettier 配置）
- **引号**：单引号
- **分号**：行尾无分号（按 `.prettierrc` 配置）
- **换行**：LF
- **命名**：变量/函数 `camelCase`，类 `PascalCase`，常量 `UPPER_SNAKE`
- **模块**：统一使用 ES Modules（`import/export`），不混用 CommonJS
- **注释**：仅在复杂逻辑处补充，避免无意义注释
- **不引入未在 `package.json` 声明的依赖**

---

## 📝 提交规范

采用 **Conventional Commits** 风格：

```
<type>(<scope>): <subject>

<body>

<footer>
```

### type 取值

| type       | 含义                   |
| ---------- | ---------------------- |
| `feat`     | 新增功能               |
| `fix`      | Bug 修复               |
| `docs`     | 文档变更               |
| `style`    | 代码格式（不影响逻辑） |
| `refactor` | 重构（无功能变化）     |
| `perf`     | 性能优化               |
| `test`     | 测试相关               |
| `chore`    | 构建/工具/依赖         |
| `ci`       | CI 配置                |
| `revert`   | 回滚                   |

### 示例

```
feat(panels): 新增资产库面板的收藏夹过滤
fix(sync): 修复批量同步取消后进度未清零的问题
docs(readme): 补充环境变量说明
chore(deps): 升级 three.js 至 0.186
```

---

## 🧪 测试要求

### 测试命令

```bash
npm test              # 单元测试（test/unit/）
npm run test:smoke    # 冒烟 + WebSocket 集成测试（test/smoke/）
```

### 要求

- **新增功能**必须附带单元测试
- **修复 Bug** 应附回归测试（防止复现）
- 测试框架：Node.js 内置 `node:test`
- 测试文件命名：`*.test.js`（unit） / `*.test.mjs`（smoke）
- PR 提交前确保本地 `npm test` 与 `npm run test:smoke` 全部通过

---

## 🚀 发布流程

详见 [RELEASE_TEMPLATE.md](RELEASE_TEMPLATE.md) 的「发布流程清单」一节。简要步骤：

1. 确认 `main` 分支测试与 lint 全部通过
2. 按 [语义化版本](https://semver.org/lang/zh-CN/) 更新 `package.json` 的 `version`
3. 在 `CHANGELOG.md` 归档 `[Unreleased]` 为新版本
4. 构建产物（`npm run build:*` / `npm run dist:*`）
5. 打 tag `vX.Y.Z` 并推送
6. 在 GitHub Releases 创建发布说明并上传产物

---

## 🤝 行为准则

- 友善、尊重、对事不对人
- 欢迎各水平开发者参与，乐于解答疑问
- 不接受恶意代码、不安全行为、抄袭内容
- 重大改动请先开 Issue 讨论方案，避免无效劳动

---

## ❓ 疑问

- 提 [Issue](https://github.com/xiongmiaozai/matoga/issues) 标注 `question`
- 联系作者：芝世 (xiongmiaozai) — 2720596091@qq.com

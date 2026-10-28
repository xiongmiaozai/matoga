# AGENTS.md — AI 协作代理行为约束

> 本文件用于约束 AI 编码代理（如 CodeArts、Claude Code 等）在本仓库中的行为。
> 项目级规则优先于全局规则。

---

## 📌 项目概览

- **名称**：matoga — 材质贴图对比工具
- **版本**：3.1.1
- **架构**：Node.js + Express 5（后端） + 原生 ES Modules（前端，无构建） + Electron（桌面壳）
- **端口**：默认 127.0.0.1:5273
- **测试**：`npm test`（unit） / `npm run test:smoke`（smoke）
- **Lint**：`npm run lint` / `npm run format:check`

---

## ✅ 必做

### 编码前

1. **先读上下文**：编辑文件前先 Read 该文件及同目录相邻文件，理解风格与约定
2. **遵循分层**：后端 `routes → services → config`，路由薄、服务厚，不跨层调用
3. **遵循面板 manifest 模式**：新增面板必须提供 manifest，参考 `web/src/panels/` 现有实现

### 编码中

4. **不引入未声明依赖**：任何 `import` 的包必须已在 `package.json` 中声明
5. **前端不引入构建工具**：保持原生 ES Modules 直跑，不引入 webpack/vite/rollup
6. **风格一致**：2 空格缩进、单引号、无分号、LF 换行（遵循 `.prettierrc`）
7. **命名规范**：变量/函数 `camelCase`，类 `PascalCase`，常量 `UPPER_SNAKE`
8. **不写无意义注释**：仅在复杂逻辑处补充注释

### 编码后

9. **必须验证**：完成后运行 `npm run lint` 与 `npm test`，全部通过才算完成
10. **新增功能附测试**：在 `test/unit/` 下新增 `*.test.js`
11. **修复 Bug 附回归测试**：防止同一问题复现

---

## 🚫 禁止

1. **禁止提交密钥/凭证**：不向仓库写入 token、密码、私钥
2. **禁止写入恶意代码**：包括但不限于后门、数据外泄、破坏性操作
3. **禁止绕过 .gitignore**：不强制提交 `data/`、`dist/`、`node_modules/`、`mc-packs/`、`official-packs/`
4. **禁止擅自提交**：未经用户明确要求，不执行 `git commit` / `git push`
5. **禁止擅自发布**：不修改 `package.json` 的 `version`、不打 tag、不触发 release workflow
6. **禁止引入 CommonJS**：统一使用 ES Modules（`import/export`）
7. **禁止破坏现有 API**：如需变更 REST 端点，先在 Issue 讨论
8. **禁止删除测试以"通过"**：测试失败应修复代码，而非删除测试

---

## 🔧 常用命令

```bash
npm start                # 启动开发服务
npm test                 # 单元测试
npm run test:smoke       # 冒烟 + 集成测试
npm run lint             # ESLint 检查
npm run lint:fix         # ESLint 自动修复
npm run format           # Prettier 格式化
npm run format:check     # Prettier 检查
```

---

## 🗂️ 关键路径

| 路径               | 说明       | 修改注意                             |
| ------------------ | ---------- | ------------------------------------ |
| `server/routes/`   | REST 路由  | 新增端点需在 `app.js` 挂载           |
| `server/services/` | 业务服务   | 路由调用服务，不直接操作 DB          |
| `server/config/`   | 配置存储   | 原子读写，注意并发安全               |
| `web/src/panels/`  | 动态面板   | manifest 驱动，参考现有面板          |
| `web/api/`         | API 适配层 | `api-client.js` 是 `window.api` 实现 |
| `test/unit/`       | 单元测试   | `*.test.js`，框架 `node:test`        |
| `test/smoke/`      | 冒烟测试   | `*.test.mjs`，含 WS 集成             |
| `data/`            | 运行时数据 | **不入库**，由 `.gitignore` 忽略     |

---

## 📐 提交规范

遵循 Conventional Commits（详见 [CONTRIBUTING.md](CONTRIBUTING.md)）：

```
feat(panels): 新增资产库面板的收藏夹过滤
fix(sync): 修复批量同步取消后进度未清零的问题
docs(readme): 补充环境变量说明
```

---

## 🧪 测试策略

- **单元测试**：覆盖 services / config / 纯逻辑函数，mock 文件系统与网络
- **冒烟测试**：启动真实服务，验证 API + WebSocket 端到端
- **不写 e2e UI 测试**：前端无构建工具，UI 测试成本过高，依赖人工验证

---

## 📞 联系

- 作者：芝世 (xiongmiaozai)
- 邮箱：2720596091@qq.com
- 仓库：https://github.com/xiongmiaozai/matoga

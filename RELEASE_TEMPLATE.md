# 发布模板 / Release Template

本文件用于规范 GitHub Release 发布说明的格式。每次发布时复制对应模板填入实际内容。

---

## 一、正式版本发布模板（GitHub Release）

> 标题：`vX.Y.Z`（如 `v3.1.0`）
> Tag：`vX.Y.Z`，基于 `main` 分支打 tag

```markdown
## 🎉 matoga vX.Y.Z

> 一句话概括本版本重点（如：资产库增强与性能优化版本）。

### ✨ 新增

- 功能点 1（简述 + 对应 issue/PR 链接）
- 功能点 2

### 🔧 变更

- 变更点 1
- 变更点 2

### 🐛 修复

- 修复点 1（#issue 编号）

### ⚠️ 破坏性变更

- 如有，说明迁移方式；如无，删除本节

### 📦 下载

| 平台           | 文件                              | 说明             |
| -------------- | --------------------------------- | ---------------- |
| Windows x64    | `matoga-win-x64.exe`              | 免安装可执行文件 |
| macOS arm64    | `matoga-macos-arm64`              | 免安装可执行文件 |
| Linux x64      | `matoga-linux-x64`                | 免安装可执行文件 |
| Windows 安装包 | `matoga-Setup-x64.exe`            | NSIS 安装程序    |
| macOS 安装包   | `matoga-x64.dmg`                  | DMG 镜像         |
| Linux 安装包   | `matoga-x86_64.AppImage` / `.deb` | AppImage + deb   |

### 🙏 贡献者

- @用户名（如有外部贡献）

**完整更新日志**：https://github.com/xiongmiaozai/matoga/compare/vX.Y.Z-1...vX.Y.Z
```

---

## 二、预发布版本模板（Pre-Release）

> 标题：`vX.Y.Z-rc.N` / `vX.Y.Z-beta.N`
> 勾选 **This is a pre-release**

```markdown
## 🔶 matoga vX.Y.Z-rc.N（预发布）

> 本版本为 vX.Y.Z 的候选版本，仅供测试，不建议生产使用。

### 本轮重点

- 测试目标 1
- 测试目标 2

### 已知问题

- 已知问题 1（计划在正式版修复）

### 反馈方式

发现问题请到 [Issues](https://github.com/xiongmiaozai/matoga/issues) 反馈，标题注明 `[vX.Y.Z-rc.N]`。
```

---

## 三、补丁版本模板（Patch Release）

> 标题：`vX.Y.Z`（仅 PATCH 号递增）
> 通常只含修复，不含新增功能

```markdown
## 🐛 matoga vX.Y.Z（补丁版本）

本版本为问题修复版本，无功能变更。

### 修复

- 修复点 1（#issue 编号）
- 修复点 2

**完整更新日志**：https://github.com/xiongmiaozai/matoga/compare/vX.Y.Z-1...vX.Y.Z
```

---

## 四、发布流程清单

发布一个新版本 `vX.Y.Z` 的完整步骤：

### 1. 准备代码

- [ ] 确认所有计划内功能已合并到 `main`
- [ ] 运行 `npm test` 与 `npm run test:smoke` 全部通过
- [ ] 运行 `npm run lint` 与 `npm run format:check` 无报错

### 2. 更新版本号

- [ ] 修改 `package.json` 的 `version` 字段为 `X.Y.Z`
- [ ] 在 `CHANGELOG.md` 中将 `[Unreleased]` 归档为 `[X.Y.Z] — YYYY-MM-DD`
- [ ] 在 `CHANGELOG.md` 顶部新增空的 `[Unreleased]` 区块
- [ ] 补充 `[X.Y.Z]` 的版本对比链接

### 3. 构建产物

- [ ] `npm run build:win` / `build:mac` / `build:linux`（免安装可执行文件）
- [ ] `npm run dist:win` / `dist:mac` / `dist:linux`（桌面安装包）
- [ ] 验证产物可正常启动并访问 `localhost:5273`

### 4. 打 Tag 与发布

- [ ] `git commit -am "chore: release vX.Y.Z"`
- [ ] `git tag vX.Y.Z`
- [ ] `git push origin main --tags`
- [ ] 在 GitHub Releases 基于 tag 创建发布，填入模板一内容
- [ ] 上传对应平台构建产物到 Release Assets

### 5. 发布后验证

- [ ] 在干净环境下载产物并运行，确认核心功能正常
- [ ] 检查 Release 页面链接与下载可用
- [ ] 如有官网，同步更新版本信息

---

## 五、版本号决策参考

| 场景                    | 版本号变更                 | 示例                          |
| ----------------------- | -------------------------- | ----------------------------- |
| 仅修复 Bug，无新功能    | PATCH +1                   | `3.1.0` → `3.1.1`             |
| 新增向下兼容的功能      | MINOR +1，PATCH 归 0       | `3.1.0` → `3.2.0`             |
| 不兼容的 API / 架构变更 | MAJOR +1，MINOR/PATCH 归 0 | `3.1.0` → `4.0.0`             |
| 正式版前的测试版本      | 追加预发布标识             | `3.2.0-rc.1` / `3.2.0-beta.1` |

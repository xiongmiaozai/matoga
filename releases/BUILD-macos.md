# matoga v1.0.0 — macOS 版本包

本包为 matoga 源码归档（macOS 平台标识）。

## 在 macOS 上运行

```bash
unzip matoga-v1.0.0-macos.zip
cd matoga-v1.0.0
npm install
npm start          # 生产模式
npm run dev        # 开发模式（启用 DevTools + 热重载）
```

## 系统要求
- macOS 11+
- Node.js 18+
- 4 GB+ 内存（推荐 8 GB）

## 打包为 .app / .dmg（可选）
```bash
npx electron-builder --mac --universal
```
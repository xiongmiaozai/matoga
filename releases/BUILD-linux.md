# matoga v1.0.0 — Linux 版本包

本包为 matoga 源码归档（Linux 平台标识）。

## 在 Linux 上运行

```bash
unzip matoga-v1.0.0-linux.zip
cd matoga-v1.0.0
npm install
npm start          # 生产模式
npm run dev        # 开发模式（启用 DevTools + 热重载）
```

## 系统要求
- Ubuntu 20.04+ / Fedora / Arch
- Node.js 18+
- 4 GB+ 内存（推荐 8 GB）

## 打包为 .AppImage / .deb / .rpm（可选）
```bash
npx electron-builder --linux AppImage deb rpm
```
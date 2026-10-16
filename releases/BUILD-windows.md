# matoga v1.0.0 — Windows 版本包

本包为 matoga 源码归档（Windows 平台标识）。

## 在 Windows 上运行

```powershell
Expand-Archive matoga-v1.0.0-windows.zip
cd matoga-v1.0.0
npm install
npm start          # 生产模式
npm run dev        # 开发模式（启用 DevTools + 热重载）
```

## 系统要求
- Windows 10+
- Node.js 18+
- 4 GB+ 内存（推荐 8 GB）

## 打包为 .exe（可选）
```bash
npx electron-builder --win x64
```
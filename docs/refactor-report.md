# Refactor Report

> Date: 2026-10-25 · Base: v3.0.0 (2bfab64) · Status: DONE

## 1. Upstream Sync

- `git fetch origin` + dropped local changes (package-lock.json touched by
  npm install was the only local edit; `git checkout --` restored it).
- Local main == upstream 2bfab64 (v3.0.0). 16 new upstream commits since the
  previous session: Electron -> B/S -> Electron+B/S hybrid, v3.0.0, release
  workflow, CI fixes.
- Note: our PR #1 (NSIS improvements on v1.0.2) was closed unmerged. The 3
  commits remain on `LingMowen/matoga` fork. The packaging improvements were
  re-applied to v3.0 in this refactor (see section 4).

## 2. Modularization

Chosen approach: **in-place layering** (option B in [module-plan.md](module-plan.md)) —
no monorepo split, because pkg.assets, electron-builder `files` globs, and
vendor static mounts all assume the single-root layout, and there is no CI
packaging test to catch a layout regression.

| Change | From | To | Reason |
| --- | --- | --- | --- |
| Move shared code | `shared/errors.js` | `core/errors.js` | core/ is the future home of shared domain logic; 6 server files + 1 test updated |
| Repo scripts | `verify-changelog.mjs` (root) | `tools/verify-changelog.mjs` | script fixed to resolve `website/` from repo root via `path.resolve(__dirname, '..')` (it used to rely on living next to the dir) |
| Asset roots | `HDRI预设/`, `材质包/` (CN names, empty) | deleted; runtime recreates `hdri-presets/`, `mc-packs/`, `official-packs/` automatically | names must match `config-store.js:55-57` defaults and `build.extraResources` |
| Stray dir | `test-install LOG=C/` | deleted | leftover NSIS debug log from 2026-10-18 install debugging |
| New dir | — | `official-packs/` | referenced by config defaults and extraResources, never existed |
| New dir | — | `tools/` | toolchain scripts |
| New dir | — | `build/` (license.txt, installer.nsh) | NSIS customization, gitignored except the two script files |

Dependency direction after refactor:

```
core/  <- server/  <- electron/   (require chain, same process)
web/   --HTTP-->   server/        (client-server contract only)
tools/ -> repo     (standalone scripts)
```

## 3. Fixes

### Packaging (build/ + package.json)

- `build.nsis`: added `license` (EULA page), `include` (installer.nsh),
  desktop/start-menu shortcuts, shortcutName, `deleteAppDataOnUninstall:false`.
- `build/license.txt`: CN EULA, UTF-8 BOM (NSIS Unicode reads UTF-8 BOM; UTF-16
  LE breaks GitHub preview).
- `build/installer.nsh`: empty `customCheckAppRunning` macro — kills the
  "cannot close matoga, please close it manually" modal (the server now runs
  in-process inside matoga.exe, window close == server close).
- `.gitignore`: `build/` -> `build/*` + whitelist for the two installer files.
- Registry leftover caveat (from PR #1 debugging): stale
  `HKCU\...\Uninstall\<guid>` entries pointing at deleted uninstallers make
  every later install exit with code 2 via `uninstallOldVersion`. If installs
  fail with exit 2 and zero files, delete the stale keys.

### Directory

- Deleted `test-install LOG=C/`, `HDRI预设/`, `材质包/` (all empty/stray).
- Created `official-packs/` (referenced but missing).

### Dependencies

- npm install against npmmirror registry; two postinstall scripts blocked by
  npm's install-scripts policy (electron-winstaller, esbuild) — approve with
  `npm install-scripts approve` if `build:win` (pkg) ever fails on missing 7z.
- Packaging needs `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`
  npmmirror env vars when github.com direct download stalls (observed).

### Code quality

- `tools/verify-changelog.mjs`: root-relative path resolution fixed (verified
  pass=7 fail=0).
- No naming changes inside server/web — upstream v3.0 already follows
  kebab-case files + folder-per-concern in server/, consistent throughout.

## 4. Verification

| Check | Result |
| --- | --- |
| `npm test` (550 unit tests) | pass, exit 0 |
| `npm run test:smoke` (19 smoke + 10 WS) | pass, exit 0 (after creating hdri-presets/) |
| `node server/index.js` | boots, http://localhost:5273 |
| `node tools/verify-changelog.mjs` | pass=7 fail=0 |
| `npm run dist:win` | exit 0, matoga Setup 3.0.0.exe (107.5 MB) |
| Silent install `/S /D=` | exit 0, 75 files, app.asar present |
| Silent uninstall `/S` | exit 0, cleanup complete |

## 5. Next Steps

1. **GUI smoke of the installer** — double-click `matoga Setup 3.0.0.exe`, walk
   license page -> dir picker -> finish, confirm EULA renders (CN text) and no
   "cannot close" modal appears on reinstall.
2. **CI mirror env** — add `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`
   to release-desktop.yml env (or a step-level env) so GH runners don't stall
   on github download timeouts; current workflow relies on default mirrors.
3. **npm install-scripts policy** — decide whether to approve
   electron-winstaller/esbuild postinstall scripts locally, or keep blocked
   (v3.0 uses electron-builder, not electron-winstaller, so blocked state is
   likely fine; esbuild postinstall only matters if a bundler is added later).
4. **Reopen PR against v3.0** — optional: cherry-pick the packaging layer
   (build/, package.json nsis block) as a fresh PR if the upstream maintainer
   wants the EULA + guard back.
5. **docs/ naming** — legacy CN-named docs (界面设计方案.md, 优化方案.md,
   纹理过滤技术.md) kept as-is; all new docs use EN filenames per repo policy.

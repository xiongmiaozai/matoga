# Module Plan

> Date: 2026-10-25 · Scope: matoga v3.0.0 (commit 2bfab64) · Status: PROPOSED

## Goal

Split the monolithic tree into clear modules with separated responsibilities:
core logic, client (web), server (backend), desktop shell (electron), toolchain
(build/test/scripts), and assets. All changes must keep the app runnable and
all tests green.

## Current State

```
matoga/
├── electron/            # desktop shell: main.js + launch.js (2 files)
├── server/              # backend: 45 files (index/app/ws/paths + config/middleware/routes/services)
├── shared/              # shared code: 1 file (errors.js) — only used by server today
├── web/                 # frontend: 110 files (api/ assets/ src/ 38 js modules)
├── test/                # 58 files (unit/ + smoke/)
├── docs/                # 7 docs, mixed CN/EN filenames
├── website/             # landing page (3 files)
├── data/                # runtime data (1 file)
├── HDRI预设/ 材质包/      # user asset dirs, CN names, currently empty
└── verify-changelog.mjs # stray script at root
```

Dependency direction (observed):

- electron → server (same-process require), server → shared
- web → server via HTTP API only (no direct imports)
- test → server + web (unit tests hit /api via fetch)

## Options Considered

| Option | Description | Verdict |
| --- | --- | --- |
| A. pnpm workspace monorepo | Move server/web/core into packages with own package.json | Rejected for now: express app requires `node_modules` layout via vendor statics at `ROOT/node_modules`, pkg assets config, and electron-builder `files` globs all assume single-root; breaking all three at once is high risk with no test net for packaging |
| B. In-place module layering | Keep single package; reorganize directories by responsibility; centralize cross-cutting config; fix naming | Chosen: zero dependency-graph change, all tests keep passing, packaging configs keep working, reversible |

## Target Layout (Option B)

```
matoga/
├── src/
│   ├── core/            # shared domain logic (moved from server/services where reusable)
│   │   └── errors.js    # from shared/errors.js (single consumer today, one level less)
│   ├── server/          # unchanged internals: config/ middleware/ routes/ services/
│   └── electron/        # desktop shell
├── web/                 # client (unchanged path: packaging + vendor statics depend on it)
├── tools/               # toolchain scripts (verify-changelog.mjs, future release helpers)
├── assets/
│   ├── hdri-presets/    # renamed from HDRI预设/
│   ├── mc-packs/        # renamed from 材质包/
│   └── official-packs/  # new (referenced by config-store defaults, was missing)
├── test/                # mirrors src layout
├── docs/                # EN filenames only (this dir)
└── package.json         # single root
```

Wait — one correction before implementation: `server/config/config-store.js:55-57`
defaults expect `<PRESET_ROOT>/hdri-presets|mc-packs|official-packs`, and
`package.json build.extraResources` copies those three dirs from project root.
Renaming the CN dirs under `assets/` would break the extraResources `from`
paths unless those are updated too. Decision: put the three asset dirs at
project root with their English names (as upstream README documents), not
under assets/, to keep both config-store defaults and extraResources valid
with minimal edits:

```
matoga/
├── hdri-presets/        # renamed from HDRI预设/ (empty, gitignored user data)
├── mc-packs/            # renamed from 材质包/  (empty, gitignored user data)
├── official-packs/      # new empty dir (referenced by defaults)
```

## Key Decisions

1. **Option B over A** — packaging (pkg + electron-builder) and vendor statics
   assume the single-root layout; a monorepo split would require simultaneous
   rewrites of `pkg.assets`, `build.files`, and `server/app.js:51-53` static
   mounts. No CI packaging test exists to catch regressions. Module boundaries
   are achieved via layout + docs, not via package separation.
2. **Asset dirs get English names at root** — config-store defaults
   (`server/config/config-store.js:55-57`) and `build.extraResources`
   (`package.json:84-93`) both reference English names; CN dirs are historical
   leftovers that the running app never reads. Renaming aligns runtime,
   packaging, and docs.
3. **web/ stays at web/** — `server/app.js:56` serves `ROOT/web` statically
   and electron-builder files include `web/**/*`; moving it would touch the
   packaging contract for zero functional gain.
4. **electron/ moves under src/ only if free** — electron/main.js requires
   `../server/app`, so electron and server must stay siblings. Final layout
   keeps `electron/` and `server/` at root as siblings; a `src/` umbrella adds
   churn without value for a no-bundler project. Revised target:

```
matoga/
├── core/                # NEW: shared domain code (from shared/, grows later)
├── server/              # backend (unchanged)
├── electron/            # desktop shell (unchanged)
├── web/                 # client (unchanged)
├── tools/               # NEW: repo scripts
├── test/                # unchanged
├── hdri-presets/ mc-packs/ official-packs/   # EN-named asset roots
└── docs/                # EN filenames
```

## Cleanup Items

- `test-install LOG=C/` — stray empty dir with a broken name; delete.
- `verify-changelog.mjs` — move to `tools/verify-changelog.mjs`.
- `dist/` — build output, must be gitignored (check).
- `data/` — inspect purpose before touching.
- docs/ CN-named files — keep content, note in docs index that new files use
  EN names; renaming existing files is allowed (they are project docs, not
  user data).

## Fix Backlog (step 3)

1. Packaging: upstream NSIS config lacks license page + app-running guard we
   had built (PR #1 was closed unmerged). Re-add under new layout: license file
   + installer.nsh + `build.nsis.include`. Also fix `build.extraResources`
   referencing dirs that don't exist (they will after rename).
2. Directory: stray `test-install LOG=C/`, root-level script, missing
   `official-packs/` dir.
3. Dependencies: three dev deps pinned with `^` ranges incl. electron 44 —
   verify lockfile consistency; pkg assets list vs actual three build files
   (three.module.js/three.core.js exist? verify).
4. Code quality: `server/app.js:61` catch-all mounts after static; check
   `web/api/` dir purpose (server-side proxy?); naming consistency in routes.

## Verification Plan

After each step: `npm test` (node --test unit), `npm run test:smoke`,
`node server/index.js` boots on 5273, then `npm run dist:win` at the end.

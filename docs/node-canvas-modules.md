# Node Canvas Modules

> Date: 2026-10-25 · Scope: `web/src/node-canvas.js` · Status: DONE

## Why

`web/src/node-canvas.js` carried the whole node editor in one file: node
definitions, widgets, edge rendering, the evaluation engine, undo/redo,
gestures, context menus, panels, and the import paths. At 3329 lines it was the
largest module in `web/`, so any change touched the same file and review diffs
were unreadable.

The split is **mechanical**: code is moved verbatim, not rewritten. Behaviour
stays bit-for-bit identical, which is why the unit suite is the acceptance gate.

## Result

```
web/src/node-canvas.js          2644  thin editor shell: graph, node CRUD,
                                      panels, context menus, wiring
web/src/node-canvas/
├── algorithms.js                614  pure math (noise / blend / effects)
├── state.js                      24  the shared graph state object
├── viewport.js                  147  pan / zoom / minimap / coordinate maths
├── widgets.js                   371  in-node property controls
├── edges.js                     106  edge drawing + drag-to-connect
├── evaluate.js                   91  topological evaluation engine
├── history.js                    80  undo / redo snapshots
├── status.js                     32  counters, changed event, toast
└── gestures.js                   47  multi-pointer + long-press
```

Sub-modules that need something the editor owns receive it through a
`set*Hooks` injection function instead of importing the editor back. This keeps
the dependency graph acyclic: every `node-canvas/*` module imports only
siblings, and `node-canvas.js` is the single place that knows the whole picture.

| Module | Injected via | Supplies |
| --- | --- | --- |
| `widgets.js` | `setWidgetHooks` | `evaluate`, `markDirty`, `toast` |
| `edges.js` | `setEdgeHooks` | `typeColor`, `edgePath`, `selectEdge`, `canConnect`, `evaluate`, `pushHistory` |
| `evaluate.js` | `setEvalHooks` | `nodeDefs`, `syncToPreview`, `_renderNoisePreview`, `_renderPreviewVal`, `updatePreview` |
| `history.js` | `setHistoryHooks` | `renderNode`, `renderEdges`, `updateStats`, `evaluate`, `toast` |
| `status.js` | `setStatusHooks` | `markDirty` |
| `gestures.js` | `setGestureHooks` | `showNodeMenu`, `showCanvasMenu` |

### Wiring happens at module load, not at init

All `set*Hooks` calls sit **at the end of `node-canvas.js`**, not inside
`initNodeCanvas()`. Hoisting makes this safe (the injected names are function
declarations or `const`s defined earlier in the file), and it means
`createNode` / `getNodeDetail` work in tests without running the full editor
initialization. An earlier attempt to wire inside `initNodeCanvas()` broke 20
tests that use those exports directly — the evaluator saw empty node
definitions.

### Mutable state crosses the boundary as accessors

`pinch` is a `let` that the editor reassigns. ESM import bindings are read-only,
so `gestures.js` exports `getPinch()` / `setPinch(v)` instead of the binding.
`pointers` is a `Map` mutated in place, so it exports directly.

## Verification

| Check | Result |
| --- | --- |
| `npm test` (550 unit tests) | pass, exit 0 |
| `node test/smoke/node-canvas-modules.mjs` | pass — exports, node creation, evaluation, undo/redo, delete |
| `node --check` on every touched file | clean |

## Flaky tests (pre-existing, unrelated)

`npm test` occasionally fails 1–4 tests when run with default concurrency.
Observed failures land in `asset-tex` / `asset-store` / texture-merge, never in
`node-canvas`; each passes when run alone or with `--test-concurrency=1`. Cause
is parallel writes under `data/` (one test logs
`EPERM ... rename 'data/config.json.<uuid>.tmp' -> 'data/config.json'`). The
same flakiness appears on the pre-split tree.

## Not moved

- Node definitions (`NODE_DEFS`) stay in `node-canvas.js`: they reference widget
  builders, so moving them would make the import graph cyclic again.
- Context menus, panels, toolbar, copy/paste, texture import: they are
  DOM-binding heavy and would need large hook surfaces for little payoff.

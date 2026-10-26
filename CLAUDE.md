# Lumen repository guide

## Read first

- `docs/architecture/README.md` and the document for the area you touch.
- `packages/schema/src/scene.ts` before any renderer change.
- `packages/core/src/live.ts` before any live-control change.

## Commands

```bash
pnpm install
pnpm dev
pnpm check-types
pnpm test
pnpm build
pnpm desktop:dev
cd apps/studio/src-tauri && cargo check && cargo test -p lumen-output -p lumen-render -p lumen-media
```

## Conventions

- Explicit imports only. `imports.autoImport` and `components.dirs` are off; import macros from `#imports` and components from `#components`.
- UI kit lives in `apps/studio/app/ui` and exports from `~/ui`. Do not edit generated `styled-system`.
- Panda tokens are strict. Use tokens (`textStyle`, `bg.panel`, `control.md`) or bracket arbitrary values (`[16px]`, `[16/9]`).
- Design tokens are copied from Malla Builder and must stay identical unless a presenter-specific token is added.
- `apps/studio` is the Tauri SPA. `apps/web` is the SSR Worker. Do not add a server route to studio.
- The audience output is a native Tauri window from `lumen-output`; never render it with a webview.
- Rust: keep monitor/window code in `lumen-output`, scene and layout in `lumen-render`, decode and clock in `lumen-media`.
- Tests: Vitest for TS, PGlite for data, Rust unit tests for placement/clock/scene. Do not add GPU-dependent tests to CI.
- Commit messages: Conventional Commits.

## Current phase

Phase 0 foundation. The next engineering milestone is the Phase 0.5 native output spike: one borderless wgpu window, a hardcoded scene, and a signed dev build on macOS and Windows.

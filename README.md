# Lumen

A ProPresenter-class live presentation app for churches and event venues.

- **Desktop**: Tauri 2 + Nuxt 5 SPA. Audience output is a native `wgpu` window, not a webview.
- **Cloud**: Hono API on Cloudflare Workers, Neon Postgres via Hyperdrive, Drizzle, R2, Durable Objects.
- **Offline**: content and media live on the machine; sync runs in the background.
- **Design**: Malla Builder tokens and UI kit, Panda CSS, Inter, ink surfaces, orange accent.

## Status

Phase 0 foundation:

- Turborepo with `apps/studio`, `apps/web`, `apps/api`, `apps/realtime`.
- Shared `@lumen/schema`, `@lumen/core`, `@lumen/db`, `@lumen/auth-token`, `@lumen/design`.
- Builder UI kit copied into `apps/studio/app/ui`; library and live workspaces render.
- Hono API with Better Auth, workspaces, libraries, presentations, sync, media presign and live sessions.
- Durable Object live relay with hibernatable WebSockets.
- Tauri shell with native borderless audience-window creation and display placement.
- Rust crates for scene, media clock and output placement.

Not yet implemented: wgpu rendering, cosmic-text layout, media decode, local SQLite repo and sync engine, desktop auth handoff, signed installers.

## Requirements

- Node 24+, pnpm 10.19
- Rust 1.85+ (`rustup`)
- macOS 12+ or Windows 10+ for the desktop app
- Xcode command line tools on macOS

## Quick start

```bash
pnpm install
pnpm dev                 # studio on :3000, web on :3001, api on :4000, realtime on :8788
pnpm desktop:dev         # Tauri window pointed at the studio dev server
```

For the API locally, copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars` and set `DATABASE_URL` to a Neon branch. Without a database, `/health` still runs.

```bash
pnpm check-types
pnpm test
pnpm build
```

Rust:

```bash
cd apps/studio/src-tauri
cargo check
cargo test -p lumen-output -p lumen-render -p lumen-media
```

## Repository

```
apps/
  studio/      Nuxt 5 SPA + Tauri operator app
  web/         Nuxt 5 SSR Worker: marketing, desktop auth, remote
  api/         Hono Worker
  realtime/    Durable Object live relay
packages/
  schema/      Zod presentation, scene and live protocol
  core/        Song splitting, scene build, live reducer
  db/          Drizzle schema and migrations
  auth-token/  HMAC tokens for realtime and remote
  design/      Shared Panda preset copied from Builder
```

Architecture notes live in [`docs/architecture`](docs/architecture). The approved build plan is in `~/.claude/plans/fancy-herding-clover.md`.

## Media and licensing

- Bundle only open fonts. Imported fonts stay local unless the user marks them as licensable for sync.
- Prefer platform decoders for H.264/AAC; use an LGPL ffmpeg sidecar for other codecs.
- NDI/Syphon/Spout, SongSelect and licensed Bible translations are post-MVP because each has its own license.

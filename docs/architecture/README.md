# Lumen architecture

Read these before changing a subsystem. The approved implementation plan is `~/.claude/plans/fancy-herding-clover.md`.

| # | Document | Covers |
|---|---|---|
| 01 | [Data model](01-data-model.md) | Tenancy, content tables, sync columns, local SQLite |
| 02 | [Render contract](02-render-contract.md) | Scene schema, preview layout, transitions |
| 03 | [Live engine](03-live-engine.md) | Live state, commands, modes, realtime relay |
| 04 | [Sync](04-sync.md) | Pull/push, revisions, conflicts, media |
| 05 | [Desktop output](05-desktop-output.md) | Native windows, render threads, power, media |
| 06 | [Deploy](06-deploy.md) | Cloudflare resources, secrets, migrations, releases |
| 07 | [Roadmap](07-roadmap.md) | Phase 0 through Phase 4 |

## Invariants

1. The audience output is never a webview.
2. Live output works with no network.
3. `Scene` is the only renderer contract; Rust never calls the API.
4. SQLite is authoritative during a service; cloud sync is background.
5. One writer per document in MVP; conflicts are surfaced, never merged silently.
6. Revisions order sync, not wall-clock timestamps.
7. Builder design tokens are copied, not approximated.

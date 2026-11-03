# Lumen architecture

Read these before changing a subsystem. The approved implementation plan is `~/.claude/plans/fancy-herding-clover.md`.

| # | Document | Covers |
|---|---|---|
| 01 | [Data model](01-data-model.md) | Tenancy, content tables, sync columns, local SQLite |
| 02 | [Render contract](02-render-contract.md) | Composition v2: sources, layers, blend, effects, masks, preview, transitions |
| 03 | [Live engine](03-live-engine.md) | Live state, commands, modes, realtime relay |
| 04 | [Sync](04-sync.md) | Pull/push, revisions, conflicts, media |
| 05 | [Desktop output](05-desktop-output.md) | Native windows, render threads, power, media |
| 06 | [Deploy](06-deploy.md) | Cloudflare resources, secrets, migrations, releases |
| 07 | [Roadmap](07-roadmap.md) | Live visuals product target, core model, Waves A–G |
| 08 | [Show control](08-show-control.md) | MIDI bindings, MTC, LTC, timecode, cue timeline |
| 09 | [Local editor](09-local-editor.md) | SQLite library, songs, lyrics split, editor routes |
| 10 | [Screens and mapping](10-screens-and-mapping.md) | Screens, per-screen layouts, corner pin, mesh, edge blend |
| 11 | [Studio UI](11-ui.md) | Workspaces, layouts of Show, Compose and Screens, route changes |
| 12 | [Command bus and API](12-command-bus.md) | One command type for UI, keyboard, MIDI, timeline, OSC, HTTP/WebSocket, Companion |
| 13 | [Virtual outputs](13-virtual-outputs.md) | NDI, Syphon, Spout, virtual camera and DeckLink screens for OBS and other software |
| 14 | [Local network](14-local-network.md) | Remote, stage, lyrics and viewer pages served by the desktop; Bonjour discovery; QR pairing |
| 15 | [Backup and export](15-backup-and-export.md) | `.lumen` bundles, import with conflicts, automatic local backups, library check |
| 16 | [Preflight and monitoring](16-preflight-and-monitoring.md) | Checks before going live, keep-awake, performance monitor and stats |
| 17 | [Props and messages](17-props-and-messages.md) | Overlay templates, lower thirds, countdowns, clocks, tickers, QR, audience messages |
| 18 | [Live inputs](18-live-inputs.md) | Cameras, capture cards, NDI, Syphon/Spout and screen capture as sources; IMAG |
| 19 | [Program recording](19-program-recording.md) | Record any screen to ProRes or H.264 with timecode and markers |
| 20 | [Show templates](20-show-templates.md) | Starting shows per market, New show wizard, save as template |
| 21 | [Stems integration](21-stems-integration.md) | Lumen follows Stems: timecode, songs and sections, setlists, tempo |

## Invariants

1. The audience output is never a webview.
2. Live output works with no network.
3. `Composition` plus `Screen[]` is the only renderer contract; Rust never calls the API.
8. Content never knows which screen shows it; layouts and mapping live on the screen.
4. SQLite is authoritative; cloud sync, when it arrives, is background only.
9. v1 is local only: no account, no cloud, no internet needed. Remotes connect over the LAN (doc 14); backups are local files (doc 15).
5. One writer per document in MVP; conflicts are surfaced, never merged silently.
6. Revisions order sync, not wall-clock timestamps.
7. Builder design tokens are copied, not approximated.

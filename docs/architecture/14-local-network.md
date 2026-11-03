# 14 — Local network: remotes, stage and discovery

Lumen v1 ships with **no cloud**. Phones, tablets and other computers connect straight to the desktop app over the local network. The desktop app serves the remote and stage pages itself, announces itself with Bonjour, and pairs devices with a QR code. A cloud relay (the Durable Object in `apps/realtime`) can come after v1, for devices outside the network, and speaks the same protocol.

- Commands, state events, tokens and the HTTP/WebSocket server: `12-command-bus.md`. This doc builds on that server.
- Live state: `03-live-engine.md`. Stage layouts: `10-screens-and-mapping.md` (`layout.stage`).
- Roadmap: **E3a Local remotes** (§ Delivery), part of the v1 local release.

## Rules

1. **Works with no internet.** Every page, font and script a remote needs is served by the desktop app. No CDN, no account.
2. **The desktop app stays the authority.** Remotes send commands and display state; they never apply commands (doc 12, invariant 2).
3. **A remote can fail without affecting the show.** A disconnected phone or a flood of requests never stalls output (doc 12, invariant 4).
4. **Pairing is explicit.** A device gets in only with a token the operator issued, and the operator can revoke it at any time.
5. **Same protocol locally and through a relay.** A remote doesn't care whether it reaches the desktop directly or through the future cloud relay.

## Web apps served by the desktop

One small Vue SPA, `apps/remote`, built with the same UI kit and tokens as the studio (`~/ui`, Panda), bundled into the desktop app's resources and served by `lumen-control`'s axum server (port 7710) as static files.

| Route | Who | What | Token role |
|---|---|---|---|
| `/remote` | Operator, producer, band leader | Rundown, slides of the current item, Prev / Take / Next, modes (Black, Clear, Freeze, Logo), clip columns, panic, stage message, timers | `control` |
| `/stage` | Musicians, speakers, actors | Stage display: current and next slide, notes, clock, timers, operator message, chosen by a stage screen layout (`layout.stage`) | `stage` |
| `/lyrics` | Musicians and singers on their own tablet | Large lyrics only, current and next lines, adjustable size, dark theme; follows the live slide | `stage` |
| `/viewer` | Anyone who needs to watch | Low-rate preview of a screen's program (JPEG, 5 fps), on-air labels, tally | `view` |

Pages are responsive and touch-first: large hit targets, a lock button against accidental taps, landscape and portrait, and a "keep screen awake" request through the Wake Lock API.

The **desktop stage window** keeps working as it does today. `/stage` is the same view for devices that aren't the Mac.

### Viewer frames

`/viewer` cannot use the native output path. The desktop app renders a small preview of the chosen screen through `preview_render_composition` at 640 px and 5 fps, encodes it as JPEG on a worker thread and pushes it over the WebSocket. It runs only while a viewer is connected, at most two screens at a time. It's for monitoring, not for program output; NDI (doc 13) is the program feed.

## Discovery

- The desktop app announces **`_lumen._tcp`** on port 7710 with Bonjour/mDNS (`mdns-sd` crate), with TXT records `version`, `show` (show name) and `id` (a random install id, not the machine name).
- Companion's module and other Lumen machines find it by service type.
- Browsers can't browse mDNS, so phones use the **QR code** or the `.local` address shown in Settings, for example `http://studio-mac.local:7710/remote`.
- OSC also announces `_osc._udp` when it's on, so TouchOSC and QLab can find it.
- Discovery is off when the API is off.

## Pairing

```
Settings → Remote control → Add device
  ├─ choose role: control | stage | view
  ├─ optional name (e.g. "Band iPad")
  └─ shows a QR code: http://<host>.local:7710/pair#<one-time code>
Phone scans → /pair page → POST /api/v1/pair { code, deviceName }
  → desktop shows "Allow 'Band iPad' as stage?" → operator accepts
  → device receives its token, stored in the browser (localStorage)
```

- The **one-time code** is valid for 5 minutes and one use. It is in the URL fragment (`#`), so it is never sent in a request line or logged by proxies.
- The operator **accepts every pairing** on the desktop. A code alone is not enough.
- The resulting token works as in doc 12: hashed at rest, revocable, with a role. The Settings list shows each device, its role, when it was last seen, and a Revoke button.
- The stage role is new: it allows state and stage data but no commands except `stage.ack` (a speaker acknowledging a message).
- Pairing over plain HTTP on a LAN can be watched by someone on the same network. Settings says so. HTTPS with a local self-signed certificate is a later option (see Open questions).

## Transport

Remotes use the WebSocket API from doc 12 unchanged: `hello` with the token, `welcome` with full state, `command`/`ack`, `state` events, `ping`/`pong`. Two additions:

```
server → { type: 'stage', current, next, notes, clock, timers, message }   for stage and lyrics pages
server → { type: 'frame', screenId, jpeg: <binary> }                       for viewer pages (binary message)
client → { type: 'watch', screenId | null }                                viewer chooses a screen
```

A remote that loses the connection shows a clear "Reconnecting" banner, retries with backoff, and gets full state on reconnect. It never shows stale slides as if they were live.

## Cloud relay later

The Durable Object in `apps/realtime` stays in the repo but is **not used in v1**. After v1 it becomes an optional relay for remotes outside the network:

- The desktop app opens one outgoing WebSocket to the relay and forwards the same messages. Remotes connect to the relay instead of the LAN address.
- Authentication moves to accounts (doc 01), and tokens become scoped to a workspace.
- Nothing in the remote apps changes except the base URL. That's rule 5.

## Security

Everything in doc 12 § Security applies. In addition:

- Static pages are served without cookies and with a strict Content-Security-Policy (`default-src 'self'`).
- `/pair` is rate limited per IP, and failed codes count towards a lockout of 1 minute after 5 failures.
- The viewer only streams screens the operator marked as viewable (a per-screen `remoteView` flag, off by default).
- Tokens are stored in the browser's localStorage, which is acceptable on a trusted device. Revoking a device removes access immediately and closes its socket.

## Files

| Area | Location |
|---|---|
| Remote SPA (remote, stage, lyrics, viewer, pair) | `apps/remote/` (Vue 3 + Panda, UI kit copied from `apps/studio/app/ui`, same tokens) |
| Static serving, pairing, stage and frame messages | `apps/studio/src-tauri/crates/lumen-control/src/{api.rs,pair.rs,web.rs}` |
| mDNS | `lumen-control/src/discovery.rs` |
| Viewer JPEG encoder | `lumen-control/src/viewer.rs` (`image` crate, worker thread) |
| Settings UI: devices, pairing QR, discovery | `apps/studio/app/settings/RemoteControlPanel.vue` |
| Stage data builder (shared with the stage window) | `apps/studio/app/stage/stageModel.ts` |

## Tests

- **Vitest:** remote pages against a fake WebSocket (render state, send commands, reconnect banner), stage and lyrics views from fixtures.
- **Rust:** pairing codes (expiry, one use, lockout), token roles, static file serving and CSP headers, the mDNS record contents, JPEG frame throttling.
- **Manual:** an iPhone and an iPad on the same Wi-Fi as the Mac; pair, run a rundown from `/remote`, follow on `/stage` and `/lyrics`, revoke a device during a show; turn off Wi-Fi on the phone and check that the show is unaffected.

## Delivery (E3a, part of the v1 local release)

| Step | Scope | Exit |
|---|---|---|
| E3a.1 Pairing | QR pairing, device list, roles, revoke | A phone pairs and appears in Settings |
| E3a.2 Remote | `/remote` page over the WebSocket API | A phone runs a rundown with Take, Next and modes |
| E3a.3 Stage and lyrics | `/stage`, `/lyrics`, stage messages | A tablet shows current and next lyrics in sync with the outputs |
| E3a.4 Viewer | `/viewer` frames, per-screen `remoteView` | A phone shows the Main screen at 5 fps |
| E3a.5 Discovery | mDNS, `_osc._udp` | Companion finds Lumen without typing an address |

Depends on D1.4 (local API).

## Open questions

- **HTTPS on the LAN.** Browsers require a secure context for some features (Wake Lock on some browsers, clipboard). A local CA or a self-signed certificate means trust prompts on every device. v1 plan: plain HTTP with a warning in Settings, and test whether Wake Lock works on the target browsers.
- **Native remote apps.** A small iOS/Android app could browse mDNS and keep the screen awake reliably. Not in v1; the web pages come first.

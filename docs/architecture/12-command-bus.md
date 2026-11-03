# 12 — Command bus and API

Roadmap milestone **D1**. One command type carries every change to the running show, whatever sends it: the UI, the keyboard, MIDI, the timeline, OSC, the local HTTP and WebSocket API, Bitfocus Companion and Stream Deck. Later milestones add DMX (D2), the cue list (E1) and network remotes and render nodes (E3) on the same bus.

Exit (from `07-roadmap.md`): Companion, OSC and MIDI drive the same state with identical results.

Related docs: `03-live-engine.md` (live state), `08-show-control.md` (MIDI and timecode), `02-render-contract.md` and `10-screens-and-mapping.md` (parameter paths).

## Why

Today each input changes state its own way:

- UI buttons and the keyboard call `useLiveSession` methods (`next`, `take`, `setMode`) and `useShowLive` clip functions directly.
- MIDI and timecode arrive as `control:event` from `lumen-control`; `useShowControl` turns them into `LiveCommand` with `toLiveCommand` and calls `liveReducer`.
- The timeline runner fires marker commands and writes keyframes straight onto the output composition.
- Compose and Screens edit the show document through `useShowDocument`.

The same action reached through two inputs can behave differently, nothing records who changed what, and adding an input means touching every feature. The bus fixes all three.

## Invariants

1. **Every change to the running show is a `Command`.** No input changes live state, the show document or outputs any other way.
2. **One authority.** The desktop app that owns the outputs applies commands, in arrival order. Remotes send commands and receive state; they never apply commands themselves.
3. **Same command, same result.** A command produces the same state change whether it came from the UI, MIDI, OSC or HTTP. Inputs only translate; they hold no logic.
4. **Live output never waits on the network.** The API and OSC run off the render and audio threads. A slow or broken client cannot stall a frame.
5. **LAN only, token protected.** The API listens on the local network, never the internet, and every client needs a token. See § Security.
6. **Commands are data.** A command is plain JSON, validated by Zod in TypeScript and serde in Rust. It can be logged, replayed and stored in a cue.

## Command model

### Envelope

```
CommandEnvelope {
  id: string              unique per command (uuid); used for acks and dedup
  command: Command        the action, below
  source: Source          who sent it
  at: number              ms since epoch, stamped by the authority on receipt
  seq: number             authority sequence number, stamped on apply
}

Source {
  kind: 'ui' | 'keyboard' | 'midi' | 'timecode' | 'timeline' | 'cue'
      | 'osc' | 'http' | 'websocket' | 'companion' | 'dmx' | 'remote'
  clientId: string | null    API client, OSC peer or MIDI port
  bindingId: string | null   MIDI or OSC binding that fired, if any
}
```

The sender fills `id`, `command` and `source`. The authority stamps `at` and `seq`. Senders never stamp time-dependent fields: timer commands get `now` from the authority, not from MIDI or a remote. That replaces today's `toLiveCommand` stamping.

### Commands

Commands are a discriminated union on `type`, with dotted names grouped by domain. They live in `packages/schema/src/command.ts`, mirrored in `lumen-control`.

| Group | Commands | Notes |
|---|---|---|
| Transport (rundown) | `live.next`, `live.prev`, `live.goTo { slideIndex }`, `live.nextItem`, `live.prevItem`, `live.take`, `live.previewNext`, `live.previewPrev`, `live.previewGoTo { itemIndex, slideIndex }`, `live.selectRundown { rundownId }` | Same semantics as today's `liveReducer`, including the hold rules for `selectRundown`. |
| Output mode | `mode.set { mode }`, `mode.toggle { mode }` | `live`, `black`, `clear`, `logo`, `freeze`. `toggle` returns to `live` when the mode is already set, which suits footswitches and Stream Deck keys. |
| Stage | `stage.setMessage { message }`, `stage.clearMessage` | |
| Timers | `timer.start { timerId }`, `timer.stop { timerId }`, `timer.reset { timerId }` | Time stamped by the authority. |
| Clips | `clip.launch { layerId, column }`, `clip.launchColumn { column }`, `clip.stop { layerId }`, `clip.stopAll` | Clip grid in Show. |
| Layers | `layer.setOpacity { layerId, value }`, `layer.setEnabled { layerId, enabled }`, `layer.setBlend { layerId, blend }`, `layer.solo { layerId }`, `layer.bypass { layerId, bypass }` | Live layer controls. Solo and bypass are new. |
| Screens | `screen.setEnabled { screenId, enabled }`, `screen.setBlackout { screenId, blackout }`, `screen.setTextPreset { screenId, preset }`, `screen.setTestPattern { screenId, pattern }`, `screen.openOutput { screenId }`, `screen.closeOutput { screenId }` | |
| Parameters | `param.set { path, value, rampMs?, easing? }`, `param.nudge { path, delta }`, `param.reset { path }` | Any numeric, colour or boolean value on a stable path (§ Parameter paths). `rampMs` fades the value; a new `param.set` on the same path cancels a running ramp. |
| Timeline | `timeline.play`, `timeline.pause`, `timeline.locate { frame }`, `timeline.arm { armed }` | |
| Show | `show.save`, `show.undo`, `show.redo` | Edit commands from Compose and Screens keep going through `useShowDocument`; only these three are exposed on the bus. |
| System | `system.panic` | Black on every output and stop the timeline. It never closes outputs. |

Rules:

- A command that names something missing (an unknown layer, screen, timer or path) is **rejected** with a reason. It is never applied partially.
- Commands are **idempotent by `id`**. The authority remembers the last 1,000 ids and acks a repeat without applying it again, so a client can retry safely.
- Each command applies atomically, in `seq` order. There is no batching in D1. A cue (E1) is a list of commands with waits.

### Parameter paths

Paths address values in the show document (composition and screens) and in live state. They follow docs 02 and 10:

```
layers.<layerId>.opacity                          0..1
layers.<layerId>.enabled                          boolean
layers.<layerId>.transform.x | y | w | h | rotation
layers.<layerId>.effects.<effectId>.enabled       boolean
layers.<layerId>.effects.<effectId>.params.<name> number | colour | boolean
sources.<sourceId>.params.<name>                  generator parameters
sources.<sourceId>.color                          solid colour
master.opacity                                    0..1
master.effects.<effectId>.params.<name>
screens.<screenId>.blackout                       boolean
screens.<screenId>.layout.text.scale              number
screens.<screenId>.mapping.color.brightness | contrast | gamma | red | green | blue
screens.<screenId>.mapping.edgeBlend.<side>.width | gamma | power
```

- Ids or names: a path segment may be an id or a unique name with a `@` prefix, such as `layers.@Lyrics.opacity`. Names make OSC and Companion setups readable; ids survive renames. The authority resolves names on apply, and an ambiguous name is rejected.
- Values are clamped to the parameter's range from `EFFECT_CATALOG` or the schema. A wrong type is rejected.
- `param.set` changes the **live value**. It is stored in the show document, so it is saved and can be undone, unless the path is marked live-only (`master.opacity` and layer opacity during a show). D1 keeps one rule: parameter changes from the bus are live-only until `show.save`. See Open questions.

## Dispatcher

```
             ┌───────────┐   ┌────────────┐   ┌──────────┐
UI/keyboard ─▶│           │   │            │   │ live     │
timeline ────▶│ Command   │──▶│ apply()    │──▶│ show doc │──▶ outputs (apply_composition)
MIDI/OSC ────▶│ queue     │   │ pure, core │   │ clips    │──▶ state events to clients
HTTP/WS ─────▶│ (authority)│  └────────────┘   └──────────┘
```

- **Pure core.** `packages/core/src/commandBus.ts` exports `applyCommand(state, envelope) → { state, result, effects }`. `state` is `{ live, show, clips, timeline }`. `effects` lists side effects for the runtime (open or close an output, start a ramp, save). No I/O. Fully unit-tested.
- **Runtime.** `apps/studio/app/control/useCommandBus.ts` holds the queue in the desktop app. `dispatch(command, source)` returns a `Promise<CommandResult>`. It applies one envelope at a time, runs effects, persists live state as today (`liveSessionStore`) and publishes a state event. The existing `useLiveSession`, `useShowLive` and `useShowTimeline` become views over bus state; their mutating methods call `dispatch`.
- **Rust I/O.** `lumen-control` owns every network and device input: MIDI (today), OSC and the HTTP/WebSocket server (new). It parses and validates, then forwards each command to the webview as a `control:event` `{ type: 'command', envelope }`. Results and state come back through a Tauri command (`control_publish`) that the server fans out to clients. Rust does not apply commands in D1. That keeps one implementation of the rules.
- **Ramps** run in the runtime on `requestAnimationFrame`. Each frame writes the interpolated value and sends one composition update. A ramp is cancelled by a new value on the same path, by `system.panic`, or when its layer is removed.

### Results

```
CommandResult =
  | { ok: true,  id, seq }
  | { ok: false, id, error: 'unknown-target' | 'invalid' | 'unauthorized' | 'rate-limited' | 'busy', message }
```

HTTP returns the result as the response body. WebSocket sends it as an `ack` to the client that sent the command. OSC sends `/lumen/ack` or `/lumen/error` back to the sender, when that peer has feedback turned on.

### State events

After each applied command the authority publishes a `StateEvent`:

```
StateEvent {
  seq: number
  live: { rundownId, itemIndex, slideIndex, previewItemIndex, previewSlideIndex, mode, held, stageMessage, timers }
  onAir: { item: string | null, slide: string | null, next: string | null }      labels for displays
  clips: { layerId, column, playing }[]
  layers: { id, name, opacity, enabled, solo, bypass }[]
  screens: { id, name, enabled, blackout, open, preset }[]
  timeline: { playing, frame, timecode, locked, armed }
  changed: string[]                                    paths changed by this command
}
```

Clients that need everything receive the full event. Companion and OSC feedback subscribe to paths and receive only changed values. Timecode and the timeline position are published at 10 Hz at most, not on every frame.

## Inputs

| Input | Where | How it maps |
|---|---|---|
| UI buttons | Vue components | Call `dispatch` with `source.kind: 'ui'`. |
| Keyboard | `ShowPage.vue` key map | Space/→ `live.next`, ← `live.prev`, Enter `live.take`, `[` `]` `live.prevItem`/`nextItem`, B/C/L/F `mode.toggle`, 1–9 `clip.launchColumn`, Esc `clip.stopAll`. |
| MIDI | `lumen-control` bindings (doc 08) | A binding stores a `Command`, not a `LiveCommand`. Notes and program changes send the command; a CC can drive `param.set` with the value scaled to the parameter's range. Existing bindings migrate (§ Migration). |
| Timecode / timeline | `useShowTimeline` | Marker actions dispatch `source.kind: 'timeline'`. Keyframes stay a per-frame transform of the output composition, not commands, so they don't flood the bus. |
| OSC | `lumen-control` (new) | § OSC. |
| HTTP / WebSocket | `lumen-control` (new) | § Local API. |
| Companion / Stream Deck | Companion module (new, separate repo) | Uses the WebSocket API. § Companion. |
| DMX (D2) | `lumen-control` | Fixture channels map to `param.set` and `clip.launch`. Out of D1 scope; listed so the model fits. |

## Local API

Served by `lumen-control` with `axum` on a dedicated Tokio runtime, outside the render and audio threads.

### Settings

- Off by default. Settings > Remote control turns it on, picks the port (default **7710**) and the network interface (default: every LAN interface; loopback only as an option).
- Clients get a **token**. The operator creates a named token in Settings, sees it once, and can revoke it. Tokens are stored hashed in the app's settings store. Each token has a role: `control` (commands and state) or `view` (state only).

### HTTP

```
GET  /api/v1/info                    { app, version, showName, apiVersion }           (no token)
GET  /api/v1/state                   StateEvent
POST /api/v1/commands                body: { id?, command }  →  CommandResult
GET  /api/v1/rundowns                [{ id, name, items }]
GET  /api/v1/show/layers             [{ id, name, tags }]
GET  /api/v1/show/screens            [{ id, name }]
GET  /api/v1/show/params             [{ path, type, min, max, value }]   for UIs and Companion pickers
```

- Auth: `Authorization: Bearer <token>`. A missing or wrong token gets `401`.
- `POST /api/v1/commands` returns `200` with the result, `400` for an invalid body, `401`, `403` for a `view` token, or `429` when rate limited.
- No cookies and no CORS. Browser pages on other origins cannot call the API.
- Rate limit: 50 commands per second per token, burst 100.

### WebSocket

`GET /api/v1/ws`. The token is sent in the first message, never in the URL.

```
client → { type: 'hello', token, clientName, subscribe?: string[] }      paths or ['*']
server → { type: 'welcome', clientId, state: StateEvent }
client → { type: 'command', id, command }
server → { type: 'ack', result: CommandResult }
server → { type: 'state', event: StateEvent }        or only `changed` values for path subscriptions
client → { type: 'ping' }    server → { type: 'pong' }
```

A client that doesn't answer pings for 15 s is dropped. After a reconnect it receives the full state again. Missed events are never replayed, because state is always sent in full.

## OSC

UDP on port **7700** (configurable), in and out. Off by default.

Commands map to addresses one to one:

```
/lumen/live/next                         /lumen/live/take
/lumen/live/prev                         /lumen/live/goto        i:slideIndex
/lumen/live/item/next                    /lumen/live/item/prev
/lumen/mode/set          s:mode          /lumen/mode/toggle      s:mode
/lumen/clip/launch       s:layer i:column
/lumen/clip/column       i:column        /lumen/clip/stopall
/lumen/layer/<layer>/opacity      f:0..1
/lumen/screen/<screen>/blackout   i:0|1
/lumen/param             s:path  f|i|s:value  [i:rampMs]
/lumen/timer/<timer>/start | stop | reset
/lumen/panic
```

- `<layer>` and `<screen>` accept an id or `@Name`, as in paths.
- **Feedback** goes to peers that sent `/lumen/feedback/subscribe s:path` (or that are listed in Settings): `/lumen/state/<path> value` for each changed path, plus `/lumen/onair/slide s:label` and `/lumen/onair/next s:label`.
- OSC has no authentication. It is accepted only from peers on an allow list of IP addresses (Settings). An empty list accepts nothing.

## Companion and Stream Deck

A Bitfocus Companion module, `companion-module-lumen`, in its own repository. It uses the WebSocket API.

- **Actions:** every command, with dropdowns filled from `/api/v1/show/layers`, `/screens`, `/params` and `/rundowns`.
- **Feedbacks:** mode active, clip playing, layer enabled, screen blackout, timeline playing, timecode locked.
- **Variables:** on-air slide, next slide, rundown item, timecode, every timer, layer opacity.
- **Presets:** a transport page (Prev, Take, Next, Black, Clear, Freeze, Panic), a clip grid page, and a screens page.

Stream Deck is supported through Companion. A native Stream Deck plugin is not planned in D1.

## Security

- Off by default; nothing listens until the operator turns it on.
- LAN only: bind to private interfaces, and refuse to bind a public address without an explicit setting and a warning.
- Every HTTP and WebSocket request needs a token, except `/api/v1/info`. Tokens are random 32-byte values shown once, stored hashed, revocable, with a `view` or `control` role.
- No tokens in URLs or logs. The command log records the token's name, not its value.
- OSC accepts only allow-listed IPs.
- All input is validated with Zod or serde before it reaches the queue. Unknown fields are rejected.
- Rate limits per client. Oversized bodies (over 64 KB) are rejected.
- `system.panic` is available to every `control` token. Closing outputs is not available remotely in D1.

## Command log

The runtime keeps the last 5,000 envelopes and results in memory, shown in a **Control log** panel (Settings, or a drawer in Show): time, source, client, command, result. It can be exported as JSON. A log can be replayed into a test bus, so a bug report reproduces exactly.

## Files

| Area | Location |
|---|---|
| Command, envelope, result, state event schemas | `packages/schema/src/command.ts` |
| Pure `applyCommand`, path resolution, ramps maths | `packages/core/src/commandBus.ts`, `packages/core/src/paths.ts` |
| Runtime queue, dispatch, effects, log | `apps/studio/app/control/useCommandBus.ts`, `commandLog.ts` |
| Settings UI: API, tokens, OSC, log | `apps/studio/app/settings/RemoteControlPanel.vue` |
| Rust command mirror, OSC, HTTP/WS server | `apps/studio/src-tauri/crates/lumen-control/src/{command.rs,osc.rs,api.rs}` |
| Tauri wiring (`control_publish`, server start/stop, tokens) | `apps/studio/src-tauri/src/control.rs` |
| Companion module | separate repository `companion-module-lumen` |

## Migration

1. `LiveCommand` becomes the `live.*`, `mode.*`, `stage.*` and `timer.*` subset of `Command`. `liveReducer` stays and is called by `applyCommand`.
2. MIDI bindings store a `Command`. Saved bindings with the old `{ type: 'next' }` shape are converted on load (`next` → `live.next`, `setMode` → `mode.set`, and so on).
3. `toLiveCommand` is removed. The authority stamps timers.
4. `control:event` keeps its name. The `command` variant carries an envelope instead of a bare command.
5. UI and keyboard handlers switch to `dispatch` one workspace at a time. Show first, then Screens (blackout, test patterns, outputs), then Compose's live controls.

## Tests

- **Core (Vitest):** `applyCommand` for every command, including rejection cases, idempotency by `id`, path resolution by id and `@Name`, clamping, ramp interpolation and cancellation, panic, and binding migration.
- **Runtime (Vitest):** queue order, effects, state events and the log, against an in-memory show.
- **Rust:** OSC parsing for every address, serde round trips for every command against shared JSON fixtures generated from the Zod schemas, token hashing and checks, rate limiter, and API handlers with an in-memory channel. No network or device tests in CI.
- **Equivalence test (the D1 exit):** a fixture sequence is sent through the UI dispatch, a fake MIDI binding, an OSC message and a WebSocket client. Each run must produce identical state events.
- **Manual:** Companion on a second machine, OSC from TouchOSC or QLab, and the API with `curl`, on the virtual displays.

## Delivery

| Step | Scope | Exit |
|---|---|---|
| D1.1 Model | `command.ts`, `applyCommand`, paths, migration of `LiveCommand` and MIDI bindings | Core tests pass; MIDI still works through the new shape |
| D1.2 Runtime | `useCommandBus`; Show, keyboard, MIDI and timeline markers dispatch through it; command log panel | Every Show action appears in the log with its source |
| D1.3 Layer and screen controls | `layer.*`, `screen.*`, `param.*` with ramps; solo and bypass in Show | A layer fades from a `param.set` with `rampMs` |
| D1.4 Local API | axum server, tokens, HTTP and WebSocket, Settings panel | `curl` sends `live.next`; a WebSocket client receives state |
| D1.5 OSC | OSC in, feedback out, allow list | TouchOSC drives Take and a layer fader, with feedback |
| D1.6 Companion | module with actions, feedbacks, variables, presets | Stream Deck through Companion runs a show; the equivalence test passes |

## Open questions

- **Live-only versus saved parameter changes.** D1 rule: bus parameter changes are live-only until `show.save`. Alternative: per-path policy (opacity live-only, effect parameters saved). Decide before D1.3.
- **Multiple operators.** D1 has one authority and last-write-wins. Locking parts of the show to a client (for example a lighting desk owning layer opacity) belongs to E3.
- **Rust authority.** When render nodes arrive (E3), the authority may need to move out of the webview into Rust so a headless node can run the show. Keeping `applyCommand` pure and data-only keeps that move possible.

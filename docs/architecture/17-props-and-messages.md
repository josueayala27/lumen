# 17 — Props and messages

Most shows need small graphics over the content: a logo in the corner, a speaker's name, a countdown to doors, a sponsor crawl, a QR code, a note to the audience. ProPresenter calls these **props** and **messages**. Lumen has the same two ideas, built on its layer model: a prop or a message is a `slide` source on an overlay layer of the composition, so it renders through the compositor, follows each screen's layout and reaches every target, NDI and Syphon included.

- Sources, layers and slide elements: `02-render-contract.md`. Layer filters and safe areas per screen: `10-screens-and-mapping.md`.
- Live state and timers: `03-live-engine.md`. Commands, ramps and state events: `12-command-bus.md`. Remote pages: `14-local-network.md`.
- Show workspace: `11-ui.md`. Bundles: `15-backup-and-export.md`. Preflight checks props' media and fonts: `16-preflight-and-monitoring.md`.
- Roadmap: show-running work, candidate for the v1 local release (`07-roadmap.md`); steps in § Delivery.

## Terms

| Term | Is | Saved in |
|---|---|---|
| **Overlay template** | A reusable design: slide elements with `{tokens}`, a size, a default position and default animation. | Library (SQLite), like themes |
| **Prop** | A template placed in a show, with its field values, position, slot layer and timing. Shown and hidden by the operator. | Show document |
| **Message template** | A template plus the fields the operator fills at trigger time, and message defaults (hold time, screens). | Show document |
| **Message** | One filled message template, queued or on air. | Live state only |
| **Stage message** | Text for performers on stage displays (doc 03, `stage.setMessage`). Never shown to the audience. | Live state only |

An audience message is for the audience and renders on audience screens. A stage message is for the people on stage and renders only on stage displays. They never cross (rule 5).

## Rules

1. **One renderer.** Props and messages are composition layers with `slide` sources (or `video` and `image` sources for media props). There is no overlay renderer beside the compositor, and the stage window and remotes never draw them a second way.
2. **The composition knows nothing about screens.** Which screens show a prop is decided by screen layouts (layer tags) and by live per-screen exclusions, never by screen ids inside the composition (doc 02, first rule).
3. **Every show and hide is a command.** Buttons, keys, MIDI, OSC, Companion, the remote, timeline markers and later the cue list all use `prop.*` and `message.*` on the bus (doc 12).
4. **Tokens resolve in the authority.** The desktop app fills tokens and sends plain text to Rust. Rust never formats a clock or reads a timer. The one per-frame value Rust computes is a crawl's scroll offset (§ Ticker).
5. **Stage and audience messages stay separate.** A stage message never renders on an audience screen. An audience message never replaces the stage message; the stage display shows it as a separate line.
6. **Props never touch content.** Showing a prop never changes a content layer, the rundown position or the clip grid. `mode.set clear` hides content-tagged layers and leaves props on air; `black` and `system.panic` cover everything.
7. **Market-neutral.** Built-in templates use neutral names (Lower third, Countdown, Clock, Logo bug, Crawl, Title card, QR code). Packs add their own.

## Overlay template

```
OverlayTemplate {
  schemaVersion: 1
  id, name
  use: 'prop' | 'message' | 'both'
  size: { w, h }                       normalized to the canvas
  elements: SlideElement[]             doc 02; text runs and qr data may hold tokens
  background: null | Color | Gradient  drawn as the bottom element
  fields: TemplateField[]
  position: PositionPreset             default for props made from it
  animation: { in: OverlayAnimation, out: OverlayAnimation }
  timer: null | TimerBinding           for countdown and clock templates, § Timers and clocks
}

TemplateField {
  key                                  token name, e.g. 'name', 'plate'
  label                                shown in the trigger form
  kind: 'text' | 'multiline' | 'number' | 'choice'
  choices: string[]                    for 'choice'
  default: string
  maxLength: number | null
  required: boolean
}
```

- Templates are edited in the slide editor (§ UI) and stored in the library, so every show can use them. A bundle (doc 15) carries the templates its show uses, as `documents/templates/<id>.json`.
- A template is the same data a slide source needs. `overlaySlideSource(template, values, now)` in `packages/core/src/overlays.ts` resolves the tokens and returns a `slide` source.

### Built-in templates

| Template | Elements | Fields |
|---|---|---|
| Logo bug | image | none |
| Lower third | shape bar, two text lines | `title`, `subtitle` |
| Title card | full-canvas shape, title, subtitle | `title`, `subtitle` |
| Countdown | text `{countdown}` | timer binding |
| Clock | text `{time\|clock24}` | none |
| Crawl | shape bar, crawl text `{items}` | items (§ Ticker) |
| QR code | qr element, caption | `url`, `caption` |
| Audience message | shape box, text `{text}` | `text` |
| Vehicle call | shape box, text `Car {plate} please move to the exit` | `plate` |

## Tokens

Tokens sit in text runs and in `qr` data. The syntax is `{name}` or `{name|format}`. `{{` and `}}` write literal braces.

| Token | Value |
|---|---|
| `{<field>}` | A template field, filled from the prop's values or the message fields. |
| `{items}` | A crawl's item list joined with its separator (§ Ticker). |
| `{time}`, `{time\|clock12}`, `{time\|clock24}` | Time of day on the authority machine. |
| `{date}`, `{date\|short}`, `{date\|long}` | Today's date, in the OS locale. |
| `{countdown}`, `{countdown\|<format>}` | The template's bound timer (§ Timers and clocks). |
| `{timer:<id>}`, `{timer:<id>\|<format>}` | Any live timer by id, or `@Name` as in doc 12 paths. |
| `{show.name}` | The show's name. |
| `{onAir.item}`, `{next.item}` | Rundown item labels, as in `StateEvent.onAir`. |

Timer formats: `auto` (`M:SS`, or `H:MM:SS` past one hour, like `formatTimer` today), `hms`, `ms`, `m` (whole minutes, rounded up), `s`. A token that names nothing renders empty, and the editor marks it.

- `packages/core/src/tokens.ts` parses templates once (`parseTokens`) and resolves them with a `TokenContext { fields, timers, now, show, onAir }`.
- **Ticking.** A prop whose text holds a time or timer token is _live_. The runtime re-resolves live props once per wall-clock second, aligned to the second, and sends one composition update only if some resolved text changed. A source whose text did not change keeps its `revision`, so Rust does not re-render it.
- **No transition on ticks.** A live prop's slide source sets `transition: 'cut'` (contract change below). A tick never fades the old text into the new one, and it never restarts or cuts a rundown crossfade running in the same update.

## Prop

```
Prop {
  id, name
  templateId
  values: Record<fieldKey, string>
  content:
    | { kind: 'template' }
    | { kind: 'media', assetId, loop }              image or video overlay without a template
  slotLayerId: string | null                        overlay layer it plays on; null = default slot
  position: PositionPreset
  size: { w, h } | null                             null = template size
  animation: { in: OverlayAnimation, out: OverlayAnimation } | null    null = template default
  holdMs: number | null                             auto-off after this long on air; null = until hidden
  group: string | null                              props in one group replace each other (e.g. 'lower-third')
  hotkey: string | null                             Show workspace key, e.g. 'Shift+1'
  color: string | null                              button colour in the Props panel
  crawl: null | CrawlSettings                       § Ticker
}

ShowDoc {
  …                                                 doc 02, doc 10
  props: Prop[]
  messageTemplates: MessageTemplate[]
  overlaySafeArea: { top, right, bottom, left }     normalized; default 0.05 each
}
```

### Position presets

```
PositionPreset =
  | { kind: 'anchor', anchor: 'topLeft' | 'top' | 'topRight' | 'left' | 'center' | 'right'
                              | 'bottomLeft' | 'bottom' | 'bottomRight', offset: { x, y } }
  | { kind: 'lowerThird' }                          full safe width, bottom of the safe area
  | { kind: 'fullscreen' }                          whole canvas, ignores the safe area
  | { kind: 'custom', transform: { x, y, w, h, rotation } }
```

- Anchors place the prop's box inside the show's `overlaySafeArea`. The default safe area keeps graphics 5 % inside every edge, which suits projectors that overscan and LED walls with soft edges.
- `positionTransform(preset, size, safeArea)` turns a preset into a normalized layer `transform`. It is pure and shared by the editor, the Props panel thumbnails and the runtime.
- Placement is in canvas space. A screen that shows a region of the canvas (doc 10) sees a prop only where its region covers it. Re-placing props per screen is an open question.

### Animation

```
OverlayAnimation {
  kind: 'cut' | 'fade' | 'slide' | 'scale'
  from: 'left' | 'right' | 'top' | 'bottom'         for 'slide'
  durationMs                                        default 300
  easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
}
```

Animations are ramps on the prop layer's parameter paths (doc 12 § Dispatcher, Ramps): `opacity` for `fade`, `transform.x` or `transform.y` for `slide` (from just outside the safe area edge), `transform.w` and `transform.h` around the box centre for `scale`. No render contract change is needed. Each ramp frame is one composition update, as for any `param.set` with `rampMs`.

### How a prop becomes layers

The runtime builds the program composition with `withOverlays(composition, show, overlays, now)` (`packages/core/src/overlays.ts`), after the live content and before timeline keyframes, the same way `withTimelineMedia` adds timeline media.

1. **Slots.** A slot is a composition layer tagged `props` or `messages`, usually with no source. New shows get two: **Props** (tags `props`, `overlay`) and **Messages** (tags `messages`, `overlay`), above every other layer. Older shows get them the first time a prop is added.
2. **Per active prop** one generated layer, inserted directly above its slot layer. Several props on one slot stack in the order they went on air, newest on top.
   - id `prop-<propId>`, source id `prop-<propId>` (a `slide` source; or a `video` or `image` source for media props).
   - `transform` from the position preset, `fit: stretch`, `blend: normal`.
   - `opacity` = the animation value × the slot layer's opacity. `enabled` = the slot's `enabled`. A fader on the Props slot (`layer.setOpacity`) fades every prop on it.
   - `tags` = the slot's tags plus `prop` and `prop:<propId>`.
3. **The active message** gets one generated layer above the `messages` slot (else above the props slot), id `message-<instanceId>`, tags = the slot's tags plus `message`.
4. Slot effects and masks do not apply to generated layers. There are no layer groups in the contract (open question).

Generated layers exist only in the program composition. They are never saved in the show document, and Compose shows them read-only with a "prop" badge.

### Per-screen visibility

Two mechanisms, both on the screen side (rule 2):

- **Layout, saved.** A screen's `layout.layers` filter (doc 10) decides whether it shows overlays at all. `{ mode: 'all' }` shows them. A lyrics-only stream screen with `{ mode: 'only', tags: ['lyrics'] }` shows none; add the `overlay` tag to show both. Because generated layers carry their slot's tags, one tag selects every prop on that slot.
- **Per trigger, live.** `prop.show { propId, screenIds }` limits one prop to some screens. The runtime adds the prop's layer id to a live-only exclusion on every other screen. This needs a small layout change (below): `layout.layers.exclude`. Exclusions are live state, cleared when the prop hides, and never saved with the screen.

```
Layout.layers =
  | { mode: 'all', exclude?: { ids: string[], tags: string[] } }
  | { mode: 'only', ids: string[], tags: string[], exclude?: { ids: string[], tags: string[] } }
```

`exclude` wins over the include list. Screens with different exclusions fall into different render groups (doc 10 § Pipeline per screen, step 1), so a prop limited to one of three screens costs one extra canvas render while it is on air.

### Groups and auto-off

- Props in the same `group` replace each other: showing one hides the others in the group with their out animation. Lower thirds usually share a group.
- `holdMs` hides a prop after it has been fully on air for that long. The authority schedules it as a `prop.hide` with `source.kind: 'schedule'` (a new source kind on the bus), so the log shows why it went off. A new `prop.show` of the same prop restarts the hold.

## Messages

```
MessageTemplate {
  id, name
  templateId                            an OverlayTemplate with use 'message' or 'both'
  position: PositionPreset              default lowerThird
  holdMs: number | null                 default 10_000; null = until hidden
  screenIds: string[] | null            default screens; null = every screen whose layout shows overlays
  animation: { in, out } | null
}

MessageInstance {
  id                                    stamped by the authority
  messageTemplateId
  fields: Record<fieldKey, string>
  screenIds: string[] | null
  holdMs: number | null
  queuedAt, shownAt | null
}

LiveOverlays {                          part of live state, persisted with the session for crash resume
  props: {
    propId, values, screenIds | null
    phase: 'in' | 'on' | 'out'
    shownAt, hideAt | null
  }[]
  message: { active: MessageInstance | null, queue: MessageInstance[] }
}
```

- **One message on air at a time.** `message.show` puts a message on air at once; if another is on air it goes out first. `message.queue` adds to the end of the queue. When the active message hides (by hand or by `holdMs`) and `autoAdvance` is on (a show setting, default off), the next queued message goes on air.
- **Fields at trigger time.** The operator picks a message template, fills its fields and presses Show or Queue. Required fields must be filled; the command is rejected with `invalid` otherwise. The fields are plain text; tokens inside field values are not resolved again, so a typed `{time}` stays literal.
- **Screens.** A message goes to its template's default screens, or to the screens chosen in the trigger form, through the same live exclusions as props.
- **Live tokens** in a message template (`The doors open in {countdown}`) tick like live props.

## Timers and clocks as props

Countdown and clock templates read live timers (doc 03, `Timer` in `packages/schema/src/live.ts`). Today a timer is `countdown` (for a duration) or `elapsed`. This doc adds a third kind and zero actions:

```
Timer {
  id, label
  kind: 'countdown' | 'elapsed' | 'untilTime'
  durationMs                            countdown
  targetTime: 'HH:MM' | 'HH:MM:SS' | null   untilTime, local time of day on the authority machine
  running, startedAt, remainingMs       as today
  atZero: Command[]                     run once when a countdown or untilTime reaches zero
}

TimerBinding {
  timerId                               or '@Name'
  format: 'auto' | 'hms' | 'ms' | 'm' | 's'
  atZero: 'stay' | 'flash' | 'hide' | 'overtime'
}
```

| Kind | Shows | Notes |
|---|---|---|
| `countdown` | Time left of `durationMs` | As today. |
| `elapsed` | Time since start | As today. |
| `untilTime` | Time left until `targetTime` today, or tomorrow if it has passed when the timer starts | Runs by itself once started; it needs no stop. |
| Clock template | Time of day | No timer; the `{time}` token. |

At zero:

- **Display** is per prop (`TimerBinding.atZero`): `stay` shows `0:00`; `flash` blinks the prop at 1 Hz for 10 s, then stays; `hide` runs the prop's out animation; `overtime` counts up with a leading `+` and an `overtime` style (the template's second colour).
- **Actions** are per timer (`Timer.atZero`): a list of commands the authority runs once with `source.kind: 'schedule'`, for example `message.show` "We start now", `clip.launchColumn`, or `prop.hide` of the countdown itself. A timer reset re-arms them.
- New commands: `timer.set { timerId, durationMs? , targetTime? }` and `timer.create { label, kind, durationMs?, targetTime? }`. The stage display shows the same timers (doc 10 `layout.stage.show: 'timers'`), so a countdown on the audience screen and on stage stays in step.

## Ticker

A ticker (crawl) scrolls one line of text across a box: sponsor names, the next acts, a news line.

```
CrawlSettings {
  items: string[]                       may hold tokens
  separator: string                     default '   •   '
  speed: number                         canvas pixels per second; default 120
  direction: 'left' | 'right'
  loop: boolean                         false = crawl once, then hide
  onChange: 'continue' | 'restart'      when items change while on air
}
```

### Decision: a `crawl` option on text elements, rendered in Rust

Three ways were considered:

| Option | Cost | Problem |
|---|---|---|
| A. A slide source whose text offset the runtime animates per frame | One composition update and one slide re-render per frame, through IPC | 60 updates a second per ticker per output. Slide re-layout every frame. Breaks "slides re-render only when their layout changes" (doc 02 § Implementation). Jitters with webview timing. |
| B. A dedicated `ticker` source kind | A second text path in Rust | Duplicates text styling (fonts, outline, shadow, fit) that the slide renderer already has. Doc 02 has one text renderer; this adds another. |
| **C. `crawl` on slide text elements** | Layout once per text change; one textured quad per frame | Small contract change. Chosen. |

Option C keeps one text renderer and one source kind. The runtime sends the ticker once; Rust moves it.

```
SlideElement text gains:
  crawl: null | {
    speed                               canvas px/s
    direction: 'left' | 'right'
    gap                                 canvas px between the end and the next start, default = one box width / 4
    loop: boolean
    epoch                               opaque string; a new value restarts the crawl
  }
```

How `lumen-render` draws it:

1. When the element's text, style or size changes, `slide.rs` lays the runs out on **one line** (no wrap, `fit: none`) into a **strip** texture at the element's height. Strips wider than 4,096 px are cut into 4,096 px tiles; only visible tiles are drawn.
2. Each frame, the slide pass draws the element's box by sampling the strip at `offset = (t − t0) × speed mod (stripWidth + gap)`, twice when the wrap point is inside the box, clipped to the element frame. This is one textured quad per visible tile. The rest of the slide stays cached.
3. **One clock for every output.** `t` comes from a process-wide `CrawlClock` in `lumen-render`, shared by every compositor that `lumen-output` creates and by the preview renderer. `t0` is recorded the first time the clock sees a `(sourceId, elementId, epoch)`. Every output and the preview scroll in step.
4. **Changing items.** With `onChange: 'continue'` the runtime keeps `epoch`. Rust lays out the new strip and swaps it at the next wrap point, so the item on screen is never cut. With `restart` the runtime sends a new `epoch`.
5. **Crawl once.** With `loop: false` the crawl runs one pass. The runtime reads the strip width from `CompositionPreviewResult.textRuns` once (a measurement render) and schedules `prop.hide` when `(stripWidth + boxWidth) / speed` has passed. No new event from Rust is needed.

Cost: one strip layout per text change (comparable to a slide change today) and under 0.1 ms GPU per ticker per frame at 1080p. Slide sources with a crawl element render every frame, like shader generators.

### Contract changes

All are additive and keep `schemaVersion: 2` of the composition (old documents parse unchanged). Rust mirrors them in `lumen-render/src/composition.rs`, with fixtures from the Zod schemas.

| Change | Where | Why |
|---|---|---|
| `crawl` on text elements | `slide.ts`, doc 02 § Slide elements | Ticker |
| `qr` element: `{ kind: 'qr', data, fg, bg, quietZone, ecc: 'L' \| 'M' \| 'Q' \| 'H' }` | `slide.ts` | QR props. Rust builds the module grid (`qrcode` crate) and draws it as a nearest-sampled texture; the runtime has already resolved tokens in `data`. Expanding a QR into hundreds of shape elements would bloat every composition. |
| `transition: 'inherit' \| 'cut'` on `slide` sources, default `inherit` | `composition.ts` | Live props tick without fading. |
| `layout.layers.exclude` | `screen.ts`, doc 10 § Layout | Per-trigger screens. Rust's layer filter in `mapping.rs` applies it. |

Docs 02 and 10 need these lines when the work lands.

## Commands

New commands on the bus (doc 12), in its dotted style. Props and messages accept an id or `@Name`.

| Group | Commands | Notes |
|---|---|---|
| Props | `prop.show { propId, screenIds?, values? }` | `values` override fields for this showing only. Hides other props in its group. Already on air: restarts `holdMs`, updates values, no new in animation. |
| | `prop.hide { propId }`, `prop.toggle { propId, screenIds? }` | `toggle` suits Stream Deck keys and footswitches. |
| | `prop.hideAll { slotLayerId?, except?: string[] }` | Every prop, or every prop on one slot. Messages are not affected. |
| | `prop.update { propId, values }` | Change fields while on air (a score, a name). The text changes with a cut. |
| | `prop.setItems { propId, items }` | Replace a crawl's items. |
| Messages | `message.show { messageTemplateId, fields, screenIds?, holdMs? }` | Result carries the new instance id. |
| | `message.queue { messageTemplateId, fields, screenIds?, holdMs? }` | |
| | `message.hide`, `message.next` | `next` hides the active message and shows the first queued one. |
| | `message.remove { instanceId }`, `message.clear` | `clear` hides the active message and empties the queue. |
| Timers | `timer.set { timerId, durationMs?, targetTime? }`, `timer.create { label, kind, durationMs?, targetTime? }` | Plus the existing `timer.start`, `timer.stop`, `timer.reset`. |
| Overlays | `overlay.clearAll` | Hides every prop and the message, clears the queue. A softer panic for graphics. |

- `system.panic` hides nothing; it blacks every output (doc 12). After a panic, props come back with the output unless the operator clears them.
- Paths: generated layers are addressable as `layers.prop-<propId>.opacity` for `param.set`, but a `prop.hide` removes the layer, which cancels its ramps (doc 12).
- Sources: timeline markers (doc 08) carry any of these commands, so a countdown can go on air at a marker. The cue list (E1) uses the same commands. `source.kind: 'schedule'` is new, for `holdMs`, `atZero` and auto-advance.
- OSC: `/lumen/prop/<prop>/show`, `/hide`, `/toggle`, `/lumen/prop/hideall`, `/lumen/message/show s:template s:json-fields`, `/lumen/message/hide`, `/lumen/message/next`, `/lumen/message/clear`.

### State event

`StateEvent` (doc 12) gains:

```
props:    { id, name, group, onAir: boolean, phase, screenIds | null, hideAt | null }[]
messages: { active: { id, templateName, text, hideAt | null } | null, queue: { id, templateName, text }[] }
```

`text` is the resolved message text, for remotes and Companion. Companion gets feedbacks (prop on air, message on air), variables (active message text, queue length, every timer) and a Props preset page with one key per prop.

## UI

### Show workspace

A **Props** tab sits next to the clip grid, in the centre column (doc 11 § Show workspace).

```
┌ Props ──────────────────────────────────── Hide all ─┐
│ [Logo ●]  [Lower third: Speaker]  [Countdown 4:32 ●] │
│ [Crawl]   [QR code]  [Title card]  [+ Add prop]      │
├ Message ─────────────────────────────────────────────┤
│ Template [Vehicle call ▾]       plate [ AB-123   ]   │
│ Screens [All ▾]  Hold [10 s]   [Queue] [Show]        │
│ On air: "Car AB-123 please move to the exit" 0:07 ✕  │
│ Queue: 1. "Doors close in 5 minutes"     ↑ ↓ ✕       │
└──────────────────────────────────────────────────────┘
```

- **Prop buttons** show the prop's name, colour, hotkey, a live thumbnail (rendered through the compositor at 160 px, at most every 500 ms) and state: on air (red outline), animating, time left of `holdMs`. Click toggles. Right-click: show on chosen screens, edit values, edit prop.
- **Message form**: template picker, one input per field, screens, hold, Queue and Show. Enter shows. The on-air message and the queue are below, with reorder and remove.
- **Preview and Program** (doc 11) show props as they render. Preview shows the props that would be on air after Take: props are not part of the rundown, so Preview and Program show the same props.
- The toolbar gets a **Props** badge with the count of props on air, and Clear graphics (`overlay.clearAll`).

### Template editor

Templates open in the content editor at `/editor/:id?kind=template`. It is the slide editor (doc 11 § Content editor) with three additions: a **Fields** panel (add fields, insert a token at the caret), a **Preview values** panel to try field values, and a size and position frame on the canvas showing the safe area. Crawl and QR elements are added from the element menu. Library gets a **Templates** filter next to presentations and songs.

The prop inspector (from **+ Add prop** or **Edit prop**) is a `SchemaForm` (`~/ui`): template, values, slot, position, size, animation, hold, group, hotkey, colour, crawl settings.

### Remote

`/remote` (doc 14) gets a **Props** tab for `control` tokens: the same prop buttons with live state, and the message form with the templates, fields, queue and Show. It uses the state event and the commands above; it renders thumbnails as labels, not images, to keep the page light.

### Stage display

The stage display keeps the stage message as today. It adds an **audience** line that shows the active audience message's text and the names of the props on air, so performers know what the audience sees. `layout.stage.show` gains `'overlays'` for this line. The stage display never renders the overlay graphics themselves.

## Performance

- A prop costs what a slide source on a layer costs: one slide render when it changes, one layer pass per frame. A media prop costs one decoder (doc 05 limits apply, and preflight counts it).
- Live props re-render once per second. Ticker elements render every frame.
- Limit: 16 props on air at once plus one message. A 17th `prop.show` is rejected with `busy`.
- Per-trigger screen exclusions add a render group per distinct exclusion set while on air.
- Budget on Apple Silicon (M1 Pro) at 1080p60: four props, one message and one ticker on air add at most 1 ms GPU per frame to the A2 budget (doc 05).

## Files

| Area | Location |
|---|---|
| Template, prop, message, crawl, position and animation schemas | `packages/schema/src/overlay.ts` |
| `crawl` and `qr` slide elements | `packages/schema/src/slide.ts` |
| `transition` on slide sources | `packages/schema/src/composition.ts` |
| `layout.layers.exclude`, `layout.stage.show: 'overlays'` | `packages/schema/src/screen.ts` |
| `untilTime` timers, `atZero`, `LiveOverlays` | `packages/schema/src/live.ts` |
| `prop.*`, `message.*`, `timer.set`, `timer.create`, `overlay.clearAll`, `schedule` source | `packages/schema/src/command.ts` |
| Token parsing and resolution | `packages/core/src/tokens.ts` |
| `withOverlays`, `overlaySlideSource`, `positionTransform`, animation ramps, exclusions | `packages/core/src/overlays.ts` |
| Prop and message commands in `applyCommand`, schedules | `packages/core/src/commandBus.ts` |
| Template storage (library table, CRUD) | `apps/studio/app/data/overlayTemplates.ts` |
| Props tab, message form, prop inspector, live ticking | `apps/studio/app/show/props/{PropsPanel.vue,MessageForm.vue,PropInspector.vue,useOverlays.ts}` |
| Template editor additions | `apps/studio/app/editor/` (fields panel, preview values, safe-area frame) |
| Stage audience line | `apps/studio/app/stage/stageModel.ts`, `StageView.vue` |
| Remote Props tab | `apps/remote/` |
| Crawl strips, tiles and `CrawlClock`; `qr` element | `apps/studio/src-tauri/crates/lumen-render/src/{slide.rs,text.rs,crawl.rs,qr.rs}` |
| Contract mirror | `lumen-render/src/composition.rs`, fixtures in `lumen-render/fixtures/` |
| Layer filter `exclude` | `lumen-render/src/mapping.rs` |
| Sharing `CrawlClock` across output compositors | `apps/studio/src-tauri/crates/lumen-output/src/lib.rs` |
| OSC addresses | `apps/studio/src-tauri/crates/lumen-control/src/osc.rs` |

## Tests

- **Core (Vitest):** token parsing (escapes, formats, unknown tokens), resolution with fixed `now` and timers; `positionTransform` for every preset and safe area; `withOverlays` slot placement, stacking order, opacity and enabled inherited from the slot, tags; groups replacing each other; `holdMs` scheduling; message show, queue, next, clear and auto-advance; required fields; per-screen exclusions added and cleared; `untilTime` across midnight; `atZero` running once and re-arming on reset; ticks changing `revision` only when text changes.
- **Command bus (Vitest):** every new command, including rejections (unknown prop, missing field, more than 16 props) and idempotency.
- **Rust:** serde round trips of `crawl`, `qr`, `transition` and `exclude` against Zod fixtures; crawl offset maths, wrap and double draw at the seam, tile selection, the swap at the wrap point for `continue`, restart on a new epoch; `CrawlClock` giving the same `t0` to two compositors; QR module grid against reference data; layer filter with `exclude`; screen grouping with different exclusions. No GPU tests in CI.
- **Ignored GPU tests:** a crawl element at two times shows the expected offset; a QR element decodes with a QR reader; a live prop tick with `transition: 'cut'` does not fade.
- **Manual:** show a lower third on two of three screens while a rundown crossfades; run a countdown to a time of day with `atZero` showing a message; run a crawl on a display and an NDI output and compare them in OBS; send a message from a phone remote; check the stage display shows the audience line and the stage message separately.

## Delivery

| Step | Scope | Exit |
|---|---|---|
| 17.1 Model | Schemas, tokens, `withOverlays`, positions, slots, `prop.*` commands | A logo bug and a lower third go on and off air from Show with fade and slide |
| 17.2 Templates | Library storage, built-in templates, template editor additions, prop inspector | An operator builds a sponsor lower third with two fields and uses it in two shows |
| 17.3 Messages | Message templates, form, queue, `message.*` commands, stage audience line | "Car {plate} please move" goes on air on one screen for 10 s from the Show tab |
| 17.4 Timers | `untilTime`, `timer.set`, `timer.create`, `atZero`, countdown and clock props, ticking | A countdown to 19:30 hits zero, flashes and shows a message |
| 17.5 Screens | `layout.layers.exclude`, per-trigger screens, Rust filter | A prop shown on the side screens only leaves the LED wall clean |
| 17.6 Ticker and QR | `crawl` and `qr` elements in Rust, `CrawlClock`, crawl once | A crawl scrolls in step on two displays and an NDI output at 60 fps |
| 17.7 Remote and Companion | Remote Props tab, state event fields, Companion feedbacks and presets, OSC | A phone queues a message and a Stream Deck key toggles the logo |

17.1 needs D1.2 (bus runtime) and D1.3 (ramps). 17.7 needs E3a.2 (doc 14).

## Open questions

- **Per-screen placement.** A lower third placed on the canvas lands where each screen's region happens to be. A per-screen option (`layout.overlays.placement: 'screen'`) could re-place props inside each screen's region and safe area, like text presets re-lay out slides (doc 10). It needs the preset on the layer, which is a contract change. Decide after 17.5 with real multi-screen shows.
- **Layer groups.** Slot effects and masks don't reach generated layers. A layer group in the contract would fix that and help Compose too. Out of scope here.
- **Logo mode.** `mode.set logo` shows black today because there is no logo asset (doc 03). It could show a chosen prop full-screen instead. Decide with the output modes.
- **Vertical crawls and credit rolls.** `direction: 'up'` fits the same strip model with a multi-line layout. Not in the first cut.
- **Data sources.** Crawl items and fields from a CSV, JSON or HTTP source belong to E2 text templates (`07-roadmap.md`). Tokens are designed to accept them later as `{data:<source>.<field>}`.

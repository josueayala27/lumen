# 20 — Show templates

A show template is a starting point for a new show. It holds the screens, the layer stack, default sources, the clip grid, props, a theme, timers and control suggestions for one kind of show. The operator picks a template, maps its screens to real outputs, picks a logo and a theme, and gets a show that runs. Templates exist for concerts and tours, conferences and events, theatre and installations. Worship is a template inside the Worship pack, not in the core.

- Show document, layers and tags: `02-render-contract.md`, `03-live-engine.md` (`content` and `lyrics` tags). Screens and layouts: `10-screens-and-mapping.md`. Virtual targets: `13-virtual-outputs.md`.
- File format: the `.lumen` bundle from `15-backup-and-export.md`. Commands and paths in suggestions: `12-command-bus.md`. Props: doc 17 (overlay items on layers tagged `props`).
- Roadmap: part of the **v1 local release** (`07-roadmap.md`). Market packs: Wave G.

## Rules

1. **Templates never change the render contract.** A template produces ordinary documents: a `ShowDoc`, themes, presentations and rundowns. It adds no source kind, layer field or screen field. Tags are plain strings.
2. **A template always creates a working show.** Every placeholder has a safe default. An unassigned screen stays a `virtual` screen; a missing logo leaves logo mode black. Nothing blocks "Create".
3. **A new show is a copy.** Instantiating a template gives every document new ids. A show keeps no live link to its template; editing or updating the template never changes existing shows.
4. **Core templates are market-neutral.** Built-in templates use show, rundown, cue and content wording. Market-specific content (worship songs, scripture, CCLI fields) ships only in packs.
5. **Suggestions are opt-in.** MIDI, OSC and Companion suggestions are shown in the wizard and applied only when the operator accepts them. They never overwrite existing bindings silently.
6. **Templates are versioned like bundles.** Documents inside carry `schemaVersion` and load through the same migrations as SQLite and bundle import (doc 15, rule 4).

## What a template holds

| Part | Stored as | Notes |
|---|---|---|
| Screens | `ShowDoc.screens` | Name, role, size, layout, text preset, safe area, background, mapping defaults. Every target is `{ kind: 'virtual' }` plus a `screenTarget` placeholder. |
| Layers | `ShowDoc.composition.layers` | Named and tagged: `background`, `visuals`, `content` or `lyrics`, `props`, and any custom tag such as `imag`. |
| Default sources | `ShowDoc.composition.sources` | Solids, gradients and shader generators. Media only when the author chose to include it. |
| Clip grid | `ShowDoc.grid` | Column count and pre-filled clips (generators, or media placeholders). |
| Props | doc 17 props on `props` layers | Lower thirds, countdowns, logo bugs, message templates. Text fields can be placeholders. |
| Theme | `documents/themes/<id>.json` | One or more themes; one is the default. |
| Timers | `TemplateDoc.timers` | Seeded into the show's live session at creation. |
| Rundown skeleton | `documents/rundowns/<id>.json` | Optional, for example an agenda with title-card items. |
| Control suggestions | `TemplateDoc.suggestions` | MIDI and OSC bindings, Companion pages, startup settings. |

## Template format

A template is a `.lumen` bundle (doc 15) of kind `template`. The bundle layout is unchanged; it adds one document folder:

```
manifest.json
documents/
  templates/<id>.json        TemplateDoc
  shows/<id>.json            ShowDoc (the template's show)
  themes/<id>.json           Theme
  presentations/<id>.json    optional sample content
  rundowns/<id>.json         optional rundown skeleton
media/
  <sha256>.<ext>             optional: logos, loops, the preview image
fonts/
```

### Manifest extension

`kind` gains `'template'`. A template manifest adds a `template` block:

```
TemplateManifest = BundleManifest & {
  kind: 'template'
  root: { kind: 'template', id }
  template: {
    id: string                       stable across versions of the same template
    name: string                     'Concert'
    description: string
    market: 'general' | 'concert' | 'conference' | 'theatre' | 'installation' | string
                                     packs add their own, e.g. 'worship'
    origin: 'builtin' | 'user' | 'pack'
    packId: string | null
    templateVersion: number          increases when the author changes the template
    minAppVersion: string            older apps refuse the template with a clear message
    preview: { sha256 } | null       a JPEG in media/, 640×360
    requires: Feature[]              shown as badges; never blocks creation
    placeholders: Placeholder[]
  }
}

Feature = 'midi' | 'osc' | 'api' | 'timecode' | 'ndi' | 'syphon' | 'spout'
        | 'virtualCamera' | 'decklink' | 'bpm' | 'props' | `pack:${string}`
```

### Template document

```
TemplateDoc {
  schemaVersion: 1
  id
  showId: string                     the ShowDoc in this bundle
  themeIds: string[]
  defaultThemeId: string | null
  rundownId: string | null           rundown skeleton, if any
  timers: TimerSeed[]
  startup: StartupSeed | null
  suggestions: {
    midi: MidiBindingSuggestion[]
    osc: OscSuggestion[]
    companion: CompanionPageSuggestion[]
  }
}

TimerSeed { id, name, kind: 'countdown' | 'countUp' | 'clock', durationMs | null, showOn: ('stage' | 'audience')[] }

StartupSeed {                        machine settings offered to the operator, never forced
  openShowOnLaunch: boolean
  openOutputsOnLaunch: boolean
  launch: Command[]                  run once outputs are open, e.g. clip.launchColumn
  initialMode: 'live' | 'black'
  hideCursor: boolean
}

MidiBindingSuggestion { kind: note | controlChange | programChange, channel, number, command, label }
OscSuggestion         { address, command, label }        documents an address; OSC needs no binding (doc 12)
CompanionPageSuggestion { name, buttons: { row, col, label, command, feedback?: string }[] }
```

Commands in suggestions use `@Name` segments for layers, screens and timers (doc 12, § Parameter paths), so they survive the id rewrite at creation.

## Placeholders

A placeholder is a value the operator supplies when creating a show from the template. The wizard asks for them; a pure function applies the answers.

```
Placeholder = { id, label, help, required: false } & (
  | { kind: 'screenTarget', screenId, accepts: TargetKind[] }
  | { kind: 'image' | 'video', bind: Bind }
  | { kind: 'text',   default: string, bind: Bind }
  | { kind: 'color',  default: Color,  bind: Bind }
  | { kind: 'duration', defaultMs: number, bind: Bind }
  | { kind: 'theme' }
)

Bind =
  | { kind: 'param',  path }                        a doc 12 path, e.g. sources.<id>.color
  | { kind: 'source', sourceId }                    sets the asset of an image or video source
  | { kind: 'clip',   clipId }                      sets the media of a grid clip
  | { kind: 'prop',   propId, field }               a doc 17 prop field, e.g. a lower third name
  | { kind: 'timer',  timerId, field: 'durationMs' }
  | { kind: 'logo' }                                the show's logo asset (logo mode, doc 03)
```

Examples: "Assign Main screen to a display", "Pick a logo image", "Event name", "Brand colour", "Session length".

- `required` is always `false` in v1 (rule 2). The field exists so a pack can mark a placeholder important; the wizard then highlights it but still allows Create.
- An unresolved placeholder keeps the template's default value. An unresolved `screenTarget` keeps `{ kind: 'virtual' }`, so the operator can assign it later in Screens.
- `accepts` filters the target picker. A stream screen accepts `ndi`, `syphon`, `spout` and `virtualCamera`; a projector screen accepts `display` and `decklink`.

## Built-in templates

Built-in templates are generated from TypeScript builders in `packages/core/src/templates/`, so they always match the current schemas. A build script packs them into `.lumen` files in the app resources.

### Blank

One `Main` audience screen. Layers `Background` (`background`), `Visuals` (`visuals`), `Content` (`lyrics`), `Props` (`props`). Eight columns. No timers or suggestions. `createShowDoc` builds this template's show, replacing today's three-screen default.

### Concert and tour

| Part | Defaults |
|---|---|
| Screens | `LED wall` (audience; layers `background`, `visuals`, `imag`; text `hidden`, switchable to `strip`), `IMAG left` and `IMAG right` (audience; `imag`, `lyrics` as `lowerThird`, `props`), `Stage` (stage role: current, next, clock, timers, message). |
| Layers | `Background` (`background`), `Visuals A` and `Visuals B` (`visuals`), `IMAG` (`imag`; empty until camera and NDI sources arrive, doc 02 reserved kinds), `Lyrics` (`lyrics`, optional), `Props` (`props`). |
| Sources | Solid black, a gradient, shader generators `noise`, `plasma` and `lines`. |
| Clip grid | 16 columns. Generators pre-filled on Visuals A in columns 1–3. Clip changes are cuts until the BPM clock (C2) lands; then they default to one-beat crossfades. |
| Props | Song title lower third, a "back in" message. |
| Timers | Set clock (count up), changeover countdown (15 min, stage only). |
| Suggestions | MIDI notes 36–51 → `clip.launchColumn` 1–16 (pad controllers); CC 1–4 → `param.set` on `layers.@Visuals A.opacity`, `@Visuals B`, `@Lyrics`, `@IMAG`. Companion: transport page and clip grid page. |
| Placeholders | LED wall, IMAG left, IMAG right and Stage targets; logo; band or artist name (title prop). |

### Conference and event

| Part | Defaults |
|---|---|
| Screens | `Main` (audience; everything), `Confidence` (stage role: current, next, notes, clock, timers, message), `Stream` (`props` and `content`; transparent background; accepts NDI, Syphon, Spout and virtual camera). |
| Layers | `Background` (`background`, a looping gradient generator), `Content` (`content`: slides with their backgrounds), `Props` (`props`). |
| Props | Speaker lower third (name, title), break countdown, logo bug, "Welcome" and "We start soon" messages. |
| Timers | Session countdown (20 min, stage), break countdown (10 min, audience through the countdown prop), clock. |
| Rundown | Agenda skeleton: Walk-in, Welcome, Session 1, Break, Session 2, Close. Items are title cards until content is added. |
| Suggestions | Companion: speaker timer page (start, stop, reset), lower thirds page, transport page. |
| Placeholders | Main, Confidence and Stream targets; logo; event name; brand colour; session length. |

### Theatre

| Part | Defaults |
|---|---|
| Screens | `Stage projection` (audience; `background`, `visuals`), `Surtitles` (audience; `lyrics` only, `strip`), `Stage manager` (stage role: current, next, notes, clock). |
| Layers | `Background` (`background`), `Scenery A` and `Scenery B` (`visuals`), `Text` (`lyrics`, for surtitles and captions), `Props` (`props`). |
| Clip grid | 8 columns, one per look. Grid launches use a 1 s fade. |
| Blackout-safe defaults | `StartupSeed.initialMode: 'black'`; outputs open black; every screen background is black; no clip, timeline or generator runs until the first Take or GO; the timeline starts disarmed. |
| Suggestions | MIDI program change *n* → `clip.launchColumn` *n* (from a console or QLab); OSC examples for QLab (`/lumen/clip/column`, `/lumen/mode/set`, `/lumen/panic`). Companion: Take, Next, Black, Panic page. |
| Placeholders | Stage projection, Surtitles and Stage manager targets. |

The E1 cue list, when it arrives, becomes this template's main control surface.

### Installation

| Part | Defaults |
|---|---|
| Screens | `Display 1` and `Display 2` (audience; everything). |
| Layers | `Background` (`background`, a generator), `Loop` (`visuals`), `Overlay` (`props`: clock, logo bug). |
| Clip grid | 4 columns; column 1 holds the loop media placeholder. Clips loop. |
| Startup | `openShowOnLaunch`, `openOutputsOnLaunch`, `launch: [clip.launchColumn { column: 1 }]`, `initialMode: 'live'`, `hideCursor`. Crash recovery restores the same state. |
| Suggestions | None for MIDI or Companion. A `view` remote (doc 14) for monitoring is suggested. |
| Placeholders | Display targets; loop video; logo. |

### Worship (Worship pack)

Shipped by the Worship pack (Wave G), never in app resources. It lists `requires: ['pack:worship']` and appears in the wizard only when the pack is installed. It uses the same format: screens for main, side, stream and stage; a `lyrics` layer over a motion background; props for announcements and a countdown; a rundown skeleton the pack defines. Any field the pack needs beyond the core documents stays in the pack.

## New show wizard

`File → New show…` and the empty state of Show open the wizard. "Blank show" skips it in one click.

```
1. Template   cards by market: preview, description, feature badges
              (e.g. "NDI Runtime not installed": the screen stays virtual)
2. Screens    one row per template screen → detected display, virtual output kind, or "Leave virtual"
              Identify button; the largest external display is suggested for the first audience screen
3. Look       theme (template themes, then library themes), logo, brand colour, text placeholders
4. Options    apply MIDI/OSC suggestions (conflicts listed), Companion pages, startup settings,
              create the rundown skeleton
5. Create     summary → one transaction → opens Screens (if any screen is virtual) or Show
```

Creation:

1. Read the template bundle with the doc 15 import planner, in "keep both" mode for every document, so every id is new (rule 3).
2. `instantiateTemplate(docs, answers, env)` applies placeholder answers and returns the show, themes, presentations, rundowns, timer seeds and accepted suggestions. Pure, no I/O.
3. Copy media by hash and insert documents in one SQLite transaction, as in doc 15 import step 4.
4. Merge accepted MIDI suggestions into the settings store. A suggestion whose trigger is already bound is skipped and listed.
5. Record `createdFrom: { templateId, templateVersion }` on the show for display only.

## Save as template

`Show → Save as template…` turns any show into a user template.

- **Name, description, market.** Market defaults to `general`.
- **Preview.** Captured from the program composition with `preview_render_composition` at 640×360.
- **Screens.** Targets are always stripped to `virtual`, with a `screenTarget` placeholder per screen. The screen's name, size, layout and mapping stay.
- **Media.** All, small only (images under 5 MB, such as logos), or none. Stripped media turn into `image` or `video` placeholders on the sources and clips that used them.
- **Content.** Include the rundowns and presentations the show uses, or none.
- **Placeholders.** The dialog lists image sources, prop text fields and timers; the author ticks which ones become placeholders.
- **Suggestions.** Optionally include the current MIDI bindings as suggestions.

The result is a `.lumen` bundle of kind `template`, stored in the user template library. It can also be exported as a file and shared.

## Where templates live

| Origin | Location | Editable |
|---|---|---|
| Built-in | `apps/studio/src-tauri/resources/templates/*.lumen` | No; "Duplicate" makes a user copy |
| User | `$APPDATA/templates/<id>.lumen`, indexed in SQLite table `templates` | Yes; rename, delete, export |
| Pack | Inside the installed pack | No |

```sql
templates (
  id TEXT PRIMARY KEY,               manifest template.id
  name TEXT NOT NULL,
  market TEXT NOT NULL,
  origin TEXT NOT NULL,              builtin | user | pack
  template_version INTEGER NOT NULL,
  manifest TEXT NOT NULL,            JSON TemplateManifest
  path TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)
```

Opening a `.lumen` file of kind `template` (double-click or drag) adds it to the user library instead of importing a show. A template with the same `template.id` and a lower or equal `templateVersion` asks before replacing.

Templates are included in full-library backups (doc 15) when their origin is `user`.

## Versioning and migration

- `formatVersion` versions the bundle (doc 15). `TemplateDoc.schemaVersion` versions the template document. Each contained document keeps its own `schemaVersion` and migrates on load.
- `templateVersion` is the author's version. It orders updates of the same template; it has no effect on shows already created (rule 3).
- `minAppVersion` protects older apps. A template that needs a newer app is listed greyed out with the required version.
- Built-in templates are rebuilt from the builders on every release, so they never need migration.

## Files

| Area | Location |
|---|---|
| Template schemas: manifest extension, `TemplateDoc`, placeholders, seeds, suggestions | `packages/schema/src/template.ts`; `kind: 'template'` in `packages/schema/src/bundle.ts` |
| Pure instantiate, placeholder binding, save-as-template stripping | `packages/core/src/template.ts` |
| Built-in template builders | `packages/core/src/templates/{blank,concert,conference,theatre,installation}.ts` |
| Build script that packs built-ins into bundles | `apps/studio/scripts/build-templates.ts` → `apps/studio/src-tauri/resources/templates/` |
| Template repository and SQLite table | `apps/studio/app/data/templates.ts` |
| Wizard, picker, save dialog | `apps/studio/app/templates/{NewShowWizard.vue,TemplatePicker.vue,SaveAsTemplateDialog.vue,useTemplates.ts}` |
| Zip reading and writing | `apps/studio/src-tauri/src/bundle.rs` (doc 15, unchanged) |

## Tests

- **Core (Vitest):** each built-in builder produces a valid `ShowDoc` and `TemplateDoc`; every built-in uses only core tags and wording (a word list check fails on market terms); `instantiateTemplate` rewrites every id and keeps references right; each `Bind` kind applies its answer; unresolved placeholders keep defaults; `screenTarget` answers set the target; `@Name` commands in suggestions still resolve after the rewrite; save-as-template strips targets and media into placeholders; a template with an older `schemaVersion` migrates.
- **Data (Vitest):** the `templates` repository and migration, replace rules by `templateVersion`, user templates in backups.
- **Rust:** a template bundle round trip through `bundle.rs`; a template whose `minAppVersion` is newer is refused.
- **Manual:** create each built-in template on a Mac with two displays and NDI, run it, save it as a template, and create a show from that template on a second Mac with no network.

## Delivery

| Step | Scope | Exit |
|---|---|---|
| 20.1 Model | Schemas, `kind: 'template'`, `instantiateTemplate`, Blank builder replaces `createShowDoc` defaults | Core tests pass; a new show comes from the Blank template |
| 20.2 Wizard | Template picker, screen mapping, look, create | A Concert show maps its LED wall to a display and runs from Show |
| 20.3 Built-ins | Concert, Conference, Theatre and Installation builders, previews, build script | Each template creates a show that opens outputs with no edits |
| 20.4 Save as template | Dialog, stripping, placeholders, user library, export | A saved show becomes a template that opens on a second Mac |
| 20.5 Suggestions | MIDI and OSC suggestions, Companion pages, startup settings | The Theatre template opens black and a QLab OSC message launches a look |

20.1 depends on doc 15 steps 15.1 and 15.2. Props in templates depend on doc 17. MIDI, OSC and Companion suggestions depend on D1. Stream screens need B4 for NDI and Syphon; until then they stay virtual.

## Open questions

- **Timers in the show.** Timers are live state today (doc 03), so a template seeds them into the live session. Storing timer definitions in `ShowDoc` would make them part of the show file. Decide with the D1 timer commands.
- **Column labels.** `ShowGrid` stores only a column count. Templates would read better with column names (Intro, Drop, Outro; Act 1, Act 2). That is a small `ShowDoc` addition, not a render contract change.
- **Startup settings per machine.** Auto-start belongs to the machine, not the show. The wizard writes it to machine settings after confirmation; a show moved to another Mac does not auto-start there until accepted again.
- **Preview images for built-ins.** Rendering previews needs a GPU, which CI does not have. Proposal: render them on a developer machine and commit the JPEGs next to the builders.
- **Companion page import.** Companion has no API to receive pages from a module. Suggested pages may have to ship as module presets that read `/api/v1/show/layers`, rather than as pages pushed from Lumen.

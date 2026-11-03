# 16 — Preflight and monitoring

A show fails in front of an audience for boring reasons: a missing video, a projector on the wrong input, a laptop on battery, a notification over the lyrics, a disk too slow for four Hap layers. This doc defines two tools that catch those problems. The **preflight check** runs before going live and lists problems with fixes. The **performance monitor** shows what the renderer, decoders and outputs do while the show runs.

- Render pipeline and budgets: `02-render-contract.md`, `05-desktop-output.md` (§ Media, § Power and teardown), `13-virtual-outputs.md` (§ Performance budget).
- Screens and targets: `10-screens-and-mapping.md`, `13-virtual-outputs.md`. Commands, state events and the API: `12-command-bus.md`. Remotes: `14-local-network.md`. Backups: `15-backup-and-export.md`.
- Roadmap: v1 local release, § Show-running gaps (keep-awake power assertion, preflight check) in `07-roadmap.md`.

## Rules

1. **Preflight never blocks output.** A blocker asks for confirmation before going live. "Go live anyway" always works, because a show with one missing clip is better than no show.
2. **Checks are read-only.** A check never changes the show, the library or the system. Only a fix changes something, and each fix is a command (doc 12) or opens the screen where the operator makes the change.
3. **Checks stay off the live path.** Probes run on worker threads, never on render, decode or audio threads. The disk speed test never runs while an output is open.
4. **Stats are cheap.** Always-on counters cost at most 0.05 ms of CPU per frame and no GPU time. GPU stage timing runs only while someone watches it.
5. **The debug HUD never reaches an audience by accident.** It needs an explicit confirmation on audience screens, is never saved and turns off when outputs close.
6. **The machine stays awake while any output is open.** Lumen holds a power assertion from the first open output to the last closed one.
7. **Diagnostics stay local.** Reports, stats and logs leave the machine only through an explicit export or the token-protected LAN API (doc 12). There is no telemetry in v1.

## Part A — Preflight check

### When it runs

| Trigger | Scope | Notes |
|---|---|---|
| Show workspace opens, or a show loads | Full | Runs in the background. The toolbar shows a status chip (green, amber, red) when it finishes. |
| Show is saved or screens change | Quick | Debounced by 2 s. Updates the chip. |
| **Go live** (Open outputs, or `screen.openOutput` for the first output) | Quick, with cached slow results | Must finish in under 200 ms. Blockers that are not ignored open the Go live dialog. |
| Operator presses **Check** in the toolbar | Full | Re-runs the slow probes too, if no output is open. |
| `preflight.run` command | Full or quick | From the API, Companion or a remote. |

- **Quick** checks read in-memory state: the show document, the media and font index, the display list, the last system probe. They never touch the disk or the network.
- **Full** checks add the slow probes: file existence for every asset, ffmpeg and NDI detection, the decoder benchmark if it is missing, the disk speed test, and a fresh system probe. Slow results are cached for the session and reused by quick runs.
- Go live from the API or a remote never opens a dialog. The report is logged, and the state event carries the summary (§ API).

### Go live dialog

```
┌ 2 blockers · 3 warnings ─────────────────────────────────────┐
│ ✖ Video "Intro.mov" is missing          [Relink…] [Ignore]   │
│ ✖ NDI Runtime is not installed (2 NDI screens) [Install…]    │
│ ▲ Mac is on battery                     [Ignore]             │
│ ▲ …                                                          │
│                       [Fix later]  [Go live anyway]          │
└──────────────────────────────────────────────────────────────┘
```

Warnings and info items show in the dialog only when there is also a blocker. On their own they show in the Preflight panel and the toolbar chip, and Go live proceeds at once.

### Report

```
PreflightReport {
  id
  showId
  createdAt                         ms since epoch
  trigger: 'open' | 'save' | 'goLive' | 'manual' | 'api'
  scope: 'quick' | 'full'
  durationMs
  items: PreflightItem[]
  summary: { blockers, warnings, infos, ignored }
  probe: SystemProbe                the system facts the checks used
}

PreflightItem {
  key                               checkId + ':' + subject key; stable across runs
  checkId                           e.g. 'media.missing', below
  severity: 'blocker' | 'warning' | 'info'
  title                             one line, e.g. 'Video "Intro.mov" is missing'
  detail                            what happens if ignored, e.g. 'Layer Background shows black'
  subject: null | { kind: 'asset' | 'font' | 'screen' | 'device' | 'show' | 'system', id, name }
  fingerprint                       hash of the facts behind the item; an ignore stops matching when it changes
  fixes: PreflightFix[]
  ignored: boolean
}

PreflightFix {
  id
  label                             e.g. 'Relink…', 'Save show'
  action:
    | { kind: 'command', command: Command }          dispatched through the bus, doc 12
    | { kind: 'open', route, query? }                 opens the place to fix it, e.g. /media?asset=<id>&relink=1
    | { kind: 'system', id: 'openPowerSettings' | 'openFocusSettings' | 'openNdiDownload' | 'openDisplaySettings' }
}
```

### Severity

| Severity | Meaning | Go live |
|---|---|---|
| `blocker` | The audience will see a fault: black where content should be, a dead output, a stalled frame. | Asks for confirmation. |
| `warning` | A risk that may become a fault during the show. | Proceeds; shown in the panel and chip. |
| `info` | Worth knowing; no action needed. | Proceeds. |

### Ignore for this show

- **Ignore** stores `{ key, fingerprint, at }` in the show document (`ShowDoc.preflight.ignored`), so it survives a restart and travels in a `.lumen` bundle.
- An ignored item still appears in a collapsed "Ignored" section, with **Unignore**.
- The ignore stops matching when the fingerprint changes. For example, ignoring "Mac is on battery" holds until the charger is plugged in and unplugged again; ignoring a missing font holds until a theme uses it in a new place.
- Blockers can be ignored. Ignoring a blocker is logged in the command log like every other command.

### Checks

| checkId | Severity | Finds | Fixes |
|---|---|---|---|
| `media.missing` | blocker | A video or image used by the show is not on disk (composition sources, grid clips, rundown items and their slides, timeline clips, prop templates from doc 17). | **Relink…** (file picker, matched by hash), **Find in folder…** (search a folder by hash, then name and size), **Show in Media**. |
| `media.offline` | blocker | Media lives on a volume that is not mounted (external drive, network share). | **Relink…**; the detail names the volume. |
| `media.unprobed` | warning | Media whose probe failed or is stale (size or modified time changed since import). | **Re-probe**. |
| `font.missing` | warning | A font used by slide text is not installed. Text draws in its fallback, then in bundled Inter (doc 02). | **Install font…** (opens the font file if the library has it), **Replace in themes…**. |
| `screen.unassigned` | blocker | An enabled audience screen with a `display` target has no monitor assigned. | **Assign display** (opens Screens). |
| `screen.disconnected` | warning | An enabled screen's monitor is assigned but not connected now. It resolves again on hotplug (doc 05). | **Identify displays**, **Disable screen** (`screen.setEnabled`). |
| `screen.noTarget` | info | An enabled audience screen has a `virtual` target, so it renders nowhere. | **Choose target** (opens Screens). |
| `screen.mainDisplay` | warning | An audience output sits on the main display (the one with the menu bar). Notifications, the Dock and menus land there. | **Open Display Settings** (move the menu bar to the operator display). |
| `screen.refresh` | info | A display runs at a refresh rate below the canvas frame rate, for example a projector at 30 Hz over HDMI. | None. |
| `output.duplicateName` | blocker | Two virtual outputs of the same kind share a source name (doc 13); the second sender fails. | **Rename** (opens the screen inspector). |
| `output.ndiRuntime` | blocker | A screen targets NDI and the NDI Runtime is not installed. | **Install NDI Runtime…** (opens the download page, doc 13 § Licensing). |
| `output.syphon` | blocker | A Syphon or Spout screen on a platform that does not support it, for example a show moved from a Mac to Windows. | **Change target**. |
| `decode.ffmpegMissing` | blocker | The show uses non-Hap video and no ffmpeg was found (doc 05 lookup order). | **Locate ffmpeg…**, **Show install help**. |
| `decode.softwareFallback` | warning | A video's codec has no hardware decoder on this machine, so ffmpeg decodes it in software (for example AV1 or VP9 on Macs without a hardware decoder, 4:2:2 10-bit HEVC on older machines). | **Show in Media**. Transcoding is an open question. |
| `decode.overBudget` | blocker or warning | The estimated decoder load exceeds the machine's capacity (§ Decoder load). Blocker above 100 %, warning above 70 %. | **Show heaviest clips**. |
| `decode.tooMany` | blocker | More videos can play at once than the decoder limits allow: 16 Hap, 4 ffmpeg (doc 05). | **Show heaviest clips**. |
| `disk.free` | warning, blocker under 500 MB | Free space on the volume holding the library is under 5 GB. SQLite, posters, logs and backups need room. | **Open storage settings**. |
| `disk.speed` | blocker or warning | The media volume's measured read speed is below the estimated Hap need (§ Disk speed). | **Show heaviest clips**; the detail suggests an internal SSD. |
| `power.battery` | warning | The machine runs on battery. | **Open power settings**. |
| `power.lowPower` | warning | Low Power Mode (macOS) or Energy Saver (Windows) is on. Both throttle the GPU. | **Open power settings**. |
| `power.thermal` | warning | The thermal state is serious or critical; the system is already throttling. | None. |
| `power.keepAwake` | blocker | The keep-awake assertion could not be created (§ Keep awake). | **Retry**. |
| `system.focus` | warning or info | Notifications can appear. Windows reports the state; macOS reports it when Focus status access is granted, otherwise this is an info item with guidance (§ Focus). | **Open Focus settings**. |
| `system.gpuBusy` | info | Other processes use the GPU heavily (best effort, § GPU use by other apps). | None. |
| `control.midiMissing` | warning | Saved MIDI bindings name an input that is not connected. | **Open Show control** (Settings). |
| `control.timecodeMissing` | warning | The show timeline follows external timecode and the LTC audio input or MTC port is not present. | **Open Show control**, **Switch timeline to internal clock** (command). |
| `remote.apiOff` | warning | Remote devices are paired (doc 14) but the API is off, so they cannot connect. | **Turn on remote control**. |
| `remote.publicBind` | warning | The API binds a public interface (doc 12 § Security). | **Open Remote control**. |
| `show.unsaved` | warning | The show has unsaved changes. | **Save show** (`show.save`). |
| `show.backupAge` | info over 24 h, warning over 7 days | The last automatic or manual backup is old (doc 15). | **Back up now**, only while no output is open (doc 15 rule 3). |

Each check is a pure function in `packages/core/src/preflight.ts`:

```
PreflightCheck {
  id
  scope: 'quick' | 'full'
  run(input: PreflightInput) → PreflightItem[]
}

PreflightInput {
  show: ShowDoc
  rundowns, presentations, themes, timelines          only those the show uses
  media: { id, path, state: 'ok' | 'missing' | 'offline' | 'stale', probe }[]
  fonts: { id, family, installed: boolean }[]
  displays: DisplayInfo[]                             from lumen-output
  devices: { midiInputs: string[], audioInputs: string[] }
  remote: { apiOn, bindPublic, pairedDevices }
  library: { lastBackupAt | null, dirty: boolean }
  probe: SystemProbe
  budget: DecoderBudget
  ignored: { key, fingerprint }[]
}
```

### System probe

One Tauri command, `system_probe { full: boolean }`, gathers the facts the checks need. It runs on a worker thread. Each field is `null` when the platform cannot tell.

```
SystemProbe {
  at
  platform: 'macos' | 'windows', osVersion, machine        e.g. 'Mac14,6'
  gpu: { name, backend, timestampQuery: boolean, bcTextures: boolean }
  power: { onBattery | null, batteryPercent | null, lowPower | null, thermal: 'nominal' | 'fair' | 'serious' | 'critical' | null }
  keepAwake: { held: boolean, error | null }
  focus: { state: 'off' | 'on' | 'unknown', source: 'focusStatus' | 'notificationState' | null }
  mainDisplayId | null
  disks: { volume, path, freeBytes, totalBytes, removable, network, readMBps | null }[]
  decoders: { ffmpeg: { path, version, hwaccels: string[] } | null, hardware: { codec, profile, supported: boolean }[] }
  ndi: { runtime: 'installed' | 'missing', version | null }
  gpuUse: { utilization | null, busyProcesses: { name, pid, utilization | null }[] }
}
```

| Fact | macOS | Windows |
|---|---|---|
| On battery, charge | `IOPSCopyPowerSourcesInfo` | `GetSystemPowerStatus` |
| Low power | `NSProcessInfo.isLowPowerModeEnabled` | `GetSystemPowerStatus` `SystemStatusFlag` (battery saver), effective power mode |
| Thermal | `NSProcessInfo.thermalState` | not available (`null`) |
| Focus / notifications | `INFocusStatusCenter` when the user granted Focus status access, else `unknown` | `SHQueryUserNotificationState` |
| Main display | `CGMainDisplayID` | primary monitor flag |
| Free space | `statfs` | `GetDiskFreeSpaceExW` |
| Hardware decode | `VTIsHardwareDecodeSupported` per codec | ffmpeg `d3d11va` probe per codec |
| NDI | runtime library load, as in doc 13 | same |
| GPU use | IOAccelerator `PerformanceStatistics` (device utilization); process names only | PDH `GPU Engine(*)\Utilization Percentage` per process |

### Decoder load

The check estimates the worst moment of the show, not an average.

1. **Peak set.** For each composition layer, take the heaviest video it can show: its own source, any grid clip on it, any timeline clip bound to it. Add the heaviest video of the content layer a second time, for a crossfade, and once more for the preloaded next cue (doc 05 § Media). The peak set is this list.
2. **Path.** Each video decodes as `hap` (Hap in QuickTime), `hw` (ffmpeg with a hardware decoder for its codec and profile) or `sw` (ffmpeg in software).
3. **Load.** `load = Σ (width × height × fps) / capacity(path)`, summed over the peak set.
4. **Capacity** comes from a short benchmark (`DecoderBudget`), run once per machine and app version on a worker thread with no output open, and cached in settings. It decodes a bundled Hap Q clip and an H.264 and HEVC clip through ffmpeg for 2 s each. Until it has run, conservative defaults apply and the item says "estimate not calibrated".

```
DecoderBudget {
  machine, appVersion, at
  hapPixelsPerSec, hwPixelsPerSec, swPixelsPerSec
  maxHap: 16, maxFfmpeg: 4                            doc 05 limits
}
```

The item lists the peak set, heaviest first, with each clip's path and share of the load. Typical result: "3 HEVC 4K60 layers use 140 % of hardware decode; convert the heaviest to Hap."

### Disk speed

- **Need:** for every Hap clip in the peak set, `bytes / durationSeconds` from the probe. Sum per volume. Doc 05 gives the scale: 8 × 1080p60 Hap Q needs about 720 MB/s.
- **Measure:** `lumen-media` reads up to 256 MB of the largest Hap file on each volume sequentially, with the cache bypassed (`F_NOCACHE` on macOS, `FILE_FLAG_NO_BUFFERING` on Windows), and stops after 1.5 s. Full runs only, never while an output is open (rule 3).
- **Result:** warning when the need is above 70 % of the measured speed, blocker above 100 %. Media on a network volume is always a warning.

### Keep awake

While at least one output is open (display or virtual target, doc 13), `lumen-output` holds a keep-awake assertion. It releases it when the last output closes or the app quits.

| Platform | Held | Notes |
|---|---|---|
| macOS | `IOPMAssertionCreateWithName` with `kIOPMAssertionTypePreventUserIdleDisplaySleep` and `kIOPMAssertionTypePreventUserIdleSystemSleep`, name "Lumen: outputs open" | Also `NSProcessInfo.beginActivity` with `.userInitiated`, `.idleDisplaySleepDisabled` and `.latencyCritical`, so App Nap and timer coalescing never throttle a backgrounded Lumen. |
| Windows | `SetThreadExecutionState(ES_CONTINUOUS \| ES_DISPLAY_REQUIRED \| ES_SYSTEM_REQUIRED)` | The state belongs to the calling thread, so a dedicated `keep-awake` thread sets it and lives until release. Lumen also opts out of power throttling (`SetProcessInformation` with `ProcessPowerThrottling`). |

- The assertion also stops the screen saver, because both platforms treat display-sleep assertions as user activity.
- The Show toolbar shows a small "awake" indicator while it is held. A failure is the `power.keepAwake` blocker and a toolbar error.
- Settings has one option, **Keep awake while Lumen is open**, for rehearsals and installations that run without outputs open. It is off by default.
- Lumen does not stop the lid from sleeping a laptop with no external display; macOS ignores assertions for a closed lid. The preflight detail says so on battery.

### Focus and notifications

Lumen cannot turn Do Not Disturb on for the user on either platform. It reports the state where it can and gives guidance:

- **Keep the menu bar on the operator display.** macOS shows banners on the main display only. With the operator display as main, a banner never covers an output. `screen.mainDisplay` checks this.
- **macOS:** create a Focus called "Show" that allows no notifications, and turn on "When mirroring or sharing the display" in its options. The Focus settings fix opens System Settings > Focus. Lumen asks for Focus status access once, from the Preflight panel, so it can report the state.
- **Windows:** turn on Do not disturb (Windows 11) or Focus assist set to Alarms only. `SHQueryUserNotificationState` reports `QUNS_BUSY`, `QUNS_PRESENTATION_MODE` and `QUNS_QUIET_TIME` as notifications off.
- Output windows sit above the menu bar and the Dock (doc 05). They do not sit above every system alert, so the guidance still matters.

### GPU use by other apps

Best effort, info only. On Windows the per-process GPU counters name the busy processes. On macOS only total utilization is public; Lumen samples it once before outputs open and lists known heavy apps that are running (OBS, browsers, Resolume, game launchers) by process name. It never stops other apps.

## Part B — Performance monitor

### What it shows

The monitor is a drawer in the Show workspace (**Performance**, toolbar button or `Cmd/Ctrl+Shift+P`). It can pop out into its own window for a second operator display. One card per open output, one row per active decoder, then the process.

```
┌ Main (display · 1920×1080 · 60 Hz) ────────────── ● ok ─────┐
│ 60.0 fps  frame 9.8 ms (p95 11.2)  dropped 0  late 0        │
│ GPU 6.1 ms: sources 2.4 · layers 2.1 · effects 0.9 ·        │
│             screen 0.5 · convert 0.2       ▁▂▂▁▂▃▂▁ 60 s    │
│ textures 412 MB                                    [HUD]    │
├ Stream (ndi · 1920×1080 · 59.94) ── 2 receivers · PGM ─────┤
│ …                                                           │
├ Decoders ──────────────────────────────────────────────────┤
│ Intro.mov   hap Q   1920×1080  60/60 fps  queue 3/4  1.1 ms │
│ Loop.mp4    ffmpeg hevc (hw)  3840×2160  58/60 ▲  queue 0/4 │
├ Process ───────────────────────────────────────────────────┤
│ CPU 38 %  memory 1.9 GB  GPU 41 %  thermal nominal          │
│ threads: output-main 12 % · output-stream 9 % · ndi-send 14 %│
└─────────────────────────────────────────────────────────────┘
```

- Every number has a 60 s sparkline on hover; frame time and GPU total show it inline.
- Values past a budget turn amber, then red (§ Budgets). A warning line names the cause, for example "Loop.mp4 decodes at 58 fps of 60".
- The toolbar shows a health dot from the always-on counters even when the drawer is closed.
- **Mark** (button, or `stats.mark`) drops a labelled marker into the history, so a glitch the operator saw can be found in a bug report.

### Stats event

`lumen-output` publishes `stats:event` to the webview while there is at least one subscriber.

```
StatsEvent {
  seq, at                              ms since epoch
  windowMs                             250 at 4 Hz, 500 at 2 Hz, 1000 at 1 Hz
  health: 'ok' | 'warning' | 'critical'
  outputs: OutputStats[]
  decoders: DecoderStats[]
  process: ProcessStats
  warnings: StatsWarning[]
  marks: { at, label }[]               marks added in this window
}

OutputStats {
  screenId, label
  target: 'display' | 'ndi' | 'syphon' | 'spout' | 'virtualCamera' | 'decklink'
  size: { width, height }
  targetFps                            monitor refresh or the target's frameRate
  fps
  frameMs: { avg, p95, max }           CPU wall time from frame start to submit
  dropped, late                        in this window
  droppedTotal, lateTotal              since the output opened
  gpuMs: null | { sources, layers, effects, master, screen, convert, total }
  textureBytes                         tracked allocations of this output's device
  ndi: null | { receivers, tally: { program, preview } }
  hud: boolean
}

DecoderStats {
  assetId, name
  kind: 'hap' | 'ffmpeg'
  codec, hardware: boolean | null
  width, height, sourceFps
  fps                                  frames delivered per second
  queueDepth, queueCapacity
  decodeMs: { avg, max }
  readMBps
  droppedTotal
  callers: string[]                    'output:<label>', 'preview', 'preload'
}

ProcessStats {
  cpuPercent                           100 = one core
  rssBytes
  gpuMemoryBytes | null                sum of tracked texture and buffer allocations
  gpuUtilization | null                system-wide, from the system probe source
  thermal | null
  threads: { name, cpuPercent }[]      named threads only
}

StatsWarning { code, subject, value, budget, since }
```

Rates: 4 Hz while the drawer or HUD is open, 2 Hz for API subscribers (§ API), 1 Hz into the history ring otherwise. The webview keeps 60 s for sparklines. Rust keeps 10 minutes at 1 Hz for bug reports.

### How stats are gathered

- **Counters.** Each output thread updates plain atomics once per frame: frame count, a frame-time sum and max, dropped and late counts. A frame-time histogram (32 buckets of 1 ms) gives p95 without storing samples. The stats thread reads and resets them per window. No locks, no allocation on the render thread.
- **Dropped and late.** A display output counts a frame late when the time since its last present exceeds 1.5 refresh periods, and dropped when it exceeds 2. A virtual target counts a tick dropped when its frame clock resends the previous frame (doc 13 § Clock).
- **GPU stage timing.** When the device has `wgpu::Features::TIMESTAMP_QUERY` and a subscriber asked for GPU timing, the compositor writes a timestamp at the start and end of each stage: sources, layers, effects, master, screen stage and conversion. With `TIMESTAMP_QUERY_INSIDE_ENCODERS` it uses `write_timestamp` on the encoder; otherwise it sets `timestamp_writes` on the first and last pass of each stage. Queries resolve into a ring of three mappable buffers that are mapped asynchronously and read when ready, one or two frames later. The render thread never waits on them. Ticks convert to milliseconds with `Queue::get_timestamp_period`. Without the feature `gpuMs` is `null` and the card says so. On tile-based Apple GPUs only pass boundaries are meaningful, which is why timing is per stage, not per draw.
- **Effects inside layers.** Layer and effect passes interleave (doc 02 pipeline step 2). The compositor accumulates effect passes into `effects` and the rest into `layers`.
- **Memory.** `lumen-render` creates every texture and buffer through one allocator wrapper that adds and subtracts byte sizes per device. This is an estimate: drivers add their own overhead. On Apple Silicon memory is unified, so the card labels it "GPU allocations", not VRAM.
- **Decoders.** `lumen-media` counts frames delivered, queue depth, decode time and bytes read per decoder with atomics, read by the stats thread. ffmpeg decoders count frames read from the pipe.
- **NDI.** `NDIlib_send_get_no_connections` and tally, polled once per window by the sender thread (doc 13).
- **CPU per thread.** Every Lumen thread has a name (`output-<label>`, `decode-<asset>`, `ndi-send-<screen>`, `ltc`, `api`). Once per second the stats thread reads per-thread CPU time: `task_threads` and `thread_info(THREAD_BASIC_INFO)` on macOS, `GetThreadTimes` on Windows. Process memory comes from `task_info` or `GetProcessMemoryInfo`.

Cost budget: counters at most 0.05 ms CPU per frame; GPU timing at most 0.1 ms GPU per frame and only while subscribed; the stats thread under 1 % of a core at 4 Hz.

### Budgets

Warnings compare stats with the budgets the other docs set. A warning needs the condition for 2 s, so one slow frame does not flash the panel.

| Code | Condition | Source |
|---|---|---|
| `frame.overBudget` | `frameMs.p95` or `gpuMs.total` above 80 % of the frame period (13.3 ms at 60 Hz) | doc 05 A2 budget, 16.7 ms |
| `frame.dropped` | any dropped frame in the last 10 s (critical when more than 1 per second) | |
| `decode.slow` | decoder `fps` below 95 % of `sourceFps` | doc 05 |
| `decode.starved` | `queueDepth` at 0 for 2 s while playing | |
| `decode.limit` | Hap decoders above 16 or ffmpeg above 4 | doc 05 |
| `target.convert` | `gpuMs.convert` above the target budget: 0.3 ms Syphon, Spout, virtual camera; 1 ms NDI, DeckLink | doc 13 |
| `ndi.noReceivers` | info: an NDI output has no receivers (it renders at 1 fps, doc 13) | doc 13 |
| `memory.high` | `gpuMemoryBytes` above 75 % of the device's recommended working set, where the platform reports it | |
| `thermal.throttling` | thermal state serious or critical | |

`health` is `critical` if any output drops more than one frame per second or any critical warning is active, `warning` if any warning is active, else `ok`.

### Debug HUD

A HUD draws fps, frame time, GPU time, dropped frames and the output label in a corner of one output's picture. It helps during load-in, when the operator stands at the projector.

- `lumen-render/src/hud.rs` draws it as the last pass of that screen's stage, before present or conversion, with the bundled Inter face. Its text is laid out again at 4 Hz.
- It is per screen, live only, never saved in the show and never part of the composition.
- On a screen with role `stage` or a `virtual` target it turns on at once.
- On an audience screen the desktop asks: "Show debug info on Main? The audience will see it." The operator confirms. The command carries `confirm: true`.
- A remote, Companion or OSC cannot turn on the HUD for an audience screen. The command is rejected with `unauthorized`.
- Every HUD turns off when its output closes, on `system.panic` and on `mode.set black`.
- While any HUD is on, the Show toolbar shows a red **HUD** badge that turns them all off.

### Commands

New commands on the bus (doc 12), in its dotted style:

| Command | Notes |
|---|---|
| `preflight.run { scope?: 'quick' \| 'full' }` | Default `full`. The full scope skips slow probes while an output is open and says so in the report. Result: `{ ok, id, seq }`; the report follows in the state event. |
| `preflight.ignore { key }`, `preflight.unignore { key }` | Stores or removes the ignore in the show document, with the item's current fingerprint. Rejected with `unknown-target` for an unknown key. |
| `debug.setHud { screenId, enabled, confirm? }` | Rules in § Debug HUD. |
| `stats.mark { label? }` | Adds a marker to the stats history. Default label: the source, for example "Companion". |

Fixes reuse existing commands where they exist: `show.save`, `screen.setEnabled`, `timeline.setClock` (below). The only new command a fix needs is `timeline.setClock { clock: 'internal' | 'external' }`. Today the clock is runtime state in `useShowTimeline` (`TimelineClock`), set from the transport; the command puts that choice on the bus.

### API

Additions to the local API (doc 12 § Local API). All need a token; `view` is enough for reads.

```
GET  /api/v1/health                 { health, preflight: { blockers, warnings, at }, outputs: [{ screenId, fps, targetFps, dropped }] }
GET  /api/v1/preflight              PreflightReport (the latest)
GET  /api/v1/stats                  StatsEvent (the latest)
```

- WebSocket: `{ type: 'subscribe', topics: ['stats'] }` adds `{ type: 'stats', event: StatsEvent }` messages at 2 Hz. `view` role and up.
- `StateEvent` (doc 12) gains `health: { level, preflight: { blockers, warnings, at } | null, hud: string[] }`, sent on change only.
- Companion feedbacks: output healthy, preflight has blockers, HUD on. Variables: fps and dropped frames per output, health level. Actions: `preflight.run`, `stats.mark`.
- OSC: `/lumen/state/health s:level` when subscribed. No OSC stats stream.

### Diagnostics export

**Export diagnostics…** (Settings > Diagnostics and the Performance drawer) writes one zip, `lumen-diagnostics-<date>.zip`:

```
manifest.json         app version, OS, machine, GPU, export time
system-probe.json     the latest SystemProbe
preflight.json        the latest PreflightReport, with a plain-text summary in preflight.txt
stats.json            the last 10 minutes at 1 Hz, with marks
command-log.json      the command log from doc 12 (no tokens, token names only)
decoder-budget.json
logs/                 app log files of the last 3 days
show.json             optional, off by default: the show document without media
```

The command log and stats share timestamps, so a dropped frame lines up with the command that caused it. The export never includes media, tokens or the library.

## Files

| Area | Location |
|---|---|
| Report, item, fix, probe and budget schemas | `packages/schema/src/preflight.ts` |
| Stats event schemas | `packages/schema/src/stats.ts` |
| Pure checks, fingerprints, ignore matching | `packages/core/src/preflight.ts` |
| Peak set and decoder load estimate | `packages/core/src/decoderLoad.ts` |
| Stats budgets and health level | `packages/core/src/statsBudget.ts` |
| Preflight runtime (triggers, caching, Go live dialog) | `apps/studio/app/show/preflight/usePreflight.ts`, `PreflightPanel.vue`, `GoLiveDialog.vue` |
| Performance drawer and pop-out window | `apps/studio/app/show/monitor/PerformancePanel.vue`, `useStats.ts` |
| Sparkline component | `apps/studio/app/ui/Sparkline.vue`, exported from `~/ui` |
| Diagnostics export | `apps/studio/app/settings/DiagnosticsPanel.vue`, `apps/studio/app/control/diagnostics.ts` |
| Keep-awake assertion | `apps/studio/src-tauri/crates/lumen-output/src/power.rs` |
| System probe: power, thermal, focus, displays, GPU use | `lumen-output/src/system.rs` |
| Output counters, stats thread, history ring, CPU per thread | `lumen-output/src/stats.rs` |
| GPU stage timing, allocator wrapper, HUD pass | `apps/studio/src-tauri/crates/lumen-render/src/{timing.rs,alloc.rs,hud.rs}` |
| Decoder counters, disk speed and free space, hardware decode probe, decoder benchmark | `apps/studio/src-tauri/crates/lumen-media/src/{stats.rs,disk.rs,probe.rs,bench.rs}` |
| API endpoints and stats topic | `apps/studio/src-tauri/crates/lumen-control/src/api.rs` |
| Tauri wiring (`system_probe`, `stats_subscribe`, `set_output_hud`, `export_diagnostics`) | `apps/studio/src-tauri/src/lib.rs` |

## Tests

- **Core (Vitest):** every check against fixture inputs, including "nothing to report"; fingerprints and ignore matching (an ignore stops matching when the facts change); peak-set selection with grid clips, timeline clips, crossfade and preload; decoder load maths; disk need per volume; budget warnings with the 2 s hold; health levels.
- **Runtime (Vitest):** trigger debouncing, quick runs reusing cached slow results, Go live dialog shown only for unignored blockers, API-triggered Go live never opening a dialog, the command log recording `preflight.ignore`.
- **Rust:** keep-awake hold and release with a fake platform layer (first open acquires, last close releases, quit releases); counter windows and histogram p95; late and dropped classification from present timestamps; timestamp ring order and tick conversion with fake values; `debug.setHud` rules for audience, stage and virtual screens; disk speed maths with a fake reader; serde round trips of `StatsEvent` and `SystemProbe` against fixtures from the Zod schemas. No GPU or device tests in CI.
- **Ignored GPU tests:** timestamp queries on the real device produce non-zero stage times; the HUD pass draws into an offscreen target.
- **Manual:** unplug a projector, rename a video, pull the charger, turn on Low Power Mode, install and remove the NDI Runtime, and check each item and fix; run 8 Hap Q layers from an external USB drive and check `disk.speed`; let the Mac idle for an hour with outputs open and check that displays stay on.

## Delivery

| Step | Scope | Exit |
|---|---|---|
| 16.1 Keep awake | `power.rs`, toolbar indicator, Settings option | Outputs stay on through an hour of idle on macOS and Windows |
| 16.2 Preflight core | Schemas, pure checks for media, fonts, screens, outputs, show and backups; Preflight panel and chip | Opening Show lists a missing video with a working Relink fix |
| 16.3 System probe | Power, thermal, focus, main display, disks, ffmpeg, NDI, GPU use | Pulling the charger adds `power.battery` on the next quick run |
| 16.4 Go live and ignore | Go live dialog, ignore for this show, `preflight.*` commands, report export | An ignored blocker stays ignored after a restart and returns when the file changes |
| 16.5 Decoder and disk | Decoder benchmark, load estimate, disk speed test | A show with 8 Hap Q 1080p60 layers on a slow USB drive gets a `disk.speed` blocker |
| 16.6 Counters and monitor | Output and decoder counters, stats thread, Performance drawer, health dot | The drawer shows fps, dropped frames and decoder fps for four outputs |
| 16.7 GPU timing and HUD | Timestamp queries, allocator wrapper, HUD with confirmation | GPU time per stage shows on an M1; the HUD needs confirmation on an audience screen |
| 16.8 API and diagnostics | `/health`, `/preflight`, `/stats`, WebSocket topic, Companion feedbacks, diagnostics export | Companion shows an output's fps; a diagnostics zip has stats and the command log on one time line |

16.1 has no dependency and ships first. 16.4 and 16.8 need D1 (doc 12). 16.7 needs the target framework from B4.1 for the conversion stage.

## Open questions

- **Transcoding fix.** ffmpeg can encode Hap (`-c:v hap -format hap_q`). A "Convert to Hap" fix would turn the most common warning into one click, but it needs a background job queue and disk space checks. Not in v1 unless the job queue exists for other reasons.
- **Focus status on macOS.** `INFocusStatusCenter` needs a Focus status entitlement and user consent, and it reports only "focused", not whether Lumen's alerts pass. If it proves unreliable, keep the check as guidance only.
- **Calibration drift.** The decoder benchmark runs once per machine and app version. A machine that runs hot in a rack decodes slower than at rest. A re-run after a thermal warning may be worth it.
- **Per-output fps when a monitor runs at a different rate.** A 50 Hz projector and a 60 Hz LED processor on one Mac render at different rates. The monitor shows each output's own rate; whether video should follow the slowest output is a question for D3 (show clock).

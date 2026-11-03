# 21 — Stems integration

Stems is the sibling desktop app for live multitrack playback (sibling repository `stems`). When a musician runs a set in Stems, Lumen follows: lyrics follow the sections, visuals change on each song and section, and clocks stay locked. Stems is the first client of a vendor-neutral **playback sync** API on Lumen's command bus. Any other playback tool can use the same API.

- Commands, tokens, HTTP, WebSocket and OSC: `12-command-bus.md`. Discovery and pairing: `14-local-network.md`.
- Timecode follow and the timeline runner: `08-show-control.md`. Live state and rundowns: `03-live-engine.md`. Songs: `09-local-editor.md`.
- BPM clock: roadmap **C2**. One show clock: **D3**. Stems side: Stems `03-data-model.md` (Song, Section, Marker, CueEvent), `05-control-sync.md` and `07-plan.md` § M5.

## Rules

1. **Each app runs alone.** Lumen never needs Stems, and Stems never needs Lumen. Each integration layer below works on its own.
2. **One bus, no second protocol.** Stems is a `control` client of Lumen's local API. Sync messages are `sync.*` commands on the doc 12 bus, applied by `applyCommand` like any other command.
3. **Lumen stays the authority** for what is on screen. Stems reports what the music does; Lumen decides what to show, through links the operator controls.
4. **Never black out on a sync failure.** A lost connection, an unknown song or a late message holds the current state. Sync never sends `mode.set black` or `system.panic` on its own.
5. **Absolute, not relative.** Messages name the song and section that play, never "next". Vamps, skips and jumps in Stems therefore land on the right slides by construction.
6. **Stems' engine is the music clock.** When a message carries a scheduled time, Lumen applies it at that instant on its own clock, using a measured clock offset. Without a time, Lumen applies on receipt.
7. **Vendor-neutral names.** Commands and fields describe playback (song, section, marker, transport), not Stems. Player-specific data goes in an optional `meta` object that Lumen stores but never interprets.

## Layers of integration

| # | Layer | Lumen follows | Transport | Lumen needs | Stems needs |
|---|---|---|---|---|---|
| 1 | Timecode | Timeline position | LTC or MTC | Done (doc 08) | M5 LTC/MTC out |
| 2 | Song and section map | Rundown item, slides, visuals | WebSocket (OSC mirror) | D1.4, this doc | Sync client (§ Stems work) |
| 3 | Shared setlist | Rundown order | WebSocket or a file | This doc | Setlist export |
| 4 | Tempo | BPM clock | Ableton Link, or `sync.transport` | C2 | M5 Link |
| 5 | MIDI | Song and section by number | MIDI | Done (doc 08, doc 12 bindings) | M5 MIDI out |

A typical concert uses 1, 2 and 4: timecode drives a timeline of visual cues, sections drive lyrics, and Link keeps clip changes on the beat.

## 1. Timecode

Stems sends LTC on an audio output channel or MTC on a MIDI port (Stems M5). Lumen follows with the timeline runner from doc 08 in external clock mode.

- **Same Mac:** MTC over the IAC bus, or LTC through a loopback audio device.
- **Two machines:** LTC on a spare interface output into a Lumen audio input, or MTC over network MIDI.
- **Song hours.** Stems offers a setlist option "timecode hour per song": song *n* of the setlist starts at `n:00:00:00`. A Lumen show timeline places each song's cues at its hour. Songs can be reordered in Stems without moving Lumen cues.
- **Offsets per song.** A song link (§ Mapping) can carry `timecodeOffsetFrames` for songs that don't follow the hour convention. The runner subtracts it while that song plays, on top of the timeline's own `offsetFrames`.
- **Rate.** Both apps must use the same frame rate. Doc 08 blocks firing on a mismatch; the Show transport shows the mismatch.

When layers 1 and 2 both run, each link chooses what drives lyrics: `lyricsFollow: 'sections'` (default) or `'timeline'` (slide clips on the timeline). Visual cues on the timeline run either way.

## 2. Song and section map

### Discovery

- Lumen announces `_lumen._tcp` on port 7710 (doc 14).
- Stems announces `_stems._tcp` with TXT records `version`, `id` (random install id) and `name` (the rig name). Lumen lists Stems machines in Settings > Sync so the operator knows which player to expect.
- Stems browses `_lumen._tcp` and lists Lumen machines by show name.

### Pairing

Pairing follows doc 14, with a code entry variant for desktop clients that can't scan a QR code:

```
Lumen: Settings → Remote control → Add device → role: control
       shows a QR code and a 6-character code (5 minutes, one use)
Stems: Settings → Lumen → pick "studio-mac" from discovery → enter the code
       → POST /api/v1/pair { code, deviceName: 'Stems on band-mac' }
Lumen: "Allow 'Stems on band-mac' as control?" → operator accepts
Stems: stores the token in the macOS Keychain
```

The token works as any doc 12 token: hashed at rest, revocable, rate limited. The command log shows `source.kind: 'sync'` and the token name.

### Messages

Stems connects to `GET /api/v1/ws`, sends `hello` with its token, and then sends commands. All sync commands are in `packages/schema/src/command.ts`.

```
sync.announce     { player: { id, app, name, version }, protocol: 1, meta? }
sync.setlist      { setlistId, name, items: SetlistItem[], meta? }
sync.songStarted  { songId?, setlistIndex?, title, artist?, bpm?, sections?: SectionInfo[], at?, resync?, meta? }
sync.songStopped  { songId, reason: 'end' | 'stop' | 'skip', at? }
sync.section      { songId, sectionId?, index?, name, occurrence, bar, lengthBars?,
                    kind: 'enter' | 'repeat', at?, resync? }
sync.vamp         { songId, sectionId, active }
sync.disarm       { songId }                     cancels a pending scheduled section
sync.marker       { songId, markerId, name, at? }
sync.transport    { playing, positionSamples, sampleRate, bpm, timeSignature: [num, den],
                    bar, beat, downbeatAt? }
sync.clockStatus  { offsetMs, rttMs, jitterMs }  for display only

SetlistItem { index, songId, title, artist?, durationMs?, sections: SectionInfo[] }
SectionInfo { id, name, index, startBar, lengthBars }
at, downbeatAt: number                           Lumen host clock, ms (§ Clock alignment)
```

- `songId` and `sectionId` are the player's ids. `setlistIndex` and `index` let a player without stable ids (or the MIDI profile, § 5) name a song or a section by position.
- `occurrence` counts how often this section has started in the current song (1 for the first Chorus, 2 for the second). `kind: 'repeat'` marks a vamp loop restarting the same section.
- Stems sends `sync.transport` at 4 Hz while playing and on every change of play state or tempo.
- `resync: true` marks state sent again after a reconnect.

Lumen sends nothing new. Stems may subscribe to `sync.*` and `onAir.*` paths to show Lumen's status ("Lyrics: Chorus, slide 2").

### What Lumen does

`applyCommand` handles each sync command against the active follow peer and the song links (§ Mapping). The live result is ordinary live commands (`live.previewGoTo`, `live.take`, `live.goTo`, `mode.set clear`) plus the link's own commands.

| Message | Lumen action |
|---|---|
| `sync.songStarted` | Find the link, then the rundown item (by setlist link, else the first item with the linked presentation). Follow `live`: go to that item on air at its first section. Follow `preview`: put it in preview; the operator takes. Run the link's `onStart` commands. Unknown song: show a banner and change nothing. |
| `sync.section` | Map the player section to a Lumen song section. Go to the first slide of that section. Run the section's `commands` (for example `clip.launchColumn`). A section mapped to `null` (instrumental) runs `mode.set clear`, which hides content layers and keeps visuals. |
| `sync.section` with `kind: 'repeat'` | Go back to the first slide of the same section. If the section has one slide, nothing changes and no transition runs. This keeps the chorus slides on screen while Stems vamps. |
| `sync.vamp` | Mark the vamp in state for the status chip. While active, `even` and `bars` timing restart on every repeat. |
| `sync.songStopped` | Run the link's `onStop`: `hold` (keep the last slide) or `clear` (default). Never black. |
| `sync.marker` | Run the commands mapped to that marker name, if any. |
| `sync.transport` | Store transport state for display and, without Link, feed the BPM clock (§ 4). |

Skip and jump need no special case: Stems sends the section it lands on, and Lumen goes there (rule 5). "Stop at end of section" arrives as `sync.songStopped { reason: 'stop', at }`, scheduled at the section end.

### Slides within a section

A Lumen song section can span several slides. Today the slides of a section are the slides whose `label` equals the section's label (`buildSongDoc` in `packages/core/src/presentation.ts`). Each section link picks how they advance:

| Mode | Behaviour |
|---|---|
| `manual` | The first slide goes on air at the section start; the operator presses Next for the rest. |
| `even` (default) | Slides split the section's `lengthBars` evenly, rounded to whole bars. Slide *k* goes on air at bar `startBar + k × length / slides`, timed from `sync.transport`. |
| `bars` | Per-slide bar counts from the link (`slideBars`), for lines that don't divide evenly. |

Operator input always works. Next, Prev and Take while following move the slide; the next section message takes over again.

### Scheduling and latency compensation

Stems knows ahead of time where a section starts: a natural boundary from the song, or an armed action resolved when armed (Stems `02-audio-engine.md`, § Live actions). It sends `sync.section` (and `sync.songStopped`) with `at` set to the instant the section's first sample reaches the speakers, at least the lookahead before that instant (default 500 ms, range 200–1000 ms).

```
Stems engine: section starts at sample S
  → playerTime(S) + outputLatencyAudio → hostAt (Lumen clock, via offset)
  → send sync.section { at: hostAt } ≥ 500 ms early
Lumen: applyCommand → effect { kind: 'schedule', at: hostAt − videoLatencyMs, commands }
  → runtime dispatches on the frame closest to that instant
```

- `applyCommand` stays pure: a scheduled sync command returns a `schedule` effect. The runtime (`useSyncFollow`) holds the pending commands and dispatches them through the bus at the right frame.
- **One pending section per peer.** A new `sync.section` replaces the pending one, as a newly armed action replaces the old one in Stems. `sync.disarm` clears it.
- **Video latency.** `videoLatencyMs` (Settings > Sync, default two frames) covers Lumen's render and the display chain. Projectors and LED processors add more; the operator tunes it by eye with a click track and a flash test pattern.
- **Late messages.** A message whose `at` is already past applies at once. It is never dropped: the target is absolute, so applying late is still correct.
- **No `at`.** The command applies on receipt. OSC and MIDI work this way.
- Target accuracy: within one frame at 60 fps on wired Ethernet, within two frames on good Wi-Fi.

### Clock alignment

The WebSocket API gains one message pair, outside the command bus because it changes no state:

```
client → { type: 'timeSync', id, t0 }                 t0: client clock, ms
server → { type: 'timeSync', id, t0, t1, t2 }         t1 receive, t2 send: Lumen host clock, ms
client: t3 = receipt time
        offset = ((t1 − t0) + (t2 − t3)) / 2
        rtt    = (t3 − t0) − (t2 − t1)
```

- `lumen-control` stamps `t1` and `t2` in Rust as the frame is read and written, from a monotonic clock (`Instant`), not in the webview. The runtime receives the same host clock through the `control:event` channel, so schedule times compare on one clock.
- The client sends a burst of 8 at connect, then one every 2 s. It keeps the last 16 samples, takes the 4 with the lowest `rtt`, and uses their median offset. That absorbs Wi-Fi jitter and the drift between Stems' audio clock and Lumen's monotonic clock.
- The client converts its own times into Lumen host time before sending `at`. Lumen never estimates a client's clock, so a simple client can skip `timeSync` and omit `at`.
- Stems reports `sync.clockStatus` every 10 s. If `rtt` exceeds 50 ms or jitter exceeds 10 ms, the Show status chip warns "sync timing degraded".

### OSC mirror

For players that only speak OSC (a Max for Live device, QLab, a DAW script), doc 12's OSC server accepts the same commands:

```
/lumen/sync/song/start    s:songId s:title [f:bpm]
/lumen/sync/song/stop     s:songId s:reason
/lumen/sync/section       s:songId s:sectionId s:name i:occurrence i:bar [i:lengthBars]
/lumen/sync/section/index i:index                           for players without ids
/lumen/sync/vamp          s:songId s:sectionId i:0|1
/lumen/sync/marker        s:songId s:markerId s:name
/lumen/sync/transport     i:playing d:positionSamples f:bpm i:bar i:beat
```

OSC messages apply on receipt (no `at`, no `timeSync`) and need the sender's IP on the allow list, as every OSC input does. Stems itself uses the WebSocket.

### Failure behaviour

| Event | Lumen behaviour |
|---|---|
| WebSocket drops | Keep the slide, clips and mode on air. A pending section within 1 s of its `at` still fires (the audio will play it); later ones are dropped. The status chip turns amber: "Stems disconnected, holding". |
| Reconnect | Stems sends `sync.announce`, `sync.setlist`, the current `sync.songStarted` and `sync.section` with `resync: true`. Lumen goes to that section if it differs from what is on air, and does nothing if it matches. |
| No `sync.transport` for 3 s while playing | Mark "no signal" and hold. `even` and `bars` timing pause on the current slide. |
| Unknown song or section | Banner with a "Link now" button. Nothing on screen changes. |
| Operator takes over | The Follow switch in Show (Off, Preview, Live) goes to Off. Messages are still received and shown, never applied. |
| Timecode lost | Doc 08: `locked: false` after 1 s; D3 decides chase or freewheel. Section following is not affected. |

Rule 4 holds in every case. The only way sync shows black is a link command the operator added on purpose.

## Mapping

### Song links

Links are saved in SQLite and travel in library and show bundles (doc 15, `settings/sync-links.json`).

```
SyncLink {
  id
  player: { app: string, songId: string }    e.g. { app: 'stems', songId: '…' }
  title: string                              player title when linked, for display and re-matching
  presentationId: string                     the Lumen song
  follow: 'live' | 'preview'                 default 'preview'
  lyricsFollow: 'sections' | 'timeline' | 'off'
  timecodeOffsetFrames: number | null
  onStart: Command[]
  onStop: 'hold' | 'clear'                   default 'clear'
  sections: SectionLink[]
  markers: { name, commands: Command[] }[]
  confirmed: boolean                         false while only auto-matched
  updatedAt
}

SectionLink {
  playerSectionId: string
  playerName: string                         'Verse 1'
  lumenSectionId: string | null              null: no lyrics (instrumental)
  withinSection: 'manual' | 'even' | 'bars'
  slideBars: number[] | null
  commands: Command[]                        visuals on enter, e.g. clip.launchColumn
}

RundownLink {
  id, rundownId
  player: { app, setlistId }
  items: { setlistIndex, songId, rundownItemId }[]
}
```

Commands in links run with `source: { kind: 'sync', clientId, bindingId: linkId }`. `sync` is a new `Source.kind`.

### Matching a song

In order:

1. **Shared id.** The player sends `meta.lumenPresentationId` once it learned the link (Stems reads `GET /api/v1/sync/links`).
2. **Explicit link** by `player.songId`.
3. **Title match.** Titles are normalized (case, punctuation, accents, a trailing "(Live)" or "- Live"). Artist breaks ties when both apps have it. Exactly one match creates a link with `confirmed: false` and an "auto" badge. Settings can turn auto-linking off.

### Matching sections

Section names are compared after normalization and a small alias table of general song-structure words: `V1` ↔ `Verse 1`, `Pre`, `PreChorus` ↔ `Pre-Chorus`, `Ch` ↔ `Chorus`, `Br` ↔ `Bridge`. A numbered player section (`Chorus 2`) matches an unnumbered Lumen section (`Chorus`) when the Lumen song has only one. `Intro`, `Outro`, `Interlude`, `Instrumental`, `Solo` and `Turnaround` map to `null` unless the Lumen song has a section with that label.

Matching is by section identity, never by position. Stems' order of sections (with repeats, vamps and skips) can differ from the Lumen song's `arrangement`; while following, Stems' order wins. The arrangement still drives the song when run by hand.

### Mapping UI

- **Show workspace:** a status chip in the transport: player name, song, section, bar, clock offset and quality. Next to it the Follow switch (Off, Preview, Live).
- **Content editor (`/editor/:id`), Sync tab:** the song's links. The section map editor has two columns: the player's sections in player order (name, occurrence, bars) and a Lumen section picker with slide thumbnails. "Auto-match" fills it; each row sets `withinSection`, slide bars and commands (clip column, prop, layer opacity) with the doc 12 command picker. A **simulate** scrubber walks the player's structure bar by bar and shows which slide is on air, so a link can be checked without Stems running.
- **Settings > Sync:** players seen and paired, the active follow peer, `videoLatencyMs`, auto-linking, all links with unconfirmed and unmapped ones first, and songs in the current setlist that have no link.

### HTTP additions

```
GET /api/v1/sync/links?app=stems    [{ playerSongId, presentationId, title, confirmed, sectionsMapped, sectionsTotal }]
GET /api/v1/songs                    [{ id, title, author, sections: [{ id, label }] }]   for player-side pickers
```

Both need a `control` token. Links are edited only in Lumen.

## 3. Shared setlist

- `sync.setlist` gives Lumen the player's setlist on connect and on every change.
- **Create rundown from setlist:** one rundown item per song, using the linked presentation, or a title card for unlinked songs. This writes a `RundownLink`, so `sync.songStarted` resolves by `setlistIndex` to the right rundown item, even when a song appears twice.
- **Keep in sync** (optional, per rundown link): setlist changes reorder the rundown. While on air, the change goes through the doc 03 hold rules: the slide on air stays until the next take or song start.
- **Offline exchange:** Stems exports a setlist file (`.stems-setlist.json`: setlist name, items, sections with names and bars). Lumen imports it as a rundown with links, with no network. Lumen exports a rundown as a list of `{ title, presentationId }` so Stems can match its songs and store `lumenPresentationId`.

## 4. Tempo

- **Ableton Link (preferred).** Both apps join the same Link session. Lumen's BPM clock (C2) follows Link tempo and phase with quantum 4. Stems leads or follows Link (Stems M5). No pairing is needed.
- **Without Link.** The BPM clock follows `sync.transport` from the active peer: `bpm` sets tempo, and `downbeatAt` (Lumen host time of the last downbeat) sets phase.
- **Priority** in Lumen's BPM clock settings: Link, then sync peer, then MIDI clock, then tap. The operator can pin one.
- Link's licence (GPLv2 or a commercial licence from Ableton) applies to both apps. Stems `07-plan.md` lists it as a risk; Lumen shares the decision. Without Link, the `sync.transport` path still works.

## 5. MIDI fallback

For rigs without a network, or as a backup path. Stems sends MIDI (M5); Lumen's MIDI bindings (doc 08, storing doc 12 commands) translate:

| MIDI from the player | Lumen command |
|---|---|
| Program change *n* on the sync channel (default 16) | `sync.songStarted { setlistIndex: n }` |
| Note *base + k* on the sync channel (default base 0) | `sync.section { index: k }`, the *k*-th section of the current song in player order (from the link), or Lumen arrangement order with no link |
| Note 127 | `sync.songStopped { reason: 'stop' }` |

The wizard in Settings > Sync writes these bindings in one click. MIDI carries no names and no schedule, so slides change on arrival, a frame or two after the audio.

## Stems work

Work for the Stems plan (proposed as **M5b Lumen link**, after M5; Stems `07-plan.md` currently lists the OSC link after M7):

1. **Discovery:** announce `_stems._tcp` and browse `_lumen._tcp` (`mdns-sd`) in `stems-control`.
2. **Pairing:** a Lumen section in Settings: pick a machine, enter the code, store the token in the Keychain, show status.
3. **WebSocket client** in `stems-control` on its own Tokio runtime, off the real-time thread: `hello`, commands, acks, reconnect with backoff, resend state with `resync: true`.
4. **Clock:** `timeSync` exchange and the offset estimate. Engine sample time maps to host time through CoreAudio host time stamps, then to Lumen host time.
5. **Event emitter:** song start and stop, section enter and repeat (with `occurrence`), vamp on and off, markers, transport at 4 Hz. Sections are sent with `at` as soon as their start sample is known and at least the lookahead early: natural boundaries from the song, armed actions when armed, `sync.disarm` when an armed action is cancelled.
6. **Setlist:** `sync.setlist` on connect and change; the `.stems-setlist.json` export; read `GET /api/v1/sync/links` and store `lumenPresentationId` per song.
7. **Timecode:** the "timecode hour per song" setlist option on top of M5 LTC and MTC out.
8. **MIDI profile:** program change per song and note per section on a chosen channel, as in § 5.
9. **Tests:** offline renders check that each section message carries the right `at` for its start sample; shared JSON fixtures from Lumen's Zod schemas check serde round trips; a fake Lumen server checks reconnect and resync.

The real-time thread stays untouched: the emitter reads engine state from the control thread, as Stems `02-audio-engine.md` requires.

## Files

| Area | Location |
|---|---|
| `sync.*` commands, `Source.kind: 'sync'`, sync state in `StateEvent` | `packages/schema/src/command.ts` |
| Links, setlist file, section info schemas | `packages/schema/src/sync.ts` |
| Apply sync commands, section resolution, slide timing, name matching | `packages/core/src/sync.ts` (called by `packages/core/src/commandBus.ts`) |
| Runtime scheduler, follow switch, status | `apps/studio/app/control/useSyncFollow.ts` |
| Links repository and SQLite tables `sync_links`, `rundown_links` | `apps/studio/app/data/syncLinks.ts` |
| Status chip, section map editor, Settings panel | `apps/studio/app/sync/{SyncStatusChip.vue,SectionMapEditor.vue,SyncSettingsPanel.vue}` |
| Rust command mirror, OSC sync addresses, `timeSync`, HTTP sync routes | `apps/studio/src-tauri/crates/lumen-control/src/{command.rs,osc.rs,api.rs,timesync.rs}` |
| Ableton Link (with C2) | `apps/studio/src-tauri/crates/lumen-control/src/link.rs` |
| Fake player for tests and demos | `tools/fake-player/` (replays a recorded session JSON against the API) |
| Shared fixtures for Stems | `packages/schema/fixtures/sync/` |

## Tests

- **Core (Vitest):** song resolution by shared id, link and title; section resolution including repeats, vamps, skips, stop at end of section and `null` sections; `even` and `bars` timing; one pending section and replacement; late messages; reconnect resync as a no-op when nothing changed; name normalization and aliases; no sync path produces `mode.set black`.
- **Runtime (Vitest):** the scheduler dispatches at the frame closest to `at − videoLatencyMs` against a fake clock; disconnect keeps state and fires only pending sections within 1 s.
- **Rust:** serde round trips for every sync command against the shared fixtures; OSC sync parsing; `timeSync` stamping; the offset estimator against simulated jitter and drift.
- **Equivalence:** the same recorded session through the WebSocket, the OSC mirror and the MIDI profile reaches the same slides (timing aside).
- **Manual:** Stems on a second Mac, wired and on Wi-Fi; film the audio meter and the output together to check the one-frame target; pull the network cable mid-chorus and check that the show holds.

## Delivery

| Step | Scope | Exit |
|---|---|---|
| 21.1 Timecode setup | Song-hour convention, per-link offset, setup guide | Lumen follows Stems' LTC through a full song (Stems M5 exit) |
| 21.2 Protocol | `sync.*` commands, `applyCommand`, OSC mirror, fake player | The fake player drives lyrics through a song with a vamp and a skip |
| 21.3 Mapping | Links, auto-match, section map editor, simulate, status chip | A song links by title and its sections map with one click |
| 21.4 Timing | `timeSync`, scheduling, `videoLatencyMs`, slide timing within sections | On wired Ethernet the chorus slide lands within one frame of the downbeat |
| 21.5 Setlist | `sync.setlist`, rundown from setlist, file exchange | A 10-song Stems set creates a rundown and runs it with no operator |
| 21.6 Tempo | Link and `sync.transport` in the BPM clock | Clips change on the bar while Stems changes tempo |
| 21.7 MIDI | MIDI profile and bindings wizard | With the network off, program changes and notes move songs and sections |

Depends on D1.4 (local API) and E3a.1 (pairing) for 21.2; C2 for 21.6. Stems work runs in parallel against the fake Lumen server and the shared fixtures.

## Open questions

- **A narrower `sync` role.** A `control` token can send any command. A `sync` role that allows only `sync.*` commands and state would limit what a compromised player can do. Decide before 21.2.
- **Section ids on slides.** Slides find their section by `label` today. A `sectionId` on each slide would survive renaming a section. It belongs with the E2 arrangements work.
- **Redundant players.** Touring rigs often run two playback machines. Lumen could follow a primary and switch to the backup when the primary drops and the backup plays the same song. Not in the first version.
- **Several Lumen machines.** With render nodes (E3), only the controller follows Stems; nodes follow the controller.
- **Section names in other languages.** The alias table is English. A per-library alias list may be needed.

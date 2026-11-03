# 03 — Live engine

The live state machine is pure TypeScript in `packages/core/src/live.ts`; the desktop is the authority.

## State

```
LiveState {
  sessionId, playlistId,
  itemIndex, slideIndex, buildIndex,
  previewItemIndex, previewSlideIndex,
  mode: live | black | clear | logo | freeze,
  stageMessage,
  timers[]
}
```

## Commands

`next`, `prev`, `goTo`, `nextItem`, `prevItem`, `previewNext`, `previewPrev`, `previewGoTo`, `take`, `setMode`, `setMessage`, `timerStart`, `timerStop`, `timerReset`.

`next` rolls into the next playlist item after the last slide. `take` copies the preview position live and sets mode to `live`. `freeze` holds the current frame without changing the playlist position.

## Output

- `live` shows the current slide.
- `black` outputs black.
- `clear` outputs transparent/background only, depending on the output setting.
- `logo` shows the workspace logo.
- `freeze` holds the last rendered frame.

Keyboard: Space/→ next, ← previous, Enter take, B black, C clear, L logo, F freeze.

## Realtime

The Durable Object relays `{hello, snapshot, command, ack}` with a sequence number and last-snapshot replay. Commands from remote controllers reach the desktop, which applies the reducer and broadcasts a new snapshot. If the DO or network is unavailable, live output continues unchanged.

## Place in the v2 model

The live state drives content, not the whole output. With render contract v2 (`02-render-contract.md`):

- The current slide becomes the `slide` source on the topmost layer tagged `content` or `lyrics`. Other layers keep playing. A grid clip launched on that layer covers the slide until the next slide goes on air (`apps/studio/app/show/showLive.ts`).
- Slide backgrounds follow the layer (`slideBackgroundMode` in `packages/core/src/slide.ts`). A layer tagged `lyrics` is an overlay: rundown slides and presentation clips on it drop the slide and theme background, so lyrics sit over the video and photos below. Any other layer, `content` included, shows the whole slide with its background. Tag the layer `content` to run full slides with their backgrounds.
- Picking another rundown in Show only loads it into the rundown panel and preview. The slide on air is held (`HeldProgram` in `apps/studio/app/live/liveSession.ts`) with the output mode, stage message and timers until the operator takes (`take`, `goTo`) or advances (`next`, `prev`, `nextItem`, `prevItem`, which land on the new rundown's first slide). Preview, mode and timer commands keep the hold.
- Show reloads the loaded rundown when it is saved (`onPlaylistSaved`) and when the workspace opens again. Program and preview follow their item ids to the new positions; if the item on air was removed, its slide is held on air until the operator moves on. The stage window follows the saved session position, so it shows the new rundown's position while a slide is held.
- `playlistId` points to a rundown (`11-ui.md`). The word "playlist" stays in the schema until the rename migration.
- Modes apply per screen after the master stage. `black`, `logo` (black until a logo asset exists) and `freeze` affect every screen; screens cannot opt out yet. `clear` hides only content-tagged layers.
- The Show workspace replaced the `/live` page, which now redirects. Keyboard shortcuts stay the same; the workspace adds 1–9 to launch a clip column and Esc to clear clips.
- The live state is shared through `useShowLive()`, so the Screens and Compose previews show what is on air.

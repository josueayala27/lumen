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

- The current slide becomes the `slide` source on the layer tagged `content` or `lyrics`. Other layers keep playing.
- `playlistId` points to a rundown (`11-ui.md`). The word "playlist" stays in the schema until the rename migration.
- Modes apply per screen after the master stage. `black` and `freeze` affect every screen unless a screen opts out; `clear` hides only content-tagged layers.
- The Show workspace replaces the `/live` page. Keyboard shortcuts stay the same.

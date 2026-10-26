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

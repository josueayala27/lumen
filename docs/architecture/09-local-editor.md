# 09 — Local editor

The first local-first slice. It has no cloud sync, auth or media upload. SQLite is the only store; the web build falls back to `localStorage` for preview.

## Storage

`apps/studio/src-tauri` exposes the SQL plugin. `apps/studio/app/data/db.ts` opens `sqlite:lumen.db` and runs idempotent migrations:

```sql
presentations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,           -- presentation | song
  title TEXT NOT NULL,
  theme_id TEXT,
  doc TEXT NOT NULL,            -- JSON PresentationDoc
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
)
```

`presentations.ts` is the repository: list, get, save (upsert), soft delete, create. It validates rows with `presentationDocSchema` and skips corrupt documents. The SQL capability needs `sql:allow-execute`, not only `sql:default`.

## Document builders

`packages/core/src/presentation.ts` builds documents:

- `buildSongDoc` parses `[Section]` markers, splits lyrics with `splitSongLyrics` and creates one text slide per split.
- `songFields` reconstructs the editor fields from `song.sections`.
- `updateSongDoc` rebuilds slides and keeps slide ids by index.
- `buildBlankPresentation` and `updatePresentationDoc` cover text-only presentations.

Each slide has a solid `#101828` background and one centered text element using the `inter` font id. The DOM preview does not yet use the Rust renderer.

## Routes

These routes change with the UI rewrite; see `11-ui.md` § Route changes.

- `/` — library list from SQLite; filter by kind (`/songs` redirects to `/?kind=songs`).
- `/editor/:id` — song fields, lyric textarea, generated slide rail, preview, save, present.
- `/show?presentation=<id>` or `/show?rundown=<id>` — the Show workspace loads the document or rundown and drives next/prev/take, modes, keyboard, MIDI and the LTC timeline. `/live` redirects here.

Deleting from the library is a soft delete; no UI yet. New presentations start with one text slide.

## Limits

- No sync, conflicts, workspaces or accounts.
- The editor preview renders the slide through the compositor in the desktop app (`slideComposition` and `preview_render_composition`, 640×360 while dragging); the browser shows an approximate DOM preview. Composition fonts are not filled in yet, so text uses system fonts.
- Text-only slides; shapes, images, media and themes are next.
- Rundowns (`/rundowns`) hold ordered content; the Show workspace runs one rundown or one presentation.

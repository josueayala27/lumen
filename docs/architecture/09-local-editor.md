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

- `/` and `/songs` — library list from SQLite; filter by kind.
- `/editor/:id` — song fields, lyric textarea, generated slide rail, preview, save, present.
- `/live?presentation=<id>` — loads the document, renders slides from `slideText`, and drives next/prev/take, modes, keyboard, MIDI and the LTC timeline.

Deleting from the library is a soft delete; no UI yet. New presentations start with one text slide.

## Limits

- No sync, conflicts, workspaces or accounts.
- No real fonts or Rust scene rendering in the editor preview.
- Text-only slides; shapes, images, media and themes are next.
- No playlist; Live loads one presentation.

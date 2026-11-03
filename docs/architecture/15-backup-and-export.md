# 15 — Backup and export

Lumen v1 has no cloud sync, so moving a show to another machine and protecting a library against a dead disk must work locally. This doc defines one file format, the **Lumen bundle** (`.lumen`), and automatic local backups.

- Library storage: `09-local-editor.md` (SQLite, `$APPDATA/media`). Cloud sync, later: `04-sync.md`.
- Roadmap: part of the **v1 local release** (`07-roadmap.md`).

## Rules

1. **A bundle is self-contained.** It opens on another machine with no network and no missing media.
2. **Import never overwrites silently.** Conflicts are shown; the operator picks keep, replace or keep both.
3. **Backups never run during a show.** While outputs are open or the show is on air, backups wait.
4. **Formats are versioned.** Every document in a bundle carries its `schemaVersion`, and import runs the same migrations as loading from SQLite.

## The `.lumen` bundle

A zip file (stored, not compressed, for media; deflate for JSON) with this layout:

```
manifest.json
documents/
  presentations/<id>.json     PresentationDoc (songs and slides)
  themes/<id>.json            Theme
  rundowns/<id>.json          PlaylistDoc
  shows/<id>.json             ShowDoc (composition, screens, clip grid)
  timelines/<id>.json         ShowTimeline
media/
  <sha256>.<ext>              original media files, named by hash
  posters/<sha256>.jpg        video posters (optional, regenerated if missing)
fonts/
  <sha256>.<ext>              fonts used by included documents, if their licence allows embedding
settings/                     only in full-library exports
  midi-bindings.json
  screens-defaults.json
```

`manifest.json`:

```
{
  format: 'lumen-bundle', formatVersion: 1,
  createdAt, appVersion,
  kind: 'show' | 'rundown' | 'library' | 'presentation',
  root: { kind, id } | null,          the item the bundle was made for
  documents: [{ kind, id, title, schemaVersion, sha256 }],
  media:     [{ id, sha256, name, kind, bytes, durationMs?, width?, height? }],
  fonts:     [{ id, family, sha256, embeddable }],
  excluded:  [{ kind, id, reason }]   e.g. fonts not allowed to embed, missing media
}
```

### What goes in

| Export | Contains |
|---|---|
| **Presentation or song** | The document, its theme, its media and fonts |
| **Rundown** | The rundown, every presentation and song in it, their themes, media and fonts |
| **Show** | The show document, the rundowns it uses, every clip's media and presentations, timelines, themes, fonts |
| **Library** | Everything, plus MIDI bindings and screen defaults |

Media are deduplicated by hash. Missing media are listed in `excluded` and the export continues; the operator sees a summary.

### Import

1. Read and validate the manifest and every document (Zod), and verify every `sha256`.
2. Show a summary: items to add, items that already exist (same id) with "same" or "different" content, missing media.
3. For each conflict the operator chooses **keep mine**, **use imported**, or **keep both** (the imported copy gets new ids and a " (imported)" suffix, and references inside the bundle are rewritten).
4. Copy media into `$APPDATA/media` by hash (skip files that are already there) and insert documents in one SQLite transaction. A failure rolls back everything.
5. Regenerate posters and peaks that are missing.

## Automatic backups

- **What:** a full-library bundle, without media by default (media are large and already on disk). An option includes media.
- **When:** at app start if the last backup is older than 24 hours, and after a show is closed. Never while outputs are open or the show is on air (rule 3).
- **Where:** `~/Documents/Lumen Backups/` by default, configurable (an external drive, a synced folder such as iCloud Drive or Dropbox; Lumen only writes files and doesn't talk to those services).
- **Retention:** keep the last 7 daily and 4 weekly backups; delete older ones.
- **Restore:** Settings > Backups lists backups with date and size. Restoring imports the bundle with "use imported" for every conflict after a confirmation, and first makes a backup of the current state.

## Crash safety of the library

Independent of bundles:

- SQLite runs in WAL mode with `synchronous = NORMAL`. A crash loses at most the last unsaved edit.
- Before every schema migration, the database file is copied to `lumen.db.bak-<version>`.
- A **library check** in Settings validates every document and media file and reports problems (corrupt JSON, missing files, unused media) with one-click fixes.

## Files

| Area | Location |
|---|---|
| Manifest and bundle schemas | `packages/schema/src/bundle.ts` |
| Pure planning: what to include, conflict detection, id rewriting | `packages/core/src/bundle.ts` |
| Zip writing and reading, hashing, copying media | `apps/studio/src-tauri/src/bundle.rs` (`zip` crate, streaming, off the main thread) |
| Export and import UI, backup settings, library check | `apps/studio/app/library/` and `apps/studio/app/settings/BackupPanel.vue` |
| Scheduler | `apps/studio/app/data/backups.ts` |

## Tests

- **Core:** inclusion rules for each export kind, deduplication, conflict detection, id rewriting for "keep both", migration of older `schemaVersion` documents.
- **Rust:** round trip of a bundle with media and fonts, hash verification failure, a truncated zip, a large media file streamed without loading it into memory.
- **Manual:** export a show on one Mac, import on another with no network, run it on outputs.

## Delivery

| Step | Scope | Exit |
|---|---|---|
| 15.1 Export | Show, rundown, presentation and library bundles | A show bundle opens on a second Mac and runs |
| 15.2 Import | Validation, conflicts, rollback | Importing the same bundle twice offers keep both and keeps references right |
| 15.3 Backups | Scheduler, retention, restore | A backup restores a deleted song |
| 15.4 Library check | Validation and fixes | The check finds a deleted media file and offers relink |

## Planned extensions

Designed in later docs, not built yet:

- **Templates:** bundle `kind: 'template'` with a `template` manifest block and `documents/templates/` (doc 20).
- **Show data:** `ShowDoc.preflight.ignored` (doc 16) and `settings/sync-links.json` (doc 21).

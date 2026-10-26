# 01 — Data model

Cloud is the backup and collaboration surface. The desktop SQLite mirror is authoritative during a service.

## Tenancy

```
user (Better Auth)
session, account, verification
workspaces(id, name, slug, plan)
workspace_members(workspace_id, user_id, role)   owner | admin | editor | operator | viewer
workspace_invites(workspace_id, email, role, token_hash, expires_at)
libraries(id, workspace_id, name, kind)
```

A workspace owns libraries. A library owns presentations, themes, playlists, media and fonts. A non-member gets a 404 for any workspace or library they cannot see.

## Content

```
presentations(id, library_id, kind, title, theme_id, doc jsonb, doc_schema, version,
              client_updated_at, server_rev, deleted_at)
themes(id, library_id, name, doc jsonb, doc_schema, server_rev, deleted_at)
playlists(id, library_id, name, doc jsonb, doc_schema, server_rev, deleted_at)
media_assets(id, library_id, kind, name, sha256, mime, size, duration_ms, width, height,
             r2_key, server_rev, deleted_at)
fonts(id, library_id, family, sha256, r2_key, source, license_flag, server_rev, deleted_at)
```

`doc` is a Zod-validated `PresentationDoc`, `Theme` or `PlaylistDoc`. `doc_schema` lets a future migration read old rows.

## Sync

```
workspace_revs(workspace_id, rev)                        monotonic per workspace
sync_ops(op_id, workspace_id, entity, entity_id, base_rev, result)
sync_conflicts(id, workspace_id, entity, entity_id, base_rev, local_doc)
```

Every write allocates the next `server_rev` for the workspace. Pull uses `server_rev > cursor`, never a wall-clock timestamp. Push is idempotent by `op_id`. MVP is single-writer per document: a version mismatch returns 409 and stores a conflict copy rather than merging slides.

## Local SQLite

Mirror the cloud tables plus:

```
local_path     device-only media path
dirty          0/1 outbox flag
base_rev       revision the local edit was based on
synced_rev     last applied server revision
attempts, next_retry_at, last_error
```

Use `PRAGMA user_version` for migrations. Media stays on disk; only metadata syncs by default.

## Auth

Better Auth runs in the API with the Drizzle adapter:

- Web: HTTP-only session cookie, `SameSite=Lax`, trusted `WEB_ORIGIN`.
- Desktop: bearer session from the `/desktop-auth` browser handoff, stored in the OS keychain. Tauri origins are trusted; browser cookies are not used in the desktop webview.
- Realtime: short-lived HMAC token in the `Authorization` header or WebSocket subprotocol, never a query string.

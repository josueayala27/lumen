# 04 — Sync

MVP is single-writer per document. Do not promise conflict-free multi-device editing; that needs Yjs.

## Pull

`GET /sync/pull?workspaceId=…&since=<server_rev>`

Returns rows whose `server_rev` is greater than `since`, including tombstones (`deleted_at`). The client applies rows in revision order and stores the new cursor. The cursor is a revision, not a timestamp.

## Push

`POST /sync/push`

```json
{
  "workspaceId": "workspace_…",
  "ops": [
    {
      "opId": "device_…:42",
      "entity": "presentation",
      "id": "presentation_…",
      "baseRev": 17,
      "clientUpdatedAt": 1760000000000,
      "payload": { "schemaVersion": 1, "…": "PresentationDoc" }
    }
  ]
}
```

- `opId` is unique per device operation. A replay returns without applying twice.
- If the server row's `server_rev` differs from `baseRev`, the API writes a `sync_conflicts` row and returns a 409-style conflict entry. It never silently overwrites.
- Successful writes allocate the next workspace revision.
- Bodies are capped at 2 MB; reject larger documents in the Worker before parsing JSON.

## Local outbox

SQLite rows carry `dirty`, `base_rev`, `attempts`, `next_retry_at` and `last_error`. Push in dependency order (parent library before presentation). Retry with exponential backoff. Pull after push so the client sees its own accepted revision.

## Media

Media files stay on disk. `media_assets` syncs metadata; `r2_key` is filled only when the user opts into cloud upload. A missing local file shows a relink action, never a silent fallback. Other devices can see metadata but cannot play unuploaded media.

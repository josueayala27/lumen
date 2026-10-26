# 06 — Deploy

## Cloudflare resources

| Resource | Staging | Production |
|---|---|---|
| Neon branch | `staging` | `production` |
| Hyperdrive | `lumen-hyperdrive-staging` | `lumen-hyperdrive-production` |
| R2 bucket | `lumen-media-staging` | `lumen-media` |
| API Worker | `lumen-api-staging` | `lumen-api` |
| Realtime Worker | `lumen-realtime-staging` | `lumen-realtime` |
| Web Worker | `lumen-web-staging` | `lumen-web` |

## Secrets

API: `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `REALTIME_TOKEN_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

Realtime: `REALTIME_TOKEN_SECRET` (same value as API).

Web: no secrets. Runtime vars `NUXT_API_ORIGIN`, `NUXT_PUBLIC_REALTIME_URL`.

## Database

- `DATABASE_URL` for drizzle-kit points at a direct, non-pooler Neon host.
- Runtime uses the Hyperdrive binding; create a `pg` client per request, `max: 3`.
- Run migrations from CI or a workstation, never from a Worker request.
- Smoke-test staging through Hyperdrive; PGlite does not exercise it.

## Desktop release

- macOS: Developer ID, hardened runtime, notarization, universal DMG.
- Windows: x64 NSIS/MSI, OV/EV certificate or Azure Trusted Signing.
- Tauri updater manifests are signed; one channel per environment.
- Start certificate and updater-key procurement in Phase 0.

## Commands

```bash
pnpm deploy:check
pnpm --filter api deploy:dry
pnpm --filter realtime deploy:dry
pnpm --filter web deploy:dry
```

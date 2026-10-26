#!/bin/sh
# Deploy Lumen Workers to staging or production.
# Usage: scripts/deploy.sh staging|production [--dry-run]
set -eu

ENV="${1:-}"
DRY_RUN="${2:-}"

case "$ENV" in
  staging|production) ;;
  *)
    echo "usage: $0 staging|production [--dry-run]" >&2
    exit 1
    ;;
esac

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

if [ "$ENV" = "production" ] && [ -z "${CONFIRM_PRODUCTION:-}" ]; then
  echo "Refusing production deploy without CONFIRM_PRODUCTION=1" >&2
  exit 1
fi

run() {
  if [ "$DRY_RUN" = "--dry-run" ]; then
    echo "dry-run: $*"
    return 0
  fi
  echo "run: $*"
  "$@"
}

pnpm check-types
pnpm test

run pnpm --filter api exec wrangler deploy --minify --env "$ENV"
run pnpm --filter realtime exec wrangler deploy --minify --env "$ENV"

pnpm --filter web build
if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "dry-run: web build produced .output/server/wrangler.json"
else
  pnpm --filter web exec wrangler deploy --config .output/server/wrangler.json --env "$ENV"
fi

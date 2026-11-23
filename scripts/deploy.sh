#!/usr/bin/env bash
# Server-side deploy script. Runs ON THE SERVER, from inside the project folder (e.g. ~/hr-portal),
# after the new code has already been checked out. The CI pipeline calls it over SSH.
#
#   PREV_SHA=<commit that was live before this deploy>  bash scripts/deploy.sh
#
# Steps: install -> build -> restart PM2 -> health check. If anything fails, it puts the previous
# build and code back and restarts, so a broken commit does not leave the site down.
#
# Optional environment variables:
#   PM2_APP    PM2 process name           (default: hr-portal)
#   APP_PORT   port the app listens on    (default: 3000)

set -euo pipefail

# Run from a temporary copy of this file. The rollback below can rewrite scripts/deploy.sh with
# "git reset --hard", and bash must not be reading the file while that happens.
if [ -z "${DEPLOY_REEXEC:-}" ]; then
  PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  TMP_COPY="$(mktemp /tmp/deploy-XXXXXX.sh)"
  cp "$0" "$TMP_COPY"
  export DEPLOY_REEXEC=1 PROJECT_ROOT
  exec bash "$TMP_COPY" "$@"
fi
trap 'rm -f "$0"' EXIT
cd "$PROJECT_ROOT"

APP="${PM2_APP:-hr-portal}"
PORT="${APP_PORT:-3000}"
PREV="${PREV_SHA:-}"
NEW="$(git rev-parse --short HEAD)"

# Only one deploy at a time.
exec 9>"/tmp/${APP}-deploy.lock"
if ! flock -n 9; then
  echo "Another deploy is already running. Aborting."
  exit 1
fi

log() { echo "[deploy $(date +%H:%M:%S)] $*"; }

# "9>&-" closes the lock file descriptor for pm2. If this deploy has to start the PM2 daemon,
# the daemon would otherwise inherit the lock and block every future deploy.
start_app() {
  if [ -f ecosystem.config.cjs ]; then
    pm2 startOrReload ecosystem.config.cjs --only "$APP" --update-env 9>&-
  else
    pm2 restart "$APP" --update-env 9>&-
  fi
}

healthy() {
  local i body
  for i in $(seq 1 20); do
    body="$(curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null || true)"
    if echo "$body" | grep -q '"status":"ok"'; then
      return 0
    fi
    sleep 2
  done
  return 1
}

rollback() {
  log "FAILED. Rolling back."
  if [ -d dist.prev ]; then
    rm -rf dist
    mv dist.prev dist
    log "Restored previous build."
  fi
  if [ -n "$PREV" ]; then
    git reset --hard "$PREV"
    npm ci --no-audit --no-fund || true
    log "Restored code and dependencies at ${PREV:0:7}."
  fi
  start_app || true
  if healthy; then
    log "Rollback complete: previous version is running again."
  else
    log "WARNING: previous version did not pass the health check either. Check: pm2 logs $APP"
  fi
  exit 1
}

log "Deploying ${NEW} (previous: ${PREV:0:7})"

# Keep the working build so we can put it back.
rm -rf dist.prev
if [ -d dist ]; then cp -a dist dist.prev; fi

log "Installing dependencies"
npm ci --no-audit --no-fund || rollback

log "Building"
npm run build || rollback

mkdir -p logs

log "Restarting $APP"
start_app || rollback

log "Health check"
healthy || rollback

pm2 save >/dev/null 2>&1 9>&- || true
rm -rf dist.prev
log "Deployed ${NEW} successfully."
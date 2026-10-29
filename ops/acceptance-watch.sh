#!/usr/bin/env bash
# Anime TCG acceptance watcher (owner request 2026-10-29).
# Every 10 minutes (scheduled task "AnimeTCG-AcceptanceWatch"): when origin/main has a newer commit
# that changes the app (web, api, shared, Caddyfile, Dockerfiles, compose, lockfile), deploy it to the
# acceptance stack on http://127.0.0.1:8180, apply its migrations (the api does that at start), load
# the card snapshot if acceptance has none, smoke-test it, and open a GitHub issue
# "Acceptance ready: <sha>" listing what to check. On failure it rolls back to the previous
# deployment and opens "Acceptance deploy failed: <sha>". Docs-only commits are never deployed.
# Production is never touched: it only runs an owner-approved tag (docs/03-release-process.md).
set -uo pipefail

BASE=/c/ProgramData/AnimeTCG
SRC=$BASE/src
ENVF=.env.acceptance.local
STATE=$BASE/acceptance-deployed
FAILED=$BASE/acceptance-failed
LOG=$BASE/acceptance-watch.log
LOCK=$BASE/.acceptance-watch.lock
SNAPDIR=/c/Users/Matrix/.anime-tcg/snapshots
URL=http://127.0.0.1:8180
REPO=ChrisDKNL/Anime-TCG
APP_PATHS=(web api shared Caddyfile Dockerfile compose.yml package.json package-lock.json .dockerignore)
export PATH="$PATH:/c/Program Files/GitHub CLI:/c/Program Files/Docker/Docker/resources/bin"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG"; }

# keep the log under ~1 MB
if [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 1000000 ]; then mv -f "$LOG" "$LOG.1"; fi

# one run at a time; a lock older than an hour is stale
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then rmdir "$LOCK"; mkdir "$LOCK" || exit 0; else exit 0; fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

docker info >/dev/null 2>&1 || { log "docker not answering; skipped"; exit 0; }
cd "$SRC" || { log "no checkout at $SRC"; exit 1; }
git fetch -q origin main 2>>"$LOG" || { log "git fetch failed; skipped"; exit 0; }

old=$(cat "$STATE" 2>/dev/null || git rev-parse HEAD)
new=$(git rev-parse origin/main)
[ "$old" = "$new" ] && exit 0
[ "$(cat "$FAILED" 2>/dev/null)" = "$new" ] && exit 0
if git diff --quiet "$old" "$new" -- "${APP_PATHS[@]}"; then
  exit 0 # docs-only since the last deployment: nothing to deploy, nothing to tell
fi

dc() { docker compose --env-file "$ENVF" --profile acceptance "$@"; }
oldtag="acceptance-$(git rev-parse --short "$old")"
newtag="acceptance-$(git rev-parse --short "$new")"
short=$(git rev-parse --short "$new")

deploy() { # $1 sha, $2 tag, $3 build|nobuild
  git checkout -q --detach "$1" || return 1
  sed -i "s/^TAG=.*/TAG=$2/" "$ENVF"
  if [ "$3" = build ]; then
    dc up -d --build --wait --wait-timeout 240 >>"$LOG" 2>&1 || return 1
  else
    dc up -d --no-build --wait --wait-timeout 240 >>"$LOG" 2>&1 || return 1
  fi
  for c in anime-tcg-db-acceptance anime-tcg-api-acceptance anime-tcg-acceptance; do
    docker update --restart unless-stopped "$c" >/dev/null 2>&1
  done
}

smoke() {
  curl -fsS -m 10 "$URL/" | grep -q '<title>Anime TCG' || { echo "GET / has no Anime TCG title"; return 1; }
  [ "$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$URL/packs")" = 200 ] || { echo "GET /packs is not 200"; return 1; }
  curl -fsS -m 10 "$URL/api/session" | grep -q '"signedIn":false' || { echo "GET /api/session is not signed out JSON"; return 1; }
  dc exec -T api-acceptance wget -qO- http://127.0.0.1:3000/healthz | grep -q '"db":"ok"' || { echo "api healthz has no db ok"; return 1; }
}

ensure_snapshot() {
  local has
  has=$(dc exec -T db-acceptance psql -U anime -d anime -tAc "select count(*) from pool_snapshots where is_current" 2>/dev/null | tr -d '[:space:]')
  [ -z "$has" ] && return 0 # no packs schema in this build
  [ "$has" != 0 ] && return 0
  local file
  file=$(ls -1 "$SNAPDIR"/snapshot-*.json 2>/dev/null | sort | tail -1)
  [ -z "$file" ] && { echo "acceptance has no card snapshot and no file in $SNAPDIR"; return 1; }
  log "loading card snapshot $(basename "$file")"
  dc exec -T api-acceptance node api/dist/cli/snapshot-pool.js --stdin <"$file" >>"$LOG" 2>&1 || { echo "snapshot load from $(basename "$file") failed"; return 1; }
}

log "deploying $new (was $old)"
reason=""
if ! deploy "$new" "$newtag" build; then
  reason="compose up --build --wait failed"
elif ! out=$(ensure_snapshot 2>&1); then
  reason="$out"
elif ! out=$(smoke 2>&1); then
  reason="smoke check failed: $out"
fi

changes=$(git log --reverse --format='- %s' "$old..$new")
compare="https://github.com/$REPO/compare/$(git rev-parse --short "$old")...$short"

if [ -n "$reason" ]; then
  log "FAILED $new: $reason; rolling back to $old"
  echo "$new" >"$FAILED"
  if deploy "$old" "$oldtag" nobuild; then rb="Rolled back to $(git rev-parse --short "$old"), which is running again."; else rb="Rollback to $(git rev-parse --short "$old") failed too: acceptance may be down."; fi
  log "$rb"
  body=$(printf 'The acceptance watcher could not deploy %s.\n\n**Reason:** %s\n\n%s\n\nChanges it tried to deploy:\n%s\n\n%s\n\nLog: `C:\\ProgramData\\AnimeTCG\\acceptance-watch.log`. The watcher does not retry this commit; the next app change on main is tried again.' \
    "$short" "$reason" "$rb" "$changes" "$compare")
  gh issue create -R "$REPO" --title "Acceptance deploy failed: $short" --body "$body" >>"$LOG" 2>&1 || log "could not open the failure issue"
  exit 1
fi

echo "$new" >"$STATE"
rm -f "$FAILED"
log "deployed $new"

# keep only the current and previous acceptance images
docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^anime-tcg-(web|api):acceptance-' |
  grep -v -e ":$newtag\$" -e ":$oldtag\$" | xargs -r docker rmi >>"$LOG" 2>&1

# notify: close earlier "Acceptance ready" issues, open a new one
for n in $(gh issue list -R "$REPO" --state open --search 'in:title "Acceptance ready:"' --json number -q '.[].number' 2>/dev/null); do
  gh issue close -R "$REPO" "$n" --comment "Superseded: acceptance now runs $short." >>"$LOG" 2>&1
done
body=$(printf 'Acceptance now runs **%s** on %s (deployed %s).\n\nWhat is new since the last acceptance build:\n%s\n\nFull diff: %s\n\nPlease check it in the browser and reply here with `acceptance ok %s`, or describe what is wrong. Testing stays on loopback; the domain is production only.' \
  "$short" "$URL" "$(date '+%F %H:%M')" "$changes" "$compare" "$short")
gh issue create -R "$REPO" --title "Acceptance ready: $short" --body "$body" >>"$LOG" 2>&1 || log "could not open the ready issue"
exit 0

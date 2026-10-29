#!/usr/bin/env bash
# Anime TCG acceptance watcher (owner request 2026-10-29; docs/03-release-process.md, "Automatic acceptance").
# Run every 10 minutes by the scheduled task "AnimeTCG-AcceptanceWatch" through acceptance-watch.ps1.
# Installed by hand as C:\ProgramData\AnimeTCG\acceptance-watch.sh; it never updates itself from the repo.
#
# When origin/main has a newer commit that changes what the images or the database are built from, it
# deploys that commit to the acceptance stack (http://127.0.0.1:8180): build and start with --wait (the api
# applies migrations at start), load the owner's newest card snapshot if acceptance has none, smoke-test,
# and open a GitHub issue "Acceptance ready: <sha>". On failure it rolls back images and code (not the
# database), smoke-tests the rollback and opens "Acceptance deploy failed: <sha>"; that commit, and any later
# commit with the same app content, is not retried. A Docker or network outage is not a failure: the next
# run tries again. Docs-only merges are never deployed. A range made only of Dependabot commits waits until
# its newest commit is 72 hours old. Production is never touched.
set -uo pipefail

BASE=/c/ProgramData/AnimeTCG
SRC=$BASE/src
ENVF=.env.acceptance.local
STATE=$BASE/acceptance-deployed      # sha of the running deployment
TAGFILE=$BASE/acceptance-tag         # its image tag (compose reads TAG from the environment, not the env file)
FAILED=$BASE/acceptance-failed       # sha that failed; not retried
PENDING=$BASE/acceptance-notify.d    # issues not opened yet, one file each: title, then body
LOG=$BASE/acceptance-watch.log
LOCK=$BASE/.acceptance-watch.lock
SNAPDIR=/c/Users/Matrix/.anime-tcg/snapshots
URL=http://127.0.0.1:8180
REPO=ChrisDKNL/Anime-TCG
OWNER=ChrisDKNL
DEPENDABOT_DELAY=$((72 * 3600))
APP_PATHS=(web api shared db Caddyfile Dockerfile compose.yml package.json package-lock.json tsconfig.base.json .dockerignore)
export PATH="$PATH:/c/Program Files/GitHub CLI:/c/Program Files/Docker/Docker/resources/bin"
TO=/usr/bin/timeout # Windows has its own timeout.exe

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG"; }
# No hook from the repo ever runs on the host: this reaches every git process, those run under timeout included.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null HUSKY=0

if [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 1000000 ]; then mv -f "$LOG" "$LOG.1"; fi

if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +90 2>/dev/null)" ]; then rmdir "$LOCK"; mkdir "$LOCK" || exit 0; else exit 0; fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

docker_up() { $TO 30 docker info >/dev/null 2>&1; }
net_up() { $TO 30 git ls-remote -q origin HEAD >/dev/null 2>&1 && $TO 15 curl -fsS -o /dev/null https://registry.npmjs.org/; }

send_issue() { # $1 queued file (title on line 1, body after it); removed once GitHub accepts it
  local title body url
  title=$(head -1 "$1")
  body=$(tail -n +2 "$1")
  if url=$($TO 60 gh issue create -R "$REPO" --title "$title" --body "$body" 2>>"$LOG"); then
    rm -f "$1"
    log "opened $url"
    $TO 30 gh issue lock -R "$REPO" "${url##*/}" >>"$LOG" 2>&1 || log "could not lock $url"
  else
    log "could not open the issue \"$title\"; retried next run"
  fi
}

open_issue() { # $1 title, $2 body: queued first, so nothing is lost while GitHub is unreachable
  mkdir -p "$PENDING"
  local f
  f="$PENDING/$(date +%s)-$$-$RANDOM"
  printf '%s\n%s' "$1" "$2" >"$f"
  send_issue "$f"
}

# notifications that failed earlier go out first, oldest first
if [ -d "$PENDING" ]; then
  for f in $(find "$PENDING" -maxdepth 1 -type f | sort); do send_issue "$f"; done
fi

docker_up || { log "docker not answering; skipped"; exit 0; }
cd "$SRC" || { log "no checkout at $SRC"; exit 1; }
$TO 120 git fetch -q origin main 2>>"$LOG" || { log "git fetch failed; skipped"; exit 0; }

old=$(cat "$STATE" 2>/dev/null) || { log "no $STATE; write the running sha there first"; exit 1; }
oldtag=$(cat "$TAGFILE" 2>/dev/null) || { log "no $TAGFILE; write the running image tag there first"; exit 1; }
new=$(git rev-parse origin/main)
[ "$old" = "$new" ] && exit 0
git diff --quiet "$old" "$new" -- "${APP_PATHS[@]}" && exit 0 # docs-only since the last deployment
if [ -f "$FAILED" ] && git diff --quiet "$(cat "$FAILED")" "$new" -- "${APP_PATHS[@]}"; then
  exit 0 # same app content as the commit that failed
fi

# Dependabot merges itself: while its newest app commit in the range is under 72 hours old, wait
newest=$(git log -1 --author='dependabot\[bot\]' --format='%ct' "$old..$new" -- "${APP_PATHS[@]}")
if [ -n "$newest" ] && [ $(($(date +%s) - newest)) -lt "$DEPENDABOT_DELAY" ]; then
  waitmark=$BASE/.acceptance-dependabot-wait
  if [ "$(cat "$waitmark" 2>/dev/null)" != "$new" ]; then
    echo "$new" >"$waitmark"
    log "$new waits for a Dependabot update until $(date -d "@$((newest + DEPENDABOT_DELAY))" '+%F %H:%M')"
  fi
  exit 0
fi

short=$(git rev-parse --short=12 "$new")
newtag="acceptance-$short"
oldshort=$(git rev-parse --short=12 "$old")

dc() { # $1 timeout in seconds, $2 image tag, then the compose arguments
  local t=$1 tag=$2
  shift 2
  TAG="$tag" $TO "$t" docker compose --env-file "$ENVF" --profile acceptance "$@"
}

deploy() { # $1 sha, $2 tag, $3 build|nobuild
  git checkout -q --detach "$1" || return 1
  local args=(up -d --wait --wait-timeout 240)
  if [ "$3" = build ]; then args+=(--build); else args+=(--no-build); fi
  dc 1800 "$2" "${args[@]}" >>"$LOG" 2>&1 || return 1
  [ "$($TO 30 docker inspect -f '{{.Config.Image}}' anime-tcg-api-acceptance 2>/dev/null)" = "anime-tcg-api:$2" ] || return 1
  [ "$($TO 30 docker inspect -f '{{.Config.Image}}' anime-tcg-acceptance 2>/dev/null)" = "anime-tcg-web:$2" ] || return 1
  for c in anime-tcg-db-acceptance anime-tcg-api-acceptance anime-tcg-acceptance; do
    $TO 30 docker update --restart unless-stopped "$c" >/dev/null 2>&1
  done
}

smoke() {
  local html asset
  html=$($TO 15 curl -fsS "$URL/" 2>>"$LOG") || { echo "GET / failed"; return 1; }
  grep -q '<title>Anime TCG' <<<"$html" || { echo "GET / has no Anime TCG title"; return 1; }
  asset=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' <<<"$html" | head -1)
  [ -n "$asset" ] || { echo "GET / names no script bundle"; return 1; }
  [ "$($TO 15 curl -s -o /dev/null -w '%{http_code}' "$URL$asset")" = 200 ] || { echo "the script bundle $asset is not 200"; return 1; }
  grep -q '"signedIn":false' <<<"$($TO 15 curl -fsS "$URL/api/session" 2>>"$LOG")" || { echo "GET /api/session is not signed-out JSON"; return 1; }
  grep -q '"db":"ok"' <<<"$(dc 30 "$1" exec -T api-acceptance wget -qO- http://127.0.0.1:3000/healthz 2>>"$LOG")" || { echo "the api health probe has no db ok"; return 1; }
}

ensure_snapshot() { # $1 tag
  local has file
  has=$(dc 30 "$1" exec -T db-acceptance psql -U anime -d anime -tAc \
    "select case when to_regclass('pool_snapshots') is null then 'none' else (select count(*)::text from pool_snapshots where is_current) end" 2>>"$LOG" | tr -d '[:space:]')
  case "$has" in
    none) return 0 ;; # this build has no card pool yet
    0) ;;
    [1-9]*) return 0 ;;
    *) echo "could not read the card pool state from the database"; return 1 ;;
  esac
  file=$(find "$SNAPDIR" -maxdepth 1 -name 'snapshot-*.json' 2>/dev/null | sort | tail -1)
  [ -n "$file" ] || { echo "acceptance has no card snapshot and the owner's snapshot folder has no file"; return 1; }
  log "loading card snapshot $(basename "$file")"
  dc 600 "$1" exec -T api-acceptance node api/dist/cli/snapshot-pool.js --stdin <"$file" >>"$LOG" 2>&1 || { echo "loading the card snapshot $(basename "$file") failed"; return 1; }
}

log "deploying $new (was $old)"
reason=""
if ! deploy "$new" "$newtag" build; then
  reason="compose up --build --wait did not bring up $newtag"
elif ! out=$(ensure_snapshot "$newtag" 2>&1); then
  reason="$out"
elif ! out=$(smoke "$newtag" 2>&1); then
  reason="smoke check failed: $out"
fi

changes=$(git log --reverse --format='- %s' "$old..$new")
compare="https://github.com/$REPO/compare/$oldshort...$short"

if [ -n "$reason" ]; then
  if ! docker_up || ! net_up; then
    log "transient: $reason, with docker or the network not answering; retried next run"
    exit 0
  fi
  log "FAILED $new: $reason; rolling back to $old ($oldtag)"
  echo "$new" >"$FAILED"
  if deploy "$old" "$oldtag" nobuild && smoke "$oldtag" >/dev/null 2>&1; then
    rb="Rolled back to $oldshort, which is running again and passes the smoke checks. The database is not rolled back: if this commit's migrations ran, the older build runs on the newer schema."
  else
    rb="The rollback to $oldshort did not pass the smoke checks either: acceptance may be down."
  fi
  log "$rb"
  open_issue "Acceptance deploy failed: $short" "$(printf 'The acceptance watcher could not deploy %s.\n\n**Reason:** %s\n\n%s\n\nChanges it tried to deploy:\n%s\n\n%s\n\nThe watcher log on the dev station has the details. This commit, and any later one with the same app content, is not retried; the next app change on main is.' \
    "$short" "$reason" "$rb" "$changes" "$compare")"
  exit 1
fi

# the tag first, so a crash in between never pairs a new sha with an old tag
echo "$newtag" >"$TAGFILE.new" && mv -f "$TAGFILE.new" "$TAGFILE"
echo "$new" >"$STATE.new" && mv -f "$STATE.new" "$STATE"
rm -f "$FAILED"
log "deployed $new as $newtag"

# keep only the current and previous acceptance images (never another project's)
$TO 30 docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^anime-tcg-(web|api):acceptance-' |
  grep -v -e ":$newtag\$" -e ":$oldtag\$" | xargs -r "$TO" 120 docker rmi >>"$LOG" 2>&1

for n in $($TO 60 gh issue list -R "$REPO" --state open --author "@me" --search 'in:title "Acceptance ready:"' --json number -q '.[].number' 2>/dev/null); do
  $TO 60 gh issue close -R "$REPO" "$n" --comment "Superseded: acceptance now runs $short." >>"$LOG" 2>&1
done
open_issue "Acceptance ready: $short" "$(printf 'Acceptance now runs **%s** on %s (deployed %s).\n\nWhat is new since the last acceptance build:\n%s\n\nFull diff: %s\n\n@%s: please check it in the browser and reply with `acceptance ok %s`, or describe what is wrong. Only the owner'"'"'s reply counts; the issue is locked to collaborators. Testing stays on loopback; the domain is production only.' \
  "$short" "$URL" "$(date '+%F %H:%M')" "$changes" "$compare" "$OWNER" "$short")"
exit 0

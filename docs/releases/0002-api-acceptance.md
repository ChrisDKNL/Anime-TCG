# API acceptance handoff — Sprint 1a backend foundation

Candidate: commit `eda4968f84c7c8f95da663482324252d9a7b9b84` on `main` (PR #13 plus its hardening follow-up #20 and the GitHub-flow sync #21; `main` CI green on that commit). This is an **acceptance run of the API stack**, not a production release: Sprint 1 is complete only after 1b (accounts) and 1c (server-side collection), so there is no release-candidate tag yet. Security tier of what is being run: T3 (`docs/05-security.md`, rows for #13 and #20).

---

You are the local Claude Code session on the dev station. This is an **acceptance run of the three-container stack** (caddy, api, db), not a production deploy. Do the steps in order and stop at every "WAIT". Report real command output, not summaries.

## 0. Ground rules

- Use only the deployment files in the repository (`Dockerfile`, `api/Dockerfile`, `Caddyfile`, `compose.yml`, `.env.example`, `docs/04-deployment.md`). Do not use any Dockerfile or compose file of your own.
- Do not merge, push to `main`, or edit `.github/`.
- Acceptance is **local only**: Caddy is bound to `127.0.0.1:8080`, the api and the database publish nothing. Do not change the bind address, do not add a proxy or tunnel route to it, do not forward a port to it.
- The `.env.acceptance.local` file you create holds secrets. It is gitignored; never paste its contents, only the names of the variables you set.
- If any step fails, paste the full error and stop. Do not patch files locally; report it so the fix goes through the normal gate.

## 1. Check out the candidate

```bash
git fetch origin
git checkout --detach eda4968f84c7c8f95da663482324252d9a7b9b84
test "$(git rev-parse HEAD)" = "eda4968f84c7c8f95da663482324252d9a7b9b84" || { echo "wrong commit, stop"; exit 1; }
```

Detached at the exact reviewed commit. Do not check out `main` by name.

## 2. Stop the previous acceptance container

The bootstrap run (`docs/releases/0001-acceptance-bootstrap.md`) left a single-container acceptance stack running from an older commit. Remove it first so the port and the container name are free:

```bash
docker rm -f anime-tcg-acceptance 2>/dev/null || true
docker ps -a --filter name=anime-tcg- --format '{{.Names}} {{.Status}}'
```

Expected: no `anime-tcg-*` containers listed (production has never been started).

## 3. Environment file

```bash
cp .env.example .env.acceptance.local
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env.acceptance.local
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env.acceptance.local
sed -i "s|^TAG=.*|TAG=acceptance-$(git rev-parse --short HEAD)|" .env.acceptance.local
grep -E '^(TAG|ACCEPTANCE_PORT|WEB_ORIGIN|LOG_LEVEL)=' .env.acceptance.local
git status --short   # must print nothing: the env file is ignored
```

`WEB_ORIGIN` stays `http://127.0.0.1:8080`. Report only the four non-secret lines.

## 4. Build and start

```bash
docker compose --env-file .env.acceptance.local --profile acceptance up -d --build --wait --wait-timeout 180
docker compose --env-file .env.acceptance.local --profile acceptance ps
```

Expected: `anime-tcg-db-acceptance`, `anime-tcg-api-acceptance` and `anime-tcg-acceptance` all `healthy`. Paste the `ps` table and the image build times.

## 5. Smoke checks (paste every output)

Exposure and hardening, the part the CI `docker` job also asserts:

```bash
docker port anime-tcg-acceptance                 # 8080/tcp -> 127.0.0.1:8080, nothing else
docker port anime-tcg-api-acceptance             # prints nothing
docker port anime-tcg-db-acceptance              # prints nothing
for c in anime-tcg-acceptance anime-tcg-api-acceptance anime-tcg-db-acceptance; do
  docker inspect "$c" --format '{{.Name}} readonly={{.HostConfig.ReadonlyRootfs}} pids={{.HostConfig.PidsLimit}} user={{.Config.User}} capdrop={{.HostConfig.CapDrop}} secopt={{.HostConfig.SecurityOpt}}'
done
```

Expected: `readonly=true`, `capdrop=[ALL]`, `secopt=[no-new-privileges:true]`, users `web` / `api` / `postgres`, pids 64 / 64 / 128.

Through Caddy:

```bash
curl -fsS http://127.0.0.1:8080/healthz; echo
curl -fsS http://127.0.0.1:8080/ | grep -o '<title>[^<]*</title>'
curl -sI http://127.0.0.1:8080/ | grep -iE '^(content-security-policy|x-content-type-options|referrer-policy|server|via):'
curl -sD - http://127.0.0.1:8080/api/session | tr -d '\r' | grep -iE '^(HTTP|cache-control|x-content-type-options|server|via|set-cookie):|^\{'
curl -s -o /dev/null -w 'POST without Origin: %{http_code}\n' -X POST http://127.0.0.1:8080/api/session
curl -s -o /dev/null -w 'POST with foreign Origin: %{http_code}\n' -X POST -H 'Origin: https://evil.example' http://127.0.0.1:8080/api/session
curl -s -o /dev/null -w 'unknown route: %{http_code}\n' http://127.0.0.1:8080/api/nope
```

Expected: `ok`; `<title>Anime TCG — Booster Packs</title>`; a CSP header, `nosniff`, `strict-origin-when-cross-origin`, and **no** `server` or `via` line on either response; `/api/session` → `HTTP/1.1 200`, `cache-control: no-store`, no `set-cookie`, body `{"signedIn":false}`; both POSTs `403`; unknown route `404`.

Inside the stack:

```bash
docker compose --env-file .env.acceptance.local --profile acceptance exec -T api-acceptance wget -qO- http://127.0.0.1:3000/healthz; echo
docker compose --env-file .env.acceptance.local --profile acceptance exec -T db-acceptance psql -U anime -d anime -c '\dt'
docker compose --env-file .env.acceptance.local --profile acceptance exec -T api-acceptance test ! -e node_modules/typescript && echo "no dev modules in the api image"
```

Expected: `{"status":"ok","db":"ok"}`; a table list containing `sessions` and the migrations bookkeeping table (the api applied `0000_create_sessions.sql` at start-up); the dev-modules line.

Rate limiter keyed per client (the fix #20 exists for). From the host, Caddy sees a private-range peer and therefore trusts `X-Forwarded-For`, so two forged clients can be told apart:

```bash
for i in $(seq 1 101); do curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Forwarded-For: 203.0.113.9' http://127.0.0.1:8080/api/session; done | sort | uniq -c
curl -s -o /dev/null -w 'other client after the flood: %{http_code}\n' -H 'X-Forwarded-For: 203.0.113.10' http://127.0.0.1:8080/api/session
curl -s -H 'X-Forwarded-For: 203.0.113.9' http://127.0.0.1:8080/api/session; echo
docker compose --env-file .env.acceptance.local --profile acceptance logs --no-color api-acceptance | grep -c '"remoteAddress":"203.0.113.9"'
```

Expected: `100 200` and `1 429` for the first client; `200` for the other client; the 429 body is `{"error":{"code":"rate_limited","message":"Too many requests; slow down"}}`; the log count is greater than zero (the api logged the forwarded address, not the Docker gateway). Wait one minute before step 6 so the bucket empties.

Secrets stay out of the logs:

```bash
docker compose --env-file .env.acceptance.local --profile acceptance logs --no-color api-acceptance | grep -c "$(grep '^SESSION_SECRET=' .env.acceptance.local | cut -d= -f2-)"
docker compose --env-file .env.acceptance.local --profile acceptance logs --no-color api-acceptance | grep -c "$(grep '^POSTGRES_PASSWORD=' .env.acceptance.local | cut -d= -f2-)"
```

Expected: `0` and `0`.

Then open http://127.0.0.1:8080 in a headless browser (Playwright is fine) and confirm the page loads with zero console errors and a booster pack opens to five cards. Paste the console output.

## 6. WAIT: owner verification

Ask the owner to open http://127.0.0.1:8080 and check:

- [ ] I can open a booster pack and see five cards; the collection survives a reload (still browser-side, as before)
- [ ] The browser's network tab shows `GET /api/session` answering `{"signedIn":false}` on page load, with no `Set-Cookie`
- [ ] Nothing in the UI mentions accounts, login, money or buying: the account flow is Sprint 1b, not this candidate
- [ ] The smoke-check output above shows the rate limiter telling two clients apart and the database reachable only from the api

Reply **"acceptance ok eda4968"** or **"acceptance rejected eda4968: <reason>"**.

## 7. After the verdict

- On **ok**: leave the acceptance stack running. Post one comment on the pull request for `docs/release-0002-api-acceptance` with the image build times, the smoke-check output (step 5, secrets-free by construction) and "API acceptance verified by owner on <date>". Do not start the `production` profile: the first production release waits for Sprint 1 to complete and follows `docs/03-release-process.md` with a tag.
- On **rejected**: `docker compose --env-file .env.acceptance.local --profile acceptance down --volumes`, post the owner's reason on the same pull request, and stop.

## What is in this candidate

- The api (`api/`): Fastify 5 with TypeBox schemas that reject unknown fields, the `{error:{code,message}}` envelope on every error path including Node-level client errors, HMAC-at-rest server sessions behind a `__Host-session` cookie (no session is created until 1b signs someone in), CSRF origin check, rate limit of 100 per minute per forwarded client address with per-route overrides honoured, redacted pino logs, Drizzle migrations applied at start-up, graceful shutdown, `/healthz` with a database probe.
- Caddy as reverse proxy for `/api/*` with `trusted_proxies static private_ranges`, request timeouts, the strict CSP, no `Server` or `Via` header.
- Compose: three hardened containers, `front`/`back` networks with the database on an internal network, log rotation, loopback-only publish with no override.
- Tests: 97 api unit, 122 route and adversarial (`api/test/security/*`), the CI `api-tests` job (now a required check), the CI `docker` job asserting the hardening and headers.

## What is NOT in it

- No accounts, no login, no invite codes (1b). `/api/session` always answers signed-out.
- No server-side collection, packs or currency (1c). The game is still the browser-local proof of concept and is not protected from manipulation; that is why Sprint 1 exists.
- No production deploy and no release tag.
- No TLS in the stack; TLS is the proxy's or the tunnel's job, and the tunnel-vs-port-forward decision (C15) is still open.

## Known limitations

- A visitor whose own address is in a private range (anyone on the LAN reaching the host proxy directly) can choose its own rate-limit key by setting `X-Forwarded-For`, because private hops are trusted. Internet visitors cannot. Recorded in `docs/05-security.md`; revisited with the C15 decision. On loopback acceptance this is exactly what makes the step 5 test possible.
- Migrations are forward-only; the only one so far creates the `sessions` table.
- First page load after a cold cache calls AniList once; on HTTP 429 the UI shows a retry banner.

---

## Verdict

_Pending: the owner runs the handoff above and the verdict is recorded here by the next session._

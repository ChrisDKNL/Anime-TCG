# Acceptance bootstrap handoff — Anime TCG

Candidate: commit `f13baf220326306a7a016f804ae1dd4ed4d1c38e` on branch `feat/deployment-files` (PR #9). This is `main` at `ad2eb7f` plus the reviewed deployment files. It is a pull request, not a release tag, because this is the first boot of the acceptance environment, not a production release. The one commit after it on the branch only edits this handoff file.

---

You are the local Claude Code session on the dev station. This is a **bootstrap of the acceptance environment**, not a production deploy. Do the steps in order and stop at every "WAIT". Report real command output, not summaries.

## 0. Ground rules

- Use only the deployment files in the repository (`Dockerfile`, `Caddyfile`, `compose.yml`, `docs/04-deployment.md`). If you have a Dockerfile or compose file of your own from earlier, do not use it; if it does something the repo's files don't, say what, so the manager can fold it in.
- Do not merge, push to `main`, or edit `.github/`.
- The acceptance container is **local only**: the compose file binds it to `127.0.0.1:8080`, so it is reachable from the dev station and nothing else. Do not change the bind address, do not add a proxy or tunnel route to it, do not forward a port to it. Verify after start: `docker port anime-tcg-acceptance` must show `127.0.0.1:8080`.

## 1. Check out the candidate

```bash
git fetch origin
git checkout --detach f13baf220326306a7a016f804ae1dd4ed4d1c38e
test "$(git rev-parse HEAD)" = "f13baf220326306a7a016f804ae1dd4ed4d1c38e" || { echo "wrong commit, stop"; exit 1; }
```

The checkout is the exact reviewed commit, detached. Do not check out the branch name: anything pushed later would be unreviewed.

## 2. Build and start acceptance

```bash
TAG=acceptance-$(git rev-parse --short HEAD) docker compose --profile acceptance up -d --build
docker compose --profile acceptance ps
```

If the build fails, paste the full error and stop. Do not patch the Dockerfile locally; report it.

## 3. Smoke checks (paste output)

```bash
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/ | grep -o '<title>[^<]*</title>'
curl -sI http://127.0.0.1:8080/ | grep -iE 'content-security-policy|x-content-type-options|referrer-policy|server'
docker inspect --format '{{.State.Health.Status}}' anime-tcg-acceptance
```

Expected: `ok`; `<title>Anime TCG — Booster Packs</title>`; a CSP header present and no `Server` header; `healthy`.

Then open http://127.0.0.1:8080 in a headless browser (Playwright is fine) and confirm: the page loads with zero console errors, the "Open Booster Pack" button becomes enabled (this calls the real AniList API, once, then caches for 24 h), and clicking it shows five cards. Paste the console output.

## 4. WAIT: owner verification

Ask the owner to open http://127.0.0.1:8080 and check:

- [ ] I can open a booster pack and see five cards with name, anime, and a rarity badge
- [ ] A second pack adds to the collection count in the header
- [ ] The Collection tab shows the cards, duplicates are grouped with ×N, the rarity filter works
- [ ] A browser reload keeps the collection
- [ ] Nothing in the UI mentions money, buying, or security

Reply **"acceptance ok f13baf2"** or **"acceptance rejected f13baf2: <reason>"**.

## 5. After the verdict

- On **ok**: leave the acceptance container running, and post one comment on the pull request for `feat/deployment-files` with: the image build time, the smoke-check output, and "Acceptance verified by owner on <date>". That comment is the evidence the manager needs before the PR is merged.
- On **rejected**: `docker compose --profile acceptance down`, post the owner's reason on the same pull request, and stop.

## What is in this candidate

- `main` as of `ad2eb7f`: the booster-pack app with a browser-local collection (proof of concept; everything will move server-side per ADR 0008, which is in PR #8).
- Deployment files (ADR 0010): multi-stage Dockerfile (Node 22 build, Caddy 2 on port 8080 as non-root, file capability stripped so it runs under `cap_drop: ALL`, healthcheck), Caddyfile with a strict CSP and security headers, `compose.yml` with loopback-only `acceptance` and `production` profiles and full hardening, CI job that builds and runs the acceptance profile and asserts the hardening and the exact CSP.

## What is NOT in it

- No backend, no accounts, no currency. The collection lives in the browser's localStorage and is not protected from manipulation; that is known and is the reason for Sprint 1.
- No production deploy. The `production` profile exists but is not to be started until a tagged release goes through `docs/03-release-process.md` (on PR #8 until it merges).
- No TLS inside the container. TLS is the proxy's or the tunnel's job.

## Known limitations

- First page load after a cold cache calls AniList once; if AniList rate-limits (HTTP 429) the UI shows a retry banner. Wait a minute and retry.
- The container trusts nothing from the client because there is no server state to trust; that cuts both ways.

---

## Verdict

**Acceptance OK, 2026-10-28.** The owner's local Claude Code session followed the handoff from the repository's own deployment files, the acceptance container came up on loopback, and the owner verified the checklist in the browser. The deployment files merged to `main` in PR #9 (squash `b584b9c`). This bootstrap did not deploy production; the first production release follows `docs/03-release-process.md` once Sprint 1 is complete.

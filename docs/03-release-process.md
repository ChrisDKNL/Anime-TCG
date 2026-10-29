# Release Process: sprint → acceptance → production

How finished work gets in front of the owner for approval and then into production. Two Claude sessions are involved: the **cloud manager** (this repo's workflow owner) and the **local Claude Code** on the owner's dev station, which runs Docker, maintenance, an acceptance instance and production.

## Environments

| Environment | Where                             | Runs                            | Who updates it                 |
| ----------- | --------------------------------- | ------------------------------- | ------------------------------ |
| Preview     | Vite dev server / CI              | any branch                      | anyone                         |
| Acceptance  | Docker on the dev station         | the newest app change on `main` | the acceptance watcher (below) |
| Production  | Docker on the dev station, public | the last approved release tag   | local Claude Code              |

Deployment files (`Dockerfile`, `compose.yml`, proxy config without secrets) must live in this repo (roadmap item 0.2). Until they do, the first handoff asks the local session to commit them on a branch and open a PR.

## Automatic acceptance

Since 2026-10-29 (owner's request) acceptance follows `main` on its own; the local session no longer deploys it by hand. A scheduled task on the dev station, `AnimeTCG-AcceptanceWatch`, runs `ops/acceptance-watch.sh` through `ops/acceptance-watch.ps1` every 10 minutes while the owner is logged on. Both are installed by hand in `C:\ProgramData\AnimeTCG\`; the watcher never updates itself from the repo, so a change to it reaches the dev station only when the owner (or the local session at the owner's request) copies it there. When `origin/main` has a commit that changes what the images or the database are built from (`web/`, `api/`, `shared/`, `db/`, `Caddyfile`, a Dockerfile, `compose.yml`, `package.json`, the lockfile, `tsconfig.base.json` or `.dockerignore`) since the last deployment, it:

1. checks the commit out in the acceptance checkout with git hooks disabled, builds it as `acceptance-<12-character sha>` (the tag is passed in the environment; the env file with the secrets is never edited) and starts the stack with `--wait` (the api applies pending migrations at start), then checks that the running containers carry the new tag;
2. loads the newest card snapshot file from the owner's snapshot folder if acceptance has no current snapshot;
3. smoke-tests `/` (title and script bundle), `/api/session` and the api's own health probe;
4. on success, closes the previous `Acceptance ready: <sha>` issue and opens a new one listing the merged changes, locked to collaborators, which notifies the owner. Only the owner's reply counts: `acceptance ok <sha>` or what is wrong. The verdict is recorded in a `docs/releases/` note as before;
5. on failure, rolls back the images and the code (not the database: the older build then runs on the newer schema) and smoke-tests the rollback, then opens `Acceptance deploy failed: <sha>` with the reason. It does not retry that commit, or a later one with the same app content; the next app change is tried. If Docker or git stops answering during a deploy, the run counts as an outage, not a failure, and the next run tries again.

Docs-only merges are not deployed and notify nobody. A range made only of Dependabot's auto-merged commits waits until its newest commit is 72 hours old. An issue that GitHub refuses (offline, an expired token) is retried on the next run. It keeps the current and previous acceptance images and removes older `anime-tcg-(web|api):acceptance-*` tags only. Production is untouched: it still runs only an owner-approved tag, deployed through the handoff below.

## Sprint

A sprint is a named batch of roadmap items. It is finished when every item's PR is merged to `main`, CI is green on `main`, and the roadmap rows say `shipped`. The manager then:

1. Tags the release candidate: `git tag -a vX.Y.Z-rc.N <main sha> -m "<sprint name>"` and pushes the tag (tags are not covered by the `main` ruleset; the manager may push them).
2. Writes the handoff prompt (template below) to `docs/releases/vX.Y.Z.md` and gives it to the owner.
3. The owner pastes the prompt into the local Claude Code session.

## The handoff prompt (template)

```
Release handoff: <sprint name> — candidate <tag> (<sha>)

You are the local Claude Code session on the dev station. Do the following in order and stop at every "WAIT".

1. Fetch and check out the candidate: git fetch --tags origin && git checkout <tag>
2. Acceptance follows main automatically ("Automatic acceptance"). If it already runs the candidate's sha,
   use it; otherwise disable the task AnimeTCG-AcceptanceWatch first, deploy the candidate to acceptance
   (compose profile "acceptance") with TAG set in the environment, and re-enable the task afterwards.
   Report the acceptance URL.
3. Run the smoke checks below against acceptance and paste the results.
4. WAIT: ask the owner to verify the acceptance checklist below in the browser and to reply
   "approved <tag>" or "rejected <tag>: <reason>".
5. On "approved": tag the release (git tag -a vX.Y.Z <sha> -m "approved by owner <date>" && git push origin vX.Y.Z),
   build the production image from that tag, deploy it to the production stack, run the smoke
   checks against production, and report. Keep the previous production image for rollback.
6. On "rejected": stop the acceptance stack, open an issue titled "Release vX.Y.Z rejected: <reason>"
   with the owner's words, and report. Do not deploy.

Rollback: redeploy the previous production tag (<previous tag>) with the same compose command.

Smoke checks (automated):
- GET / returns 200 and the page title contains "Anime TCG"
- the JS bundle loads without console errors (Playwright, or curl + grep for the asset path)
- <sprint-specific checks: one line each>

Acceptance checklist (owner, in the browser):
- <one line per user-visible change in the sprint, phrased as "I can …">
- <one line per bug fixed, phrased as "… no longer happens">

What is in this release: <PR links, one line each>
What is NOT in this release: <deferred items, so the owner does not look for them>
Known limitations: <from the specs' "Out of scope" and the ADR caveats>
```

## Rules

- Production only ever runs a tag that the owner approved in an acceptance round. No tag, no deploy.
- The local session never merges PRs or pushes to `main`; it deploys what `main` already contains.
- The manager never deploys; it hands off.
- Every release gets a `docs/releases/vX.Y.Z.md` with the prompt and the owner's verdict, so a future session can see what went live when.
- A rejected release goes back through the normal gate as fixes on a branch; the next candidate is `-rc.N+1`.

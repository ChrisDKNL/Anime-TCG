# GitHub Flow

What is enforced, by what, and the one-time setup you (the repo owner) have to do because it needs admin rights.

## The flow

1. Branch off `main`: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`.
2. Commit. **Pre-commit** (Husky + lint-staged) lints and format-checks staged files.
3. Push. **Pre-push** (Husky) runs `npm run check`: format, lint, typecheck, unit tests, build. A failure aborts the push.
4. Open a pull request against `main` using the template. **CI** runs five required jobs:
   - `quality` — format, lint, typecheck, unit tests + coverage, build
   - `e2e` — Playwright against a mocked AniList
   - `security` — `npm audit` (high+) and a gitleaks secret scan
   - `docker` — builds the image, starts it and smoke-tests `/healthz`, the app's `<title>` and the exact `Content-Security-Policy` header (`docs/04-deployment.md`)
   - `api-tests` — the API's route tests and `*.security.test.ts` adversarial suites against a real Postgres
5. The branch ruleset blocks the merge button until all five are green on the branch's own head and every review thread is resolved. The branch does not have to contain the latest `main` (see _Keeping branches current_ below); it does have to merge without conflicts.
6. **You merge.** Squash or merge commit, then delete the branch. Nothing else can merge: there are no bypass actors in the ruleset, and `CLAUDE.md` forbids the manager from calling the merge API. The one exception is Dependabot auto-merge, below.

### Dependabot auto-merge

Owner decision 2026-10-28: Dependabot pull requests merge without a human click when, and only when, every required check is green. `.github/workflows/dependabot-auto-merge.yml` enables GitHub's auto-merge (squash) on qualifying PRs. The workflow can only ask GitHub to merge; the ruleset decides. If the PR is already green, `gh` merges it on the spot; otherwise GitHub merges once the required checks pass. Either way it is the ruleset being satisfied, never the workflow bypassing it.

Merges automatically:

- Patch and minor updates in any ecosystem: `version-update:semver-patch` / `semver-minor`, the highest change in the PR as reported by `dependabot/fetch-metadata`
- `github-actions` bumps including majors (branch name `dependabot/github_actions/...`), except the two security controls below

Does not:

- Major updates in `npm`; a grouped PR that contains one major counts as major
- ESLint 10 is not even proposed: `.github/dependabot.yml` ignores majors of `eslint` and `@eslint/js` until `eslint-plugin-jsx-a11y` supports it (peer range `^3..^9`, verified 2026-10-28)
- Majors of `gitleaks/gitleaks-action` and `dependabot/fetch-metadata` (security review 2026-10-28): a gitleaks major can stop scanning and still report green, and a fetch-metadata major changes the verification this very workflow relies on
- `docker` bumps, in practice: a digest-only bump has no `update-type`, and a tag change such as `22-alpine` → `26-alpine` (#10) parses as major, so both stay manual
- Anything whose required checks fail or whose branch conflicts with `main`: auto-merge waits, and Dependabot rebases on conflict or at its next scheduled run
- Anything not opened by `dependabot[bot]` in this repository: the job is skipped, and `fetch-metadata` additionally leaves its outputs empty unless the PR author and the first commit's author are `dependabot[bot]` and that commit's signature is verified

Two things to know:

- Once auto-merge is enabled on a PR it stays enabled through later pushes by a user with write access, which today is only you. Pushing to a Dependabot branch yourself does not cancel the merge; disable auto-merge on the PR first if you want to look.
- PRs that were already open when the workflow landed only get auto-merge on their next `pull_request` event: comment `@dependabot rebase`, or close and reopen.

Prerequisites, both done by the owner on 2026-10-28: **Settings → General → Pull Requests → Allow auto-merge** is enabled (without it `gh pr merge --auto` fails and every Dependabot PR stays manual, the safe failure), and `docker` is a required check in the live ruleset (one-time setup, step 2 below). The second matters because without it an image-breaking base-image or Caddy bump that passes `quality`, `e2e` and `security` could auto-merge.

### Keeping branches current

Owner decision 2026-10-28: the ruleset no longer requires a branch to contain the latest `main` before it can merge (`strict_required_status_checks_policy: false` in `.github/rulesets/main-protection.json`, changed in the live ruleset the same day). With that setting on, every merge made every other open pull request "out of date", each needing a manual **Update branch** click and a full CI rerun before its merge button came back; with four Dependabot PRs and one feature PR open at once that was a click-and-wait loop with no end.

What the setting bought and what replaces it:

- It guaranteed that the checks you see ran against exactly the tree that `main` will become. Without it, two PRs that are each green against an older `main` can combine into a red `main` (for example one renames a function the other calls). GitHub still refuses a merge with textual conflicts; it is only the semantic case that gets through. Put plainly: a PR's checks have no expiry, so an old green PR merges into today's `main` without a rerun.
- The `push: main` CI run is the backstop: it runs the same five jobs on every merge. A red `main` is fixed forward with a `fix/` PR, never by force-pushing `main` (the ruleset forbids it anyway). The manager checks the `main` run after each merge it asked for and reports a failure immediately. Production is only ever built by hand from a date-tagged commit (`docs/04-deployment.md`), and only from one whose `main` run is green, so a red `main` cannot ship on its own.
- For a change where the combination risk is real (a refactor touching code another open PR also edits), the manager merges `main` into the branch before marking the PR ready and says so in the PR; that is a judgement call, not a rule.

Why not a merge queue: GitHub's merge queue would restore the guarantee without the clicks (it builds each candidate on top of the queue ahead of it), but it is only offered on public repositories owned by an **organization**, or private ones on GitHub Enterprise Cloud ([managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue), verified 2026-10-28). This repository is owned by a personal account, where the `merge_queue` ruleset rule is rejected on import and the **Require merge queue** option does not appear. Making the repository private would not help; it would also lose the free CodeQL and Dependabot features. The one route to a queue is transferring the repository to a free organization; not worth it for a solo project today. Revisit if red-`main` incidents actually happen.

## Layers of enforcement

| Layer       | Stops                                                       | Can be bypassed by                     | Backstop                      |
| ----------- | ----------------------------------------------------------- | -------------------------------------- | ----------------------------- |
| Pre-commit  | Unformatted / lint-failing staged files                     | `git commit --no-verify`               | Pre-push, CI                  |
| Pre-push    | Pushing a branch whose checks fail                          | `git push --no-verify`                 | CI + ruleset                  |
| CI          | Nothing by itself — it reports                              | Editing the workflow (visible in diff) | Ruleset requires its checks   |
| Ruleset     | Merging without green CI, direct pushes, force-push, delete | Nobody (no bypass actors)              | —                             |
| `CLAUDE.md` | The manager merging or pushing to `main`                    | A future session ignoring it           | Ruleset (still needs a human) |

The git hooks are a convenience for fast feedback; the ruleset is the real gate. "Changes only get pushed after a successful test and check" is true at the hook level for anyone who installed the hooks (`npm install` does it via `prepare`), and true at the `main` level for everyone via the ruleset.

## One-time setup (needs repo admin: you)

> **Status: done on 2026-10-28** via the GitHub API with a fine-grained token scoped to this repo (Administration, Contents, Pull requests, Workflows). `main` is the default branch, the ruleset is active (id 26049188), Dependabot alerts + security updates and CodeQL default setup are on, and head branches auto-delete after merge. The steps below are kept for reference and for re-creating the setup.

The feature branch was the first push, so GitHub made it the default branch. These steps create `main` and protect it. They are not automated because they require admin rights and because the manager never pushes to `main`.

### 1. Create `main` from the current branch and make it default

```bash
git fetch origin
git checkout -b main origin/claude/anime-card-game-dapaop
git push -u origin main
```

Then **Settings → General → Default branch** → switch to `main`.

### 2. Import the ruleset

**Settings → Rules → Rulesets → New ruleset ▾ → Import a ruleset** → upload `.github/rulesets/main-protection.json`. Review and **Create**.

What it enforces on `main`: pull request required, all review threads resolved, required checks `quality` / `e2e` / `security` / `docker` / `api-tests` green on the branch head (not required to be up to date with `main`, see _Keeping branches current_), linear history, no force-push, no deletion, no bypass actors.

The ruleset was imported before the `docker` and `api-tests` jobs existed; `docker` was added to the required checks by hand on 2026-10-28 (**Settings → Rules → Rulesets → Protect main → Require status checks to pass**). `api-tests` (Sprint 1a) was found missing from the live ruleset in the security review of #21 and must be added the same way: until it is, an API security-test failure does not block a merge. If you ever re-import the JSON, it includes both.

### 3. Decide on the approval count

The ruleset ships with `required_approving_review_count: 0`. Reason: GitHub does not let a pull request's author approve their own PR, and PRs the manager opens are authored by **your** account (the GitHub connector acts as you). With a count of 1 you would be unable to merge anything you did not get a second human to approve.

"Approved by a human" is therefore enforced as: only a human can click **Merge**, and the ruleset guarantees that click is the only way in. If you ever add a collaborator, or if PRs start showing as authored by a bot account, raise the count to 1 and enable _Require review from Code Owners_ (the `CODEOWNERS` file already names you).

### 4. Optional, recommended

- **Settings → Code security** → enable _Dependabot alerts_, _Dependabot security updates_ and _CodeQL default setup_. All free for public repos; no workflow file needed.
- **Settings → General → Pull Requests** → _Automatically delete head branches_.

## Verifying the setup

Open a trivial PR (a typo fix). You should see five required checks, a blocked merge button until they pass, and the button turning green only for you. Try `git push origin main` from a clone: it must be rejected.

Verified as of 2026-10-28 against GitHub's ruleset import format; if the import rejects the JSON after a GitHub change, recreate the same rules by hand from the list in step 2.

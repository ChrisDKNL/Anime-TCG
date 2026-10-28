# GitHub Flow

What is enforced, by what, and the one-time setup you (the repo owner) have to do because it needs admin rights.

## The flow

1. Branch off `main`: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`.
2. Commit. **Pre-commit** (Husky + lint-staged) lints and format-checks staged files.
3. Push. **Pre-push** (Husky) runs `npm run check`: format, lint, typecheck, unit tests, build. A failure aborts the push.
4. Open a pull request against `main` using the template. **CI** runs three required jobs:
   - `quality` — format, lint, typecheck, unit tests + coverage, build
   - `e2e` — Playwright against a mocked AniList
   - `security` — `npm audit` (high+) and a gitleaks secret scan
5. The branch ruleset blocks the merge button until all three are green, the branch is up to date with `main`, and every review thread is resolved.
6. **You merge.** Squash or merge commit, then delete the branch. Nothing else can merge: there are no bypass actors in the ruleset, and `CLAUDE.md` forbids the manager from calling the merge API.

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

What it enforces on `main`: pull request required, all review threads resolved, required checks `quality` / `e2e` / `security` green on an up-to-date branch, linear history, no force-push, no deletion, no bypass actors.

### 3. Decide on the approval count

The ruleset ships with `required_approving_review_count: 0`. Reason: GitHub does not let a pull request's author approve their own PR, and PRs the manager opens are authored by **your** account (the GitHub connector acts as you). With a count of 1 you would be unable to merge anything you did not get a second human to approve.

"Approved by a human" is therefore enforced as: only a human can click **Merge**, and the ruleset guarantees that click is the only way in. If you ever add a collaborator, or if PRs start showing as authored by a bot account, raise the count to 1 and enable _Require review from Code Owners_ (the `CODEOWNERS` file already names you).

### 4. Optional, recommended

- **Settings → Code security** → enable _Dependabot alerts_, _Dependabot security updates_ and _CodeQL default setup_. All free for public repos; no workflow file needed.
- **Settings → General → Pull Requests** → _Automatically delete head branches_.

## Verifying the setup

Open a trivial PR (a typo fix). You should see three required checks, a blocked merge button until they pass, and the button turning green only for you. Try `git push origin main` from a clone: it must be rejected.

Verified as of 2026-10-28 against GitHub's ruleset import format; if the import rejects the JSON after a GitHub change, recreate the same rules by hand from the list in step 2.

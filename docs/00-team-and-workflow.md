# Team and Workflow

How work moves from idea to `main` in this repository, and who does what. The manager (the assistant orchestrating sessions) is described in `CLAUDE.md`; the specialists live in `.claude/agents/`.

## Roles

| Role               | Agent                | Writes                            | Reviews / gates                          | Never                                       |
| ------------------ | -------------------- | --------------------------------- | ---------------------------------------- | ------------------------------------------- |
| Manager            | (main session)       | PRs, roadmap, ADRs                | Sequences the gate, presents to the user | Merges; pushes to `main`; skips a gate      |
| Designer           | `ui-designer`        | `docs/design/*.md`, design tokens | —                                        | Implements components                       |
| Senior engineer    | `senior-engineer`    | Feature code + unit tests         | —                                        | Self-certifies; merges                      |
| Tester             | `tester`             | e2e/integration/regression tests  | Finds gaps in engineer's tests           | Writes production code; skips/weakens tests |
| Quality controller | `quality-controller` | Reports only                      | Runs the full gate; reviews the diff     | Edits code; passes on "looks fine"          |
| Security officer   | `security-officer`   | Reports only                      | Threat model; dependency + data review   | Edits code; allows a real-money path        |
| Human (owner)      | you                  | Decisions                         | **Approves and merges every PR**         | —                                           |

Two design choices worth stating:

- **Reviewers cannot edit.** `quality-controller` and `security-officer` have no Write/Edit tools. A reviewer who can quietly fix what they find has an incentive to under-report; one who can only report has an incentive to be thorough.
- **Nobody approves their own work.** The engineer does not run the gate on their own PR as the only check; the designer does not sign off the implementation of their own spec; the manager does not merge.

## Feature lifecycle

```
idea ──► roadmap entry ──► [1] spec ──► [2] build ──► [3] test ──► [4] QC ──► [5] security* ──► [6] PR ──► [7] human merge
                                ▲            │            │          │             │
                                └────────────┴────────────┴──────────┴─────────────┘  any FAIL returns to the step that owns it
```

\* mandatory for auth, persistence, user data, currency/wagering, dependencies; optional otherwise.

| Step | Owner                | Artifact                                                                   | Done when                                           |
| ---- | -------------------- | -------------------------------------------------------------------------- | --------------------------------------------------- |
| 1    | `ui-designer`        | `docs/design/<feature>.md`                                                 | Open questions answered by the user                 |
| 2    | `senior-engineer`    | Branch `feat/<slug>` with code + unit tests; `npm run check` green locally | Hand-off note lists what is _not_ covered           |
| 3    | `tester`             | `e2e/<feature>.spec.ts` (+ regression tests)                               | Real test output in the report                      |
| 4    | `quality-controller` | QC report (`VERDICT: PASS`)                                                | All commands exit 0; findings addressed or accepted |
| 5    | `security-officer`   | Security report                                                            | No open critical/high                               |
| 6    | manager              | Pull request with template filled, sign-offs recorded, CI green            |                                                     |
| 7    | you                  | Merge                                                                      | Squash or merge commit; branch deleted              |

### Definition of done

A feature is done when: it is on `main`; CI was green on the merged commit; it has unit + e2e tests; the spec's open questions are resolved; the roadmap status says _shipped_; and any decision made on the way has an ADR.

## Bug fixes

Same path minus the spec (the bug report is the spec). The fix _must_ include a regression test that fails before the fix and passes after — `tester` writes it first if the engineer has not.

## Small changes

Docs-only or config-only changes still go through a branch, CI, and your merge. They skip steps 1, 3 and 5 unless they touch `.github/`, hooks, or dependencies — those are security-relevant and get step 5.

## Working agreements

### Two Claude sessions, one repo

The owner runs a local Claude Code session on their dev machine and a cloud session (the manager). Both push. To avoid two agents editing the same branch:

- Each session works on its own branches and opens its own PRs; both use the `feat/`, `fix/`, `docs/`, `chore/` naming (the owner allowed the cloud manager to do so on 2026-10-28; its original `claude/anime-card-game-dapaop` branch retires once its PR merges).
- Releases: the manager tags and writes the handoff; the local session runs acceptance and production (`docs/03-release-process.md`).
- A PR is owned by the session that opened it: rebases, branch updates and review replies on it come from that session only.
- Dependabot PRs are handled by whichever session the owner asks; by default the local one.
- Decisions still land in `docs/` and ADRs, not in either session's chat.

- Branch names: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`.
- Commits: imperative subject, body says _why_. Small commits over big ones.
- No `--no-verify`. If the hook is wrong, fix the hook in its own PR.
- History rewrites (`git rebase`, `git commit --amend`, `git push --force-with-lease`) are allowed on a branch you created yourself and nobody else has commits on; never on someone else's branch, never plain `--force`, never on `main`. The owner granted this on 2026-10-28; `.claude/settings.json` encodes it as permission rules.
- Never run `prettier --write` (or any formatter) on a path a running subagent is editing; format only the files you are committing. A formatter rewriting a file mid-edit silently breaks the agent's edits (happened 2026-10-28).
- A subagent's report is a claim. The manager spot-checks claims that matter (a "tests pass" is re-run; a "stopped the server" is checked with `lsof`).
- Status lives in `docs/02-roadmap.md`, decisions in `docs/adr/`. Chat history is not memory.
- **Merge-friendly PRs** (owner decision, 2026-10-30):
  - **Build on `main`, never on another open PR.** A feature that needs another one starts after that one merges. With auto-merge on, the wait is short, and squash merges then never leave a branch in conflict with its own history.
  - **Shared tables stay out of feature PRs.** A feature PR writes its security entry as its own file in `docs/security-log/` and does not edit the controls, threat model or open items of `docs/05-security.md`, or the status columns of `docs/02-roadmap.md`.
  - **One register-sync PR after merges.** The manager applies the merged PRs' register edits and roadmap statuses in one small docs PR (`docs/register-sync-<date>`).

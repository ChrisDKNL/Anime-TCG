# Security log

One file per pull request at T1 or above, and per infrastructure change made outside the repo. It continues the change-log table in `docs/05-security.md`, which holds every entry up to 2026-10-30 and is no longer extended. Owner decision, 2026-10-30: shared tables that every PR edits caused most merge conflicts, so each PR now writes only its own file.

## Rules

- **File name:** `YYYY-MM-DD-<branch-slug>.md`, for example `2026-10-30-landing-demo-pack.md`. The branch slug is known before the PR number, and two PRs never share a slug.
- **Who writes it:** the manager commits it on the PR's own branch, from the `security-officer`'s report. The officer supplies the text but edits no files.
- **What a feature PR does not touch:** the controls table, the threat model, the open items and the old change-log table in `docs/05-security.md`, and the status columns of `docs/02-roadmap.md`. Its log file lists the edits those need under _Register edits_.
- **After the merge:** the manager applies every _Register edits_ section of the newly merged PRs to `docs/05-security.md`, and the status changes to `docs/02-roadmap.md`, in one small docs PR (`docs/register-sync-<date>`). That PR is the only one that edits those shared tables, so feature PRs never conflict on them.

## Template

```markdown
# <PR title> (#<number>)

- **Date:** YYYY-MM-DD
- **Tier:** T1 / T2 / T3
- **Verdict:** PASS / PASS WITH FINDINGS / FAIL, then PASS after <fix commits>
- **Owner informed:** through the PR's sign-offs

## Change

<What changed, in the register's style: routes, tables, grants, client behaviour.>

## Review notes

<What the officer checked and how it is proven: tests, probes, audit and signature results.>

## Findings

1. **<severity>:** <finding>. <fixed in <sha> | open item | accepted, with the reason>.

## Register edits

<Exact text the register-sync PR applies to `docs/05-security.md`: control status extensions, new controls with their number, threat-model sentences, open items to add or close. "None" when there are none.>
```

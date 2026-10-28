# 0002 — Gated development workflow with human-only merges

2026-10-28 · accepted

## Context

The owner wants a full DevOps setup with a role-based team (manager, designer, senior engineer, tester, quality control, security) where changes are only pushed after tests and checks pass, and every merge is approved by a human.

## Decision

- Roles are Claude subagents in `.claude/agents/`, with reviewers (`quality-controller`, `security-officer`) deliberately denied write tools.
- Local gates: Husky pre-commit (lint-staged) and pre-push (`npm run check`).
- Server gates: GitHub Actions (`quality`, `e2e`, `security`) required by a branch ruleset on `main` with no bypass actors.
- The manager never merges and never pushes to `main` (`CLAUDE.md`). Merges are the owner's click.
- `required_approving_review_count` is 0 because GitHub forbids self-approval and PRs are authored by the owner's account; the human merge click is the approval. Raise to 1 when a second reviewer exists.

## Consequences

- A change cannot reach `main` without green CI and a human. Hooks can be bypassed locally; the ruleset cannot.
- Every feature costs a spec + tests + two reviews. That is the point; small changes are allowed to skip design/security per `docs/00`.
- One-time admin setup is manual (`docs/01-github-flow.md`) because it requires rights the manager intentionally does not exercise.

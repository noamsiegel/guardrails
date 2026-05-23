---
name: personal-hooks
description: Audit and manage the personal git-hook quality harness (guardrails) layered on top of wt. USE WHEN the user asks about pai-hooks, audit personal hooks, why a hook didn't run, which repos override core.hooksPath, set up guardrails, or troubleshoot lefthook/wt chaining.
---

# personal-hooks

Tooling for the **guardrails** personal git-hook layer that lives at `~/.git-hooks-personal/`.
guardrails plugs into `wt`'s hook chain to add cross-repo quality gates (gitleaks, actionlint,
commitlint, large-files, branch-guard, fallow audit) without interfering with repo-owned
lint/format/typecheck.

## Architecture

```
git commit / push
   ↓
wt hook (~/.config/git/hooks/<name>)              ← worktree-aware logic
   ↓ wt_run_personal_hook (sourced from _wt-personal.sh)
   ↓
~/.git-hooks-personal/<name>                      ← guardrails (this layer)
   ↓ lefthook
   ↓ runs checks from lefthook.yml
   ↓
exec_chain → repo-local .git/hooks/<name>         ← repo-owned hooks (if any)
```

A repo's local `core.hooksPath` (e.g., the monorepo's `.githooks`) **bypasses the entire wt
chain** — including guardrails. Those repos need a direct shim in their own hook entry.

## Commands

`pai-hooks doctor` — Audit every git repo under `~/Documents/GitHub/`:
- Identifies category per repo:
  - **chain-enrolled**: no local `core.hooksPath` override; wt → guardrails → per-repo `.git/hooks/` chain fires.
  - **bypass**: local `core.hooksPath` set (Husky, lefthook, monorepo `.githooks`, etc.); guardrails won't run unless explicitly shimmed.
  - **opt-out**: repo path is in `~/.git-hooks-personal/.opt-out` or has `.no-personal-hooks` marker.
- Emits per-repo recommendations for bypass-category repos (one-line guarded shim or `extends:` snippet).

`pai-hooks doctor --root <PATH>` — Override scan root.

`pai-hooks doctor --json` — Machine-readable output.

## Files

- `~/.git-hooks-personal/lefthook.yml` — Source of truth for what runs (will publish to `github.com/noamsiegel/guardrails`).
- `~/.git-hooks-personal/<hook>` — Entry shims invoked from wt's chain.
- `~/.git-hooks-personal/checks/*.sh` — Bash check helpers.
- `~/.git-hooks-personal/.opt-out` — Absolute repo paths to skip (one per line).
- `~/.config/git/hooks/_wt-personal.sh` — Sourceable helper defining `wt_run_personal_hook`.
- `~/.pai/skills/personal-hooks/doctor.ts` — This skill's audit CLI.
- `~/.local/bin/pai-hooks` — Thin shim invoking `bun` against `doctor.ts`.

## Bypass Reference

See `~/.git-hooks-personal/README.md` for the full bypass cheatsheet.

## Future work

- Publish guardrails to GitHub for `extends:`-ing into shared repos.
- PR the monorepo's `.githooks/pre-commit` to invoke guardrails.
- Build a separate gist-per-PR provenance CLI.

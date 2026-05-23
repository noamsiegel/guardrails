# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] — initial public release

### Added
- Universal `pre-commit` checks: gitleaks, actionlint (on workflow files), large-files (staged-blob).
- `commit-msg`: commitlint with Conventional Commits.
- `pre-push` checks: branch-guard (list or regex), fallow audit (JS/TS only).
- Portable lefthook config that consumers can `extends:` via `GUARDRAILS_HOME` env var.
- `pai-hooks doctor` skill (Bun/TS) audits coverage across all local repos.
- 22-test bun-test suite.

### Security hardening (vs naive lefthook setups)
- User-owned gitleaks baseline that defeats hostile repo `.gitleaks.toml`.
- `git cat-file -s` staged-blob check (no worktree-truncation bypass).
- No in-repo opt-out marker — repos cannot disable user-level checks.
- PATH sanitization at hook entry; override via `GUARDRAILS_PATH`.
- Env-var bypass requires explicit `SKIP_*` per check (not ambient state).

### Known limitations
- macOS-tested. Linux probably works but untested in CI.
- bash >= 4 required.
- `commitlint` requires `@commitlint/config-conventional` resolvable from the lefthook config. Local install via `bun install` in this directory creates `node_modules/` for that.

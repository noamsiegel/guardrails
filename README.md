# ai-git-guardrails

> Personal git-hook quality layer. Installs per-repo with safe ownership marker.

`ai-git-guardrails` installs a curated set of universal quality checks into each repo you opt in, without conflicting with that repo's own lint/format/typecheck setup. It composes cleanly with Husky, lefthook, the pre-commit framework, or no other hook system.

## Why the rename

This project was previously named `guardrails`. That name now collides with Guardrails AI and several unrelated package-registry projects that expose or imply a `guardrails` CLI. `ai-git-guardrails` makes scope explicit: AI-assisted, user-owned Git safety checks.

Fresh installs use binary `ai-git-guardrails`, marker `# ai-git-guardrails-managed: ai-git-guardrails.v0`, env vars like `AI_GIT_GUARDRAILS_TEMPLATES`, and config dir `~/.config/ai-git-guardrails/`. Existing repos with old `# guardrails-managed: guardrails.v0` hooks are still recognized as ours so `ai-git-guardrails uninstall` can remove them safely. Legacy `GUARDRAILS_TEMPLATES` and `~/.config/guardrails/` are read as fallback during migration.

## What it runs

Universal checks only — the kind every repo benefits from, none of which duplicate repo-owned tooling:

| Hook | Command | Skip env | Rationale |
|---|---|---|---|
| `pre-push` | `branch-guard` | `SKIP_BRANCH_GUARD` | Block pushes to protected refs (`main`, `master`, `prod*`) |
| `pre-commit` | `large-files` | `SKIP_LARGE_FILES` | Refuse staged blobs over `MAX_BLOB_SIZE` |
| `pre-commit` | `gitleaks` | `SKIP_GITLEAKS` | Detect secrets in staged changes |
| `pre-commit` | `actionlint` | `SKIP_ACTIONLINT` | Validate `.github/workflows` YAML |
| `commit-msg` | `commitlint` | `SKIP_COMMITLINT` | Enforce Conventional Commits format |
| `pre-push` | `fallow` | `SKIP_FALLOW` | Run universal code-health gate for JS/TS |

Deliberately NOT in scope: `eslint`, `prettier`, `ruff`, `biome`, `tsc`, `mypy`, project tests. Those belong to each repo's own CI.

## Install

```bash
brew tap noamsiegel/tap
brew install noamsiegel/tap/ai-git-guardrails
```

That puts `ai-git-guardrails` on `PATH` at `/opt/homebrew/bin/ai-git-guardrails`. Then in each repo you want enrolled:

```bash
cd <some-repo>
ai-git-guardrails install
```

That writes hook shims into `.git/hooks/{pre-commit,pre-push,commit-msg}` with ownership marker (`# ai-git-guardrails-managed: ai-git-guardrails.v0`) and sets local `core.hooksPath` to point at them. The shims invoke `ai-git-guardrails run <hook>` which delegates to `lefthook` with the shipped config.

To enroll new clones automatically:

```bash
ai-git-guardrails --global-template
```

That wires `git config --global init.templateDir` so every subsequent `git init` / `git clone` installs ai-git-guardrails hooks.

## Commands

```bash
ai-git-guardrails install [--force] [--skip <hook>]   # install hooks in current repo
ai-git-guardrails uninstall                            # remove only ours-marked hooks
ai-git-guardrails doctor                               # audit current repo + tool reachability
ai-git-guardrails run <hook>                           # invoked by installed shims
ai-git-guardrails migrate [--apply]                    # migrate from legacy global-hooksPath install
ai-git-guardrails --global-template                    # auto-install on new clones
ai-git-guardrails --version
```

`ai-git-guardrails install` is conflict-aware: it refuses to clobber non-ai-git-guardrails hooks unless you pass `--force`, and it detects Husky/lefthook/pre-commit configs in the repo and prints a canonical compose snippet if you'd rather chain than override. Embedded shims preserve `"$@"`, propagate failures, and leave stdin untouched (required for `pre-push` ref lines).

## Compose snippets

`pre-commit`:

```bash
# ai-git-guardrails compose: pre-commit
# Preserves "$@" and stdin; exits non-zero if ai-git-guardrails blocks.
if command -v ai-git-guardrails >/dev/null 2>&1; then
  ai-git-guardrails run pre-commit "$@" || exit $?
fi
```

`pre-push`:

```bash
# ai-git-guardrails compose: pre-push
# Preserves "$@" and stdin; exits non-zero if ai-git-guardrails blocks.
if command -v ai-git-guardrails >/dev/null 2>&1; then
  ai-git-guardrails run pre-push "$@" || exit $?
fi
```

`commit-msg`:

```bash
# ai-git-guardrails compose: commit-msg
# Preserves "$@" and stdin; exits non-zero if ai-git-guardrails blocks.
if command -v ai-git-guardrails >/dev/null 2>&1; then
  ai-git-guardrails run commit-msg "$@" || exit $?
fi
```

## Bypass

| Goal | How |
|---|---|
| Skip one check, once | `SKIP_GITLEAKS=1 git commit ...` (also `SKIP_ACTIONLINT`, `SKIP_LARGE_FILES`, `SKIP_COMMITLINT`, `SKIP_BRANCH_GUARD`, `SKIP_FALLOW`) |
| Allow push to protected branch once | `ALLOW_PROTECTED_PUSH=1 git push ...` |
| Raise large-file threshold | `LARGE_FILE_LIMIT_MB=20 git commit ...` |
| Pin fallow to a different version | `FALLOW_VERSION=2.45.0 git push ...` |
| Skip all ai-git-guardrails checks for one invocation | `SKIP_PERSONAL_HOOKS=1 git commit ...` |
| Opt out a repo permanently | Add canonical path to `~/.config/ai-git-guardrails/.opt-out`, one per line |
| Override PATH for non-standard tool locations | Drop `~/.config/ai-git-guardrails/init.sh` to extend `PATH` (asdf/mise/nvm) |
| Skip everything (ai-git-guardrails AND repo hooks) | `git commit --no-verify` / `git push --no-verify` |

There is deliberately no in-repo opt-out marker. A repository must not be able to disable user-level security checks by committing a file.

## Competitor comparison

| Tool | What they do | What we do that they don't |
|---|---|---|
| pre-commit | Multi-language hook framework with version-pinned hook repos and reusable hooks, including large-file and branch checks. | Ship one brew-installed, user-owned universal safety layer that hostile repos cannot weaken by editing repo config. |
| lefthook | Fast hook orchestrator with concurrent YAML-defined commands. | Use lefthook as execution substrate while adding conflict-aware install, ownership markers, migration, and curated universal policy. |
| Husky | Popular JS/package.json-centered hook helper using `core.hooksPath`. | Work across non-JS repos and provide secrets, branch, large-file, actionlint, commitlint, and fallow checks as user-owned baseline. |
| Gitleaks | Secret scanner for repos/files/stdin. | Wrap Gitleaks with a hostile-repo-resistant baseline config and combine it with non-secret universal Git checks. |
| TruffleHog | Broad secret scanner with live credential verification and many data-source backends. | Stay lightweight for client-side Git hooks and provide hook enrollment, composition, branch guard, large-file, actionlint, commitlint, and fallow checks. |

## Security properties

- User-owned config lives outside repos.
- Uninstall removes only hooks with recognized ownership markers.
- Existing old-marker installs classify as ours for safe migration.
- Staged large-file checks inspect staged blobs, not mutable worktree bytes.
- Gitleaks uses the shipped baseline config explicitly, so repo-local `.gitleaks.toml` cannot weaken the scan.

## Development

```bash
bun test tests/ai-git-guardrails.test.ts
bash -n ai-git-guardrails checks/registry.sh
```

# Releasing ai-git-guardrails

1. Pick `vX.Y.Z` and confirm the release diff is intentional.
2. Run pre-release checks:
   ```bash
   bun test tests/ai-git-guardrails.test.ts
   bash -n ai-git-guardrails checks/registry.sh checks/*.sh
   git status --short
   ```
   `git status --short` must be empty except deliberate release edits before tagging.
3. Bump `AI_GIT_GUARDRAILS_VERSION` near the top of `ai-git-guardrails`.
4. Prepend `## [vX.Y.Z]` to `CHANGELOG.md` with `Added`, `Changed`, `Fixed`, or `Migration` subsections as needed.
5. Commit, tag, and push in this order:
   ```bash
   git add -A
   git commit -m "release: vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```
6. Create the GitHub release only after both pushes succeed:
   ```bash
   gh release create vX.Y.Z --notes "..."
   ```
7. Update Homebrew tap `Formula/ai-git-guardrails.rb` with the new tarball URL and `sha256`.
   Formula must install the binary, `checks/*`, shipped configs (`lefthook.yml`, `gitleaks.toml`, `commitlint.config.cjs`), and use `inreplace` for `AI_GIT_GUARDRAILS_TEMPLATES`.
8. Verify Homebrew install path:
   ```bash
   brew update
   brew upgrade noamsiegel/tap/ai-git-guardrails
   ```
9. Smoke installed CLI:
   ```bash
   ai-git-guardrails --version
   ai-git-guardrails doctor
   ```
   Version must report `X.Y.Z`; doctor must show tool reachability and current repo audit detail.

## Recovery

- Stale shim issue: repos installed before v0.8.0 may still have old `guardrails` shims in `.git/hooks`. If pushes fail there, run `ai-git-guardrails install --force` in that repo to refresh enrollment.
- Tag misalignment: if `gh release create` or a failed push leaves remote tag `vX.Y.Z` pointing at the wrong commit, delete the GitHub release, delete the remote tag, delete the local tag, recreate the annotated tag on the intended commit, push `main`, push the tag, then recreate the release.
- Formula install failure: inspect `Formula/ai-git-guardrails.rb` first. It must ship binary + `checks/*` + `lefthook.yml` + `gitleaks.toml` + `commitlint.config.cjs`, and patch `AI_GIT_GUARDRAILS_TEMPLATES` to Homebrew `pkgshare`.

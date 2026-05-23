#!/usr/bin/env bash
# Block commits whose STAGED BLOBS exceed LARGE_FILE_LIMIT_MB (default 5).
#
# Critically: we measure the size of the BLOB in the git index, not the
# worktree file. A user can stage a 100MB file, edit the worktree down to
# 1KB, then commit — git commits the staged blob, not the worktree. Worktree
# stat() would lie. `git cat-file -s :path` reports the true staged size.

set -euo pipefail

LIMIT_MB="${LARGE_FILE_LIMIT_MB:-5}"
LIMIT_BYTES=$((LIMIT_MB * 1024 * 1024))

# Strip lefthook's `--` separator if present.
[[ $# -gt 0 && "$1" == "--" ]] && shift

if [[ $# -eq 0 ]]; then
  exit 0
fi

fail=0
for f in "$@"; do
  # Resolve the staged blob for this path via git ls-files -s. The format is:
  #   <mode> <sha> <stage>\t<path>
  # If the path isn't staged (e.g. ignored by lefthook glob mismatches), skip.
  staged_line=$(git ls-files --stage -z -- "$f" | tr -d '\0' || true)
  [[ -z "$staged_line" ]] && continue

  # mode 120000 = symlink; skip — the staged blob is the link text, not content.
  mode=$(printf '%s' "$staged_line" | awk '{print $1}')
  [[ "$mode" == "120000" ]] && continue

  # Get the blob size in bytes from git itself.
  size=$(git cat-file -s ":$f" 2>/dev/null || echo 0)
  if (( size > LIMIT_BYTES )); then
    mb=$(awk -v s="$size" 'BEGIN { printf "%.2f", s / 1048576 }')
    printf '\033[31m%s\033[0m  %sMB staged  (>%sMB threshold)\n' "$f" "$mb" "$LIMIT_MB" >&2
    fail=1
  fi
done

if (( fail == 1 )); then
  printf '\nIf this file genuinely belongs in the repo:\n' >&2
  printf '  - Track it via Git LFS, or\n' >&2
  printf '  - Raise the threshold: LARGE_FILE_LIMIT_MB=20 git commit ...\n' >&2
  printf '  - Bypass: SKIP_LARGE_FILES=1 git commit ...\n' >&2
  exit 1
fi

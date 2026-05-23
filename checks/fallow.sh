#!/usr/bin/env bash
# Run fallow audit, auto-detecting the base ref so we don't hardcode origin/main.
# Resolution order:
#   1. FALLOW_BASE env var (explicit override)
#   2. origin/HEAD (symbolic ref to the default remote branch)
#   3. origin/main, origin/master, origin/develop (in that order)
#   4. HEAD~1 (last-resort fallback for repos with no remote)

set -euo pipefail

base="${FALLOW_BASE:-}"

if [[ -z "$base" ]]; then
  base=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true)
fi

if [[ -z "$base" ]]; then
  for candidate in origin/main origin/master origin/develop; do
    if git rev-parse --verify --quiet "$candidate" >/dev/null; then
      base="$candidate"
      break
    fi
  done
fi

if [[ -z "$base" ]]; then
  if git rev-parse --verify --quiet HEAD~1 >/dev/null; then
    base="HEAD~1"
  else
    echo "fallow.sh: cannot determine base ref (no remotes, no HEAD~1). Skipping."
    exit 0
  fi
fi

# --fail-on-issues makes findings block the push (default).
# Set FALLOW_NO_FAIL=1 to make fallow advisory (run but don't gate).
fail_flag="--fail-on-issues"
[[ "${FALLOW_NO_FAIL:-0}" == "1" ]] && fail_flag=""

# Pin fallow version for reproducibility and supply-chain safety. Override
# with FALLOW_VERSION env var if you need a different release temporarily.
# Bump this when you've validated a new fallow release in your repos.
FALLOW_VERSION="${FALLOW_VERSION:-2.79.0}"

exec npx --yes "fallow@${FALLOW_VERSION}" audit \
  --quiet \
  --format compact \
  --changed-since="$base" \
  $fail_flag

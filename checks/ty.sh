#!/usr/bin/env bash
# Run ty as an optional repo-aware Python type check.

set -euo pipefail

if ! command -v ty >/dev/null 2>&1; then
  printf '%s\n' "git-guardrails: ty not found; skipping ty check" >&2
  exit 0
fi

has_python=0
while IFS= read -r path; do
  if [[ -n "$path" ]]; then
    has_python=1
    break
  fi
done < <(git ls-files '*.py' '*.pyi')

if (( has_python == 0 )); then
  exit 0
fi

exec ty check

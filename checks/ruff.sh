#!/usr/bin/env bash
# Run Ruff as an optional repo-aware Python quality gate.
# Usage:
#   ruff.sh staged -- <staged files>
#   ruff.sh full

set -euo pipefail

mode="${1:-}"
[[ -n "$mode" ]] || mode="staged"
shift || true
if [[ "${1:-}" == "--" ]]; then
  shift
fi

if ! command -v ruff >/dev/null 2>&1; then
  printf '%s\n' "git-guardrails: ruff not found; skipping ruff check" >&2
  exit 0
fi

python_files=()
case "$mode" in
  staged)
    for path in "$@"; do
      case "$path" in
        *.py|*.pyi) python_files+=("$path") ;;
      esac
    done
    ;;
  full)
    while IFS= read -r path; do
      [[ -n "$path" ]] && python_files+=("$path")
    done < <(git ls-files '*.py' '*.pyi')
    ;;
  *)
    printf '%s\n' "usage: ruff.sh staged -- <files> | ruff.sh full" >&2
    exit 10
    ;;
esac

if (( ${#python_files[@]} == 0 )); then
  exit 0
fi

exec ruff check --force-exclude -- "${python_files[@]}"

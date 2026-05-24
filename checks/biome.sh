#!/usr/bin/env bash
# Run Biome only for repos that explicitly carry Biome config.
# Usage:
#   biome.sh staged -- <staged files>
#   biome.sh full

set -euo pipefail

mode="${1:-}"
[[ -n "$mode" ]] || mode="staged"
shift || true
if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ ! -f biome.json && ! -f biome.jsonc ]]; then
  exit 0
fi

if ! command -v biome >/dev/null 2>&1; then
  printf '%s\n' "git-guardrails: biome not found; skipping biome check" >&2
  exit 0
fi

case "$mode" in
  staged)
    if (( $# == 0 )); then
      exit 0
    fi
    exec biome check --no-errors-on-unmatched --files-ignore-unknown=true -- "$@"
    ;;
  full)
    exec biome check .
    ;;
  *)
    printf '%s\n' "usage: biome.sh staged -- <files> | biome.sh full" >&2
    exit 10
    ;;
esac

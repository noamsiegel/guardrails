#!/usr/bin/env bash
# Block direct pushes to protected branches.
# Reads pre-push refs from stdin per git's pre-push hook protocol:
#   <local-ref> <local-sha> <remote-ref> <remote-sha>
#
# Two configuration knobs (use one OR the other, list wins if both set):
#
#   PROTECTED_BRANCHES_LIST="main,master,trunk,release/v1"
#       Newline- OR comma-separated list of exact branch names.
#       Recommended — predictable, no regex pitfalls.
#
#   PROTECTED_BRANCH_REGEX="^(main|master|trunk|release/.*)$"
#       Bash extended regex matched against the remote branch name.
#       Use when you need wildcards (e.g. `release/.*`).
#       Caller is responsible for anchoring.
#
# If neither is set, the default protected set is: main, master, trunk,
# and any branch starting with release/.
#
# Skip non-branch refs (tags, notes, etc.) — only `refs/heads/*` is checked.
#
# Bypass:
#   ALLOW_PROTECTED_PUSH=1 git push ...   (this push only)
#   git push --no-verify                  (skip ALL hooks)

set -euo pipefail

[[ "${ALLOW_PROTECTED_PUSH:-0}" == "1" ]] && exit 0

# Honor legacy PROTECTED_BRANCHES env var for backwards compat, but warn.
# Treat its value as a regex (the old behavior).
if [[ -n "${PROTECTED_BRANCHES:-}" ]] && [[ -z "${PROTECTED_BRANCH_REGEX:-}" ]]; then
  echo "guardrails branch-guard: PROTECTED_BRANCHES is deprecated. Use PROTECTED_BRANCH_REGEX (regex) or PROTECTED_BRANCHES_LIST (literal list)." >&2
  PROTECTED_BRANCH_REGEX="$PROTECTED_BRANCHES"
fi

# Build the protected-name list from PROTECTED_BRANCHES_LIST (literal).
declare -a protected_list=()
if [[ -n "${PROTECTED_BRANCHES_LIST:-}" ]]; then
  # Accept both comma and newline separators; trim whitespace.
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    protected_list+=("$line")
  done < <(printf '%s' "$PROTECTED_BRANCHES_LIST" | tr ',\n' '\n\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' || true)
fi

# Default regex if neither list nor regex is set.
default_regex='^(main|master|trunk|release/.*)$'
regex="${PROTECTED_BRANCH_REGEX:-$default_regex}"
use_regex=true
if (( ${#protected_list[@]} > 0 )); then
  use_regex=false
fi

is_protected() {
  local branch="$1"
  if $use_regex; then
    [[ "$branch" =~ $regex ]]
    return $?
  fi
  for p in "${protected_list[@]}"; do
    [[ "$branch" == "$p" ]] && return 0
  done
  return 1
}

fail=0
while read -r local_ref local_sha remote_ref _remote_sha; do
  [[ -z "$remote_ref" ]] && continue
  # Skip deletions (local_sha = all zeros).
  [[ "$local_sha" == "0000000000000000000000000000000000000000" ]] && continue
  # Only check refs/heads/*. Tags (refs/tags/*) and other refs are ignored.
  [[ "$remote_ref" == refs/heads/* ]] || continue

  remote_branch="${remote_ref#refs/heads/}"
  if is_protected "$remote_branch"; then
    printf '\033[31mrefusing direct push to protected branch:\033[0m %s\n' "$remote_branch" >&2
    printf '  remote ref:                 %s\n' "$remote_ref" >&2
    printf '  override (this push only):  ALLOW_PROTECTED_PUSH=1 git push ...\n' >&2
    printf '  bypass everything:          git push --no-verify\n' >&2
    fail=1
  fi
done

exit "$fail"

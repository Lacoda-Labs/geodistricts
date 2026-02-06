#!/usr/bin/env bash
# Check staged files under .cursor/ for common secret patterns.
# See .cursor/ARCHIVE_PRE_COMMIT_SPEC.md for full spec.
# Usage: run from repo root as pre-commit hook (or manually).

set -e

[[ -n "$SKIP_ARCHIVE_SECRET_CHECK" ]] && exit 0

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

STAGED="$(git diff --cached --name-only)"
if [[ -z "$STAGED" ]]; then
  exit 0
fi

# Only scan paths under .cursor/
CANDIDATES="$(echo "$STAGED" | grep -E '^\.cursor/' || true)"
[[ -z "$CANDIDATES" ]] && exit 0

# Patterns: variable-style assignments with long values, Bearer tokens, AWS key, GitHub PAT
PATTERNS=(
  -e '(api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['\''\"]?[^'\''\"\s]{12,}'
  -e 'Bearer\s+[a-zA-Z0-9_\-\.]{20,}'
  -e 'AKIA[0-9A-Z]{16}'
  -e 'ghp_[a-zA-Z0-9]{36}'
)

FOUND=
while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  CONTENT="$(git show ":$path" 2>/dev/null)" || true
  if echo "$CONTENT" | grep -qE "${PATTERNS[@]}"; then
    FOUND="${FOUND:+$FOUND }$path"
  fi
done <<< "$CANDIDATES"

if [[ -n "$FOUND" ]]; then
  echo "pre-commit: possible secret in staged file(s):" >&2
  echo "$FOUND" | tr ' ' '\n' | sed 's/^/  /' >&2
  echo "Unstage the file(s) or remove the sensitive content, then commit again." >&2
  exit 1
fi

exit 0

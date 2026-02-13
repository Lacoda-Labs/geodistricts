#!/usr/bin/env bash
# Sync .cursor/archive to docs/archive for GitHub Pages.
# Excludes .gitkeep. Does not remove files that exist only in docs/archive (e.g. README.md).
# Run from repo root after archiving; then commit docs/archive/ to update the site.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

rsync -a --exclude='.gitkeep' .cursor/archive/ docs/archive/

# Generate INDEX.md for discoverability (date, path, first heading or first line)
INDEX="$REPO_ROOT/docs/archive/INDEX.md"
echo "# Archive index" > "$INDEX"
echo "" >> "$INDEX"
echo "Session summaries by path. Canonical source: [.cursor/archive/](https://github.com/Lacoda-Labs/geodistricts/tree/main/.cursor/archive)." >> "$INDEX"
echo "" >> "$INDEX"

for f in $(find docs/archive -name '*.md' -type f | grep -E 'archive/[0-9]{4}-[0-9]{2}/' | sort); do
  rel="${f#docs/archive/}"
  if [[ "$rel" == "README.md" ]] || [[ "$rel" == "ARCHIVE_ENTRY_TEMPLATE.md" ]]; then
    continue
  fi
  first="$(head -1 "$f" | sed 's/^# *//')"
  echo "- [\`$rel\`]($rel) — $first" >> "$INDEX"
done

echo ""
echo "Synced .cursor/archive/ → docs/archive/ and updated INDEX.md. Commit docs/archive/ to publish."

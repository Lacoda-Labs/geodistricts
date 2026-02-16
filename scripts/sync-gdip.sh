#!/usr/bin/env bash
# Sync protocol docs from geodistricts (canonical) to the nested gdip repo.
# Source: doc/protocol/GDIPs/ and doc/protocol/process/
# Target: gdip/GDIPs/ and gdip/process/
# After running, commit and push from inside gdip/ to publish to Lacoda-Labs/gdip.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -d gdip/.git ]]; then
  echo "Error: gdip/ is not a git repo. Clone it first: git clone https://github.com/Lacoda-Labs/gdip.git gdip"
  exit 1
fi

echo "Syncing doc/protocol → gdip (canonical source: geodistricts doc/protocol/)"
rsync -a --delete doc/protocol/GDIPs/ gdip/GDIPs/
rsync -a doc/protocol/process/ gdip/process/

echo ""
echo "Done. Next steps to publish to the GDIP repo:"
echo "  cd gdip"
echo "  git status"
echo "  git add -A && git commit -m 'Sync protocol docs from geodistricts'"
echo "  git push origin main"

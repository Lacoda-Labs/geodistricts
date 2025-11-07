#!/bin/bash

# Archive Cursor conversation session
# Usage: ./cursor/archive-session.sh "session-name"
# Example: ./cursor/archive-session.sh "isolation-check-implementation"

if [ -z "$1" ]; then
    echo "Usage: $0 \"session-name\""
    echo "Example: $0 \"isolation-check-implementation\""
    exit 1
fi

SESSION_NAME="$1"
DATE=$(date +%Y-%m-%d)
ARCHIVE_DIR=".cursor/archive/$DATE"
ARCHIVE_FILE="$ARCHIVE_DIR/${SESSION_NAME}.md"

# Create archive directory if it doesn't exist
mkdir -p "$ARCHIVE_DIR"

# Create archive file with header
cat > "$ARCHIVE_FILE" << EOF
# $SESSION_NAME

**Date:** $DATE  
**Session:** $SESSION_NAME

## Summary
<!-- Add a brief summary of what was discussed/implemented in this session -->

## Conversation
<!-- Paste your Cursor conversation here -->

EOF

echo "✅ Created archive file: $ARCHIVE_FILE"
echo "📝 Edit the file to add your conversation content"
echo ""
echo "To open in editor:"
echo "  code $ARCHIVE_FILE"
echo "  # or"
echo "  vim $ARCHIVE_FILE"


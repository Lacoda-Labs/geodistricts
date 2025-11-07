#!/bin/bash

# Archive chats since last push and push
# This script finds new/modified files in .cursor/commands/ since last push,
# archives them, commits, and pushes

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
CURSOR_DIR="$REPO_ROOT/.cursor"
COMMANDS_DIR="$CURSOR_DIR/commands"
ARCHIVE_DIR="$CURSOR_DIR/archive"

# Get the last pushed commit hash
LAST_PUSH=$(git rev-parse origin/main 2>/dev/null || echo "")

if [ -z "$LAST_PUSH" ]; then
    echo "⚠️  No remote branch found. Archiving all files in commands/ directory."
    FILES_TO_ARCHIVE=$(find "$COMMANDS_DIR" -type f -name "*.md" ! -name "README.md" ! -name "*.md.bak")
else
    # Find files in .cursor/commands/ that were added or modified since last push
    FILES_TO_ARCHIVE=$(git diff --name-only --diff-filter=AM "$LAST_PUSH" HEAD -- "$COMMANDS_DIR"/*.md 2>/dev/null || echo "")
    
    if [ -z "$FILES_TO_ARCHIVE" ]; then
        echo "✅ No new or modified command files since last push."
        exit 0
    fi
fi

if [ -z "$FILES_TO_ARCHIVE" ]; then
    echo "✅ No files to archive."
    exit 0
fi

# Get today's date for archive directory
TODAY=$(date +%Y-%m-%d)
TODAY_ARCHIVE_DIR="$ARCHIVE_DIR/$TODAY"
mkdir -p "$TODAY_ARCHIVE_DIR"

ARCHIVED_COUNT=0
ARCHIVED_FILES=()

echo "📦 Archiving chats since last push..."
echo ""

# Process each file
for FILE in $FILES_TO_ARCHIVE; do
    if [ ! -f "$FILE" ]; then
        continue
    fi
    
    FILENAME=$(basename "$FILE")
    BASENAME="${FILENAME%.md}"
    
    # Skip README and backup files
    if [[ "$FILENAME" == "README.md" ]] || [[ "$FILENAME" == *.bak ]]; then
        continue
    fi
    
    # Create archive filename (use original name or generate descriptive name)
    ARCHIVE_NAME="$BASENAME.md"
    ARCHIVE_PATH="$TODAY_ARCHIVE_DIR/$ARCHIVE_NAME"
    
    # If file already exists in archive, append timestamp
    if [ -f "$ARCHIVE_PATH" ]; then
        TIMESTAMP=$(date +%H%M%S)
        ARCHIVE_NAME="${BASENAME}-${TIMESTAMP}.md"
        ARCHIVE_PATH="$TODAY_ARCHIVE_DIR/$ARCHIVE_NAME"
    fi
    
    # Read the original file and create archive entry
    {
        echo "# $BASENAME"
        echo ""
        echo "**Date:** $TODAY"
        echo "**Source:** \`.cursor/commands/$FILENAME\`"
        echo ""
        echo "## Summary"
        echo "<!-- Add a brief summary of what was discussed/implemented -->"
        echo ""
        echo "## Conversation"
        echo ""
        cat "$FILE"
    } > "$ARCHIVE_PATH"
    
    ARCHIVED_COUNT=$((ARCHIVED_COUNT + 1))
    ARCHIVED_FILES+=("$ARCHIVE_NAME")
    
    echo "  ✅ Archived: $FILENAME → $ARCHIVE_NAME"
done

if [ $ARCHIVED_COUNT -eq 0 ]; then
    echo "✅ No files to archive."
    exit 0
fi

echo ""
echo "📝 Committing archived chats..."

# Stage archive files
git add "$TODAY_ARCHIVE_DIR"/*.md 2>/dev/null || true

# Commit
COMMIT_MSG="Archive chats since last push

- Archived $ARCHIVED_COUNT conversation(s) to archive/$TODAY/
- Files: ${ARCHIVED_FILES[*]}"

git commit -m "$COMMIT_MSG" || {
    echo "⚠️  Nothing to commit (files may already be committed)"
}

echo ""
echo "🚀 Pushing to remote..."

# Push to remote
git push origin main || {
    echo "⚠️  Failed to push. Check your git status."
    exit 1
}

echo ""
echo "✅ Successfully archived and pushed $ARCHIVED_COUNT chat(s)!"
echo "   Archive location: archive/$TODAY/"


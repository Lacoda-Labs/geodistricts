#!/bin/bash

# Archive chats since last push and push
# This script finds new/modified files in .cursor/commands/ since last push,
# archives them, creates an archive entry for the current conversation,
# commits, and pushes

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
        # Continue to create current conversation entry
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

# Get today's date for archive directory (if not already set)
if [ -z "$TODAY" ]; then
    TODAY=$(date +%Y-%m-%d)
    TODAY_ARCHIVE_DIR="$ARCHIVE_DIR/$TODAY"
    mkdir -p "$TODAY_ARCHIVE_DIR"
fi

# Create archive entry for current conversation (always create this)
echo ""
echo "📝 Creating archive entry for current conversation..."

CURRENT_SESSION_NAME="cursor-session-$(date +%Y%m%d-%H%M%S)"
CURRENT_ARCHIVE_PATH="$TODAY_ARCHIVE_DIR/$CURRENT_SESSION_NAME.md"

# Create archive entry with template
{
    echo "# Cursor Session - $TODAY"
    echo ""
    echo "**Date:** $TODAY"
    echo "**Time:** $(date +%H:%M:%S)"
    echo "**Session ID:** $CURRENT_SESSION_NAME"
    echo ""
    echo "## Summary"
    echo "<!-- Add a brief summary of what was discussed/implemented in this session -->"
    echo ""
    echo "## Key Changes"
    echo "<!-- List key changes, features, or fixes implemented -->"
    echo ""
    echo "## Files Modified"
    echo "<!-- List files that were modified -->"
    echo ""
    echo "## Conversation"
    echo ""
    echo "<!-- This conversation was archived automatically. To add the full conversation:"
    echo "1. Copy the conversation from Cursor"
    echo "2. Paste it below this comment"
    echo "3. Commit and push -->"
    echo ""
    echo "## Notes"
    echo "<!-- Add any additional notes or context -->"
} > "$CURRENT_ARCHIVE_PATH"

ARCHIVED_COUNT=$((ARCHIVED_COUNT + 1))
ARCHIVED_FILES+=("$CURRENT_SESSION_NAME.md")

echo "  ✅ Created archive entry: $CURRENT_SESSION_NAME.md"
echo "     Edit this file to add conversation details: $CURRENT_ARCHIVE_PATH"

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


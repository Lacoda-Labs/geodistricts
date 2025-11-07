# Cursor Conversations Archive

This directory contains Cursor AI conversation history and command files for the GeoDistricts project.

## Directory Structure

```
.cursor/
├── commands/          # Active commands/requests (current work)
├── archive/          # Archived conversations (completed sessions)
│   └── YYYY-MM-DD/   # Organized by date
└── README.md         # This file
```

## Usage

### Active Commands (`commands/`)
- Store current commands, requests, and active conversations
- These are working files that you're actively using
- Typically named with timestamps or descriptive names (e.g., `251106.md`)

### Archived Conversations (`archive/`)
- Store completed conversation sessions
- Organized by date in `YYYY-MM-DD` format
- Example: `archive/2025-11-06/isolation-check-implementation.md`

### Archiving a Session

1. **Archive Chats (Recommended):**
   - Say "archive chats" or "archive chats since last push and push"
   - This automatically:
     - Finds new/modified files in `commands/` since last push and archives them
     - Creates an archive entry for the current conversation session
     - Automatically populates the archive with conversation details
     - Commits and pushes everything
   - Or run manually:
     ```bash
     ./cursor/archive-chats-since-last-push.sh
     ```

2. **Manual Archive:**
   - Copy conversation from Cursor
   - Create date directory: `archive/2025-11-06/`
   - Save as markdown file with descriptive name

3. **Using Archive Script:**
   ```bash
   ./cursor/archive-session.sh "session-name"
   ```
   This will create a dated directory and save the conversation.

## Best Practices

1. **Keep commands/ clean**: Move completed sessions to archive regularly
2. **Use descriptive names**: Name files based on the main topic/feature
3. **Include context**: Add a brief summary at the top of archived files
4. **Version control**: These files are tracked in git, so commit meaningful archives

## Example Archive Structure

```
archive/
├── 2025-11-06/
│   ├── isolation-check-implementation.md
│   └── intersecting-tract-highlighting.md
└── 2025-11-07/
    └── server-restart-fixes.md
```

## Notes

- All files in `.cursor/` are tracked in git
- Sensitive information should be redacted before archiving
- Archive files help maintain project context and decision history


# Pre-commit hook: block commits with secrets in archive (and other tracked files)

## Purpose

Prevent committing sensitive data (API keys, tokens, passwords) in:
- `.cursor/archive/` (conversation archives),
- and optionally other paths that are committed to git.

## Behavior

- **When:** On `git commit`, before the commit is created.
- **Input:** List of staged files (`git diff --cached --name-only`).
- **Action:** For each staged file in the **scanned paths**, check file contents for **secret patterns**.
- **Exit code:** `0` → allow commit. `1` → block commit and print which file(s) and (optionally) which pattern matched.

## Paths to scan

| Path | Required |
|------|----------|
| `.cursor/archive/` | Yes – primary target (archived chats). |
| `.cursor/commands/` | Recommended – active command/request files. |
| Any staged file | Optional – project-wide scan. |

**Recommendation:** At minimum, scan all staged files under `.cursor/`. Optionally extend to all staged files.

## Patterns to detect

Match staged file **contents** (not filenames). Use case-insensitive where appropriate.

| Pattern | Description | Example |
|--------|-------------|--------|
| API key / secret variable | `api_key`, `apikey`, `api-key`, `secret`, `token` followed by `=` or `:` and a quoted or unquoted value (e.g. 16+ chars) | `api_key=sk_live_...`, `SECRET=abc123...` |
| Bearer token | Word `Bearer` followed by space and long token | `Bearer eyJhbGc...` |
| AWS access key | `AKIA` followed by 16 alphanumeric chars | `AKIAIOSFODNN7EXAMPLE` |
| GitHub PAT | `ghp_` followed by 36 alphanumeric | `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| Generic password assignment | `password` or `passwd` followed by `=` or `:` and value | `password=mySecret123` |
| Long base64-like token | Long run of alphanumeric + `+/=` (e.g. 40+ chars) in a line by itself or after `=` | Optional; high false positive risk. |

**Implementation note:** Use regex (e.g. `grep -E` or script) with boundaries to reduce false positives (e.g. match `api_key\s*=\s*` not just `key`).

## What not to block

- Normal prose: “the API key is stored in env” (no actual key).
- Placeholders: `API_KEY=your_key_here`, `xxx`, `REDACTED`, `***`.
- Short or obviously fake values (e.g. under 12 chars) if you want to allow examples.

Optional: allow an **exception marker** in a line (e.g. `# no-secret-check`) so that line is skipped.

## Environment

- **Skip check:** If `SKIP_ARCHIVE_SECRET_CHECK=1`, exit 0 without scanning (useful for CI or one-off commits).
- **Verbose:** If `ARCHIVE_SECRET_CHECK_VERBOSE=1`, print which pattern matched (still exit 1); otherwise print only file path(s).

## Installation

1. **Script:** Use `scripts/check-archive-secrets.sh` (see below).
2. **Hook:** Install as the repo’s pre-commit hook:
   ```bash
   cp scripts/check-archive-secrets.sh .git/hooks/pre-commit
   chmod +x .git/hooks/pre-commit
   ```
   Or symlink:
   ```bash
   ln -sf ../../scripts/check-archive-secrets.sh .git/hooks/pre-commit
   ```
3. **Optional:** Use a hook manager (e.g. [pre-commit](https://pre-commit.com/)) and add an entry that runs this script.

## Script interface

- **Input:** None (script should run in repo root and use `git diff --cached --name-only`).
- **Scanned content:** For each staged file in scope, use `git show :<path>` to get staged content (so only staged changes are checked).
- **Output:** Stderr for messages; stdout optional. On match: print at least the file path; exit 1. On no match or skip: exit 0.

## Example output (blocked)

```
pre-commit: possible secret in staged file:
  .cursor/archive/2026-02/260205.md
Unstage the file or remove the sensitive content, then commit again.
Exit 1.
```

## Reference implementation

The script `scripts/check-archive-secrets.sh` implements this spec: it scans staged files under `.cursor/` for the patterns above and exits 1 if any match. Extend the pattern list or paths in that script as needed.

# Archive entry template

Use this structure when appending a session to the daily archive file  
`.cursor/archive/YYYY-MM/YYMMDD.md`. Create the file and folder if needed.

---

## Daily file (create once per day)

- **Path:** `.cursor/archive/YYYY-MM/YYMMDD.md`  
  Example: `.cursor/archive/2026-02/260205.md` for 2026-02-05.
- **First line:** `# YYMMDD`  
  Example: `# 260205`

---

## One session entry (append for each chat)

Use 24-hour time with no colon (e.g. `1430`, `0032`).

```markdown
## HHMM

### Prompt

[Exact or summarized user message. Do not include API keys, tokens, passwords, or internal URLs.]

### Response / actions

[What the agent did: summary, bullets, or key code/docs touched. Use ✅ **RESOLVED** or ✅ **IMPLEMENTED** when appropriate.]
```

---

## Minimal variant (no subsections)

If you prefer the existing style without `### Prompt` / `### Response`:

```markdown
## HHMM

[User request or topic.]

✅ **RESOLVED** / **IMPLEMENTED** / **FIXED**: [What was done.]
```

---

## Example (full)

```markdown
# 260205

## 0915

### Prompt

Fix the step controls on the maps admin page so step 0 shows one district group (entire state) and a label for the next step (sort census tracts). Add pulsing highlight for tracts in the DG.

### Response / actions

✅ **IMPLEMENTED**: Added step 0 visualization with step 0 info panel, "Next Step: Sort Census Tracts" label, and pulsing animation (2s per tract). Fixed Leaflet layer handling and automatic start/stop when entering/leaving step 0 in admin mode.

## 1430

### Prompt

Add a pre-commit hook that blocks commit if staged files under .cursor/archive contain common secret patterns.

### Response / actions

✅ **IMPLEMENTED**: Added scripts/check-archive-secrets.sh and spec at .cursor/ARCHIVE_PRE_COMMIT_SPEC.md. Installed as .git/hooks/pre-commit.
```

---

## Sensitive information

- Do **not** paste API keys, tokens, passwords, or internal URLs into chat (or redact before archiving).
- When archiving, summarize intent instead of quoting sensitive content.
- Pre-commit hook (see `ARCHIVE_PRE_COMMIT_SPEC.md`) should scan staged archive (and optionally other) files and block commit on matches.

# Archive this chat

When the user asks to archive this chat (e.g. "/archive this chat" or "/archive this chat &lt;topic&gt;"):

1. **Read** `.cursor/archive/ARCHIVE_ENTRY_TEMPLATE.md` and follow its structure exactly.

2. **Target file:** Create or append to `.cursor/archive/YYYY-MM/YYMMDD-<topic>.md`. Use a **brief chat topic** in the filename: lowercase, hyphenated, a few words (e.g. `260209-home-page-sections.md`, `260207-slider-sort-and-perf.md`). If the user supplied a topic after "archive this chat", use that; otherwise infer a short topic from the conversation. For a brand-new session with no clear topic, use plain `YYMMDD.md`.

3. **Add one session entry:**
   - Section: `## HHMM` using current 24-hour time with no colon (e.g. `2130`).
   - Optionally add a short summary in the heading: `## 2130 home page sections`.
   - Include either the full variant (`### Prompt` and `### Response / actions`) or the minimal variant (see template).
   - In **Prompt**: user’s request or topic (no API keys, tokens, passwords, or internal URLs).
   - In **Response / actions**: what was done (summary, bullets, ✅ **IMPLEMENTED** / **RESOLVED** / **FIXED** as appropriate).

4. **Create folder** `.cursor/archive/YYYY-MM/` if it does not exist.

5. **If the file is new:** start with line `# YYMMDD` then the session entry. **If appending:** add only the new `## HHMM` section. (First line of the file is always `# YYMMDD`; the topic appears only in the filename.)

6. **Do not** include sensitive information; summarize instead of quoting secrets.

After writing the entry, reply briefly that the chat was archived and give the path to the file (e.g. `.cursor/archive/2026-02/260209-home-page-sections.md`). Optionally add: to publish to GitHub Pages, run `./scripts/sync-archive-to-docs.sh` and commit `docs/archive/`.

# Archive this chat

When the user asks to archive this chat (e.g. "/archive this chat" or "/archive this chat &lt;topic&gt;"):

1. **Read** `.cursor/archive/ARCHIVE_ENTRY_TEMPLATE.md` and follow its structure exactly.

2. **Current date:** Get today's date by running in the shell: `date +%Y-%m-%d` for YYYY-MM-DD and `date +%y%m%d` for YYMMDD. Use this output for paths and filenames. Do **not** use the date from user_info or other context.

3. **Target file:** Create or append to `.cursor/archive/YYYY-MM/YYYY-MM-DD/YYMMDD-<topic>.md`. Use a **brief chat topic** in the filename: lowercase, hyphenated, a few words (e.g. `260209-home-page-sections.md`, `260207-slider-sort-and-perf.md`). If the user supplied a topic after "archive this chat", use that; otherwise infer a short topic from the conversation. For a brand-new session with no clear topic, use plain `YYMMDD.md`.

4. **Add one session entry:**
   - Section: `## HHMM` using current 24-hour time with no colon (e.g. `2130`).
   - Optionally add a short summary in the heading: `## 2130 home page sections`.
   - Include either the full variant (`### Prompt` and `### Response / actions`) or the minimal variant (see template).
   - In **Prompt**: the user’s prompt as written (verbatim). Do not summarize. Redact only API keys, tokens, passwords, or internal URLs.
   - In **Response / actions**: what was done (summary, bullets, ✅ **IMPLEMENTED** / **RESOLVED** / **FIXED** as appropriate).
   - If a plan file in the workspace (`.cursor/plans/*.plan.md`) is associated with this chat, add a link to it in the archive entry (e.g. at the start of **Response / actions** or as a **Plan** line).

5. **Create folders** `.cursor/archive/YYYY-MM/` and `.cursor/archive/YYYY-MM/YYYY-MM-DD/` if they do not exist (e.g. `2026-02/` and `2026-02/2026-02-09/`).

6. **If the file is new:** start with line `# YYMMDD` then the session entry. **If appending:** add only the new `## HHMM` section. (First line of the file is always `# YYMMDD`; the topic appears only in the filename.)

7. **Do not** include sensitive information; redact API keys, tokens, passwords, or internal URLs in the prompt (e.g. replace with `[REDACTED]`); do not summarize the prompt itself.

After writing the entry, reply briefly that the chat was archived and give the path to the file (e.g. `.cursor/archive/2026-02/2026-02-09/260209-home-page-sections.md`). Optionally add: to publish to GitHub Pages, run `./scripts/sync-archive-to-docs.sh` and commit `docs/archive/`.

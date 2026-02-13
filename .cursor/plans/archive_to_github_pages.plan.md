# Move Cursor archive to GitHub Pages (developer portal) — updated

## Current setup (no change needed)

- **GitHub Pages**: Already live at https://lacoda-labs.github.io/geodistricts/
- **Workflow**: Pages build and deployment via GitHub Actions  
  https://github.com/Lacoda-Labs/geodistricts/actions/workflows/pages/pages-build-deployment
- **Landing**: [README.md](README.md) is the landing page.

So we do **not** create a new portal or enable Pages; we add the archive so the existing site serves it and link from the existing landing (README).

---

## Rationale and feedback (unchanged)

- **Publish a copy, do not move**: Keep [`.cursor/archive/`](.cursor/archive/) as the single source of truth. Publish a copy wherever the Pages deployment serves from so the archive is available at a stable public URL.
- **Two audiences**: Humans (project evolution, “first vibe” development); agents (context for analysis, per [REFERENCE_IMPLEMENTATION.md](doc/protocol/REFERENCE_IMPLEMENTATION.md)).

---

## Where to put the archive

The Pages workflow determines the deployed root. Common cases:

1. **Deploy from branch (e.g. main) with root = repo root**  
   Then the site serves from the repo root and README is the index. Add an **`archive/`** folder at **repo root** so the archive is at `https://lacoda-labs.github.io/geodistricts/archive/`.

2. **GitHub Actions builds an artifact from a folder (e.g. `docs/` or `site/`)**  
   Then add **`archive/`** inside that folder (e.g. `docs/archive/`) and ensure the workflow includes it in the artifact. Archive URL would be `https://lacoda-labs.github.io/geodistricts/archive/` (or `.../docs/archive/` if the workflow deploys a subpath).

**Action**: Confirm where the pages workflow expects content (repo root vs a subfolder). Then place the archive folder there. The rest of the plan assumes **repo root `archive/`**; if the workflow uses a subfolder, use that folder instead.

---

## Implementation plan (revised)

### 1. Add archive under the Pages-served root

- Create **`archive/`** at repo root (or inside the folder the Pages workflow uses).
- **Initial content**: Copy current [`.cursor/archive/`](.cursor/archive/) into `archive/`, excluding `.gitkeep`.
- Add **`archive/README.md`** explaining:
  - **Purpose**: Open development; summarized AI pair-programming sessions published for transparency.
  - **Content**: Summarized Cursor/IDE sessions (prompt + response/actions), `YYYY-MM/YYMMDD[-topic].md`.
  - **Audiences**: Humans (project evolution, requirements); agents (context for analysis; see [REFERENCE_IMPLEMENTATION.md](doc/protocol/REFERENCE_IMPLEMENTATION.md)).
  - **Format**: Reference in-repo [.cursor/archive/ARCHIVE_ENTRY_TEMPLATE.md](.cursor/archive/ARCHIVE_ENTRY_TEMPLATE.md); no secrets (pre-commit in repo).
  - **Canonical source**: This is a published copy of [`.cursor/archive/`](.cursor/archive/); add entries in repo via the archive command.

### 2. Link from the landing (README.md)

- In [README.md](README.md), add a short “Developer portal” or “Documentation” line that links to the archive, e.g.:
  - **Archive (AI session summaries):** [lacoda-labs.github.io/geodistricts/archive/](https://lacoda-labs.github.io/geodistricts/archive/)
- Place it where it fits (e.g. near “Architecture & Tech Stack” or “Contributing”).

### 3. Sync script

- Add **`scripts/sync-archive-to-docs.sh`** (or `scripts/sync-archive-to-pages.sh`) that copies `.cursor/archive/` → `archive/` (or → the folder used by Pages), excluding `.gitkeep`.
- **When to run**: After archiving, run the script and commit changes so the next Pages build/deploy includes updated archive content. Optionally mention in the archive command reply: “To publish to GitHub Pages, run scripts/sync-archive-to-pages.sh and commit the archive/ folder.”

### 4. Optional

- **Index**: Script generates **`archive/INDEX.md`** (date, path, one-line summary) for discoverability.
- **REFERENCE_IMPLEMENTATION.md**: Add that the archive is also published at https://lacoda-labs.github.io/geodistricts/archive/ for URL-based context.
- **CONTRIBUTING / .cursor/README**: Note that archived sessions are published to GitHub Pages.

### 5. Pages workflow

- If the Pages workflow only deploys a specific directory (e.g. `docs/`), ensure **`archive/`** is inside that directory and that the workflow includes it in the deployment artifact. No change to workflow is needed if the site already serves from repo root and includes all tracked files.

---

## Summary of changes from original plan

| Original assumption | Update |
|---------------------|--------|
| GitHub Pages not set up; create `docs/` and portal landing | Pages exists; README is landing. No new portal; add archive to served root and link from README. |
| Enable Pages from `docs/` on main | Use existing Pages + pages workflow; place archive where that workflow serves from (likely repo root `archive/`). |
| `docs/README.md` as portal index | Omit; README.md at repo root is already the index. |

---

## Files to add or change

| Action | Path |
|--------|------|
| Create | `archive/README.md` (purpose, audiences, format, canonical source) |
| Create | `archive/` (initial copy of `.cursor/archive/` minus `.gitkeep`) |
| Create | `scripts/sync-archive-to-pages.sh` (or sync-archive-to-docs.sh) |
| Edit | `README.md` (add link to archive in Developer portal / Documentation) |
| Optional | `archive/INDEX.md` (generated by script) |
| Optional | One line in `doc/protocol/REFERENCE_IMPLEMENTATION.md` (public archive URL) |
| Optional | Note in CONTRIBUTING or `.cursor/README.md` about archive being published |

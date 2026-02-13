# Archive — AI session summaries

## Purpose

GeoDistricts is built in the open. This folder publishes **summarized AI pair-programming sessions** (Cursor/IDE chats) so the project’s evolution and intent are visible. Requirements and design decisions often live in these sessions.

## Content

- **Summarized** Cursor/IDE chat sessions: prompt + response/actions, not raw logs.
- One file per day or topic: `YYYY-MM/YYMMDD[-topic].md` (e.g. `2026-02/260212-poligeo-documentation.md`).
- No secrets or credentials; the repo uses a pre-commit hook to block accidental commits of sensitive content in the canonical archive.

## Audiences

- **Humans**: See how a senior engineer uses AI-assisted “first vibe” development; trace requirements and design over time.
- **Agents / LLMs**: Use as context for project analysis, maintenance, or extension. The reference implementation doc describes using “prompt archive/history” as optional context: [REFERENCE_IMPLEMENTATION.md](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/protocol/REFERENCE_IMPLEMENTATION.md).

## Format

- Structure (date heading, time sections, optional Prompt / Response subsections) follows the in-repo template: [.cursor/archive/ARCHIVE_ENTRY_TEMPLATE.md](https://github.com/Lacoda-Labs/geodistricts/blob/main/.cursor/archive/ARCHIVE_ENTRY_TEMPLATE.md).

## Canonical source

This folder is a **published copy** of [.cursor/archive/](https://github.com/Lacoda-Labs/geodistricts/tree/main/.cursor/archive) in the repo. The authoritative copy and all new entries live there. To add an entry, use the archive command in the repo; to update this copy on the site, run `./scripts/sync-archive-to-docs.sh` and commit `docs/archive/`.

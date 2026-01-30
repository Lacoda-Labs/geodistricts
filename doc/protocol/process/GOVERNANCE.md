# GeoDistricts Protocol Governance

This document describes who maintains the protocol, how GDIP versions and protocol releases are tagged, and how the changelog/index is updated.

## Maintainers

- Protocol maintainers are responsible for reviewing GDIP pull requests, merging accepted GDIPs, and updating the GDIP index and changelog.
- Maintainer list and contact: TBD (e.g. in README or CODEOWNERS in the protocol repo).
- The reference implementation (geodistricts repo) is maintained separately; it tracks which protocol version (or GDIP set) it implements.

## GDIP Versioning

- Each GDIP has a **version** (e.g. 1.0) and **status** (Draft, Review, Accepted).
- Changes to an accepted GDIP should be done by:
  - **Errata**: Small fixes (typos, clarifications) via PR; version stays 1.0 or bump patch (1.0 → 1.1).
  - **Supersession**: Substantive changes may require a new GDIP or a new version (e.g. GDIP-002 v2) that supersedes the previous version; document in the GDIP and in the index.

## Protocol Releases

- A **protocol release** is a named set of GDIP versions (e.g. "Protocol 1.0" = GDIP-002 v1, GDIP-003 v1, GDIP-004 v1).
- Releases are tagged in the protocol repo (e.g. git tag `protocol-v1.0`) and optionally documented in CHANGELOG.md.
- The reference implementation (geodistricts repo) should document which protocol version or tag it implements (e.g. in README or doc/protocol/REFERENCE_IMPLEMENTATION.md).

## Changelog and Index

- **GDIP index**: [GDIPs/README.md](../GDIPs/README.md) lists all GDIPs with number, title, status, required/optional, and short description. Update this file when a GDIP is accepted or revised.
- **CHANGELOG.md**: Optional; at repo root, list protocol releases and summary of changes (e.g. "Protocol 1.0: initial required GDIPs 002–004").

## Iterative Execution

Building and executing the protocol plan is **iterative**. Each GDIP will need review, revision, and edits. The order of work is a sequence of steps, not one-shot; expect to cycle on GDIP drafts, feedback, and protocol-repo setup.

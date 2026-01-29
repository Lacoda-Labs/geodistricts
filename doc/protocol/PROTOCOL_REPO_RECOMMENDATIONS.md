# GeoDistricts Protocol Repository: Recommendations

This document provides recommendations for creating and maintaining a **separate GitHub repository** for the GeoDistricts Protocol (GDPIPs, governance, index). This repository (geodistricts) is the **reference implementation**, not the protocol repo.

## Purpose of the Protocol Repo

- **Host**: GDPIPs (GeoDistricts Protocol Improvement Proposals), GDPIP process/governance docs, protocol index and changelog.
- **Scope**: Specification and process only. No application code.
- **Relationship**: Protocol repo = source of truth for the spec; geodistricts repo = reference implementation that implements the protocol and links to the protocol repo by version/tag.

## Organization Choice

### Option A: Under Lacoda-Labs (https://github.com/Lacoda-Labs)

**Pros:**
- Keeps "Lacoda ecosystem" visible (GeoDistricts protocol alongside web3 democracy/NDN protocol, alivevote reference implementation, etc.).
- Single org for discoverability and maintenance.
- Simpler access control if the same maintainers own multiple projects.

**Cons:**
- Protocol may be perceived as tied to one organization rather than neutral.
- Multi-implementer or third-party adoption might prefer a neutral namespace.

### Option B: Separate organization (e.g. `geodistricts-protocol` or `GeoDistricts-Protocol`)

**Pros:**
- Signals protocol neutrality and multi-implementer ownership.
- Clear separation: protocol org vs implementation org (e.g. Lacoda-Labs/geodistricts).
- Aligns with patterns like Ethereum (ethereum/EIPs) or Nostr (nostr-protocol/nips).

**Cons:**
- Additional org to create and maintain.
- Discoverability may require cross-linking from Lacoda-Labs.

### Recommended option

**Recommendation: Start under Lacoda-Labs** (e.g. `Lacoda-Labs/geodistricts-protocol`). Rationale:

- Lower operational overhead; Lacoda-Labs already hosts related OSS.
- The protocol can be moved or mirrored to a separate org later if neutrality becomes important for adoption (e.g. state governments, other implementers).
- Document in the protocol repo README that the protocol is open for adoption by any implementer and that governance is transparent (GDPIP process).

## Repository Layout

Suggested structure for the protocol repo:

```
geodistricts-protocol/
├── README.md                 # Project intro, link to reference implementation, index of GDPIPs
├── process/                  # Governance and process
│   ├── GDPIP-PROCESS.md      # How to submit, discuss, adopt GDPIPs
│   ├── GDPIP-TEMPLATE.md     # Template for new GDPIPs
│   └── GOVERNANCE.md         # Maintainers, releases, versioning
├── GDPIPs/                    # Numbered spec files
│   ├── README.md             # Index: list of GDPIPs (required vs optional), status
│   ├── gdpip-001-*.md        # Example: data model
│   ├── gdpip-002-*.md        # Example: required data sources
│   └── ...
└── CHANGELOG.md              # Optional: protocol release history
```

- **GDPIPs/**: One file (or small set) per GDPIP; naming e.g. `gdpip-NNN-short-title.md`.
- **process/**: Single source of truth for how to change the protocol; no application code.

## Relationship Between Repos

| Repo | Role | Contents |
|------|------|----------|
| **Protocol repo** (e.g. `Lacoda-Labs/geodistricts-protocol`) | Spec and process | GDPIPs, process/, README with index, CHANGELOG |
| **geodistricts** (this repo) | Reference implementation | Application code, docs that reference protocol by version/tag |

- In the **protocol repo** README: link to the reference implementation (e.g. `Lacoda-Labs/geodistricts` or project URL), and state that implementers can use the protocol independently.
- In the **geodistricts** repo: document which protocol version (or GDPIP set) this implementation follows; link to the protocol repo. See `doc/protocol/REFERENCE_IMPLEMENTATION.md` (created in this repo) and CONTRIBUTING.md section "Protocol changes."

## Creating the New Repo

1. Create a new repository under the chosen org (e.g. `Lacoda-Labs/geodistricts-protocol`).
2. Copy the contents of this project's `doc/protocol/process/` and `doc/protocol/GDPIPs/` (index and any initial GDPIPs) into the new repo's `process/` and `GDPIPs/` directories.
3. Add a README in the new repo that includes the index of GDPIPs and a link to the reference implementation.
4. Optionally add a LICENSE (e.g. CC-BY or MIT for docs) and CONTRIBUTING that points to the GDPIP process.

The reference implementation (this repo) will retain a copy of the process template and GDPIP index under `doc/protocol/` for local reference and for drafting GDPIPs until the protocol repo is created; once the protocol repo exists, links should point to it as the canonical source.

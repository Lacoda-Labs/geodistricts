# GDIP-006: Comparison Metrics (Existing Districts vs Geodistricts) — Optional

**Status**: Draft  
**Type**: Optional  
**Created**: 2026-01-28  
**Updated**: 2026-01-29

## Summary

Defines metrics and methods for comparing **existing** (e.g. enacted) congressional districts with **geodistricts** produced by the protocol. Implementations MAY implement this GDIP to report population variance, contiguity, partisan balance, and demographic differences between current maps and protocol-generated maps.

## Motivation

Researchers, advocates, and legislators need to compare current districts with algorithmically generated ones to assess fairness and impact. This GDIP specifies what to compare and how, so that results are consistent and interpretable across implementations.

## Specification

### 1. Scope

- **Input**: (a) Geodistricts (output of GDIP-004); (b) existing district boundaries (e.g. from Census TIGER current congressional districts or state-provided shapefiles). Optional: voter registration or demographic data per geography.
- **Output**: Comparison metrics (e.g. population variance, contiguity, partisan balance, demographic breakdown) for both existing and geodistrict maps; optionally difference metrics (e.g. change in partisan share by district).

### 2. Data sources for existing districts

- **Boundaries**: U.S. Census TIGER/Line current congressional districts (e.g. 116th/118th Congress), or state GIS portals. Format: GeoJSON or shapefile; district identifier (e.g. CD118FP) and state FIPS.
- **Matching**: Existing districts are built from census blocks; they may split census tracts. Implementations MUST document how tract-level (or block-level) data is assigned to existing districts (e.g. by centroid containment or area overlay). See [CONGRESSIONAL_DISTRICT_COMPARISON_PLAN](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/history/CONGRESSIONAL_DISTRICT_COMPARISON_PLAN.md).

### 3. Metrics

- **Population variance**: Per district, (population − target) / target; report for both existing and geodistrict maps. Compare: e.g. mean absolute variance, max variance.
- **Contiguity**: Per district, percentage of tracts (or blocks) with at least one adjacent tract in the same district. Report for both maps; compare.
- **Partisan balance** (optional): If voter registration or election data is available, aggregate to each district (existing and geodistrict). Report party share per district; compare e.g. efficiency gap, mean district partisan lean.
- **Demographics** (optional): If demographic data is available (GDIP-005), report per-district demographics for both maps; compare e.g. racial composition, age distribution.

### 4. No impact on boundaries

- This GDIP does NOT change the core algorithm. Comparisons are performed **after** geodistricts are generated. The protocol does not use comparison results to redraw boundaries.

### Required vs Optional

**Optional**: Implementations MAY implement this GDIP. Conforming implementations that do not implement it do not report comparison metrics; boundary output and core protocol are unchanged.

### Data model impact

- Optional: comparison report structure (e.g. per-state summary, per-district metrics). Schema can be specified in reference implementation or a future GDIP.

### Backward Compatibility

- Fully backward compatible; additive only.

## Reference Implementation

- [doc/history/CONGRESSIONAL_DISTRICT_COMPARISON_PLAN.md](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/history/CONGRESSIONAL_DISTRICT_COMPARISON_PLAN.md)  
- [PoliGeo Analyst](https://github.com/Lacoda-Labs/geodistricts/blob/main/doc/pages/POLIGEO_ANALYST.md) — partisan balance and comparison to current US House representation.
- [backend/services/representation-comparison.js](https://github.com/Lacoda-Labs/geodistricts/blob/main/backend/services/representation-comparison.js)

## References

- [GDIP-002: Data Model](gdip-002-data-model.md)  
- [GDIP-004: Core Algorithm](gdip-004-core-algorithm.md)  
- [GDIP-005: Demographics for New Geodistricts](gdip-005-demographics.md) (optional)

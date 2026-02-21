# Code Standards & Algorithm Principles

## Algorithm Principles
1. **Population Equality First**: Districts must be as close to equal population as possible (target: <1% variance)
2. **Contiguity Preferred**: Districts should be contiguous when possible, but discontiguity is acceptable for geographic barriers
3. **Objective & Automated**: No human intervention; algorithm runs deterministically based on census data
4. **Hierarchical Division**: Use administrative boundaries (counties) as natural grouping units before fine-tuning with census tracts

## Key Implementation Details
- Two-phase division strategy: County-level → Tract-level refinement
- Alternating latitude/longitude sorting for geographic distribution
- Step-by-step visualization and logging for transparency
- Population variance tracking and contiguity scoring

## Code Quality Standards
- Use TypeScript strict mode
- Follow Angular style guide for frontend code
- **Use Angular signals** for reactive component state: `signal()` for writable state, `computed()` for derived values (e.g. disabled state from multiple loading flags). Prefer signals over plain class properties so the template updates automatically without manual change detection.
- Use async/await for asynchronous operations
- Include error handling and logging
- Write self-documenting code with clear variable names
- Add comments for complex algorithm logic

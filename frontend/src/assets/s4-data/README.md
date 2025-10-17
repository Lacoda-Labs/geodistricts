# Brown University S4 Project - Diversity and Disparities Dataset

This directory contains adjacency data files from the Brown University S4 project's Diversity and Disparities dataset.

## Files Required

To use the Brown S4 algorithm, download the following files from:
https://s4.ad.brown.edu/projects/diversity/Researcher/Pooling.htm

### For 2020 Census Data:
- `tract_2020.csv` - Contains tract IDs and metadata
- `nlist_2020.csv` - Contains adjacency relationships (FID = focal tract ID, NID = neighbor ID)

### File Format:
- **tract_2020.csv**: Contains columns like GEOID, STATE, COUNTY, TRACT, etc.
- **nlist_2020.csv**: Contains columns FID (focal tract ID) and NID (neighbor tract ID)

## Usage

The Brown S4 algorithm uses these pre-computed adjacency files to build a reliable adjacency graph for census tracts, ensuring better contiguity in district generation compared to on-the-fly geometric calculations.

## Notes

- Files are ~10-50 MB per year
- Queen's contiguity weights matrix (including self-loops)
- Derived from TIGER/Line shapefiles
- Handles barriers like water/islands implicitly (no edge if no shared boundary)
- More reliable than geometric intersection calculations

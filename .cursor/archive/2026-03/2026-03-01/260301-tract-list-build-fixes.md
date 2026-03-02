# 260301

## 1400 tract list template build fixes

### Prompt

@/Users/jeffmorgan/.cursor/projects/Users-jeffmorgan-work-geodistricts/terminals/4.txt:7-188

### Response / actions

- User shared terminal output showing build errors: TS2531 (currentStep possibly null), TS2322 (devTractList possibly null), "Property 'trackByCountyFips' does not exist" (and trackByChunkStart, trackByTractId), and NG8107 warning on `chunk.tracts?.length`.
- **Template:** Fixed optional-chaining warning by using `chunk.tracts.length` instead of `chunk.tracts?.length` in the tract-list `[style.display]` binding (chunk.tracts is always defined in the getter’s type).
- **Component:** Verified non-null assertions (`this.currentStep!.districtGroups!`, `this.devTractList!`) and the three trackBy methods (trackByCountyFips, trackByChunkStart, trackByTractId) are present in maps-page.component.ts. No code changes needed for those; suggested restarting dev server or clearing .angular/dist if errors persist.

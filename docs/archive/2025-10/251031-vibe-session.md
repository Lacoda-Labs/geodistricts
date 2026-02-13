# 251031 vibe session (happy halloween)
see ./251030-step-by-step.md

our goal tonight is to continue to debug moving west with our lat sort.

## step 3 (continuing from yesterday)
the third tract should be 950102
the algo current selects 002000 as the third tract 
however, 950102 is completely enclosed within 950103
so our next step should be to modify the algo to always add any enclosed tracts within the current tract. 
once enclosed tracts are added, continue on with moving west.
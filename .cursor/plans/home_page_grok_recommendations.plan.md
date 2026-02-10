# Home Page Improvements (from Grok chat 260209)

Plan is based on [.cursor/archive/2026-02/260209-grok-home-page.md](.cursor/archive/2026-02/260209-grok-home-page.md). Grok’s second reply recommends **keeping the homepage concise** (~3–5 sections, 3–5 scrolls) and moving deeper content to dedicated pages later. This plan only changes the existing home page and does not add new routes.

---

## Design constraint: concise homepage

- Keep current five sections: Hero, Problem, Solution, Principles, Support.
- Do not add long new sections; optional micro-elements (e.g. one trust line, one CTA block) are small.
- Deeper content (algorithm details, VRA/legal, “Why Now” long-form) stays out of scope or is a single short sentence/link where suggested below.

---

## Phase 1: Quick wins (typo, Solution copy, CTA)

**1.1 Fix typo (Principles)**  
- In [frontend/src/app/pages/home-page.component.html](frontend/src/app/pages/home-page.component.html) line 108: change **"protocal"** to **"protocol"** in the Full Transparency card description.

**1.2 Strengthen Solution section copy**  
- In the same file, Solution block (~lines 68–92):
  - **Subtitle:** Change to: *"A simple, transparent, three-step algorithm that any citizen can verify and reproduce from public data."*
  - **Step 1 title:** "Start With **Neutral** Geography".
  - **Step 1 description:** Use only official state boundaries and U.S. Census population data (tract or block level). No voter history, party data, or incumbent addresses — just people and places.
  - **Step 2 title:** "Recursive **Latitude & Longitude** Splits".
  - **Step 2 description:** Alternately divide the state with straight north-south (longitude) and east-west (latitude) lines, balancing population as evenly as possible. For odd numbers of districts, splits can be uneven (e.g., 7 vs. 6). Lines snap to census tract boundaries for clean, practical divisions.
  - **Step 3 title:** "**Equal, Compact** Districts".
  - **Step 3 description:** The result: 435 contiguous, geographically compact districts with population deviation under ~1%. Deterministic, open-source, and reproducible by anyone.
  - Add **numbered** step titles in the copy (e.g. "1. Start With Neutral Geography") for scannability.

**1.3 Solution CTA block**  
- After the three step cards, add a short CTA block inside the Solution section:
  - One line: e.g. *"See the algorithm in action."*
  - One primary button: **"View All 50-State Maps"** (or "Explore the 50-State Maps") that uses the existing `navigateToItem(..., route: '/maps')` pattern.
- Reuse existing section styles; add a small wrapper class (e.g. `solution-cta`) if needed in [frontend/src/app/pages/home-page.component.scss](frontend/src/app/pages/home-page.component.scss).

**1.4 Hero: primary button and Learn More**  
- Change primary button text from "See How It Works" to **"Explore the 50-State Maps"** (or keep "See How It Works" but ensure it already goes to `/maps` — currently it does).
- Make "Learn More" scroll to `#solution`: e.g. `navigateToItem({ id: 'solution', label: 'Learn more', route: null })` so it smooth-scrolls to the Solution section (ensure `id="solution"` exists on the section — it does).

---

## Phase 2: Problem section — stats and “Why Now”

**2.1 Update stat copy (no fabricated stats)**  
- **First stat:** Replace "59% of Americans believe congressional districts are drawn unfairly" with a more current, defensible line. Grok suggested something like "Large majorities across parties view gerrymandering as a major problem" or a 2025-style framing; **use only if you have a real source** (e.g. linked poll). Otherwise keep the current line or a generic "Most Americans believe districts are drawn unfairly" until a citation is added.
- **Second stat:** Refine to something like "Fewer than 5% of House seats are truly competitive in recent cycles" (or keep "90%+ safe" with minor wording tweak).
- **Third stat:** Keep as is: "0 states use a purely objective, algorithm-based redistricting method."

**2.2 Add a short “Why Now” hook**  
- After the main Problem paragraph, add one sentence before the stat boxes, e.g.: *"Even as states engage in a rare wave of mid-decade redistricting in 2025–2026, politicians continue to draw the lines."* (Or a one-line variant that fits the tone.)

---

## Phase 3: Optional enhancements (lower priority)

**3.1 Hero trust line**  
- Below the hero description, add one short line, e.g.: *"Open-source · Public census data only · Prototype maps for all 50 states."* Style as subtle, small text so the hero stays concise.

**3.2 Principles: optional rephrase**  
- Consider renaming "Full Transparency" to **"Citizen Verifiable"** and tightening the description to emphasize GitHub and running the implementation (e.g. "The full reference implementation is open-source on GitHub — anyone can run it independently."). Optional; can be skipped if you prefer to keep "Full Transparency."

**3.3 Support section: one extra CTA**  
- Add one more action, e.g. **"Star on GitHub"** (link to repo) or **"Share on X with #GeoDistricts"** (link to X or a thread). Keep the list short (2–3 actions) to avoid clutter.

**3.4 Button consistency**  
- Audit hero and Solution buttons: use one pattern (e.g. `mat-flat-button` or `matButton="filled"`) and same class naming where appropriate. Document in the plan or a short comment if you standardize.

---

## Phase 4: Orange → Material design colors

- **Goal:** Replace the custom orange/gold accent (`$section-accent: #c5943c`) with the app’s Material design tokens so section labels, stat numbers, step icons, principle icons, and support primary button use the same palette as the rest of the app.
- **In [frontend/src/app/pages/home-page.component.scss](frontend/src/app/pages/home-page.component.scss):**
  - Replace or alias `$section-accent` with a Material token (e.g. `var(--mat-sys-primary, #2B638B)` as used on about-page, or the theme primary/accent). Use that token everywhere `$section-accent` is currently used: section labels, `.stat-number`, step/principle icon backgrounds, `.support-btn-primary`.
  - Remove or override any hardcoded `#c5943c` so all accent usage comes from the theme.
- **Check:** Section label, stat box numbers, Solution step icon wrap, Principles card icon wrap, and Support primary button should all use the chosen token for a consistent look.

---

## Phase 5: Hero map on small devices

- **Goal:** On smaller viewports, the hero map should not shrink too much and center; it should use more width and sit under the hero tagline.
- **In [frontend/src/app/pages/home-page.component.scss](frontend/src/app/pages/home-page.component.scss):**
  - Add a media query for small devices (e.g. `max-width: 768px` or match existing breakpoints). For the hero:
    - **`.hero-container`:** Set `max-width: 90%` (and keep or set `width: 90%`) so the map and copy can use 90% of the viewport width instead of the current 70%.
    - **Alignment:** Change layout so the hero content aligns to the **top** just under the tagline: e.g. `align-items: flex-start` on `.hero-section` or `.hero-container`, and ensure the map (`.hero-map-bg`) and copy (`.hero-copy`) are positioned so the map sits top-aligned (e.g. `top: 0` or similar so it starts below the tagline rather than centered vertically). Adjust padding/margin so the tagline remains at the top, then the map fills below it with max-width 90%.
  - Ensure the hero tagline stays visible and the map doesn’t overlap it; the map can fill the remaining space below the tagline (and optional trust line) and above the headline/description/buttons, or flow as a top-aligned block depending on desired layout.
- **Result:** On small devices, hero map is 90% width and top-aligned just under the hero tagline instead of centered and shrinking.

---

## Phase 6: Explicitly out of scope (for later)

- **New pages:** No new routes in this plan. Ideas for later: `/how-it-works` (algorithm detail, diagrams), `/approach` or `/faq` (VRA/opt-in), blog for “Why Now” long-form.
- **Solution diagram:** Grok suggested a small recursive-split or compact-vs-gerrymandered visual; treat as a future enhancement (asset + placement in Solution or on a dedicated page).
- **Email signup, sticky floating button, schema/SEO:** Not in scope for this plan; can be separate tasks.

---

## Files to touch

| File | Changes |
|------|--------|
| [frontend/src/app/pages/home-page.component.html](frontend/src/app/pages/home-page.component.html) | Typo fix; Solution titles/descriptions and numbering; Solution CTA block; Hero button text and Learn More scroll target; Problem stat text and “Why Now” sentence; optional trust line, Principles rephrase, Support CTA. |
| [frontend/src/app/pages/home-page.component.scss](frontend/src/app/pages/home-page.component.scss) | Optional: `.solution-cta`; spacing for trust line. **Phase 4:** Replace `$section-accent` with Material token throughout. **Phase 5:** Small-screen media query — hero container 90% width, hero content top-aligned so map sits just under tagline. |

---

## Order of implementation

1. Phase 1 (typo, Solution copy, Solution CTA, Hero button + Learn More scroll).
2. Phase 2 (Problem stats and “Why Now”).
3. Phase 4 (orange → Material design colors).
4. Phase 5 (hero map 90% width + top-align on small devices).
5. Phase 3 as desired (trust line, Principles, Support, button consistency).

No new routes or new components required; all edits are content and layout in the existing home page and styles.

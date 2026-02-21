# 260220

## 1600 play button advances on step complete

### Prompt

1. what does play button do
2. but that is not a good implementation. instead it should cycle through steps only as a step completes, until final step is completed. ie. automates the user clicking next until final step.
3. Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself. To-do's from the plan have already been created. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.
4. /archive

### Response / actions

Plan: [.cursor/plans/play_advances_on_step_complete_20110cf9.plan.md](.cursor/plans/play_advances_on_step_complete_20110cf9.plan.md)

- **Play button behavior:** Explained current behavior (2s interval calling `nextStep()`); user requested event-driven advance only when a step completes.
- **Plan:** Created plan for event-driven play: remove interval, add `onStepDisplayComplete()` hook, call hook from every place a step finishes (sync path, visualization GET path, dev executeNextStep path), stop at final step via `canGoToNextStep()`.
- **IMPLEMENTED** in `frontend/src/app/pages/maps-page.component.ts`: Removed `playInterval`; `playSteps()` now sets `isPlaying = true` and calls `nextStep()` once; `pauseSteps()` only sets `isPlaying = false`. Added private `onStepDisplayComplete()` (if playing and no next step → `pauseSteps()`, else → `nextStep()`). Wired hook: after sync `renderFinalDistricts()` with `setTimeout(..., 0)`; in GET subscribe after `renderFinalDistricts()` and `cdr.markForCheck()`; inside executeNextStep `setTimeout(..., 100)` after `renderFinalDistricts()`; and in `isComplete && !newStep` branch before return so play stops at final step.

# 260225

## 1400 NG0100 UsCongressionalMapComponent

### Prompt

root_effect_scheduler.mjs:3597 ERROR _RuntimeError: NG0100: ExpressionChangedAfterItHasBeenCheckedError: Expression has changed after it was checked. Previous value: 'true'. Current value: 'false'. Expression location: UsCongressionalMapComponent component. Find more at https://angular.dev/errors/NG0100
    at throwErrorIfNoChangesMode (debug_node.mjs:6255:11)
    at bindingUpdated (debug_node.mjs:12924:17)
    at Module.ɵɵproperty (debug_node.mjs:23157:9)
    at UsCongressionalMapComponent_Template (us-congressional-map.component.html:29:8)
    at executeTemplate (debug_node.mjs:7939:9)
    at refreshView (debug_node.mjs:8975:13)
    at detectChangesInView (debug_node.mjs:9195:9)
    at detectChangesInViewIfAttached (debug_node.mjs:9195:5)
    at detectChangesInComponent (debug_node.mjs:9143:5)
    at detectChangesInChildComponents (debug_node.mjs:9221:9)

### Response / actions

✅ **FIXED**: NG0100 was caused by `loadStaticHero()` (called from `ngAfterViewInit` via `loadBoundaries()`) synchronously setting `isLoading = false`. The template *ngIf on line 29 (`variant === 'hero' && !heroAnimationDone && (heroAnimatedPaths.length || isLoading)`) was true initially, then flipped to false in the same change-detection cycle.

Deferred the clearing of `isLoading` to the next tick in `frontend/src/app/components/us-congressional-map.component.ts`: wrapped `this.isLoading = false` and `this.cdr.markForCheck()` in `queueMicrotask()` so the update runs after the current CD cycle. Left other state updates in `loadStaticHero()` synchronous.

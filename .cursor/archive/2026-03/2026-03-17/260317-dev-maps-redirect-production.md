# 260317

## 0035 dev-maps redirect on GCP public site

### Prompt

for public site deployed on GCP, prevent access to /dev/maps by having it redirect to /maps page.

### Response / actions

✅ **IMPLEMENTED**: Added `devMapsRedirectGuard` (frontend/src/app/guards/dev-maps-redirect.guard.ts): in production (`environment.production`) redirects any navigation to `/dev/maps` to `/maps` via `CanActivateFn` returning `UrlTree(['/maps'])`. Applied guard to the `dev/maps` route in app.routes.ts. Local dev unchanged: `/dev/maps` still loads when not in production.

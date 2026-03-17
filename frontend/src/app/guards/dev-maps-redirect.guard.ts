import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { environment } from '../../environments/environment';

/**
 * When deployed to production (GCP public site), prevent access to /dev/maps by redirecting to /maps.
 * In development (e.g. ng serve), /dev/maps remains available.
 */
export const devMapsRedirectGuard: CanActivateFn = () => {
  if (environment.production) {
    return inject(Router).createUrlTree(['/maps']);
  }
  return true;
};

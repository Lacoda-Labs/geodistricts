import { Routes } from '@angular/router';
import { CensusPageComponent } from './pages/census-page.component';
import { HomePageComponent } from './pages/home-page.component';
import { OldHomePageComponent } from './pages/oldhome-page.component';
import { StateMapPageComponent } from './pages/state-map-page.component';
import { CongressionalDistrictsViewerComponent } from './components/congressional-districts-viewer.component';
import { GeodistrictPageComponent } from './pages/geodistrict-page.component';
import { TractDebugPageComponent } from './pages/tract-debug-page.component';
import { AlgorithmComplexityPageComponent } from './pages/algorithm-complexity-page.component';
import { MapsPageComponent } from './pages/maps-page.component';
import { devMapsRedirectGuard } from './guards/dev-maps-redirect.guard';
import { VoterRegistrationAdminPageComponent } from './pages/voter-registration-admin-page.component';
import { PoliGeoAdminPageComponent } from './pages/poligeo-admin-page.component';
import { PrivacyPageComponent } from './pages/privacy-page.component';
import { TermsPageComponent } from './pages/terms-page.component';
import { ContributePageComponent } from './pages/contribute-page.component';
import { AboutPageComponent } from './pages/about-page.component';

export const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  { path: 'home', component: HomePageComponent },
  { path: 'oldhome', component: OldHomePageComponent },
  { path: 'census', component: CensusPageComponent },
  { path: 'map', component: StateMapPageComponent },
  { path: 'maps', component: MapsPageComponent, data: { mode: 'visualization' } },
  { path: 'dev/maps', component: MapsPageComponent, data: { mode: 'development' }, canActivate: [devMapsRedirectGuard] },
  { path: 'districts', component: CongressionalDistrictsViewerComponent },
  { path: 'geodistrict', component: GeodistrictPageComponent },
  { path: 'tract-debug', component: TractDebugPageComponent },
  { path: 'algorithm-complexity', component: AlgorithmComplexityPageComponent },
  { path: 'admin/voter-registration', component: VoterRegistrationAdminPageComponent },
  { path: 'admin/poligeo', component: PoliGeoAdminPageComponent },
  { path: 'privacy', component: PrivacyPageComponent },
  { path: 'terms', component: TermsPageComponent },
  { path: 'contribute', component: ContributePageComponent },
  { path: 'about', component: AboutPageComponent },
  { path: '**', redirectTo: '/home' }
];

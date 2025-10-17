import { Routes } from '@angular/router';
import { CensusPageComponent } from './pages/census-page.component';
import { HomePageComponent } from './pages/home-page.component';
import { StateMapPageComponent } from './pages/state-map-page.component';
import { CongressionalDistrictsViewerComponent } from './components/congressional-districts-viewer.component';
import { GeodistrictPageComponent } from './pages/geodistrict-page.component';
import { TractDebugPageComponent } from './pages/tract-debug-page.component';

export const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  { path: 'home', component: HomePageComponent },
  { path: 'census', component: CensusPageComponent },
  { path: 'map', component: StateMapPageComponent },
  { path: 'districts', component: CongressionalDistrictsViewerComponent },
  { path: 'geodistrict', component: GeodistrictPageComponent },
  { path: 'tract-debug', component: TractDebugPageComponent },
  { path: '**', redirectTo: '/home' }
];

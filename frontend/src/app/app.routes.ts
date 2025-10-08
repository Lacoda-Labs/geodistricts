import { Routes } from '@angular/router';
import { CensusPageComponent } from './pages/census-page.component';
import { HomePageComponent } from './pages/home-page.component';
import { StateMapPageComponent } from './pages/state-map-page.component';

export const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  { path: 'home', component: HomePageComponent },
  { path: 'census', component: CensusPageComponent },
  { path: 'map', component: StateMapPageComponent },
  { path: '**', redirectTo: '/home' }
];

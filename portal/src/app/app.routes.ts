import { Routes } from '@angular/router';
import { authGuard } from './guards/auth-guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginPage),
  },
  {
    path: 'runs',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/runs/runs').then((m) => m.RunsPage),
  },
  {
    path: 'runs/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/brief/brief').then((m) => m.BriefPage),
  },
  { path: '', pathMatch: 'full', redirectTo: 'runs' },
  { path: '**', redirectTo: 'runs' },
];

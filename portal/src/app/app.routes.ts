import { Routes } from '@angular/router';
import { authGuard } from './guards/auth-guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shared/layout/app-shell').then((m) => m.AppShellComponent),
    children: [
      { path: 'runs', loadComponent: () => import('./pages/runs/runs').then((m) => m.RunsPage) },
      {
        path: 'runs/:id',
        loadComponent: () => import('./pages/brief/brief').then((m) => m.BriefPage),
      },
      {
        path: 'cartera',
        loadComponent: () => import('./pages/cartera/cartera').then((m) => m.CarteraPage),
      },
      {
        path: 'clientes',
        loadComponent: () => import('./pages/clientes/clientes').then((m) => m.ClientesPage),
      },
      {
        path: 'clientes/nuevo',
        loadComponent: () =>
          import('./pages/clientes/cliente-crear').then((m) => m.ClienteCrearPage),
      },
      {
        path: 'clientes/:id',
        loadComponent: () =>
          import('./pages/clientes/cliente-perfil').then((m) => m.ClientePerfilPage),
      },
      {
        path: 'clientes/:id/ver',
        loadComponent: () =>
          import('./pages/clientes/cliente-vista').then((m) => m.ClienteVistaPage),
      },
      { path: '', pathMatch: 'full', redirectTo: 'runs' },
    ],
  },
  { path: '**', redirectTo: 'runs' },
];

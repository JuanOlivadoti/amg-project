import { Routes } from '@angular/router';
import { authGuard } from './guards/auth-guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginPage),
  },
  {
    /*
     * El entregable del restaurante cuelga de la RAÍZ, no del shell, y el orden acá **sí** es
     * load-bearing (a diferencia del de `runs/:id/informe` dentro del shell): tiene que ir ANTES de la
     * ruta `''`, que es la que intenta emparejar todo lo demás.
     *
     * Fuera del shell porque es una HOJA, no una pantalla: sin sidebar, sin header y sin el `lg:pl-64`
     * del contenedor. La spec pedía eso «con `@media print`»; sacarlo del shell lo hace verdad de
     * estructura en vez de verdad de CSS, y elimina los bugs de impresión que vienen de un sidebar
     * `fixed` y un margen que la hoja hereda. Ver la cabecera de `EntregablePage`.
     *
     * Lleva `authGuard` propio: al salir del shell, deja de heredar el suyo. Sin esta línea la hoja
     * sería alcanzable sin sesión (la API igual respondería 401, pero la pantalla sería una promesa
     * rota en vez de un redirect al login).
     */
    path: 'runs/:id/entregable',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/entregable/entregable').then((m) => m.EntregablePage),
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
        // Va DESPUÉS de `runs/:id` y no antes, y no cambia nada: el router de Angular no hace prefijo
        // parcial con una ruta sin hijas, así que `/runs/x/informe` no lo puede atrapar `runs/:id`.
        // El orden es por legibilidad —la pantalla que cuelga de la de arriba— no por precedencia.
        path: 'runs/:id/informe',
        loadComponent: () => import('./pages/informe/informe').then((m) => m.InformePage),
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
      {
        path: 'usuarios',
        loadComponent: () => import('./pages/usuarios/usuarios').then((m) => m.UsuariosPage),
      },
      {
        path: 'usuarios/:id',
        loadComponent: () =>
          import('./pages/usuarios/usuario-perfil').then((m) => m.UsuarioPerfilPage),
      },
      { path: '', pathMatch: 'full', redirectTo: 'runs' },
    ],
  },
  { path: '**', redirectTo: 'runs' },
];

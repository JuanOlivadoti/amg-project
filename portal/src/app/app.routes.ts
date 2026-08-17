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
     * load-bearing: tiene que ir ANTES de la ruta `''`, que intenta emparejar todo lo demás.
     *
     * Fuera del shell porque es una HOJA, no una pantalla: sin sidebar, sin header y sin el
     * `lg:pl-64` del contenedor. La spec pedía eso «con `@media print`»; sacarlo del shell lo hace
     * verdad de estructura en vez de verdad de CSS. Anidarlo bajo la ficha del cliente lo devolvería
     * al shell y reintroduciría los bugs de impresión — por eso lleva la URL del cliente pero no su
     * jerarquía.
     *
     * Lleva `authGuard` propio: al salir del shell, deja de heredar el suyo. Sin esta línea la hoja
     * sería alcanzable sin sesión (la API igual respondería 401, pero la pantalla sería una promesa
     * rota en vez de un redirect al login).
     */
    path: 'clientes/:id/research/:runId/entregable',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/entregable/entregable').then((m) => m.EntregablePage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shared/layout/app-shell').then((m) => m.AppShellComponent),
    children: [
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
        /*
         * La ficha es un SHELL con tabs, no una pantalla: carga el cliente una vez y sus hijas se
         * montan en su `<router-outlet>`. Va DESPUÉS de `clientes/nuevo` y eso sí es load-bearing:
         * `:id` empareja la palabra literal "nuevo" y se tragaría el alta. Hay un test.
         */
        path: 'clientes/:id',
        loadComponent: () =>
          import('./pages/clientes/cliente-ficha').then((m) => m.ClienteFichaComponent),
        children: [
          {
            path: 'perfil',
            loadComponent: () =>
              import('./pages/clientes/cliente-perfil').then((m) => m.ClientePerfilPage),
          },
          {
            path: 'research',
            loadComponent: () =>
              import('./pages/clientes/cliente-research').then((m) => m.ClienteResearchPage),
          },
          {
            path: 'research/:runId',
            loadComponent: () => import('./pages/brief/brief').then((m) => m.BriefPage),
          },
          {
            // Va DESPUÉS de `research/:runId` por legibilidad, no por precedencia: el router no hace
            // prefijo parcial con una ruta sin hijas, así que `research/x/informe` no lo puede
            // atrapar `research/:runId`.
            path: 'research/:runId/informe',
            loadComponent: () => import('./pages/informe/informe').then((m) => m.InformePage),
          },
          {
            // Placeholder deliberado: el Bloque F (respondedor de reseñas de Google) todavía no
            // tiene ni código ni spec. El tab existe para que el hueco se vea y se pueda nombrar.
            path: 'resenas',
            loadComponent: () =>
              import('./pages/clientes/cliente-resenas').then((m) => m.ClienteResenasPage),
          },
          {
            // Ídem, pero al revés: acá el backend YA existe (migración 0013, `PgIdeas`, tres
            // endpoints) y lo que falta son las pantallas — etapas 5-7 de la pieza 3.
            path: 'ideas',
            loadComponent: () =>
              import('./pages/clientes/cliente-ideas').then((m) => m.ClienteIdeasPage),
          },
          {
            // El detalle de UNA idea (Task 2). Va DESPUÉS de `ideas` por el mismo criterio que
            // `research/:runId/informe` va después de `research/:runId`: el router no hace prefijo
            // parcial con una ruta sin hijas, así que `ideas/x` no lo puede atrapar `ideas` — el
            // orden es por legibilidad, no por precedencia.
            path: 'ideas/:ideaId',
            loadComponent: () =>
              import('./pages/clientes/cliente-idea-detalle').then((m) => m.ClienteIdeaDetallePage),
          },
          {
            path: 'menu',
            loadComponent: () =>
              import('./pages/clientes/cliente-menu').then((m) => m.ClienteMenuPage),
          },
          { path: '', pathMatch: 'full', redirectTo: 'perfil' },
        ],
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
      {
        path: 'inicio',
        loadComponent: () => import('./pages/inicio/inicio').then((m) => m.InicioPage),
      },
      // La home del portal es `/inicio` desde el 2026-08-13: decisión de Juan al cerrar la Pieza 4
      // (Dashboard), en respuesta a la pregunta que el informe de cierre dejó abierta a propósito.
      // Antes era `clientes` (desde que Research dejó el menú, sin pantalla global a la que abrir);
      // `clientes` sigue siendo por donde empieza cualquier recorrido de un cliente puntual, solo
      // que ya no es lo primero que se ve al entrar.
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
    ],
  },
  { path: '**', redirectTo: 'clientes' },
];

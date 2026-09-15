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
            // Mismo motivo de orden que `research/:runId/informe`, arriba. Task 11 (sub-proyecto de
            // publicación en blog externo): los posts generados por un run `crear_posts`, enlazados
            // desde `brief.ts` — mismo patrón que el link "Ver el informe del research →".
            path: 'research/:runId/posts',
            loadComponent: () => import('./pages/posts/posts').then((m) => m.PostsPage),
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
          {
            // El detalle de UN plato, por posición — ver "Por qué la identidad de un plato es su
            // posición" en el spec. Va DESPUÉS de `menu` por el mismo motivo que `ideas/:ideaId` va
            // después de `ideas`: legibilidad, no precedencia (el router no hace prefijo parcial).
            path: 'menu/:index',
            loadComponent: () =>
              import('./pages/clientes/cliente-menu-detalle').then((m) => m.ClienteMenuDetallePage),
          },
          {
            // El sexto tab (Task 9), solo ofrecido a `correduria_seguros` por `tabsFicha` — ver el
            // docblock ahí. El historial de comparativas, más nueva primero.
            path: 'comparativas',
            loadComponent: () =>
              import('./pages/comparativas/listado').then((m) => m.ComparativasListadoPage),
          },
          {
            // La pantalla de carga (Task 8), sin tab propio — se llega desde el botón "Nueva
            // comparativa" del historial. Va DESPUÉS de `comparativas` por legibilidad, mismo
            // criterio que `menu/:index` después de `menu`: el router no hace prefijo parcial con
            // una ruta sin hijas.
            path: 'comparativas/cargar',
            loadComponent: () =>
              import('./pages/comparativas/form').then((m) => m.ComparativasFormPage),
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
  {
    /*
     * El resultado imprimible de una comparativa de seguros (Task 9) — mismo motivo que el entregable
     * de arriba: fuera del shell para poder imprimirse (sin sidebar `fixed`, sin `lg:pl-64`), pero con
     * la URL anidada (`clientes/:id/comparativas/:cid`) para que el enlace sea coherente con el resto
     * de la ficha. `form.ts` ya navega acá tras crear con éxito (Task 8); esta ruta es lo que hace que
     * ese destino exista.
     *
     * **Va DESPUÉS del shell, y NO antes como el entregable — esto SÍ es load-bearing, medido en el
     * navegador.** El entregable puede ir antes de `''` porque no hay ningún hijo literal del shell
     * que choque con su forma. Acá SÍ lo hay: `clientes/:id/comparativas/cargar` (Task 8, hija de la
     * ficha, dentro del shell) tiene la MISMA forma de cuatro segmentos que esta ruta con `:cid` en el
     * último — y el Router prueba las rutas del array EN ORDEN y no por especificidad. Puesta antes
     * del shell, esta ruta capturaba `cargar` como si fuera un `:cid` y montaba `resultado.ts` con
     * `cid: 'cargar'` en vez de la pantalla de carga — silencioso, sin error de compilación ni en
     * consola, solo la pantalla equivocada. Puesta DESPUÉS del shell, el Router prueba primero el
     * hijo literal `comparativas/cargar` (que gana, mismo criterio que `clientes/nuevo` antes que
     * `clientes/:id`) y solo cae acá para cualquier OTRO valor de `:cid` que ningún hijo del shell
     * matcheó. Lleva su propio `authGuard` — al salir del shell, deja de heredarlo.
     */
    path: 'clientes/:id/comparativas/:cid',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/comparativas/resultado').then((m) => m.ComparativaResultadoPage),
  },
  { path: '**', redirectTo: 'clientes' },
];

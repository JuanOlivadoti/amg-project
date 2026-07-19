# `portal` — la SPA de Angular (etapa 5.2)

Donde el equipo de AMG (y el cliente, en modo lectura) trabaja el research: lanzarlo, ver el brief
**separado por evidencia**, y **aprobar la compuerta** (ADR-06). Stack cerrado en ADR-21: Angular
standalone + signals, Tailwind puro, **habla solo con nuestra API** (nunca con Postgres directo).

## Lo que ya está

- **Login** (Supabase Auth por su endpoint REST, sin SDK).
- **Lista de research** — cada quien ve lo suyo (RLS decide). El equipo, además, puede **lanzar**.
- **El brief** — páginas propuestas **separadas por evidencia**: ✅ respaldadas por datos de mercado
  vs ⚠️ sin validar. *Es el argumento de venta: el sistema dice lo que no sabe.*
- **La compuerta doble (ADR-06)** — aprobar página por página, **editar** (revoca la aprobación) y
  después aprobar el run → despierta al workflow → publica.
- **Refresh del token** — un 401 refresca la sesión y reintenta **una** vez; si el refresh falla, se
  cierra sesión y al login. La política vive en `api-core` (probada); el mecanismo, en `AuthService`.
- **Polling** — mientras un research corre, el brief se repregunta cada 4 s hasta que termina
  (ADR-21: polling, no realtime).

> El brief se **suscribe** al parámetro de la ruta, no lee el snapshot: Angular reutiliza el
> componente al ir de `/runs/A` a `/runs/B`, y con snapshot la pantalla decía B mientras **aprobar
> iba contra A** (8ª review).

## La decisión de fondo: la lógica es TypeScript puro, testeable sin navegador

Todo lo que se puede romper vive en `src/app/core/`, **sin Angular ni DOM**, y se prueba con
`node:test` (16 tests): el cliente HTTP (`api-core.ts`, con `fetch` inyectable), el login
(`auth-core.ts`), y la separación por evidencia (`evidence.ts`). Los componentes son cáscaras finas.
Es la misma disciplina que hace testeable a RLS sin Docker: acá, HTTP y auth sin red.

```bash
npm test          # el núcleo, con node:test (sin navegador)
npm run build     # compila la SPA (AOT valida todos los templates)
npm start         # dev server (ng serve)
```

## Config (`src/environments/environment.ts`)

`apiBaseUrl`, `supabaseUrl`, `supabaseAnonKey`. **No hay secretos**: la anon key es pública; el poder
lo tiene RLS. El `tenantId` sale de `app_metadata.tenant_id` del usuario (claim firmado por Supabase);
el rol, de `app_metadata.rol` — pero **solo para mostrar/ocultar botones**: la autorización real la
impone la API/RLS (ADR-20).

## Lo que queda abierto (a propósito, y dicho)

- **Sin tests de componente** (karma). El núcleo cubre la lógica (19 tests); los componentes se
  verifican compilando (AOT valida los templates) y corriendo la app. `npm run test:karma` disponible.
- **El intervalo de polling (4 s) es a ojo.** Se calibra cuando se mida la duración real de una
  corrida (acción 06): si un research tarda minutos, quizás convenga espaciarlo o avisar distinto.
- **La lista de runs no hace polling** (sí el brief). Un run que termina se ve al recargar la lista.

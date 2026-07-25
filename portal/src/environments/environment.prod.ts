/**
 * Config del portal — **PRODUCCIÓN** (Fase 1). `angular.json` reemplaza `environment.ts` por este
 * archivo en el build de producción (`ng build`, configuración `production`).
 *
 * **Qué completar antes de `ng build`** (2 valores de Supabase; NINGUNO es secreto — la anon key es
 * pública por diseño, y el poder de autorizar lo tiene RLS, no esta clave):
 *   · `supabaseUrl`    → la URL del proyecto Supabase. Ej: https://xxxx.supabase.co
 *   · `supabaseAnonKey`→ la anon key (Project Settings → API) del mismo proyecto.
 *
 * `apiBaseUrl` ya apunta a `https://api.bigballs.es` (la API en Railway con dominio propio). Si la
 * URL de la API cambia, actualizala acá. Requiere que el DNS `api.bigballs.es` apunte a Railway (§C.7).
 *
 * `features.lanzarResearch: false` es una **decisión de Fase 1**, no un placeholder: en Nivel 1 no
 * hay orquestador detrás del botón. Se reenciende en Fase 2 (§A.5 / §12 del plan). No lo toques al
 * desplegar.
 */
export const environment = {
  production: true,
  apiBaseUrl: 'https://api.bigballs.es',
  supabaseUrl: 'https://hyrwrpmnsqkelxokwddt.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5cndycG1uc3FrZWx4b2t3ZGR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5ODkwMjUsImV4cCI6MjEwMDU2NTAyNX0.geOGbDPotg9dpJKMMGX1ctaU5ZEOjsFz5ZdfHzUpAHQ',
  features: {
    lanzarResearch: false,
    // Fase 1: aprobar el run emitiría un evento sin orquestador detrás. Frank aprueba PÁGINAS (la
    // compuerta), no el run. Se reenciende en Fase 2. NO tocar al desplegar.
    aprobarRun: false,
  },
};

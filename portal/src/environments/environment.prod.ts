/**
 * Config del portal — **PRODUCCIÓN** (Fase 1). `angular.json` reemplaza `environment.ts` por este
 * archivo en el build de producción (`ng build`, configuración `production`).
 *
 * **Qué completar antes de `ng build`** (son 3 valores; NINGUNO es secreto — la anon key es pública
 * por diseño, y el poder de autorizar lo tiene RLS, no esta clave):
 *   · `apiBaseUrl`     → el dominio de la api desplegada (Railway). Ej: https://api.tudominio.com
 *   · `supabaseUrl`    → la URL del proyecto Supabase. Ej: https://xxxx.supabase.co
 *   · `supabaseAnonKey`→ la anon key (Project Settings → API) del mismo proyecto.
 *
 * `features.lanzarResearch: false` es una **decisión de Fase 1**, no un placeholder: en Nivel 1 no
 * hay orquestador detrás del botón. Se reenciende en Fase 2 (§A.5 / §12 del plan). No lo toques al
 * desplegar.
 */
export const environment = {
  production: true,
  apiBaseUrl: 'https://api.tudominio.com',
  supabaseUrl: 'https://TU-PROYECTO.supabase.co',
  supabaseAnonKey: 'TU-ANON-KEY-PUBLICA',
  features: {
    lanzarResearch: false,
  },
};

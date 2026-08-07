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
 * **Los dos `features` estuvieron APAGADOS hasta el 2026-08-07**, y no eran placeholders: el motivo
 * escrito era "no hay orquestador detrás del botón". Ese motivo dejó de valer el día que el
 * orquestador se desplegó en Railway y su app quedó sincronizada con Inngest, así que se encendieron.
 * Siguen sin ser config editable al desplegar: los fija un test (`environment.prod.test.ts`).
 */
export const environment = {
  production: true,
  apiBaseUrl: 'https://api.bigballs.es',
  supabaseUrl: 'https://hyrwrpmnsqkelxokwddt.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5cndycG1uc3FrZWx4b2t3ZGR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5ODkwMjUsImV4cCI6MjEwMDU2NTAyNX0.geOGbDPotg9dpJKMMGX1ctaU5ZEOjsFz5ZdfHzUpAHQ',
  features: {
    // Desde el 2026-08-07 hay orquestador detrás: el evento `research/solicitado` lo recoge una
    // función real y el run avanza. Antes de esta fecha el botón habría dejado un run huérfano.
    lanzarResearch: true,
    /*
     * Encendido el 2026-08-07, con una advertencia que hay que conocer antes de usarlo en una demo:
     * SOLO hace algo en un run que NACIÓ DEL PIPELINE.
     *
     * La compuerta humana es un `paso.esperarEvento` DENTRO del workflow (`orchestrator/workflow.ts`),
     * y el orquestador registra una única función, disparada por `research/solicitado`. No hay ningún
     * listener suelto de `research/aprobado`. O sea que aprobar un run que se insertó directo en la
     * base —el de `sembrarDemo`, sin ir más lejos— emite un evento que NO ESPERA NADIE: la API
     * responde bien y no se publica nada.
     */
    aprobarRun: true,
  },
};

/**
 * Config del portal — **PRODUCCIÓN** (Fase 1). `angular.json` reemplaza `environment.ts` por este
 * archivo en el build de producción (`ng build`, configuración `production`).
 *
 * **Qué completar antes de `ng build`** (2 valores de Supabase; NINGUNO es secreto — la anon key es
 * pública por diseño, y el poder de autorizar lo tiene RLS, no esta clave):
 *   · `supabaseUrl`    → la URL del proyecto Supabase. Ej: https://xxxx.supabase.co
 *   · `supabaseAnonKey`→ la anon key (Project Settings → API) del mismo proyecto.
 *
 * `apiBaseUrl` ya apunta a `https://api.dinamicseo.es` (la API en Railway con dominio propio). Si la
 * URL de la API cambia, actualizala acá. Requiere que el DNS `api.dinamicseo.es` apunte a Railway (§C.7).
 *
 * **Los dos `features` estuvieron APAGADOS hasta el 2026-08-07**, y no eran placeholders: el motivo
 * escrito era "no hay orquestador detrás del botón". Ese motivo dejó de valer el día que el
 * orquestador se desplegó en Railway y su app quedó sincronizada con Inngest, así que se encendieron.
 * Siguen sin ser config editable al desplegar: los fija un test (`environment.prod.test.ts`).
 */
export const environment = {
  production: true,
  apiBaseUrl: 'https://api.dinamicseo.es',
  supabaseUrl: 'https://hyrwrpmnsqkelxokwddt.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5cndycG1uc3FrZWx4b2t3ZGR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5ODkwMjUsImV4cCI6MjEwMDU2NTAyNX0.geOGbDPotg9dpJKMMGX1ctaU5ZEOjsFz5ZdfHzUpAHQ',
  features: {
    // Desde el 2026-08-07 hay orquestador detrás: el evento `research/solicitado` lo recoge una
    // función real y el run avanza. Antes de esta fecha el botón habría dejado un run huérfano.
    lanzarResearch: true,
    /*
     * Encendido el 2026-08-07. Actualizado tras el sub-proyecto 2 (desacoplar keyword research de
     * creación de webs, 2026-08-26): el mecanismo de aprobación ya NO es un `paso.esperarEvento`
     * dentro de un único workflow — son DOS funciones de Inngest separadas
     * (`orchestrator/src/functions.ts`): `crearFuncionResearch`, disparada por `research/solicitado`,
     * que deja el run en `pending_approval`; y `crearFuncionDecision`, disparada por
     * `research/aprobado`, que SÍ es el listener que faltaba antes — relee la decisión bajo RLS
     * (`kr_run_decisiones`) y la procesa (`workflowDecision`, `orchestrator/src/workflow.ts`).
     *
     * `POST /runs/:id/approve` ya no exige que el run "naciera del pipeline": cualquier run en
     * `pending_approval` puede recibir una decisión, nacido del pipeline o sembrado a mano (ver
     * `environment.prod.test.ts`, y el retiro de `RunSinWorkflowError` / el gate `tiene_workflow`).
     */
    aprobarRun: true,
    /** La opción "crear_posts" del selector de destino. `false` a propósito: el sub-proyecto de
     *  publicación en blog externo todavía no existe, así que no hay a dónde publicar un post. Es
     *  una decisión de LANZAMIENTO separada de encenderla en dev — se queda en `false` acá aunque
     *  ese sub-proyecto la encienda en `environment.ts`. */
    destinoPosts: false,
  },
};

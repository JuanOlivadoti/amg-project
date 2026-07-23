/**
 * Config del portal — **DESARROLLO** (local). En el build de producción, `angular.json` reemplaza
 * este archivo por `environment.prod.ts` (fileReplacements). **No hay secretos**: la anon key de
 * Supabase es pública por diseño; el poder de decidir lo tiene RLS, no esta clave.
 */
export const environment = {
  production: false,
  /** La API REST (`api/`). En local, el `npm run serve` de ese paquete. */
  apiBaseUrl: 'http://localhost:3000',
  /** Supabase Auth: emite el JWT que la API verifica. */
  supabaseUrl: 'https://TU-PROYECTO.supabase.co',
  supabaseAnonKey: 'TU-ANON-KEY-PUBLICA',
  /**
   * Flags de funcionalidad. En **dev** se lanza research de verdad (contra la api local), así que el
   * botón está encendido. En **Fase 1** (prod, Nivel 1 "read-mostly") se apaga: no hay orquestador
   * detrás y un botón que no hace nada es peor que no tenerlo. Se reenciende en Fase 2. Ver §A.5.
   */
  features: {
    lanzarResearch: true,
    /** Aprobar el run (emite el evento de publicación). En dev hay orquestador de mentira; en Fase 1
     *  prod se apaga porque no hay consumidor y "publicar" no publicaría. Ver §A.5 / 10ª review #2. */
    aprobarRun: true,
  },
};

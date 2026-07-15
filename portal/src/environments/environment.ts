/**
 * Config del portal. Los valores reales se inyectan en el deploy (etapa 5.3). Acá van los de
 * desarrollo local. **No hay secretos**: la anon key de Supabase es pública por diseño; el poder de
 * decidir lo tiene RLS, no esta clave.
 */
export const environment = {
  production: false,
  /** La API REST (`api/`). En local, el `npm run serve` de ese paquete. */
  apiBaseUrl: 'http://localhost:3000',
  /** Supabase Auth: emite el JWT que la API verifica. */
  supabaseUrl: 'https://TU-PROYECTO.supabase.co',
  supabaseAnonKey: 'TU-ANON-KEY-PUBLICA',
};

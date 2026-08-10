/**
 * ARRANQUE DE DESARROLLO — la API real, sobre PGlite, sin credenciales.
 *
 * ⚠️ **Nunca en producción.** Usa un verificador de token FALSO (`valid:<uuid>`) y una base en
 * memoria que se pierde al salir. Existe para dos cosas legítimas:
 *   · levantar el portal contra una API de verdad sin tener Supabase ni Postgres;
 *   · verificar en un navegador lo que los tests no alcanzan (render, navegación entre runs).
 *
 * Es posible porque `createApp` recibe TODO inyectado (store, emisor, verificador). El mismo diseño
 * que hace testeable a la API sin red es el que permite este harness.
 *
 * Correr:  npm run dev:server -w api
 */
import { PGlite } from "@electric-sql/pglite";
import { serve } from "@hono/node-server";
import {
  aplicarMigraciones,
  ConexionReservada,
  PglitePool,
  PgStore,
  PgClientes,
  PgMembresias,
  PgIdeas,
  sembrarDemo,
} from "db";
import { createApp } from "./app.js";
import type { EmisorEventos } from "./solicitar.js";
import type { VerificadorToken } from "./auth.js";

if (process.env["NODE_ENV"] === "production") {
  throw new Error("dev-server.ts NO se corre en producción: su verificador de token es falso.");
}

const pg = new PGlite();
await aplicarMigraciones(pg);
const store = new PgStore(new PglitePool(pg));
const clientes = new PgClientes(new PglitePool(pg));
const membresias = new PgMembresias(new PglitePool(pg));
const ideas = new PgIdeas(new PglitePool(pg));

const sql = async <T = Record<string, unknown>>(q: string, p: unknown[] = []): Promise<T[]> =>
  (await pg.query<T>(q, p)).rows;

// ---------------------------------------------------------------- seed
//
// Usa `sembrarDemo` —la MISMA función que corre en producción— en vez de inventar su propio dataset.
// Antes inventaba uno (un italiano, un bar de tapas), así que verificar el portal en local mostraba
// un negocio que no existía en ninguna otra parte de la demo: la cuarta copia del mismo problema.
// Ahora, mirar el portal acá es mirar lo que verá Frank.
const FRANK = "11111111-1111-1111-1111-111111111111"; // maestro
const JUAN = "22222222-2222-2222-2222-222222222222"; // equipo — es con este que arranca la sesión
const r = await sembrarDemo(ConexionReservada.desdePglite(pg), {
  frankUserId: FRANK,
  juanUserId: JUAN,
});
const tenant = r.tenantId;
const equipo = JUAN;

// ---------------------------------------------------------------- miembros (pieza 2 — Usuarios)
//
// `sembrarDemo` (seed-demo.ts, NO se toca acá) solo da de alta a Frank (maestro) y Juan (equipo) en
// `memberships` — no en `auth.users` (esa tabla no es nuestra; en PGlite es un stand-in que crea
// `migrate.ts`). `membresias_perfil` los cruza con un INNER JOIN, así que sin una fila en
// `auth.users`, GET /members los dejaría afuera — nadie vería la pantalla de miembros con datos.
// Se les da email acá, y se agrega un TERCER miembro con rol `cliente` (el dueño del negocio de la
// demo) para poder manejar los tres roles en el navegador (Etapa 4/5 del programa).
const DUENO = "33333333-3333-3333-3333-333333333333"; // rol cliente, atado al cliente de la demo
await pg.query(
  `insert into auth.users (id, email, raw_app_meta_data) values
     ($1, 'frank@amg.dev', '{"name":"Frank"}'::jsonb),
     ($2, 'juan@amg.dev', '{"name":"Juan"}'::jsonb),
     ($3, 'dueno@labirrabar.dev', '{"name":"Dueño La Birra Bar"}'::jsonb)`,
  [FRANK, JUAN, DUENO],
);
await pg.query(
  `insert into memberships (tenant_id, user_id, rol, client_id) values ($1, $2, 'cliente', $3)`,
  [tenant, DUENO, r.clientId],
);

/** Runs EXTRA del mismo cliente, para tener los otros estados de la lista en pantalla. */
const crearRun = async (prompt: string, status: string): Promise<string> =>
  (
    await sql<{ id: string }>(
      `insert into kr_runs (tenant_id, client_id, schema_version, status, prompt,
                            market_country, market_language, market_location_code, coste_micros_usd)
       values ($1,$2,'kr.v0.5',$4,$3,'ES','es',2724, 298400) returning id`,
      [tenant, r.clientId, prompt, status],
    )
  )[0]!.id;

const runAprobado = await crearRun("Hamburguesería gourmet en Madrid (corrida anterior)", "approved");

/*
 * Un run **APROBABLE**, y hace falta uno a propósito (bloque C0, migración 0019).
 *
 * Todo lo que este archivo siembra —incluido el run de `sembrarDemo`— se inserta DIRECTO en la base,
 * así que no tiene `solicitud_emitida_at` y `approveRun` lo rechaza con 409 `RUN_SIN_WORKFLOW`. Eso
 * es correcto y es lo que hay que poder ver en el navegador… pero si fuera lo ÚNICO que hay, el botón
 * de aprobar estaría apagado en las cuatro pantallas y no habría forma de manejar el camino feliz.
 *
 * Se escribe la marca a mano (y no pasando por `POST /runs`) porque acá no hay ningún Inngest ni
 * ningún workflow: lo que se está montando es el ESTADO que deja el camino real, no el camino.
 */
const runAprobable = await crearRun("Pizzería napolitana en Malasaña (lista para aprobar)", "pending_approval");
await sql(
  `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, url_slug, keyword_principal,
                         keywords_secundarias, intencion, local, volumen, dificultad, evidencia,
                         opportunity_score, score_confidence, orden_brief, seo, content_brief,
                         preguntas_frecuentes, approved, retirada)
   values ($1,$2,$3, gen_random_uuid(), 'landing_local', '/pizza-napolitana-malasana',
           'pizza napolitana malasaña', array['pizzería napolitana madrid'], 'local', true, 480, 18,
           'datos_mercado', 81, 0.9, 0,
           '{"meta_title":"Pizza napolitana en Malasaña","meta_description":"Horno de leña en Malasaña."}'::jsonb,
           '{"h1":"Pizza napolitana en Malasaña","word_count_objetivo":900}'::jsonb,
           array['¿Hacen reservas?'], false, false)`,
  [tenant, runAprobable, r.clientId],
);
await store.marcarSolicitudEmitida({ tenantId: tenant, userId: equipo }, runAprobable);

// ---------------------------------------------------------------- ideas (pieza 3, Etapa 3)
//
// Se insertan con la INFRAESTRUCTURA (superusuario, saltea RLS) y no por la API, porque `app_user` no
// tiene grant de `insert` sobre `ideas` (0013): el ingreso real es el flujo de audio de n8n y todavía
// no existe. Que acá haga falta el superusuario es la forma de notar ese hueco.
//
// Es un seed MÍNIMO para poder manejar las pantallas en el navegador, y a propósito NO es el
// `db/src/seed-ideas-demo.ts` que planifica la Etapa 4 (ese es de `db/` y tiene su propio test de
// idempotencia). Cuando exista, esto se reemplaza por una llamada a aquél.
//
// Los cuatro estados están representados para poder ver el listado, los filtros y las transiciones:
// desde `nueva` solo se puede pasar a `en_revision`; `aprobada` y `rechazada` son TERMINALES, así que
// intentar moverlas en el portal tiene que dar 400 con motivo.
const ANALISIS_DEMO = {
  audiencia_objetivo: "vecinos del barrio y oficinistas del mediodía",
  canales_comunicacion: ["instagram", "whatsapp"],
  intencion: "promocionar el menú del día",
  materiales_formatos: ["reel corto", "cartel A3 para la puerta"],
  observaciones: "EJEMPLO — audio de desarrollo, no es un cliente real.",
  checklist_interpretacion: ["confirmar el precio del menú", "pedir fotos de los platos"],
  ideas_complementarias: ["sorteo de dos menús entre quienes compartan el reel"],
  tipo_accion: "campaña",
};

const crearIdea = async (titulo: string, estado: string, transcripcion: string): Promise<string> =>
  (
    await sql<{ id: string }>(
      `insert into ideas (tenant_id, client_id, titulo, estado, resumen, transcripcion, audio_url,
                          carpeta_url, mensaje_de, analisis)
       values ($1, $2, $3, $4::idea_estado, 'Resumen de EJEMPLO para desarrollo.', $5,
               'https://example.invalid/audios/idea.ogg', 'https://example.invalid/carpeta',
               'Dueño (EJEMPLO)', $6::jsonb)
       returning id`,
      [tenant, r.clientId, titulo, estado, transcripcion, JSON.stringify(ANALISIS_DEMO)],
    )
  )[0]!.id;

const ideaNueva = await crearIdea(
  "[EJEMPLO] Menú del día en Instagram",
  "nueva",
  "Hola chicos, se me ocurrió que podríamos subir el menú del día a Instagram cada mañana, " +
    "con una foto del plato. EJEMPLO de desarrollo.",
);
await crearIdea(
  "[EJEMPLO] Sorteo de dos menús",
  "en_revision",
  "Otra idea: un sorteo de dos menús entre los que compartan la publicación. EJEMPLO de desarrollo.",
);
await crearIdea("[EJEMPLO] Cartel nuevo para la puerta", "aprobada", "EJEMPLO de desarrollo.");
await crearIdea("[EJEMPLO] Reparto a domicilio", "rechazada", "EJEMPLO de desarrollo.");

// ---------------------------------------------------------------- app
const eventos: Array<{ name: string; data: Record<string, unknown> }> = [];
const emisor: EmisorEventos = {
  send: async (e) => {
    eventos.push(e);
    console.log(`  [evento] ${e.name}`, e.data);
    return {};
  },
};

/** FALSO a propósito: `valid:<uuid>` identifica a ese usuario. Ver el aviso de arriba. */
const verificar: VerificadorToken = async (t) => (t.startsWith("valid:") ? { userId: t.slice(6) } : null);

const app = createApp({
  store,
  clientes,
  membresias,
  ideas,
  emisor,
  verificar,
  corsOrigins: ["http://localhost:4200"],
});

// Un run EN CURSO: es el que dispara el polling del brief (y con el que se comprueba que no quede
// un intervalo huérfano al salir de la pantalla).
const runCorriendo = await crearRun("Cervecería artesanal en Chamberí (corriendo)", "running");

serve({ fetch: app.fetch, port: 3000 }, () => {
  const sesion = {
    accessToken: `valid:${equipo}`,
    refreshToken: "dev-refresh",
    expiraEn: Date.now() + 86_400_000,
    userId: equipo,
    email: "equipo@amg.dev",
    tenantId: tenant,
    rol: "equipo",
  };
  console.log("\n▶ API de desarrollo en http://localhost:3000  (PGlite en memoria, token falso)\n");
  console.log(`  La Birra Bar — el brief de la demo (14 páginas, 8✅/6⚠️): ${r.runId}`);
  console.log(`     ↑ SIN workflow: aprobar da 409 RUN_SIN_WORKFLOW (0019). El botón va apagado.`);
  console.log(`  lista para aprobar (1 página, CON workflow):             ${runAprobable}`);
  console.log(`  corrida anterior (aprobada):                            ${runAprobado}`);
  console.log(`  corrida en curso (dispara el polling):                  ${runCorriendo}\n`);
  console.log(`  ideas de EJEMPLO (4, una por estado). La 'nueva':       ${ideaNueva}`);
  console.log(`     ↑ el ingreso real (flujo de audio en n8n) NO existe: estas las sembró la infra.\n`);
  console.log("  Sesión para el portal (pegar en la consola del navegador):");
  console.log(`  localStorage.setItem('amg.sesion', ${JSON.stringify(JSON.stringify(sesion))})\n`);
});

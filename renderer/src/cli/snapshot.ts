import { NodePgPool, PgSitios } from "db";
import { StoryblokCda } from "../cda.js";
import { USO, correrSnapshot } from "../snapshot.js";

/**
 * Genera el **snapshot estático de salida** de un cliente (ADR-11): la web congelada, autocontenida,
 * hosteable en cualquier lado, sin dependencia de AMG OS ni de Storyblok.
 *
 * ## Por qué existe
 *
 * ADR-11 (versión vigente, 2026-09-11) lo vende como salida por defecto **incluida** en el contrato.
 * Hasta este comando nadie lo había generado nunca: se podía sacar de `renderStory()`, pero no había
 * ni comando ni comprobación de que el resultado abriera en un navegador desconectado. Mientras no
 * existiera, esa línea del contrato describía una intención — que es exactamente lo que este
 * proyecto llama *una garantía en un comentario*.
 *
 * ## Qué credenciales usa
 *
 * Solo **lectura**: `DATABASE_URL_RENDER` (el login `amg_render`, que solo puede asumir `app_render`
 * — el rol más pobre del sistema, ADR-17) y el token público de la CDA que sale de la propia fila
 * del cliente. **Nunca la Management API**: esto lee lo que ya es público, no reescribe nada. Misma
 * frontera que el servicio (ver la cabecera de `../cda.ts`).
 *
 * ## Uso
 *
 * ```bash
 * npm run snapshot -w renderer -- micliente.com ./salida/micliente
 * ```
 *
 * Después, para comprobarlo **sin red** (que es el gate de aceptación, no un extra):
 *
 * ```bash
 * npx --yes http-server ./salida/micliente -p 4173 -c-1
 * # y en las DevTools: ni una petición a un host que no sea localhost
 * ```
 *
 * ⚠️ **Hace falta un servidor estático: con `file://` no se ve.** Las rutas del snapshot son
 * absolutas (`/menu`, `/_assets/fonts/…`) **a propósito** — es lo que preserva las URLs del sitio
 * vivo y evita reescribir un solo `href`. Bajo `file://`, `/` es la raíz del disco y no la del
 * snapshot, así que la nav y los assets no resuelven. Cualquier hosting estático (Netlify, S3,
 * Hostinger, un nginx) sirve el directorio tal cual y funciona; el doble clic sobre el `index.html`,
 * no. Es el precio del punto 3 del contrato y se paga a sabiendas.
 *
 * ## Códigos de salida
 *
 * - `0` — snapshot completo: ni una referencia a un host externo.
 * - `1` — no hubo snapshot (faltan argumentos, falta la credencial, el dominio no existe…).
 * - `2` — el snapshot está escrito pero **incompleto**: algo no se pudo descargar. El detalle queda
 *   en `<destino>/_snapshot-informe.txt` y en stderr. No se entrega así.
 */

const argv = process.argv.slice(2);

// El uso se responde ANTES de mirar el entorno: pedirle una credencial a alguien para después
// decirle que escribió mal el comando es la peor de las dos órdenes posibles.
if (argv.length < 2) {
  console.error(USO);
  process.exit(1);
}

const databaseUrl = process.env["DATABASE_URL_RENDER"]?.trim();
if (!databaseUrl) {
  console.error(
    "Falta DATABASE_URL_RENDER en renderer/.env: es la cadena del login `amg_render`, que solo puede\n" +
      "asumir el rol `app_render` (solo lectura de las columnas públicas de `clients`). Se reparte con\n" +
      "`npm run env:sync` desde docs/private/credenciales.env.",
  );
  process.exit(1);
}

const { Pool } = await import("pg");

// Un pool mínimo y con TODOS los plazos puestos, por lo mismo que `deps.ts`: los defaults de `pg`
// son esperar para siempre. Acá es un proceso de un solo uso, así que dos conexiones sobran y los
// plazos son más largos que los del servicio (un lote no compite con el tiempo de una visita).
const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 5_000,
  query_timeout: 10_000,
  statement_timeout: 10_000,
  keepAlive: true,
});
pool.on("error", (e) => console.error("[snapshot] error del pool de Postgres:", e.message));

try {
  process.exitCode = await correrSnapshot(argv, {
    sitios: new PgSitios(new NodePgPool(pool)),
    cda: new StoryblokCda(),
  });
} finally {
  await pool.end();
}

import { DEMO_CLIENT_ID } from "db";
import { PERFIL_BORCELLE } from "../perfil-demo.js";

/**
 * Imprime el SQL que pone al **cliente de demo** en un dominio, con su perfil al día.
 *
 * ## Por qué un UPDATE y no un INSERT
 *
 * La primera versión insertaba un cliente nuevo, y estaba mal: el cliente de demo del proyecto **ya
 * existe** con id fijo (`DEMO_CLIENT_ID`, lo siembra `sembrarDemo`). Un `insert` con otro dominio
 * habría creado un segundo «Borcelle Burger» —dos fichas del mismo negocio, cada una con su research
 * y su perfil— que es justo lo contrario de lo que se pidió: **un solo cliente**.
 *
 * Y hay una razón más dura: las cuatro FK que apuntan a `clients` son `on delete cascade`. Corregir el
 * duplicado después borrando uno se lleva por delante sus `kr_runs`, sus páginas y sus membresías.
 * Actualizar la fila que ya está no tiene ese riesgo.
 *
 * ## Por qué un generador y no un `.sql` escrito a mano
 *
 * El perfil vive en `db/src/seed-demo.ts` y lo usan el seed, el `dev-server` y esto. Un `.sql` con el
 * JSON copiado sería una segunda copia, y el día que alguien ajuste una foto o un precio los dos
 * seguirían funcionando **diciendo cosas distintas**.
 *
 * ## Lo que este script NO hace, a propósito
 *
 * **No toca la base.** Escribe SQL por stdout y nada más. La misma regla que separa
 * `reseed:demo --dry-run` de la siembra de verdad.
 *
 * ## Uso
 *
 * ```bash
 * npm run sql:demo -w renderer                        # → borcelle.bigballs.es
 * npm run sql:demo -w renderer -- otro.bigballs.es
 * ```
 *
 * ⚠️ Si además querés que el **research, las ideas y el informe** del portal queden con el nombre
 * nuevo, lo que corresponde es `npm run reseed:demo` (que siembra todo eso de forma coherente) y
 * después este `update` solo para el dominio. Este script cubre el perfil y el dominio, no el resto
 * del estado de demo.
 */

const DOMINIO = process.argv[2] ?? "borcelle.bigballs.es";

/**
 * Un literal SQL con las comillas simples escapadas.
 *
 * El JSON lo produce `JSON.stringify` sobre un objeto tipado —no hay entrada de usuario en el
 * camino— pero el escape va igual: «este valor viene de nuestro código» es la frase con la que
 * empiezan las inyecciones el día que alguien cambia de dónde viene el valor.
 */
function literal(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

process.stdout.write(`-- ============================================================================
-- Cliente de DEMO: «Borcelle Burger» → https://${DOMINIO}
--
-- Generado por \`npm run sql:demo -w renderer\`. NO lo edites a mano: el perfil vive en
-- db/src/seed-demo.ts (PERFIL_DEMO) y lo comparten el seed, el dev-server y este generador.
--
-- Actualiza la fila que YA existe (el cliente de demo tiene id fijo). No inserta: un segundo cliente
-- con el mismo negocio sería dos fichas del mismo sitio, y deshacerlo borrando una se lleva en
-- cascada sus runs, sus páginas y sus membresías.
--
-- ⚠️ El \`storyblok_space_id\` y los tokens NO se tocan acá: los que la fila ya tiene siguen valiendo.
--    Sin \`storyblok_space_id\` el renderizador devuelve 404, así que si la fila no lo tuviera, hay que
--    ponerlo antes (Storyblok → el space → Settings › General).
-- ============================================================================

update clients
   set nombre           = 'Borcelle Burger',
       domain           = ${literal(DOMINIO)},
       business_profile = ${literal(JSON.stringify(PERFIL_BORCELLE, null, 2))}::jsonb
 where id = ${literal(DEMO_CLIENT_ID)};

-- Comprobación (no imprime los tokens):
select nombre, domain, storyblok_space_id is not null as tiene_space,
       business_profile_publico ? 'testimonios'                as trae_resenas,
       jsonb_array_length(business_profile_publico -> 'fotos') as fotos,
       jsonb_array_length(business_profile_publico -> 'menu')  as platos
  from clients where id = ${literal(DEMO_CLIENT_ID)};

-- Y que no haya quedado ningún otro cliente servible:
select count(*) as clientes_con_dominio from clients where domain is not null;
`);

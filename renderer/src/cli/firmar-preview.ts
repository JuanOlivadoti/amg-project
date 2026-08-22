import { firmarPreview, PARAM_FIRMA, PARAM_VENCE } from "../preview.js";

/**
 * Genera un enlace de preview del Visual Editor, firmado, para un dominio de cliente en PRODUCCIÓN.
 *
 * ## Por qué existe
 *
 * `firmarPreview()` (`../preview.ts`) está hecha y probada desde que existe el mecanismo de preview
 * (ADR-19), pero en producción el enlace se generaba a mano con un script fuera del repo — la única
 * copia vivía en la máquina de quien lo escribió, sin test, sin historia en git (Bloque H,
 * `docs/proyecto/15-plan-plataforma.md`). Este CLI es ese mismo cálculo, adentro del repo.
 *
 * ## Qué credencial usa (y por qué no viaja por `env:sync`)
 *
 * `PREVIEW_SECRET` es la única del servicio (no una por cliente, ver `../preview.ts`), y en
 * producción vive en el panel de Railway — no en `docs/private/credenciales.env` ni en el `MAPA` de
 * `scripts/env-sync.mts` (`renderer/.env` es solo para la demo LOCAL). Mismo patrón que
 * `DATABASE_URL_ADMIN` en `db/.env`: para correr esto contra un cliente real, poné el valor de
 * producción en `renderer/.env` a mano, corré el comando, y no lo dejes commiteado ni pegado en
 * ningún lado.
 *
 * ## Uso
 *
 * ```bash
 * npm run preview:firmar -w renderer -- micliente.com          # 1 hora (default)
 * npm run preview:firmar -w renderer -- micliente.com 240      # 240 minutos
 * ```
 *
 * Imprime la URL lista para pegar en el navegador donde se abra el space de Storyblok. El enlace
 * sirve para CUALQUIER página del dominio (la firma es site-wide, ver `../preview.ts`), así que no
 * hace falta re-firmar al navegar entre páginas del Visual Editor.
 */

const dominio = process.argv[2];
if (!dominio) {
  console.error(
    "Uso: npm run preview:firmar -w renderer -- <dominio> [duracion_minutos]\n" +
      "  ej: npm run preview:firmar -w renderer -- micliente.com 240",
  );
  process.exit(1);
}

const secreto = process.env["PREVIEW_SECRET"]?.trim();
if (!secreto) {
  console.error(
    "Falta PREVIEW_SECRET en renderer/.env: es la de PRODUCCIÓN (panel de Railway), no la sintética\n" +
      "de dev-server.ts/demo-server.ts. No viaja por `env:sync` a propósito — ponela a mano, corré\n" +
      "este comando, y no la dejes commiteada.",
  );
  process.exit(1);
}

const duracionArg = process.argv[3];
const duracionMs = duracionArg ? Number(duracionArg) * 60_000 : undefined;
if (duracionArg !== undefined && (!Number.isFinite(duracionMs) || duracionMs! <= 0)) {
  console.error(`duracion_minutos inválida: "${duracionArg}" — tiene que ser un número positivo.`);
  process.exit(1);
}

const { firma, vence } = firmarPreview(secreto, dominio, duracionMs);
const url = `https://${dominio}/?${PARAM_FIRMA}=${firma}&${PARAM_VENCE}=${vence}`;

console.log(`\n${url}\n`);
console.log(`  Vence: ${new Date(vence).toISOString()}`);
console.log(`  Sirve CUALQUIER página de ${dominio} hasta el vencimiento (firma site-wide).`);

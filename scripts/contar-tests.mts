import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/*
 * Cuenta los tests en verde a partir del log del runner de `node:test`.
 *
 * Esto era un `grep -hE '^# pass'` incrustado en verificar.sh, y se rompió exactamente como se rompen
 * las cifras que nadie testea. Medido el 2026-08-05 con las dos versiones instaladas:
 *
 *   node v22.21.1 → reporter `tap`  → "# pass 34"
 *   node v24.18.1 → reporter `spec` → "ℹ pass 34"
 *
 * O sea que Node 24 no cambió el prefijo: cambió el REPORTER por defecto cuando la salida no es una
 * terminal. El patrón anclaba en `#`, así que bajo Node 24 no encontraba nada, la suma daba 0 — y
 * verificar.sh imprimía `[OK] 0 tests en verde`. Un cero disfrazado de verde, en el único lugar del
 * arnés que responde "¿cuánto verificaste?".
 *
 * Vive en un .mts y no en el bash por el motivo que declara la cabecera de verificar.sh: la lógica que
 * necesita test sale del script. Y ésta lo necesita porque ya se rompió una vez, en silencio.
 *
 * La mitad que importa es el piso, no el patrón: el patrón cubre los dos formatos que se midieron, y
 * el piso cubre el tercero que todavía no existe. Un conteo en cero NO tiene salida verde — si los
 * tests pasaron, hubo tests, y un cero significa que este parser quedó viejo. Que es justo el aviso
 * que nadie recibió esta vez.
 */

export type Conteo = { ok: true; total: number; resumenes: number } | { ok: false; motivo: string };

/*
 * El prefijo es un carácter cualquiera que no sea letra, dígito ni espacio: cubre el `#` de tap, el
 * `ℹ` de spec y el símbolo decorativo que se le ocurra al próximo reporter. Y es opcional, para el
 * caso de que algún día no haya ninguno.
 *
 * Anclado a los dos extremos a propósito. Sin indentación, porque en TAP los resúmenes de los
 * subtests SÍ van indentados y sumarlos contaría los mismos tests dos veces (medido: en los logs de
 * ambas versiones hay exactamente una línea de resumen, y no está indentada). Y `[ \t]*$` al final,
 * porque en spec los tests se imprimen como "✔ nombre (0.2ms)" y sin el ancla un test llamado
 * "pass 12" entraría en la suma.
 */
const RESUMEN_PASS = /^(?:[^\w\s][ \t]+)?pass[ \t]+(\d+)[ \t]*$/gm;

export function contarTests(log: string): Conteo {
  let total = 0;
  let resumenes = 0;

  for (const m of log.matchAll(RESUMEN_PASS)) {
    const cifra = m[1];
    if (cifra === undefined) continue;
    total += Number(cifra);
    resumenes += 1;
  }

  if (resumenes === 0) {
    return {
      ok: false,
      motivo:
        `no encontré ninguna línea de resumen ("pass N") en el log del runner. ` +
        `Node ${process.versions.node} probablemente cambió el formato: mirá el log y actualizá ` +
        `RESUMEN_PASS en scripts/contar-tests.mts. NO es un verde: es un conteo que no pudo contar`,
    };
  }

  if (total === 0) {
    return {
      ok: false,
      motivo:
        `el log declara ${resumenes} resumen(es) y todos suman 0 tests. ` +
        `Un paquete que no corre ningún test no puede reportarse en verde`,
    };
  }

  return { ok: true, total, resumenes };
}

/** CLI: `node --import tsx scripts/contar-tests.mts <log>`. La cifra por stdout, el motivo por stderr. */
function main(): void {
  const ruta = process.argv[2];
  if (!ruta) {
    console.error("uso: contar-tests.mts <archivo-de-log>");
    process.exitCode = 1;
    return;
  }

  const conteo = contarTests(readFileSync(ruta, "utf8"));
  if (conteo.ok) console.log(conteo.total);
  else {
    console.error(conteo.motivo);
    process.exitCode = 1;
  }
}

// Solo cuando se ejecuta como programa, no cuando lo importa el test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

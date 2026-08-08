import { mkdir, writeFile } from "node:fs/promises";
import { CASOS } from "./casos.js";
import { DIR_FIXTURES } from "./comparar.js";

/**
 * Captura el HTML de cada caso de paridad tal y como lo emite el render **de este momento**.
 *
 *     npm run capturar:paridad -w web-builder
 *
 * **Se corre UNA vez, ANTES de empezar el refactor, y las fixtures se commitean.** Volver a correrlo
 * después de tocar el render sobrescribe la foto de "antes" con la de "después", y el gate de paridad
 * pasa a compararse contra sí mismo: verde perpetuo, garantía cero. Si hace falta re-capturar por un
 * cambio visual deliberado, eso es una decisión que se explica en el commit — no un paso de rutina.
 *
 * Por eso no hay ningún test que llame a esta función: un test que regenerase su propia referencia
 * sería exactamente el adorno que este proyecto persigue.
 */
export async function capturarFixtures(): Promise<string[]> {
  await mkdir(DIR_FIXTURES, { recursive: true });
  const escritos: string[] = [];

  for (const caso of CASOS) {
    const ruta = new URL(`${caso.nombre}.html`, DIR_FIXTURES);
    await writeFile(ruta, caso.render(), "utf8");
    escritos.push(caso.nombre);
  }

  return escritos;
}

const esEntrada = process.argv[1]?.endsWith("capturar.ts") ?? false;
if (esEntrada) {
  const escritos = await capturarFixtures();
  console.log(`✔ ${escritos.length} fixtures de paridad capturadas en ${DIR_FIXTURES.pathname}`);
  for (const n of escritos) console.log(`  · ${n}.html`);
  console.log(
    "\n⚠️  Commitealas ANTES de tocar el render. Si se re-capturan después, el gate se compara\n" +
      "   contra sí mismo y deja de probar nada.",
  );
}

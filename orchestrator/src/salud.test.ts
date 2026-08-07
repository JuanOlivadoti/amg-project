import { test } from "node:test";
import assert from "node:assert/strict";
import { crearSonda, DEPENDENCIA_BASE, TIMEOUT_SONDA_MS, TTL_SONDA_MS } from "./salud.js";

/**
 * La sonda de `/_health`. Lo que se prueba acá es el CONTRATO: qué reporta, cuándo vuelve a
 * preguntar, y cuántas veces habla. Nada de esto se puede ver desde un test HTTP que mire el 200.
 *
 * El reloj se inyecta a propósito: un test del TTL que duerma cinco segundos es un test que nadie
 * corre dos veces.
 */

/** Un reloj que se mueve cuando el test lo dice. */
function relojFalso(t = 0) {
  return {
    ahora: () => t,
    avanzar: (ms: number) => {
      t += ms;
    },
  };
}

test("🔴 sana: NO aparece el campo `degradado` (su presencia es la señal, no su contenido)", async () => {
  const sonda = crearSonda({ comprobar: async () => undefined });

  const salud = await sonda();

  assert.deepEqual(salud, {});
  assert.ok(!("degradado" in salud), "un `degradado: []` obliga a leer el array para saber que está sano");
});

test("🔴 con la base caída: sigue siendo 200 por fuera, y `degradado` nombra qué falló", async () => {
  const sonda = crearSonda({
    comprobar: async () => {
      throw new Error("getaddrinfo ENOTFOUND base");
    },
    log: () => {},
  });

  const salud = await sonda();

  assert.deepEqual(salud.degradado, [DEPENDENCIA_BASE]);
});

/**
 * 🔴 El motivo del fallo va al LOG, nunca al cuerpo.
 *
 * `/_health` es público y anónimo. Un mensaje de error de Postgres lleva el host, a veces el usuario
 * y el nombre de la base — justo lo que no se le regala a quien pruebe la URL. Es el mismo criterio
 * que ADR-19 aplica al renderizador: la pregunta es *"si me lo toman, ¿qué se llevan?"*.
 */
test("🔴 el motivo del fallo NO viaja en el cuerpo (lleva host y usuario de la base)", async () => {
  const dicho: string[] = [];
  const sonda = crearSonda({
    comprobar: async () => {
      throw new Error("password authentication failed for user amg_orquestador at db.supabase.co");
    },
    log: (m) => dicho.push(m),
  });

  const salud = await sonda();

  assert.equal(JSON.stringify(salud).includes("amg_orquestador"), false, "el usuario no sale al cuerpo");
  assert.equal(JSON.stringify(salud).includes("supabase"), false, "el host tampoco");
  assert.match(dicho[0]!, /amg_orquestador/, "pero al log sí: ahí es donde hace falta para diagnosticar");
});

/**
 * 🔴 Se loguea la TRANSICIÓN, no el estado.
 *
 * Con la base caída y un chequeo por request, una línea por chequeo son cientos de líneas idénticas
 * por hora, y el ruido esconde lo único que se quería ver: cuándo se rompió. Esta es la mitad que la
 * 15ª review señaló — un campo que nadie lee no es una señal — y que se pierde si el log inunda.
 */
test("🔴 con la base caída tres veces seguidas, el log dice UNA cosa (transición, no estado)", async () => {
  const reloj = relojFalso();
  const dicho: string[] = [];
  const sonda = crearSonda({
    comprobar: async () => {
      throw new Error("caída");
    },
    ttlMs: 10,
    log: (m) => dicho.push(m),
    ahora: reloj.ahora,
  });

  await sonda();
  reloj.avanzar(50);
  await sonda();
  reloj.avanzar(50);
  await sonda();

  assert.equal(dicho.length, 1, `una sola línea, y dijo ${dicho.length}: ${JSON.stringify(dicho)}`);
  assert.match(dicho[0]!, /DEGRADADO/);
});

test("🔴 y la recuperación también se anuncia: sin eso, el log dice cuándo se rompió y nunca cuándo volvió", async () => {
  const reloj = relojFalso();
  const dicho: string[] = [];
  let cae = true;
  const sonda = crearSonda({
    comprobar: async () => {
      if (cae) throw new Error("caída");
      return undefined;
    },
    ttlMs: 10,
    log: (m) => dicho.push(m),
    ahora: reloj.ahora,
  });

  await sonda();
  cae = false;
  reloj.avanzar(50);
  await sonda();
  reloj.avanzar(50);
  await sonda();

  assert.equal(dicho.length, 2, "una al romperse y otra al volver, no más");
  assert.match(dicho[0]!, /DEGRADADO/);
  assert.match(dicho[1]!, /recuperado/);
});

/**
 * 🔴 El primer chequeo sano del proceso NO anuncia una recuperación que nunca ocurrió.
 *
 * Es el motivo de que el estado previo empiece en `null` y no en `true`: con `true`, el arranque
 * normal sería silencioso por casualidad; con `false`, cada arranque anunciaría un "recuperado"
 * falso. Distinguir "todavía no sé" es lo que hace correcto el caso de borde.
 */
test("🔴 el primer chequeo sano no anuncia nada (no hubo de qué recuperarse)", async () => {
  const dicho: string[] = [];
  const sonda = crearSonda({ comprobar: async () => undefined, log: (m) => dicho.push(m) });

  await sonda();

  assert.deepEqual(dicho, []);
});

/**
 * 🔴 La cache no es una optimización: `/_health` no lleva autenticación.
 *
 * Sin TTL, cualquiera que sepa la URL abre una transacción contra Postgres por request. Con TTL, el
 * coste queda acotado por tiempo y no por tráfico.
 */
test("🔴 dentro del TTL no se vuelve a preguntar (si no, cualquiera abre transacciones a voluntad)", async () => {
  const reloj = relojFalso();
  let veces = 0;
  const sonda = crearSonda({
    comprobar: async () => {
      veces++;
    },
    ttlMs: 5_000,
    ahora: reloj.ahora,
  });

  await sonda();
  reloj.avanzar(4_999);
  await sonda();
  await sonda();

  assert.equal(veces, 1, "una sola comprobación real");

  reloj.avanzar(2);
  await sonda();
  assert.equal(veces, 2, "y vencido el TTL, vuelve a preguntar");
});

/**
 * 🔴 Una base que tarda treinta segundos ESTÁ caída para esto.
 *
 * Sin timeout, `/_health` se cuelga con ella: Railway ve un request que no responde, y el diagnóstico
 * pasa de "el cuerpo dice qué falla" a "el health check no contesta", que es peor que el estado
 * original. El test no duerme el timeout real: usa uno corto y una promesa que nunca resuelve.
 */
test("🔴 una comprobación que nunca responde cuenta como degradada, no cuelga el health check", { timeout: 3_000 }, async () => {
  // El `timeout` del propio test NO es decorado: sin él, quitarle el `conTimeout` a la sonda no pone
  // este test en rojo — lo deja **colgado para siempre**, y un runner que no termina es peor que uno
  // que falla. Medido: con la mutación aplicada, el archivo entero no devolvía nunca. Con el timeout,
  // la mutación da rojo en 3 s y dice cuál.
  const sonda = crearSonda({
    comprobar: () => new Promise(() => {}),
    timeoutMs: 20,
    log: () => {},
  });

  const salud = await sonda();

  assert.deepEqual(salud.degradado, [DEPENDENCIA_BASE]);
});

/**
 * 🔴 Diez requests concurrentes con la base lenta no abren diez transacciones.
 *
 * Es el mismo agujero que el TTL cierra en el tiempo, abierto en el eje de la concurrencia: el TTL
 * solo se fija DESPUÉS de que la comprobación termina, así que sin esto todo lo que llegue mientras
 * la primera está en vuelo dispararía la suya.
 */
test("🔴 varias llamadas a la vez comparten UNA comprobación en vuelo", async () => {
  let veces = 0;
  let soltar!: () => void;
  const bloqueada = new Promise<void>((r) => {
    soltar = r;
  });
  const sonda = crearSonda({
    comprobar: async () => {
      veces++;
      await bloqueada;
    },
  });

  const todas = Promise.all([sonda(), sonda(), sonda(), sonda(), sonda()]);
  soltar();
  const resultados = await todas;

  assert.equal(veces, 1, `una comprobación para las cinco, y hubo ${veces}`);
  assert.deepEqual(resultados[0], {});
});

/**
 * 🔴 Los dos números son defaults de PRODUCCIÓN, y todos los tests de arriba los pisan.
 *
 * O sea que sin este test ninguno fija los que corren de verdad — la regla del proyecto: *si el test
 * elige el parámetro, no está fijando el que corre en prod*.
 */
test("🔴 los defaults de la sonda son los que corren en producción", () => {
  assert.equal(TTL_SONDA_MS, 5_000, "5 s: acota el coste sin dar una foto vieja");
  assert.equal(TIMEOUT_SONDA_MS, 2_000, "2 s: más que eso y el health check se lee como un cuelgue");
  assert.ok(TIMEOUT_SONDA_MS < TTL_SONDA_MS, "el timeout tiene que caber dentro del TTL");
});

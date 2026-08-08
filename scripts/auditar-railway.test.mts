/**
 * El contrato de `auditar-railway`. Nada de red: lo que se prueba es la lógica que decide qué se
 * reporta, que es donde están los tres modos de fallo que importan — el falso verde, el ruido y la
 * fuga de un valor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAPA } from "./env-sync.mts";
import {
  auditar,
  comparar,
  esperadas,
  EXTRA_JUSTIFICADO,
  formatear,
  gravedadDe,
  hayProblemas,
  huella,
  OBLIGATORIAS,
  SEGUN_MODO,
  SERVICIOS,
  type Servicio,
} from "./auditar-railway.mts";

/** Qué paquetes del `MAPA` alimentan a cada servicio. Lo que no salga de ahí es lo "extra". */
const DEL_MAPA: Record<Servicio, readonly string[]> = {
  "amg-project": MAPA.api,
  "amg-orchestrator": [...MAPA.orchestrator, ...MAPA["kr-service"], ...MAPA["web-builder"]],
  "amg-renderer": MAPA.renderer,
};

// ================================================================
// #1 — la holgura con el MAPA no puede ser donde se esconden los olvidos
// ================================================================

/**
 * 🔴 El inventario de producción es a propósito **más amplio** que el `MAPA`, y esa holgura es
 * exactamente donde una clave se cuela sin que nadie la haya decidido. Si agregar una obliga a
 * redactar por qué, una clave indefendible se nota al intentar escribir el motivo.
 */
test("🔴 toda clave esperada que no sale del MAPA está justificada por nombre", () => {
  for (const servicio of SERVICIOS) {
    const delMapa = new Set(DEL_MAPA[servicio]);
    for (const k of esperadas(servicio).filter((k) => !delMapa.has(k))) {
      assert.ok(
        EXTRA_JUSTIFICADO[k],
        `${servicio} espera "${k}", que no sale del MAPA y nadie justificó. Agregala a ` +
          "EXTRA_JUSTIFICADO con el motivo, o sacala del inventario",
      );
    }
  }
});

/** Y al revés: una justificación de una clave que ya nadie espera es documentación fantasma. */
test("no sobran justificaciones de claves que el inventario ya no pide", () => {
  const todas = new Set(SERVICIOS.flatMap((s) => esperadas(s)));
  assert.deepEqual(
    Object.keys(EXTRA_JUSTIFICADO).filter((k) => !todas.has(k)),
    [],
    "estas justifican claves que ya nadie espera",
  );
});

/**
 * 🔴 Las tres del renderizador son el caso que motivó tener inventario propio: el reparto **local**
 * se las niega con un test (`el renderizador NUNCA recibe una credencial de base de datos`) y en
 * Railway las tiene igual. Con `MAPA.renderer` pelado, el comparador diría que no falta nada mientras
 * al servicio le faltaran las tres.
 */
test("🔴 el inventario del renderizador incluye lo que el MAPA le niega a propósito", () => {
  const todas = esperadas("amg-renderer");
  for (const k of ["DATABASE_URL_RENDER", "PREVIEW_SECRET", "STORYBLOK_WEBHOOK_SECRET"]) {
    assert.ok(todas.includes(k), `sin "${k}" en el inventario, su ausencia en Railway no se detecta`);
  }
  assert.ok(
    !(MAPA.renderer as readonly string[]).includes("DATABASE_URL_RENDER"),
    "control: el MAPA local sigue negándosela — si esto cambia, el test de env-sync ya cayó",
  );
});

/**
 * 🔴 Los dos niveles tienen que ser **disjuntos**. Una clave en los dos sitios sería obligatoria y
 * opcional a la vez, y el informe la contaría dos veces con dos veredictos opuestos.
 */
test("🔴 ninguna clave es obligatoria y `según modo` a la vez", () => {
  for (const s of SERVICIOS) {
    const cruce = OBLIGATORIAS[s].filter((k) => k in SEGUN_MODO[s]);
    assert.deepEqual(cruce, [], `${s}: estas están en los dos niveles`);
  }
});

/**
 * 🔴 Y las obligatorias tienen que ser las que **de verdad** hacen fallar el arranque. Este test no
 * puede leer el `leerConfig` de cada paquete, pero sí puede impedir que la lista se infle: si alguien
 * mete acá una que el proceso tolera, el comando empieza a dar rojo en despliegues sanos y a la
 * tercera corrida se ignora. Las cuatro del orquestador salen del MAPA, que sí está atado a su
 * `.env.example` por otro test.
 */
test("🔴 las obligatorias del orquestador son EXACTAMENTE las de su contrato", () => {
  assert.deepEqual([...OBLIGATORIAS["amg-orchestrator"]].sort(), [...MAPA.orchestrator].sort());
});

// ================================================================
// #2 — el falso verde: una lectura vacía NO es "está todo bien"
// ================================================================

/**
 * 🔴 **El control positivo obligatorio.** Es el modo de fallo exacto que esta herramienta existe para
 * no repetir: `probar-dsn` daba verde midiendo otra cosa. Un token sin permiso, un servicio renombrado
 * o el entorno equivocado devuelven cero variables, y ante eso "no falta nada" no solo es falso:
 * además tranquiliza.
 */
test("🔴 un servicio que devuelve CERO variables ABORTA, no informa 'todo bien'", async () => {
  await assert.rejects(
    () => auditar(async () => new Map(), new Map()),
    /CERO variables/,
    "una lectura vacía tiene que verse como fallo de lectura, no como un servicio limpio",
  );
});

/** Control negativo del anterior: con variables de verdad, no aborta y no inventa problemas. */
test("con las obligatorias presentes, no hay problemas", async () => {
  const diffs = await auditar(async (s) => new Map(esperadas(s).map((k) => [k, `v-${k}`])), new Map());
  assert.equal(diffs.length, SERVICIOS.length);
  assert.ok(!hayProblemas(diffs));
});

// ================================================================
// #3 — ruido: una ausencia deliberada NO es un fallo
// ================================================================

/**
 * 🔴 El hallazgo que rehizo este archivo. Medido el 2026-08-08: el orquestador tiene **seis**
 * variables nuestras y no las veinte del inventario, y las catorce ausentes son correctas —sin
 * `DATAFORSEO_*` el research es mock, sin `OPENAI_API_KEY` la prosa es mock, sin
 * `STORYBLOK_MANAGEMENT_TOKEN` la publicación es dry-run—. Un comparador que grita catorce veces por
 * un despliegue sano se ignora a la tercera corrida, y entonces no avisa el día que el fallo es real.
 */
test("🔴 un servicio con SOLO las obligatorias no da rojo: informa lo que declara", () => {
  const real = new Map(OBLIGATORIAS["amg-orchestrator"].map((k) => [k, "x"]));
  const d = comparar("amg-orchestrator", real, new Map());

  assert.deepEqual(d.faltan, [], "no falta nada de lo que impide arrancar");
  assert.ok(!hayProblemas([d]), "un despliegue en mock está SANO, y el comando tiene que decirlo");
  assert.ok(d.declaraciones.length > 0, "pero sí informa qué implica cada ausencia");

  const dicho = new Map(d.declaraciones);
  assert.match(dicho.get("OPENAI_API_KEY") ?? "", /mock/, "la consecuencia se dice, no se supone");
  assert.match(dicho.get("STORYBLOK_MANAGEMENT_TOKEN") ?? "", /dry-run/);
});

test("🔴 una obligatoria ausente SÍ da rojo, y dice que sin ella no arranca", () => {
  const real = new Map(OBLIGATORIAS["amg-orchestrator"].filter((k) => k !== "PIPELINE_MODO").map((k) => [k, "x"]));
  const d = comparar("amg-orchestrator", real, new Map());
  assert.deepEqual(d.faltan, ["PIPELINE_MODO"]);
  assert.ok(hayProblemas([d]));
  assert.match(formatear([d]), /NO ARRANCA/);
});

// ================================================================
// #4 — qué reporta
// ================================================================

/**
 * 🔴 **El hallazgo que justifica el comando entero**, medido el 2026-08-08: la API tenía en Railway
 * `DATABASE_URL_ORQUESTADOR`, `DATABASE_URL_CACHE`, `DATABASE_URL_RENDER`, `INNGEST_SIGNING_KEY`,
 * `PREVIEW_SECRET` y `STORYBLOK_WEBHOOK_SECRET` — las credenciales de los otros dos procesos.
 *
 * Llamarlo "sobra una variable" sería quedarse corto: Postgres sigue impidiendo que `amg_api` **asuma**
 * `app_service` (ADR-17), pero un proceso que tiene el DSN del orquestador no necesita asumir nada —se
 * conecta como él—. La compartimentación que `env:sync` impone en local con un test no estaba impuesta
 * en producción por nadie, y eso es lo que este comando existe para ver.
 */
test("🔴 una credencial de OTRO servicio no 'sobra': se reporta como tal, con su dueño", () => {
  const real = new Map([
    ...esperadas("amg-project").map((k) => [k, "x"] as const),
    ["DATABASE_URL_ORQUESTADOR", "x"] as const,
    ["PREVIEW_SECRET", "x"] as const,
  ]);
  const d = comparar("amg-project", real, new Map());

  assert.deepEqual(d.sobran, [], "no son sobrantes anónimos: tienen dueño y hay que decirlo");
  assert.deepEqual(d.intrusas, [
    { clave: "DATABASE_URL_ORQUESTADOR", duenio: "amg-orchestrator", gravedad: "credencial" },
    { clave: "PREVIEW_SECRET", duenio: "amg-renderer", gravedad: "credencial" },
  ]);
  assert.ok(hayProblemas([d]), "tener la credencial de otro proceso es un problema, no un aviso");
  assert.match(formatear([d]), /CREDENCIALES DE OTRO PROCESO/);
});

/**
 * 🔴 Y lo que NO es un secreto no se anuncia como si lo fuera.
 *
 * Al limpiar el panel el 2026-08-08 quedaron `PIPELINE_MODO` y `TRUST_PROXY` —un enum y un booleano—
 * bajo el titular "CREDENCIALES DE OTRO PROCESO". Exagerar es el mismo pecado que este comando
 * persigue, y se paga caro: una herramienta que exagera se deja de leer, y el día que diga algo grave
 * nadie va a mirar. Sigue informándose (confunde tenerlo ahí), pero no da rojo.
 */
test("🔴 la CONFIGURACIÓN de otro proceso se informa, pero no se anuncia como credencial", () => {
  const real = new Map([
    ...esperadas("amg-project").map((k) => [k, "x"] as const),
    ["PIPELINE_MODO", "mock"] as const,
    ["TRUST_PROXY", "1"] as const,
  ]);
  const d = comparar("amg-project", real, new Map());

  assert.deepEqual(d.intrusas.map((i) => i.gravedad), ["config", "config"]);
  assert.ok(!hayProblemas([d]), "un enum fuera de sitio no es un agujero de seguridad");

  const salida = formatear([d]);
  assert.ok(!salida.includes("CREDENCIALES DE OTRO PROCESO"), "no hay ninguna credencial acá");
  assert.match(salida, /configuración de otro proceso/, "pero se dice, porque confunde tenerlo ahí");
});

/** Lo que el CATALOGO no clasifica no se adivina: se pide decidirlo. Fallar ruidoso, no fallar bien. */
test("🔴 una clave que nadie clasificó se marca `sin-clasificar` y NO se da por inocente", () => {
  assert.equal(gravedadDe("UNA_QUE_NADIE_CLASIFICO"), "sin-clasificar");
  assert.equal(gravedadDe("DATABASE_URL_RENDER"), "credencial");
  assert.equal(gravedadDe("PIPELINE_MODO"), "config");
});

test("una clave del servicio que nadie declaró se reporta como sobrante", () => {
  const real = new Map([...esperadas("amg-project").map((k) => [k, "x"] as const), ["UNA_QUE_NADIE_PUSO", "x"]]);
  assert.deepEqual(comparar("amg-project", real, new Map()).sobran, ["UNA_QUE_NADIE_PUSO"]);
});

/** Las que inyecta la plataforma sobran SIEMPRE; listarlas en cada corrida sería ruido puro. */
test("PORT y las RAILWAY_* no cuentan como sobrantes", () => {
  const real = new Map([
    ...esperadas("amg-project").map((k) => [k, "x"] as const),
    ["PORT", "8080"] as const,
    ["RAILWAY_GIT_BRANCH", "main"] as const,
  ]);
  assert.deepEqual(comparar("amg-project", real, new Map()).sobran, []);
});

/**
 * 🔴 El caso que motivó todo esto: la variable **está**, y su valor **no es** el de la fuente. El
 * 2026-08-07 Railway tenía un DSN con `@base:` de host mientras la fuente estaba bien, y `probar-dsn`
 * daba verde porque medía la fuente.
 */
test("🔴 una clave presente con OTRO valor se reporta como que difiere", () => {
  const fuente = new Map([["DATABASE_URL_API", "postgres://bien"]]);
  const real = new Map(esperadas("amg-project").map((k) => [k, k === "DATABASE_URL_API" ? "postgres://mal" : "x"]));
  const d = comparar("amg-project", real, fuente);
  assert.deepEqual(d.difieren, ["DATABASE_URL_API"]);
  assert.equal(d.faltan.length, 0, "está: lo que pasa es que no coincide");
});

test("presente con el MISMO valor cuenta como coincidencia, no como diferencia", () => {
  const fuente = new Map([["DATABASE_URL_API", "postgres://igual"]]);
  const real = new Map(esperadas("amg-project").map((k) => [k, k === "DATABASE_URL_API" ? "postgres://igual" : "x"]));
  const d = comparar("amg-project", real, fuente);
  assert.deepEqual(d.difieren, []);
  assert.equal(d.coinciden, 1, "solo esa se puede comparar: de las otras no hay valor en la fuente");
});

/** "Está pero vacía" es un fallo DISTINTO de "no está", y pasa cualquier chequeo de "está definida". */
test("una vacía en el servicio difiere de una con valor en la fuente", () => {
  const fuente = new Map([["CORS_ORIGINS", "https://bigballs.es"]]);
  const real = new Map(esperadas("amg-project").map((k) => [k, k === "CORS_ORIGINS" ? "" : "x"]));
  assert.deepEqual(comparar("amg-project", real, fuente).difieren, ["CORS_ORIGINS"]);
});

// ================================================================
// #5 — no se filtra un valor, nunca
// ================================================================

/**
 * 🔴 **La razón por la que `formatear` es una función aparte.** Todo lo que este comando imprime pasa
 * por acá, así que un descuido —un `JSON.stringify(real)` para depurar, un "esperaba X y vino Y"—
 * filtraría credenciales a la terminal y al scrollback. El test le da valores reconocibles y exige que
 * no aparezcan.
 */
test("🔴 la salida NO contiene ningún VALOR, solo nombres", () => {
  const SECRETO = "postgres://amg_api:ESTA-ES-LA-PASSWORD@host/db";
  const fuente = new Map([["DATABASE_URL_API", "postgres://amg_api:OTRA-PASSWORD@host/db"]]);
  const real = new Map(esperadas("amg-project").map((k) => [k, k === "DATABASE_URL_API" ? SECRETO : "x"]));

  const salida = formatear([comparar("amg-project", real, fuente)]);

  assert.ok(salida.includes("DATABASE_URL_API"), "el NOMBRE sí, que es lo que sirve para arreglarlo");
  assert.ok(!salida.includes("ESTA-ES-LA-PASSWORD"), "el valor del servicio se filtró a la salida");
  assert.ok(!salida.includes("OTRA-PASSWORD"), "el valor de la fuente se filtró a la salida");
  assert.ok(!salida.includes(SECRETO));
});

test("🔴 la huella no es el valor ni lo contiene", () => {
  const h = huella("password-larguísima-y-reconocible");
  assert.equal(h.length, 8);
  assert.ok(!h.includes("password"));
  assert.notEqual(h, huella("otra-cosa"), "valores distintos, huellas distintas");
  assert.equal(h, huella("password-larguísima-y-reconocible"), "y es estable");
});

/** Vacía y no-vacía tienen que distinguirse a simple vista, porque son fallos distintos. */
test('una vacía se marca como "(vacía)" y no como una huella cualquiera', () => {
  assert.equal(huella(""), "(vacía)");
  assert.notEqual(huella(" "), "(vacía)", "un espacio NO es vacío: es una variable mal pegada");
});

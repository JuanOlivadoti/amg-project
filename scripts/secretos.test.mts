import { test } from "node:test";
import assert from "node:assert/strict";
import { filtrarProhibidas, motivoProhibido } from "./secretos.mts";

/**
 * La compuerta que impide que una key entre a git. Existe con test porque la versión anterior era un
 * `grep` dentro de `verificar.sh` sin ninguno, y una revisión le encontró cuatro huecos en cinco
 * minutos: los cuatro están abajo marcados con 🔴.
 *
 * Cada caso responde una sola pregunta: ¿esta ruta puede estar versionada, sí o no?
 */

const PROHIBIDAS = [
  ".env",
  "api/.env",
  "db/.env",
  ".env.local",
  ".env.produccion",
  "portal/src/environments/.env.staging",
  "docs/private/credenciales.env",
  "docs/private/notas-de-despliegue.md",
  "docs/private/backup-env/api.env",
  "node_modules/paquete/index.js",
  "out/bundle.js",
  ".cache/dataforseo/respuesta.json",
];

const PERMITIDAS = [
  ".env.example",
  "api/.env.example",
  "db/.env.example",
  "docs/proyecto/07-configuracion.md",
  "portal/src/environments/environment.ts",
  "portal/src/environments/environment.prod.ts",
  "scripts/env-sync.mts",
  "AGENTS.md",
  "src/entorno.ts",
];

test("las rutas con secretos se rechazan, una por una", () => {
  for (const ruta of PROHIBIDAS) {
    assert.ok(motivoProhibido(ruta), `${ruta} debería estar prohibida y pasó`);
  }
});

test("las plantillas y el código normal pasan", () => {
  for (const ruta of PERMITIDAS) {
    assert.equal(motivoProhibido(ruta), null, `${ruta} no debería estar prohibida y se rechazó`);
  }
});

test("🔴 un archivo que TERMINA en .env, sin empezar con punto", () => {
  // El hueco más grave del grep viejo: exigía que el nombre fuera `.env` o empezara con `.env.`, así
  // que `credenciales.env` —el nombre que usa este mismo repo en docs/private— pasaba limpio.
  assert.ok(motivoProhibido("credenciales.env"));
  assert.ok(motivoProhibido("produccion.env"));
  assert.ok(motivoProhibido("config/staging.env"));
});

test("🔴 .envrc de direnv", () => {
  // direnv exporta variables al entrar al directorio: el contenido es el mismo que un .env.
  assert.ok(motivoProhibido(".envrc"));
});

test("🔴 docs/private/ gana sobre la excepción de .env.example", () => {
  // El grep viejo aplicaba `grep -v '.env.example$'` a la LÍNEA ENTERA, así que un
  // `docs/private/algo.env.example` quedaba perdonado por el sufijo aunque estuviera en la carpeta de
  // los valores reales. El orden de evaluación es la corrección: docs/private/ se decide primero.
  const motivo = motivoProhibido("docs/private/algo.env.example");
  assert.ok(motivo, "un .env.example dentro de docs/private/ NO es una plantilla pública");
  assert.match(motivo, /docs\/private/);
});

test("🔴 node_modules en cualquier nivel, no solo en la raíz", () => {
  // El patrón viejo anclaba `^node_modules/`, así que el árbol de dependencias del portal —que vive
  // en portal/node_modules porque no es workspace— no lo veía ninguno de los dos chequeos.
  assert.ok(motivoProhibido("portal/node_modules/@angular/core/index.js"));
  assert.ok(motivoProhibido("node_modules/tsx/dist/cli.js"));
});

test("🔴 la caja no apaga el detector", () => {
  // `.ENVRC` es el caso que importa: es el único de la lista que `.gitignore` NO cubre, así que este
  // detector es su única defensa. Los demás están cubiertos dos veces (acá y en .gitignore, que en
  // macOS casa sin distinguir caja) — pero una defensa en profundidad que se cae con Bloq Mayús no
  // es defensa en profundidad.
  assert.ok(motivoProhibido(".ENVRC"), "un .envrc en mayúsculas sigue siendo un .envrc");
  assert.ok(motivoProhibido(".ENV"));
  assert.ok(motivoProhibido("CREDENCIALES.ENV"));
  assert.ok(motivoProhibido("api/.Env.local"));
  assert.ok(motivoProhibido("docs/Private/notas.md"));
  assert.ok(motivoProhibido("portal/NODE_MODULES/x.js"));
  // Y la excepción también vale en cualquier caja: no se cuela una plantilla como si fuera secreto.
  assert.equal(motivoProhibido("api/.ENV.EXAMPLE"), null);
});

test("el motivo explica cuál es el problema, no solo que lo hay", () => {
  // Un "[FALLA] hay secretos" sin decir por qué obliga a adivinar. Cada rechazo se explica.
  assert.match(motivoProhibido(".env") ?? "", /entorno|keys/i);
  assert.match(motivoProhibido("node_modules/x.js") ?? "", /node_modules/);
  assert.match(motivoProhibido("out/x.js") ?? "", /build|cache/i);
});

test("filtrarProhibidas devuelve solo las malas, con su ruta limpia", () => {
  const entrada = [" .env ", "AGENTS.md", "", "docs/private/x.md", "api/.env.example"];
  const malas = filtrarProhibidas(entrada);
  assert.deepEqual(
    malas.map((m) => m.ruta),
    [".env", "docs/private/x.md"],
  );
});

test("una línea vacía no es un hallazgo", () => {
  // `git ls-files` termina con un salto de línea: sin esto, cada corrida reportaría un falso positivo
  // con la ruta vacía y el [FALLA] sería permanente.
  assert.equal(motivoProhibido(""), null);
  assert.equal(motivoProhibido("   "), null);
  assert.deepEqual(filtrarProhibidas(["", "  ", "\n"]), []);
});

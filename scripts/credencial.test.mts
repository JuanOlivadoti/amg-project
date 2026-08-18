/**
 * El contrato del generador de credenciales. Lo que se prueba NO es que genere cadenas: es que el
 * catálogo no se pueda quedar viejo en silencio, y que lo generado entre en un DSN sin romperlo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CATALOGO, MAPA, construirDsn, generarSecreto, upsertEnEnv, type Familia } from "./credencial.mts";

const CLAVES_DEL_MAPA = [...new Set(Object.values(MAPA).flat())] as string[];
const deFamilia = (f: Familia) => Object.entries(CATALOGO).filter(([, e]) => e.familia === f);

/*
 * El cerrojo del cerrojo: sin este test el catálogo sería una lista escrita a mano que envejece sola.
 * `env-sync` ya sabe qué claves existen —las reparte—, así que agregar una al `MAPA` sin decidir acá
 * CÓMO se crea rompe la suite. La dirección es solo ésta: el catálogo puede tener de más (las del
 * orquestador, que todavía no se reparten; las tres que a propósito no se le dan al renderizador),
 * pero no de menos.
 */
test("toda clave que env-sync reparte está clasificada en el CATALOGO", () => {
  assert.ok(CLAVES_DEL_MAPA.length > 0, "control positivo: si el MAPA llegara vacío, este test no miraría nada");
  const sinClasificar = CLAVES_DEL_MAPA.filter((c) => !CATALOGO[c]);
  assert.deepEqual(
    sinClasificar,
    [],
    "estas claves se reparten pero nadie declaró cómo se crean. Agregalas a CATALOGO en " +
      "scripts/credencial.mts eligiendo su familia (dsn | secreto | tercero | config).",
  );
});

/*
 * El bug que este test existe para impedir: una password con `@`, `/`, `#`, `%` o `+` metida cruda en
 * `postgresql://usuario:PASS@host/…` rompe la URL. Y lo peor no es el error — es que a veces NO hay
 * error y se conecta a otro sitio, porque el parser corta por el primer `@`.
 *
 * Muta `base64url` a `base64` en `generarSecreto` y este test cae: el alfabeto de base64 incluye `+`
 * y `/`, los dos reservados en una URL.
 */
test("lo generado es URL-safe: solo A-Za-z0-9-_", () => {
  for (let i = 0; i < 200; i++) {
    const s = generarSecreto();
    assert.match(s, /^[A-Za-z0-9_-]+$/, `carácter no seguro en una URL: ${JSON.stringify(s)}`);
  }
});

test("lo generado no es constante ni corto", () => {
  const a = generarSecreto();
  const b = generarSecreto();
  assert.notEqual(a, b, "dos llamadas devolvieron lo mismo: no hay azar");
  // 24 bytes en base64url son 32 caracteres. Se comprueba el piso, no la igualdad, para que subir la
  // entropía no rompa el test — pero bajarla sí.
  assert.ok(a.length >= 32, `demasiado corto (${a.length}): 24 bytes tienen que dar 32 caracteres`);
});

test("el DSN usa el transaction pooler y el usuario lleva el project-ref", () => {
  const dsn = construirDsn("amg_orquestador", "elref", "un.host.example", undefined);
  // El 6543 no es cosmético: es el modo que soporta el acceso por transacción con conexión reservada
  // (ADR-13). Con el 5432 el proceso conecta igual y falla más tarde y peor.
  assert.match(dsn, /@un\.host\.example:6543\/postgres$/, "tiene que salir por el pooler de transacciones");
  assert.match(dsn, /^postgresql:\/\/amg_orquestador\.elref:/, "Supabase exige usuario.<project-ref>");
});

test("la password del DSN también es URL-safe", () => {
  for (let i = 0; i < 50; i++) {
    const dsn = construirDsn("amg_cache", "r", "h", undefined);
    const pass = dsn.slice(dsn.indexOf(":", dsn.indexOf("//")) + 1, dsn.lastIndexOf("@"));
    assert.match(pass, /^[A-Za-z0-9_-]+$/);
    // Y la comprobación que de verdad importa: que el DSN entero sea una URL parseable y que lo que
    // el driver lea como host sea el host. Un `@` en la password movería este límite sin avisar.
    assert.equal(new URL(dsn).hostname, "h");
  }
});

/*
 * La familia `tercero` es la razón de ser del catálogo: ante `OPENAI_API_KEY` un generador ingenuo
 * devolvería 32 caracteres al azar —algo que PARECE una key y falla mucho después con un 401—. El
 * script se niega, pero negarse sin decir dónde conseguirla lo vuelve un muro: por eso la nota es
 * obligatoria y lo fija este test.
 */
test("cada credencial de tercero dice quién la emite", () => {
  const terceros = deFamilia("tercero");
  assert.ok(terceros.length > 0, "control positivo: sin entradas `tercero` este test no miraría nada");
  for (const [nombre, e] of terceros) {
    assert.ok(e.nota && e.nota.length > 0, `\`${nombre}\` se niega a generarse pero no dice dónde sacarla`);
  }
});

/*
 * -----------------------------------------------------------------------------------------------
 * La escritura en la fuente. Todo se prueba sobre TEXTO, nunca sobre `docs/private/credenciales.env`:
 * un test que abriera el archivo real sería un test capaz de romperlo.
 * -----------------------------------------------------------------------------------------------
 */

/** El fixture lleva a propósito las tres formas que confunden a un `replace` ingenuo. */
const ENV = [
  "# --- api ---",
  "DATABASE_URL_API=vieja-api",
  "",
  "# --- db ---",
  "#DATABASE_URL_CACHE=comentada-y-vieja",
  "DATABASE_URL_CACHE=vieja-cache",
  "CORS_ORIGINS=https://bigballs.es",
  "",
].join("\n");

test("upsert reemplaza EN SU SITIO y no toca ni una línea más", () => {
  const r = upsertEnEnv(ENV, "DATABASE_URL_CACHE", "NUEVA");
  assert.equal(r.reemplazo, true);
  assert.equal(r.anterior, "vieja-cache");
  assert.equal(
    r.texto,
    ENV.replace("DATABASE_URL_CACHE=vieja-cache", "DATABASE_URL_CACHE=NUEVA"),
    "solo puede cambiar esa línea: el archivo está agrupado por paquete y los comentarios importan",
  );
});

/*
 * La trampa nº 1, y la más fácil de escribir mal: sin el `=` en el ancla, `DATABASE_URL` pisaría
 * `DATABASE_URL_API`. En este proyecto los prefijos compartidos son la norma (`DATABASE_URL_*`), así
 * que esto no es un caso de laboratorio. Quitá el `\\s*=` del ancla en `upsertEnEnv` y este test cae.
 */
test("upsert no confunde una clave con otra que empieza igual", () => {
  const r = upsertEnEnv(ENV, "DATABASE_URL", "NUEVA");
  assert.equal(r.reemplazo, false, "`DATABASE_URL` no existe: `DATABASE_URL_API` es OTRA clave");
  assert.match(r.texto, /DATABASE_URL_API=vieja-api/, "no puede haber tocado la que empieza igual");
  assert.match(r.texto, /\nDATABASE_URL=NUEVA\n$/, "la nueva se agrega al final");
});

/*
 * La trampa nº 2: si una línea comentada contara como "la clave", el upsert reemplazaría la HISTORIA y
 * dejaría intacta la clave de verdad más abajo — o sea, escribiría la credencial nueva en un sitio que
 * nadie lee, y en silencio.
 */
test("upsert ignora una línea comentada y encuentra la de verdad", () => {
  const r = upsertEnEnv(ENV, "DATABASE_URL_CACHE", "NUEVA");
  assert.match(r.texto, /#DATABASE_URL_CACHE=comentada-y-vieja/, "el comentario se conserva tal cual");
  assert.match(r.texto, /\nDATABASE_URL_CACHE=NUEVA\n/, "y la que se reemplaza es la activa");
});

test("upsert agrega la clave nueva sin duplicar el salto de línea final", () => {
  assert.match(upsertEnEnv("A=1\n", "B", "2").texto, /^A=1\nB=2\n$/);
  assert.match(upsertEnEnv("A=1", "B", "2").texto, /^A=1\nB=2\n$/, "una fuente sin \\n final tampoco se pega");
  assert.match(upsertEnEnv("", "B", "2").texto, /^B=2\n$/, "y una fuente vacía no empieza con un vacío");
});

test("cada DSN del catálogo nombra su rol de Postgres", () => {
  const dsns = deFamilia("dsn");
  assert.ok(dsns.length > 0, "control positivo: sin entradas `dsn` este test no miraría nada");
  for (const [nombre, e] of dsns) {
    assert.ok(e.rol, `\`${nombre}\` es familia dsn pero no declara el rol al que se le cambia la password`);
    // ADR-17: un proceso, un login, un rol. Un DSN cuyo rol fuera el dueño de la base convertiría esa
    // separación en una coincidencia de nombres.
    assert.notEqual(e.rol, "postgres", `\`${nombre}\` apunta al DUEÑO de la base: eso rompe ADR-17`);
  }
});

/*
 * 🔴 El bug real: en Windows, `` `file://${process.argv[1]}` `` (backslashes, dos barras) nunca es
 * igual a `import.meta.url` (siempre `file:///C:/...`, forward slashes, tres barras) — así que la
 * puerta de arranque nunca se abría, `main()` no corría NUNCA, y el CLI quedaba mudo: sin imprimir,
 * sin escribir, sin fallar. Los tests de arriba importan el módulo (por eso `main()` no debe correr
 * ahí) pero ninguno prueba lo contrario: que SÍ corra cuando el script se ejecuta de verdad como CLI.
 * Solo un subproceso real lo prueba — mismo mecanismo que ya usa `contar-tests.test.mts` para el
 * mismo motivo. Sin argumentos es la invocación sin efectos secundarios (imprime el catálogo y
 * vuelve), así que no toca `docs/private/credenciales.env`.
 */
test("🔴 el CLI corre de verdad como proceso (no solo importado) — sin esto, main() nunca se llama", () => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "credencial.mts"], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    encoding: "utf8",
  });

  assert.equal(r.status, 0, `el CLI sin argumentos no debería fallar (stderr: ${r.stderr})`);
  assert.match(
    r.stdout,
    /Credenciales que ESTE script genera/,
    "si esto no aparece, la puerta de arranque no dejó pasar a main() — exactamente el bug de Windows",
  );
});

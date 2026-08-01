/**
 * El contrato de reseed-demo. Lo que se prueba no es el "camino feliz" (eso lo prueba correrlo): es
 * que falle CERRADO ante una fuente a medio completar, que no filtre la password de admin por
 * ninguna salida, y que el comando que lanza no pueda tomar las credenciales de `db/.env`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MAPA, RAIZ, claveDePaquete } from "./env-sync.mts";
import { CLAVES_SEED, clavesDeSeed, validar, resumirDsn, construirComando } from "./reseed-demo.mts";

const PASSWORD = "PaSsW0rd-SUPERSECRETA";
const DSN_OK = `postgresql://postgres.abcdefghijkl:${PASSWORD}@aws-1-eu-west-2.pooler.supabase.com:5432/postgres`;
const FRANK = "11111111-2222-3333-4444-555555555555";
const JUAN = "66666666-7777-8888-9999-aaaaaaaaaaaa";

/** Una fuente válida a la que cada test le rompe una cosa. */
function fuenteValida(extra: Record<string, string> = {}): Map<string, string> {
  return new Map(
    Object.entries({
      DATABASE_URL_ADMIN: DSN_OK,
      SEED_FRANK_USER_ID: FRANK,
      SEED_JUAN_USER_ID: JUAN,
      ...extra,
    }),
  );
}

test("clavesDeSeed toma exactamente las claves del MAPA de db, ni una más", () => {
  // Si mañana el MAPA le da otra clave a `db`, este script tiene que seguirla sin que nadie edite una
  // copia acá. Y no puede arrastrar claves de otros paquetes al entorno del seed.
  const claves = clavesDeSeed(fuenteValida({ STORYBLOK_MANAGEMENT_TOKEN: "no-es-tuyo" }));
  assert.deepEqual([...claves.keys()].sort(), [...MAPA.db].sort());
  assert.deepEqual([...CLAVES_SEED].sort(), [...MAPA.db].sort());
});

test("clavesDeSeed respeta el override por paquete DB__…", () => {
  const otro = DSN_OK.replace("aws-1-eu-west-2", "aws-9-us-east-1");
  const claves = clavesDeSeed(fuenteValida({ [claveDePaquete("db", "DATABASE_URL_ADMIN")]: otro }));
  assert.equal(claves.get("DATABASE_URL_ADMIN"), otro);
});

test("una fuente completa y coherente no tiene problemas", () => {
  assert.deepEqual(validar(clavesDeSeed(fuenteValida())), []);
});

test("clavesDeSeed recorta: lo validado es EXACTAMENTE lo que recibiría el proceso hijo", () => {
  // El env del hijo se arma con este mismo mapa. Si el recorte se hiciera solo dentro de `validar`,
  // se validaría un string y se sembraría con otro —el caso real es un DSN con un salto de línea
  // pegado al final, que hace fallar la conexión con un error que no menciona el espacio en blanco.
  const claves = clavesDeSeed(new Map([["SEED_FRANK_USER_ID", `  ${FRANK}\n`], ["DATABASE_URL_ADMIN", ` ${DSN_OK} `]]));
  assert.equal(claves.get("SEED_FRANK_USER_ID"), FRANK);
  assert.equal(claves.get("DATABASE_URL_ADMIN"), DSN_OK);
  assert.ok(!validar(claves).some((p) => /SEED_FRANK_USER_ID no es un UUID/.test(p)));
});

test("avisa si el DSN quedó entre comillas", () => {
  // En un `.env` las comillas no se quitan: quedan dentro del valor. Sin este caso el mensaje sería
  // "no parece un DSN de Postgres" sobre algo que a la vista sí lo es.
  const problemas = validar(clavesDeSeed(fuenteValida({ DATABASE_URL_ADMIN: `"${DSN_OK}"` })));
  assert.ok(problemas.some((p) => /entre comillas/.test(p)), JSON.stringify(problemas));
  for (const p of problemas) assert.ok(!p.includes(PASSWORD), `filtró la password en: ${p}`);
});

for (const [caso, fuente, esperado] of [
  ["DSN vacío", fuenteValida({ DATABASE_URL_ADMIN: "" }), /DATABASE_URL_ADMIN está vacía/],
  ["DSN que no es Postgres", fuenteValida({ DATABASE_URL_ADMIN: "https://supabase.com/db" }), /no parece un DSN de Postgres/],
  [
    "DSN con el placeholder del ejemplo",
    fuenteValida({ DATABASE_URL_ADMIN: "postgresql://postgres.PROJECT-REF:LA-PASSWORD@host:5432/postgres" }),
    /placeholder del ejemplo/,
  ],
  ["UUID de Frank vacío", fuenteValida({ SEED_FRANK_USER_ID: "" }), /SEED_FRANK_USER_ID está vacía/],
  ["UUID de Juan vacío", fuenteValida({ SEED_JUAN_USER_ID: "" }), /SEED_JUAN_USER_ID está vacía/],
  ["UUID malformado", fuenteValida({ SEED_JUAN_USER_ID: "no-soy-un-uuid" }), /SEED_JUAN_USER_ID no es un UUID/],
] as const) {
  test(`falla cerrado: ${caso}`, () => {
    const problemas = validar(clavesDeSeed(fuente));
    assert.ok(
      problemas.some((p) => esperado.test(p)),
      `esperaba un problema que matchee ${esperado}, salió: ${JSON.stringify(problemas)}`,
    );
  });
}

test("falla cerrado si Frank y Juan son el mismo usuario", () => {
  // El seed no fallaría: la segunda membresía upserta sobre la primera y Frank pierde `maestro` en
  // silencio. Si alguien saca esta validación, el fallo reaparece recién en el portal.
  const problemas = validar(clavesDeSeed(fuenteValida({ SEED_JUAN_USER_ID: FRANK })));
  assert.ok(problemas.some((p) => /el mismo UUID/.test(p)), JSON.stringify(problemas));

  // Y el mismo UUID escrito con otra caja sigue siendo el mismo usuario. Se compara contra JUAN, no
  // contra FRANK: FRANK es todo dígitos, así que `toUpperCase()` no lo cambiaría y el test pasaría
  // solo, incluso sin normalización — un test de seguridad que siempre pasa es peor que no tenerlo.
  const otraCaja = JUAN.toUpperCase();
  assert.notEqual(otraCaja, JUAN, "el UUID elegido tiene que tener letras para que este test valga");
  const conMayus = validar(clavesDeSeed(fuenteValida({ SEED_FRANK_USER_ID: otraCaja })));
  assert.ok(conMayus.some((p) => /el mismo UUID/.test(p)), JSON.stringify(conMayus));
});

test("ningún mensaje de validación contiene la password de admin", () => {
  // Los errores se pegan en chats y en tickets. Rompé el DSN de todas las formas que se nos ocurren y
  // revisá TODAS las salidas: la password no puede aparecer en ninguna.
  const rotos = [
    "",
    "https://supabase.com/db",
    `postgres://postgres.PROJECT-REF:${PASSWORD}@host:5432/postgres`,
    `postgresql://postgres.abc:${PASSWORD}@host:puerto-no-numerico/postgres`,
  ];
  for (const dsn of rotos) {
    for (const p of validar(clavesDeSeed(fuenteValida({ DATABASE_URL_ADMIN: dsn, SEED_JUAN_USER_ID: "roto" })))) {
      assert.ok(!p.includes(PASSWORD), `filtró la password en: ${p}`);
    }
  }
});

test("resumirDsn muestra usuario, host y base, y tapa la password", () => {
  const r = resumirDsn(DSN_OK);
  assert.ok(!r.includes(PASSWORD), r);
  assert.ok(r.includes("postgres.abcdefghijkl"), r);
  assert.ok(r.includes("aws-1-eu-west-2.pooler.supabase.com:5432"), r);
  assert.ok(r.endsWith("/postgres"), r);
});

test("resumirDsn NO vuelca el DSN crudo cuando no parsea", () => {
  // El caso típico de DSN no parseable es una password con `@` sin escapar: el fallback ingenuo
  // («si no puedo parsearlo, lo muestro tal cual») filtraría justo la credencial.
  const r = resumirDsn(`postgresql://postgres.abc:${PASSWORD}@@@host:no-un-puerto/postgres`);
  assert.ok(!r.includes(PASSWORD), r);
  assert.match(r, /no se pudo parsear/);
});

test("el comando del seed NO carga ningún .env: la fuente única es el entorno que le pasamos", () => {
  // `npm run seed:demo -w db` usa `tsx --env-file-if-exists=.env`, y `db/.env` es generado y puede
  // estar desincronizado de la fuente. Si alguien "simplifica" esto a llamar al script de npm,
  // sembrar dependería de la precedencia entorno-vs-env-file para no escribir en OTRA base.
  const { cmd, args, cwd } = construirComando();
  assert.ok(!args.some((a) => a.includes("--env-file")), args.join(" "));
  assert.equal(cwd, join(RAIZ, "db"));
  assert.ok(cmd.endsWith(join("node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx")), cmd);
});

test("el comando apunta a un CLI de seed que existe", () => {
  const { args, cwd } = construirComando();
  assert.equal(args.length, 1);
  assert.ok(existsSync(join(cwd, args[0]!)), `no existe ${join(cwd, args[0]!)}`);
});

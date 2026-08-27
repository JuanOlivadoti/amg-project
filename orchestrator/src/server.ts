/*
 * Carga `orchestrator/.env` (desde el cwd, o sea `npm run serve -w orchestrator`). Va **acá, en el
 * punto de entrada**, y no en `config.ts`, por dos motivos:
 *
 *  · Hasta hoy funcionaba **de rebote**: `kr-service` y `web-builder` hacen `import "dotenv/config"`
 *    en SUS config, y como este proceso los importa, el `.env` acababa cargándose antes de
 *    `leerConfig()`. Cierto, y accidental: dependía de que estas importaciones siguieran ahí. El
 *    `.env.example` que promete que `env:sync` genera un archivo útil necesita que esto sea explícito.
 *  · En `config.ts` sería peor: ese módulo **sí** lo importan los tests, y entonces un
 *    `orchestrator/.env` presente en la máquina de alguien le metería variables a `config.test.ts`
 *    —que comprueba justamente qué pasa cuando FALTAN— y el suite pasaría a depender de qué archivos
 *    tenga cada uno. `server.ts` no lo importa ningún test.
 */
import "dotenv/config";
import { serve } from "inngest/node";
import { modoProsa, modoPublicacion } from "web-builder";
import { crearServidor, opcionesDeServe } from "./app.js";
import { leerConfig } from "./config.js";
import { crearDeps, crearConexiones } from "./deps.js";
import {
  crearFuncionBarrido,
  crearFuncionDecision,
  crearFuncionPollingResenas,
  crearFuncionPublicarResena,
  crearFuncionResearch,
  crearFuncionVincularTelegram,
  inngest,
} from "./functions.js";
import { crearSonda } from "./salud.js";

/**
 * Expone las funciones del orquestador para que Inngest las invoque.
 *
 * En desarrollo: `npx inngest-cli dev -u http://localhost:3100/api/inngest` levanta el runtime
 * local (con su panel para ver los runs, los steps y reintentarlos a mano). Sin `DATABASE_URL` y
 * sin credenciales de proveedor, el sistema entero corre igual: PGlite en memoria y los providers
 * mock. Es el mismo principio que ya rige en `kr-service` y `web-builder`.
 *
 * En producción (Railway) el arranque es al revés: `leerConfig()` es lo PRIMERO que corre y aborta si
 * falta algo. Antes no había nada de eso y una variable mal escrita levantaba un proceso que se
 * declaraba sano sobre una base efímera. Ver `config.ts`.
 *
 * `obtenerModoPublicacion` viaja acá y no como `import` dentro de `config.ts`: ese módulo lo importan
 * los tests, y `web-builder` hace `import "dotenv/config"` al cargarse — traerlo adentro de `config.ts`
 * le metería el `.env` de `web-builder` a `config.test.ts`. Acá, en cambio, ya está importado (línea de
 * arriba) para `/_health`, así que pasarlo es reusar la misma lectura, no una nueva.
 */
const config = leerConfig({ obtenerModoPublicacion: modoPublicacion });

const cx = await crearConexiones(config);
const deps = crearDeps(cx);
// Seis: el workflow del research, el workflow de la decisión (aprobar y bifurcar por destino), el
// barrido programado, el polling de reseñas de Google, la publicación de la respuesta de vuelta en
// Google (Bloque F, fase 2, segunda pieza) y la vinculación de Telegram (Bloque F, fase 2, alertas).
// `/_health` reporta el número, así que tras desplegar esto tiene que decir `funciones: 6` — y en el
// panel de Inngest se ven ocho, porque cuenta el `onFailure` de research y el de decision, cada uno,
// como una función aparte.
const funciones = [
  crearFuncionResearch(deps),
  crearFuncionDecision(deps),
  crearFuncionBarrido(deps),
  crearFuncionPollingResenas(deps),
  crearFuncionPublicarResena(deps),
  crearFuncionVincularTelegram(deps),
];

/*
 * En qué modo publica este proceso. Se pregunta UNA vez —la config de `web-builder` se congela al
 * importarse, así que preguntar por request daría lo mismo— y el valor se usa para las DOS salidas:
 * el log del arranque y `/_health`. Una sola llamada y no dos, para que no exista siquiera la
 * posibilidad de que el log diga una cosa y el endpoint otra.
 */
const publicacion = modoPublicacion();
const prosa = modoProsa();
const borrador = config.borradorResenas;

const server = crearServidor({
  // La `signingKey` validada viaja acá dentro. Si se dejara al SDK releer el entorno, lo comprobado
  // y lo usado serían dos lecturas distintas — ver `opcionesDeServe`.
  manejadorInngest: serve(opcionesDeServe(config, inngest, funciones)),
  funciones: funciones.length,
  modo: config.esProduccion ? "cloud" : "dev",
  pipeline: config.pipeline,
  // Lo que importa es de DÓNDE sale: de la misma función que elige el publisher, no de un
  // `process.env` releído acá. Ver `app.ts`.
  publicacion,
  prosa,
  borrador,
  // La sonda va por el STORE, no por el pool: así recorre el mismo `set local role app_service` que
  // hace el trabajo real, y no solo el TCP. Ver `salud.ts` y `PgStore.comprobarAcceso`.
  sonda: crearSonda({ comprobar: () => deps.store.comprobarAcceso() }),
});

server.listen(config.puerto, () => {
  console.log(`▶ Orquestador escuchando en http://localhost:${config.puerto}/api/inngest`);
  console.log(`  Salud: http://localhost:${config.puerto}/_health`);
  console.log(`  Funciones: ${funciones.length}`);
  console.log(`  Modo: ${config.esProduccion ? "cloud (producción)" : "dev"}`);
  console.log(`  Persistencia: ${config.persistencia.tipo}`);
  console.log(`  Pipeline: ${config.pipeline}${config.pipeline === "live" ? " ⚠️  GASTA DINERO" : ""}`);
  const aviso =
    publicacion === "live"
      ? " ⚠️  ESCRIBE EN EL STORYBLOK DEL CLIENTE"
      : publicacion === "mock"
        ? " ⚠️  no sale del contenedor, pero la base lo anota como publicado"
        : "";
  console.log(`  Publicación: ${publicacion}${aviso}`);
  console.log(`  Prosa: ${prosa}${prosa === "openai" ? " ⚠️  GASTA DINERO al publicar" : ""}`);
  console.log(`  Borrador IA: ${borrador}${borrador === "openai" ? " ⚠️  GASTA DINERO al generar borradores" : ""}`);
});

const apagar = async () => {
  server.close();
  await cx.cerrar();
  process.exit(0);
};
process.on("SIGINT", apagar);
process.on("SIGTERM", apagar);

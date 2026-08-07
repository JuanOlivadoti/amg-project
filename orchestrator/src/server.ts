import { serve } from "inngest/node";
import { crearServidor, opcionesDeServe } from "./app.js";
import { leerConfig } from "./config.js";
import { crearDeps, crearConexiones } from "./deps.js";
import { crearFuncionBarrido, crearFuncionResearch, inngest } from "./functions.js";

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
 */
const config = leerConfig();

const cx = await crearConexiones(config);
const deps = crearDeps(cx);
// Dos: el workflow del research y el barrido programado. `/_health` reporta el número, así que tras
// desplegar esto tiene que decir `funciones: 2` — y en el panel de Inngest se ven tres, porque cuenta
// el `onFailure` del research como una función aparte.
const funciones = [crearFuncionResearch(deps), crearFuncionBarrido(deps)];

const server = crearServidor({
  // La `signingKey` validada viaja acá dentro. Si se dejara al SDK releer el entorno, lo comprobado
  // y lo usado serían dos lecturas distintas — ver `opcionesDeServe`.
  manejadorInngest: serve(opcionesDeServe(config, inngest, funciones)),
  funciones: funciones.length,
  modo: config.esProduccion ? "cloud" : "dev",
  pipeline: config.pipeline,
});

server.listen(config.puerto, () => {
  console.log(`▶ Orquestador escuchando en http://localhost:${config.puerto}/api/inngest`);
  console.log(`  Salud: http://localhost:${config.puerto}/_health`);
  console.log(`  Funciones: ${funciones.length}`);
  console.log(`  Modo: ${config.esProduccion ? "cloud (producción)" : "dev"}`);
  console.log(`  Persistencia: ${config.persistencia.tipo}`);
  console.log(`  Pipeline: ${config.pipeline}${config.pipeline === "live" ? " ⚠️  GASTA DINERO" : ""}`);
});

const apagar = async () => {
  server.close();
  await cx.cerrar();
  process.exit(0);
};
process.on("SIGINT", apagar);
process.on("SIGTERM", apagar);

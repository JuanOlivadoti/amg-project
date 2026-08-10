import type { ConexionReservada } from "./deploy.js";
import type { EstadoIdea } from "./ideas.js";

/**
 * Seed de IDEAS de ejemplo para el módulo del portal (pieza 3, Etapa 4).
 *
 * Siembra unas pocas ideas de La Birra Bar en los cuatro estados, para poder manejar el listado, los
 * filtros, el detalle y las transiciones en un navegador. Es un seed de **desarrollo**: `dev-server.ts`
 * lo llama; `reseed:demo` (que escribe en el Supabase real) **no**, y esa es una decisión, no un
 * olvido — producción tiene los datos reales de la demo y sembrar ahí ideas inventadas es algo que
 * nadie ha pedido. Si algún día se quiere, se decide entonces y se engancha en `db/src/cli/seed.ts`.
 *
 * ## ⛔ La Birra Bar es un restaurante REAL, y esto va en su ficha
 *
 * De ahí las dos reglas que gobiernan el contenido de este archivo, y las dos tienen test:
 *
 *   1. **Se tiene que notar que es de mentira DESDE LA PANTALLA**, no desde un comentario del código
 *      que nadie ve. La marca va en el título (que es lo único que se lee en el listado), en el
 *      resumen, en el remitente, en la primera línea de la transcripción y en las observaciones del
 *      análisis. Si alguien abre el portal y no puede distinguirlo en dos segundos, el seed está mal
 *      hecho. Una idea falsa que parezca real en la pantalla de un cuentas es peor que no tener seed.
 *   2. **No se inventa nada sobre el negocio**: ni precios, ni horarios, ni promociones que la
 *      agencia no haya hecho. Es la misma regla que hace que `PERFIL_DEMO` (`seed-demo.ts`) se niegue
 *      a poner un `price` en la carta —"antes ausente que inventado"— y que las fotos de stock no se
 *      siembren en esta ficha. Un importe puesto a ojo en una idea es un hecho fabricado sobre un
 *      negocio que existe.
 *
 * Las URL apuntan a `example.invalid`: el TLD reservado por la RFC 2606, que **nunca resuelve**. Un
 * `<audio src>` de ejemplo no puede terminar sonando algo real, y el enlace no lleva a ninguna parte.
 *
 * ## Se corre con la INFRAESTRUCTURA, y que haga falta es la señal
 *
 * `app_user` no tiene grant de `insert` sobre `ideas` (0013): el ingreso real es el flujo de audio de
 * n8n y **todavía no existe**. Hasta que exista, la única vía es la conexión de administración —la
 * misma que corre las migraciones—. Que este seed necesite esa autoridad no es una incomodidad que
 * haya que "arreglar" con un grant: es cómo se nota el hueco.
 */

/** Lo único que hace falta saber de fuera: a qué negocio pertenecen estas ideas. */
export interface DestinoIdeasDemo {
  tenantId: string;
  /** El cliente de la demo (`DEMO_CLIENT_ID` de `seed-demo.ts`). La FK compuesta exige que sea suyo. */
  clientId: string;
}

/**
 * La marca que hace visible que una idea es de ejemplo. Es una constante y no un literal repetido
 * porque el test la compara: si alguien la cambia, la comprobación la sigue.
 */
export const MARCA_EJEMPLO = "[EJEMPLO]";

/**
 * El aviso que abre TODAS las transcripciones sembradas.
 *
 * Va primero porque la pantalla de detalle pinta la transcripción entera y lo primero que se lee es
 * el principio; y lo pone `conAviso()` en vez de estar copiado en cada texto, para que no dependa de
 * que quien agregue la sexta idea se acuerde.
 */
const AVISO_TRANSCRIPCION = `${MARCA_EJEMPLO} Texto de prueba para desarrollo. NO es un audio real de La Birra Bar.`;

const CIERRE_TRANSCRIPCION = "— fin del texto de EJEMPLO —";

function conAviso(cuerpo: string): string {
  return `${AVISO_TRANSCRIPCION}\n\n${cuerpo}\n\n${CIERRE_TRANSCRIPCION}`;
}

/**
 * Las ocho claves del bloque que produce el LLM.
 *
 * Están tipadas una por una en vez de `Record<string, unknown>` para que un typo (`canales_comunicación`)
 * **no compile**. La lista tiene que coincidir con `CLAVES_ANALISIS` (`api/src/ideas-http.ts`), que es
 * la allowlist que valida un `PATCH`: si el seed produjera una clave que la API no admite, la pantalla
 * de edición cargaría el análisis, lo reenviaría entero y recibiría un 400. `db` no puede importar de
 * `api` (la dependencia va al revés), así que las dos listas las ata un test **en `api`**
 * (`api/src/ideas-seed-contrato.test.ts`).
 *
 * Las tres que la pantalla RECORRE (`canales_comunicacion`, `materiales_formatos`,
 * `ideas_complementarias`) son arrays a propósito: `analisis` valida los nombres de las claves, no la
 * forma de los valores, y `@for` sobre un objeto lanza en Angular.
 */
export interface AnalisisIdeaDemo {
  audiencia_objetivo: string;
  canales_comunicacion: string[];
  intencion: string;
  materiales_formatos: string[];
  /** Lleva la marca de ejemplo: es el campo del análisis que la pantalla muestra como texto libre. */
  observaciones: string;
  checklist_interpretacion: string[];
  ideas_complementarias: string[];
  tipo_accion: string;
}

/** Una idea de ejemplo, con su id FIJO (es lo que hace el seed idempotente). */
export interface IdeaDemo {
  id: string;
  titulo: string;
  estado: EstadoIdea;
  resumen: string | null;
  transcripcion: string | null;
  audio_url: string | null;
  carpeta_url: string | null;
  mensaje_de: string | null;
  /** `{}` = todavía sin analizar. El default de la columna es el mismo (0013). */
  analisis: AnalisisIdeaDemo | Record<string, never>;
  /**
   * Hace cuántos días entró la idea, contados desde el momento de sembrar.
   *
   * **Se siembra a mano y no se deja el default `now()`**, y no es un adorno: `now()` es el instante
   * de la TRANSACCIÓN, así que las cinco ideas salían con la misma marca al milisegundo. Con todas
   * empatadas, el `order by creada_en desc, id desc` de `listarIdeas` se resolvía entero por el
   * desempate y el listado no ejercitaba su propio orden — ni en los tests ni en la pantalla, donde
   * cinco filas con la misma fecha y hora además se ven falsas por el motivo equivocado.
   *
   * Los valores están elegidos para que el orden por fecha **contradiga** al orden por id: si
   * coincidieran, un test de orden no podría distinguir cuál de los dos criterios se aplicó (es la
   * trampa que la 13ª review encontró en el test de `orden_brief`).
   *
   * Es relativo a `now()` y no una fecha fija para que el seed no envejezca: re-sembrar dentro de un
   * mes sigue mostrando "hace 3 días". El precio es que `creada_en` cambia en cada re-siembra; la
   * idempotencia que importa —qué filas hay y qué dicen— no depende de eso.
   */
  dias_creada: number;
  /** Cuándo la tocó la agencia por última vez. Nunca antes de `dias_creada` (o sea, ≤). */
  dias_actualizada: number;
}

/**
 * IDs FIJOS, en la misma serie que `DEMO_CLIENT_ID`/`DEMO_RUN_ID` (`seed-demo.ts`), con `1dea` en el
 * último grupo para que se reconozcan de un vistazo en un `select`. Son la clave estable que hace el
 * seed idempotente: re-sembrar toca exactamente estas filas y ninguna otra idea del cliente.
 */
const ID = (n: number) => `d3305eba-11a5-4e0e-9c1f-1dea0000000${n}`;

/**
 * Las ideas de ejemplo. Una por estado —que es para lo que existe el seed— más una recién llegada y
 * sin analizar.
 *
 * El contenido es plausible para una hamburguesería pero **no afirma nada sobre La Birra Bar**: son
 * cosas que un dueño podría proponer, no cosas que este dueño haya propuesto ni que la agencia haya
 * hecho. Sin importes, sin horarios y sin nombres de personas.
 */
export const IDEAS_DEMO: readonly IdeaDemo[] = [
  {
    id: ID(1),
    dias_creada: 1,
    dias_actualizada: 1,
    titulo: `${MARCA_EJEMPLO} Subir el plato del día a stories`,
    estado: "nueva",
    resumen: "EJEMPLO — Publicar cada día una foto del plato del día y guardarla en un destacado.",
    transcripcion: conAviso(
      "Hola chicos, ¿qué tal? Se me ocurrió una cosa para Instagram: subir todos los días una foto " +
        "del plato del día en stories, con una frase corta, y después guardarlo en un destacado para " +
        "que no se pierda. Lo podríamos sacar por la mañana, antes de abrir, que es cuando la barra " +
        "tiene mejor luz. Decidme qué os parece y si hace falta que os mande yo las fotos.",
    ),
    audio_url: "https://example.invalid/ejemplo/audio-de-prueba-1.ogg",
    carpeta_url: "https://example.invalid/ejemplo/carpeta-de-prueba",
    mensaje_de: "Remitente de EJEMPLO (dato de prueba)",
    analisis: {
      audiencia_objetivo: "vecinos del barrio y gente que come fuera entre semana",
      canales_comunicacion: ["Instagram stories", "Instagram destacados"],
      intencion: "dar a conocer el plato del día y ganar visitas recurrentes",
      materiales_formatos: ["foto vertical del plato", "frase corta de una línea", "portada del destacado"],
      observaciones: "EJEMPLO — análisis de prueba para desarrollo; no procede de ningún audio real.",
      checklist_interpretacion: [
        "confirmar quién saca la foto cada día",
        "aclarar si el plato del día rota o es fijo",
      ],
      ideas_complementarias: ["reutilizar las fotos del destacado en la carta de la web"],
      tipo_accion: "contenido recurrente",
    },
  },
  {
    id: ID(2),
    dias_creada: 3,
    dias_actualizada: 2,
    titulo: `${MARCA_EJEMPLO} Sorteo entre quienes compartan el reel`,
    estado: "en_revision",
    resumen: "EJEMPLO — Sortear dos menús entre las cuentas que compartan el reel de la hamburguesa.",
    transcripcion: conAviso(
      "Otra que se me ocurrió: hacemos un reel corto de la hamburguesa saliendo de la parrilla y " +
        "sorteamos dos menús entre los que lo compartan en sus stories. Habría que ver el tema de las " +
        "bases legales, que no sé cómo va eso aquí. Si os parece lo hablamos.",
    ),
    audio_url: "https://example.invalid/ejemplo/audio-de-prueba-2.ogg",
    carpeta_url: "https://example.invalid/ejemplo/carpeta-de-prueba",
    mensaje_de: "Remitente de EJEMPLO (dato de prueba)",
    analisis: {
      audiencia_objetivo: "seguidores actuales y sus contactos",
      canales_comunicacion: ["Instagram reels", "Instagram stories"],
      intencion: "ampliar alcance apoyándose en la comunidad que ya sigue la cuenta",
      materiales_formatos: ["reel corto de la parrilla", "pieza de anuncio del sorteo", "bases legales"],
      observaciones:
        "EJEMPLO — análisis de prueba para desarrollo. Un sorteo real exige bases legales revisadas.",
      checklist_interpretacion: [
        "confirmar si el premio se entrega en sala o para llevar",
        "fijar fecha de inicio y de cierre",
        "revisar las bases legales antes de publicar",
      ],
      ideas_complementarias: [
        "grabar el momento del sorteo y publicarlo como prueba",
        "guardar las piezas para reutilizarlas en la siguiente campaña",
      ],
      tipo_accion: "campaña puntual",
    },
  },
  {
    id: ID(3),
    dias_creada: 8,
    dias_actualizada: 6,
    titulo: `${MARCA_EJEMPLO} Cartel nuevo para la puerta del local`,
    estado: "aprobada",
    resumen: "EJEMPLO — Cambiar el cartel de la puerta por uno que se lea desde la acera de enfrente.",
    transcripcion: conAviso(
      "Chicos, el cartel de la puerta se ve fatal desde la calle, sobre todo de noche. ¿Podríamos " +
        "hacer uno nuevo, con letras más grandes y el logo arriba? Con que se lea desde la acera de " +
        "enfrente me vale.",
    ),
    audio_url: "https://example.invalid/ejemplo/audio-de-prueba-3.ogg",
    carpeta_url: "https://example.invalid/ejemplo/carpeta-de-prueba",
    mensaje_de: "Remitente de EJEMPLO (dato de prueba)",
    analisis: {
      audiencia_objetivo: "gente que pasa por delante del local",
      canales_comunicacion: ["cartelería en el local"],
      intencion: "que el local se identifique desde la calle, también de noche",
      materiales_formatos: ["cartel A3 para la puerta", "versión con vinilo para el cristal"],
      observaciones: "EJEMPLO — análisis de prueba para desarrollo, sin relación con ningún encargo real.",
      checklist_interpretacion: [
        "medir el hueco de la puerta antes de diseñar",
        "confirmar si hace falta permiso para el vinilo del cristal",
      ],
      ideas_complementarias: ["aprovechar el mismo diseño para la carta impresa"],
      tipo_accion: "material gráfico",
    },
  },
  {
    id: ID(4),
    dias_creada: 12,
    dias_actualizada: 9,
    titulo: `${MARCA_EJEMPLO} Reparto a domicilio los domingos`,
    estado: "rechazada",
    resumen: "EJEMPLO — Abrir reparto a domicilio solo los domingos, con la carta reducida.",
    transcripcion: conAviso(
      "Se me ocurrió que los domingos, que hay menos movimiento en sala, podríamos hacer reparto a " +
        "domicilio con una carta reducida. No sé si compensa con lo que cobran las plataformas, pero " +
        "os lo dejo ahí para que lo miréis.",
    ),
    audio_url: "https://example.invalid/ejemplo/audio-de-prueba-4.ogg",
    carpeta_url: "https://example.invalid/ejemplo/carpeta-de-prueba",
    mensaje_de: "Remitente de EJEMPLO (dato de prueba)",
    analisis: {
      audiencia_objetivo: "clientes del barrio que piden a casa el fin de semana",
      canales_comunicacion: ["plataformas de reparto", "Instagram"],
      intencion: "aprovechar el día de menos sala con otro canal de venta",
      materiales_formatos: ["carta reducida para reparto", "fotos de los platos que aguantan el traslado"],
      observaciones:
        "EJEMPLO — análisis de prueba para desarrollo. Se deja en 'rechazada' para poder ver ese " +
        "estado en la pantalla, no porque la agencia haya decidido nada.",
      checklist_interpretacion: [
        "confirmar qué platos aguantan el traslado",
        "revisar las comisiones antes de decidir",
      ],
      ideas_complementarias: ["probar primero con recogida en el local, que no tiene comisión"],
      tipo_accion: "cambio operativo",
    },
  },
  {
    /*
     * Una idea RECIÉN LLEGADA: el audio existe, pero nadie lo ha transcrito ni analizado todavía.
     *
     * No es un relleno: es el estado real de una fila entre que entra por el flujo de audio y que el
     * LLM la procesa, y es el caso que la pantalla tiene que aguantar sin romperse (análisis vacío,
     * transcripción ausente). Si el seed solo tuviera ideas completas, la Etapa 5 se escribiría contra
     * un dato que en producción no siempre existe.
     */
    id: ID(5),
    dias_creada: 0,
    dias_actualizada: 0,
    titulo: `${MARCA_EJEMPLO} Audio recién llegado, todavía sin analizar`,
    estado: "nueva",
    resumen: null,
    transcripcion: null,
    audio_url: "https://example.invalid/ejemplo/audio-de-prueba-5.ogg",
    carpeta_url: null,
    mensaje_de: "Remitente de EJEMPLO (dato de prueba)",
    analisis: {},
  },
];

/**
 * Siembra (o re-siembra) las ideas de ejemplo del cliente de la demo. Idempotente por id fijo.
 *
 * Devuelve los ids sembrados, en el orden de `IDEAS_DEMO`.
 *
 * ## Por qué `delete` + `insert` y NO `on conflict (id) do update`
 *
 * Porque un upsert es un UPDATE, y sobre `ideas` los UPDATE los gobierna el trigger
 * `ideas_transicion_estado` (0013). Si la agencia movió una idea a `en_revision` desde el portal,
 * re-sembrarla como `nueva` sería la transición `en_revision → nueva`, que la máquina de estados
 * rechaza con un `23514`: el upsert sería idempotente **solo mientras nadie hubiera usado la
 * pantalla**, que es justo cuando no hace falta re-sembrar. Con `delete` + `insert` el seed devuelve
 * las ideas a su estado de ejemplo siempre, y además el INSERT no pasa por el trigger —es `before
 * update`—, que es lo que permite poblar los cuatro estados de una.
 *
 * Es destructivo **solo sobre estas cinco filas**: el `delete` va por los ids fijos, nunca por
 * `client_id`. Una idea real del mismo cliente (cuando exista el ingreso de n8n) no se toca. Mismo
 * criterio que el `delete from kr_runs where id = $1` de `sembrarDemo`, y por el mismo motivo.
 *
 * Todo en UNA transacción: si algo falla, la base queda como estaba y no a medio sembrar.
 */
export async function sembrarIdeasDemo(
  con: ConexionReservada,
  destino: DestinoIdeasDemo,
): Promise<string[]> {
  const ids = IDEAS_DEMO.map((i) => i.id);

  await con.exec("begin");
  try {
    await con.query("delete from ideas where id = any($1::uuid[])", [ids]);

    for (const idea of IDEAS_DEMO) {
      await con.query(
        `insert into ideas (id, tenant_id, client_id, titulo, estado, resumen, transcripcion,
                            audio_url, carpeta_url, mensaje_de, analisis, creada_en, actualizada_en)
         values ($1, $2, $3, $4, $5::idea_estado, $6, $7, $8, $9, $10, $11::jsonb,
                 now() - make_interval(days => $12::int),
                 now() - make_interval(days => $13::int))`,
        [
          idea.id,
          destino.tenantId,
          destino.clientId,
          idea.titulo,
          idea.estado,
          idea.resumen,
          idea.transcripcion,
          idea.audio_url,
          idea.carpeta_url,
          idea.mensaje_de,
          JSON.stringify(idea.analisis),
          // Las dos marcas se escriben acá y no se dejan al default: ver `dias_creada`. El trigger
          // `ideas_actualizada_en` es `before update`, así que no pisa nada en un INSERT.
          idea.dias_creada,
          idea.dias_actualizada,
        ],
      );
    }

    await con.exec("commit");
    return ids;
  } catch (e) {
    await con.exec("rollback");
    throw e;
  }
}

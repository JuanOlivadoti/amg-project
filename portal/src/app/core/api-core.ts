import type {
  Brief,
  CambioRolMiembro,
  CambiosClienteAgencia,
  CambiosPagina,
  CambiosPost,
  ClienteAgencia,
  Contenido,
  EstadoIdea,
  IdeaDetalle,
  IdeaResumen,
  Informe,
  MenuCarta,
  Miembro,
  NuevoClienteAgencia,
  NuevoRun,
  PerfilSeguros,
  PostDePagina,
  ResenaGoogle,
  RunSummary,
} from './models';
import { SIN_PAGINAS_APROBADAS, TRANSICION_INVALIDA } from './codigos';

/**
 * Error de la API con el status HTTP, para que la UI distinga 401 (relogin) de 403/409/500.
 *
 * `codigo` es opcional porque **solo los 409 lo llevan** (`api/src/codigos.ts` lo dice y acota el
 * alcance): los 400/403/404 que ya existían responden `{ error }` a secas y el portal no ramifica
 * sobre ellos. Ausente significa ausente — no se rellena con el status ni con una cadena vacía, o
 * dejaría de poder distinguirse «este 409 es aquel caso» de «este 409 es cualquier otro».
 *
 * `campos` es opcional por el mismo motivo: **solo los 400 de validación Zod lo llevan** (el editor
 * de menú, `menuPatchSchema` en `api/src/app.ts`) — el resto de los errores sigue respondiendo
 * `{ error }` a secas. Cuando viene, cada entrada dice qué `ruta` del body falló y por qué, para que
 * la pantalla señale el campo sin depender del texto de `mensaje` (que puede cambiar).
 */
export interface ApiError extends Error {
  status: number;
  codigo?: string;
  campos?: Array<{ ruta: string; mensaje: string }>;
}

/**
 * ¿Este error es el 409 de «el run no tiene ninguna página aprobada»?
 *
 * Mira el **código** y nunca el mensaje, por el motivo que explica `core/codigos.ts`. Y tampoco el
 * status: hoy el endpoint tiene un solo 409, pero el día que tenga dos, ramificar por status
 * confundiría uno con el otro sin que nada avise.
 *
 * Recibe `unknown` porque eso es lo que le llega a un `catch`.
 */
export function esSinPaginasAprobadas(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as ApiError).codigo === SIN_PAGINAS_APROBADAS;
}

/**
 * ¿Este error es el 409 de «esta transición de destino no califica»?
 *
 * `POST /runs/:id/approve` la devuelve cuando el `destino` pedido no es ni la primera decisión de un
 * run en `pending_approval` ni el único camino retomable (última decisión completada
 * `solo_informe` → un destino distinto). El selector de esta pantalla ya intenta acotar lo que se
 * puede pedir (`puedeAprobarRunUI`/`puedeRetomarUI`), así que llegar acá significa que la pantalla y
 * la base **no coincidían**: otra pestaña, el endpoint llamado a mano, o una decisión que se resolvió
 * mientras esta pantalla seguía abierta. La UI es un atajo, la autoridad es el backend.
 *
 * Mismo criterio que arriba: el **código**, nunca la frase ni el status.
 */
export function esTransicionInvalida(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as ApiError).codigo === TRANSICION_INVALIDA;
}

/** Un archivo bajado de la API: el contenido y con qué nombre guardarlo. */
export interface ArchivoDescargado {
  nombre: string;
  blob: Blob;
}

/*
 * ALLOWLIST del nombre de archivo, del lado del cliente. Es la MISMA que `api/src/informe-nombre.ts`
 * aplica al emitir el header, repetida acá a propósito: defensa en profundidad, el mismo criterio por el
 * que el renderizador revalida lo que ya validó el emisor. El valor sale del nombre que un humano
 * escribió en el CRM, y este código no puede comprobar que el saneado del servidor siguiera puesto.
 *
 * Lo que se evita concretamente es un `nombre` con separadores de ruta o con `..` acabando en el atributo
 * `download` de un `<a>`. Los navegadores lo neutralizan, pero eso es una propiedad del navegador, no una
 * del portal — y este archivo no depende de propiedades que no impone.
 */
const NOMBRE_PERMITIDOS = /[^A-Za-z0-9._-]/g;
/*
 * 80 y no 60: el nombre que emite la API ya está saneado y su contrato tope es `"informe-" + 60 + ".md"`
 * = 71 caracteres (`api/src/informe-nombre.ts`). Con 60 acá, un cliente de nombre largo bajaría el archivo
 * TRUNCADO y sin extensión — un saneado que rompe el caso legítimo en vez del hostil.
 */
const NOMBRE_LARGO_MAXIMO = 80;

/**
 * El nombre con el que se guarda una descarga: el `filename` del `Content-Disposition` si viene y
 * sobrevive a la allowlist, y si no el `fallback`.
 *
 * **El header llega, y el camino normal es el del header.** `api/src/app.ts` declara
 * `exposeHeaders: ["content-disposition"]` en su `cors()`, que es lo que permite leerlo desde otro origen
 * (portal en :4200, API en :3000): sin esa línea el navegador se lo esconde a JavaScript y
 * `headers.get(...)` devuelve `null` — así estaba cuando esta función se escribió, medido en Chrome, y por
 * eso existe el `fallback`.
 *
 * Así que el `fallback` es lo que su nombre dice: una **rama defensiva**, no la que corre. Sigue haciendo
 * falta y tiene test propio, porque el portal no puede comprobar desde acá que el header venga: un proxy
 * que filtre cabeceras, un `exposeHeaders` que alguien recorte, o un `filename` que no sobreviva a la
 * allowlist dejan la descarga sin nombre. Con el fallback, baja igual y se distingue de las demás.
 */
export function nombreDeDescarga(contentDisposition: string | null, fallback: string): string {
  const delHeader = /filename="([^"]*)"/.exec(contentDisposition ?? '')?.[1] ?? '';
  // El `fallback` pasa por la MISMA allowlist que el header, y no es simetría decorativa: hoy lo arma el
  // portal con el `runId` de la URL, que es entrada del usuario. Si el saneado se aplicara solo a una de
  // las dos ramas, la rama que corre sería justo la no saneada.
  return sanearNombreArchivo(delHeader) || sanearNombreArchivo(fallback) || 'informe.md';
}

/** Vacío si no queda nada de la allowlist. Lo que devuelve **siempre** termina en `.md`. */
function sanearNombreArchivo(crudo: string): string {
  const base = crudo
    .replace(NOMBRE_PERMITIDOS, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, NOMBRE_LARGO_MAXIMO)
    .replace(/[-.]+$/g, '');
  if (base === '') return '';
  // La extensión se garantiza acá: sin `.md` el sistema operativo no sabe qué acaba de bajar, y el corte
  // de largo de arriba se la puede haber comido.
  return base.endsWith('.md') ? base : `${base}.md`;
}

export interface ApiOpts {
  /** URL base de la API, sin barra final (p. ej. `http://localhost:3000`). */
  baseUrl: string;
  /** El access token vigente, o null. Se lee en cada request: si se refresca, la próxima ya lo usa. */
  getToken: () => string | null;
  /** El tenant activo (coordenada, no autoridad — RLS decide). */
  getTenant: () => string | null;
  /**
   * Renueva la sesión cuando la API responde 401. Devuelve `true` si consiguió un token nuevo (y
   * entonces el request se reintenta UNA vez) o `false` si no (y el 401 se propaga). El mecanismo se
   * inyecta —el core no sabe de Supabase—, pero la POLÍTICA (refrescar y reintentar una sola vez)
   * vive acá, probada. Sin este hook, un 401 se propaga tal cual.
   */
  refrescar?: () => Promise<boolean>;
  /** Inyectable para testear sin red. Por defecto, el `fetch` global. */
  fetchFn?: typeof fetch;
}

/**
 * El cliente de la API, framework-agnóstico. **Toda la lógica HTTP vive acá** (headers, parseo,
 * errores), en TypeScript puro y testeable con un `fetch` de mentira — igual que la API se testea sin
 * red. El `ApiService` de Angular es una cáscara fina encima de esto.
 */
export interface ClienteApi {
  /**
   * Los runs de un cliente, o los de todo el tenant si se OMITE el argumento.
   *
   * Un `clientId` vacío **lanza**: no es «todos», es un id que no llegó. Ver el motivo largo en la
   * implementación y en su test.
   */
  listarRuns(clientId?: string): Promise<RunSummary[]>;
  crearRun(nuevo: NuevoRun): Promise<string>;
  /**
   * Las ideas de un cliente, opcionalmente filtradas por `estado`.
   *
   * A diferencia de `listarRuns`, `clientId` no es opcional: este tab siempre cuelga de
   * `/clientes/:id/ideas` y no hay pantalla que necesite la cartera entera, así que la interfaz no
   * ofrece ese modo. Un `clientId` vacío **lanza**, mismo criterio que `listarRuns('')`: no es «sin
   * filtro», es un id que no llegó (ver el test de `cliente-ideas.ts`).
   */
  listarIdeas(clientId: string, estado?: EstadoIdea): Promise<IdeaResumen[]>;
  /**
   * Las ideas de TODO el tenant (sin filtrar por cliente), opcionalmente por `estado`. A diferencia de
   * `listarIdeas`, que exige un cliente porque su pantalla siempre cuelga de una ficha, esta es la
   * fuente del dashboard: necesita ver el estado de trabajo de la agencia entera. RLS decide el
   * conjunto visible según el rol de quien pregunta (ADR-15) — un `cliente` solo ve lo suyo, por
   * construcción del lado del servidor, no de este método.
   */
  listarTodasLasIdeas(estado?: EstadoIdea): Promise<IdeaResumen[]>;
  /**
   * El detalle completo de UNA idea (transcripción + análisis), para la pantalla de revisión (Task
   * 2). `null` en 404 — que unifica "no existe", "es de otro tenant" y "no la puede ver"
   * (`api/src/app.ts`) — para que la pantalla pueda mostrar "no encontrada" sin envolver cada
   * llamado en un `try/catch`. Distinto de `cambiarEstadoIdea`/`editarIdea`, donde un error SÍ debe
   * propagarse: ahí el 400/404 lleva un motivo que la pantalla tiene que mostrar, no callar.
   */
  obtenerIdea(id: string): Promise<IdeaDetalle | null>;
  /**
   * Mueve una idea por su máquina de estados. Manda **solo** `{ estado }` — nunca junto con
   * contenido, el servidor rechaza la mezcla con 400 (`api/src/app.ts`: "El cambio de estado va
   * solo"). Lanza con el mensaje del servidor ante una transición inválida (400, con `desde`/`hacia`
   * en el cuerpo) o si la idea no existe/no es visible/no se puede escribir (404, los tres
   * unificados a propósito). No se traga el error: la pantalla lo necesita para explicar el rechazo.
   */
  cambiarEstadoIdea(id: string, estado: EstadoIdea): Promise<void>;
  /**
   * Edita el CONTENIDO de una idea — nunca su estado, eso es `cambiarEstadoIdea`. El subconjunto que
   * se mande viaja tal cual, sin agregar `estado`: dos acciones separadas en la UI ("guardar
   * contenido" y "aprobar/rechazar/revisar"), nunca un botón único que mande las dos cosas juntas.
   */
  editarIdea(
    id: string,
    cambios: Partial<
      Pick<
        IdeaDetalle,
        'titulo' | 'resumen' | 'transcripcion' | 'audio_url' | 'carpeta_url' | 'mensaje_de' | 'analisis'
      >
    >,
  ): Promise<void>;
  verBrief(runId: string): Promise<Brief>;
  /**
   * El informe del run. **`informe_md: null` NO es un error**: es «todavía no hay informe» (o el rol no
   * lo ve, que es indistinguible y así debe quedar). Un run que no existe o no es visible lanza 404.
   */
  verInforme(runId: string): Promise<Informe>;
  /**
   * El `.md` para bajar. **No es un `<a href>`**: la API exige `Authorization`, y un token en la query
   * string queda en los logs del servidor y en el historial del navegador. Así que se pide con `fetch`
   * autenticado y quien llama guarda el `Blob` (ver `DescargasService`). Un run sin informe lanza 404.
   */
  descargarInformeMd(runId: string): Promise<ArchivoDescargado>;
  /**
   * El **entregable del restaurante**: el mismo research SIN el bloque de coste, en Markdown.
   *
   * Devuelve el TEXTO y no un `ArchivoDescargado` porque su destino es la pantalla imprimible, que lo
   * parsea a bloques (`core/markdown.ts`) y lo dibuja. La API lo manda con `Content-Disposition:
   * attachment` —está pensado para bajarse—, pero eso solo importa cuando el navegador navega a la
   * URL; leído con `fetch`, el cuerpo es el cuerpo.
   *
   * **El coste no viene, y no es este cliente quien lo saca**: la API llama a `renderReport(brief,
   * { audiencia: "restaurante" })` y el bloque no se genera. Si alguna vez hace falta filtrar un coste
   * desde acá, algo se rompió aguas arriba.
   *
   * Lanza 404 —con la MISMA forma— si el run no existe, si es de otro tenant o si quien pregunta no
   * es staff: lo decide `app.es_staff()` en el predicado de la consulta, no un `if` de la API, así
   * que el portal no puede distinguir los tres casos ni debe intentarlo.
   */
  verEntregableMd(runId: string): Promise<string>;
  aprobarPagina(pageId: string): Promise<void>;
  editarPagina(pageId: string, cambios: CambiosPagina): Promise<void>;
  /**
   * El post de blog de una página, para la pantalla de posts (Task 11). `null` en 404 —que unifica
   * "la página no existe" y "existe pero nunca se generó un post", indistinguibles a propósito, mismo
   * criterio que `getPost` en `db/`— para que la pantalla pueda mostrar "Generando…" sin envolver
   * cada llamado en un `try/catch`.
   */
  verPost(pageId: string): Promise<PostDePagina | null>;
  /**
   * Edita título/cuerpo del post — un ÚNICO `PATCH /pages/:id` con `{post_titulo, post_cuerpo}`, NO
   * dos requests separados. NO revoca `approved` (editar el TEXTO no es editar el BRIEF aprobado) y
   * el servidor la rechaza con 404 mientras hay una publicación en curso (`solicitadoEn !== null`) —
   * la pantalla deshabilita los campos en ese estado por UX, pero el servidor la rechazaría igual.
   */
  editarPost(pageId: string, cambios: CambiosPost): Promise<void>;
  /**
   * Pide publicar el post en el blog externo del cliente — comando compuesto (ADR-18): la fila se
   * marca bajo RLS primero, y el evento (sin autoridad) sale después. Sirve tanto para el primer
   * intento como para reintentar uno que falló (`errorEn !== null`): el servidor limpia
   * `post_error_en` al reintentar (`marcarPostFallido`/`solicitarPublicacionPost`, `db/`).
   */
  solicitarPublicacionPost(pageId: string): Promise<void>;
  /**
   * Decide el destino de un run en `pending_approval` (o retoma uno con última decisión
   * `solo_informe`/`completado` hacia otro destino). `destino` es OBLIGATORIO — a diferencia del
   * viejo "Aprobar" sin argumentos, el servidor ya no tiene un único camino que asumir.
   *
   * Los tres valores existen desde el sub-proyecto de publicación en blog externo (Task 11): antes
   * de esa Task, `crear_posts` estaba tipado afuera a propósito —la pantalla que lo consume todavía
   * no existía— y el selector de `brief.ts` la mostraba deshabilitada.
   */
  aprobarRun(runId: string, destino: 'crear_web' | 'solo_informe' | 'crear_posts'): Promise<void>;

  listarClientes(): Promise<ClienteAgencia[]>;
  verCliente(id: string): Promise<ClienteAgencia>;
  crearCliente(datos: NuevoClienteAgencia): Promise<string>;
  actualizarCliente(id: string, cambios: CambiosClienteAgencia): Promise<void>;
  archivarCliente(id: string): Promise<void>;
  desarchivarCliente(id: string): Promise<void>;

  /**
   * Los miembros VISIBLES para quien pregunta, que no es lo mismo que "los del tenant": la vista
   * `membresias_perfil` (0012) ya decidió en Postgres si eso son todos o solo la fila propia.
   */
  listarMiembros(): Promise<Miembro[]>;
  cambiarRolMiembro(userId: string, cambio: CambioRolMiembro): Promise<void>;

  /**
   * Las reseñas de Google del cliente, en el orden que ya fija el SQL de `PgResenas.listarResenas`
   * (1-3★ sin ver primero, más nueva después). Este método no reordena nada — quien lo consuma
   * tampoco debería.
   */
  listarResenas(clientId: string): Promise<ResenaGoogle[]>;
  /** Marca una reseña como vista. Único cambio soportado por el endpoint (`{"vista": true}`). */
  marcarResenaVista(clientId: string, resenaId: string): Promise<void>;
  /** Edita el borrador de respuesta de una reseña. A diferencia de `marcarResenaVista`, se puede
   * repetir (no es de una sola vez). */
  editarBorradorResena(clientId: string, resenaId: string, texto: string): Promise<void>;
  /**
   * Pide publicar el borrador de vuelta en Google (Bloque F, fase 2, segunda pieza). Se puede
   * repetir (reintenta) igual que `editarBorradorResena` — nunca es "de una sola vez" como
   * `marcarResenaVista`. 404 si la reseña no existe, no tiene borrador, ya está publicada, o el rol
   * no puede escribir.
   */
  publicarRespuestaResena(clientId: string, resenaId: string): Promise<void>;
  /**
   * Arma la URL de consentimiento de Google para este cliente. Quien llama navega ahí de verdad
   * (`window.location.href`), no es un `fetch` que se quede esperando una respuesta JSON del OAuth.
   */
  conectarGoogle(clientId: string): Promise<{ url: string }>;
  /** Desconecta la cuenta de Google del cliente: limpia las tres columnas en `clients`. */
  desconectarGoogle(clientId: string): Promise<void>;

  /**
   * Arma la URL de `https://t.me/<bot>?start=<código>` para vincular Telegram a la PROPIA cuenta
   * (Bloque F, fase 2). A diferencia de `conectarGoogle`, no lleva `clientId`: esto es sobre quién
   * está autenticado, no sobre un cliente de la agencia. Quien llama abre la URL en una pestaña
   * nueva (`window.open`), no navega la propia — no hay callback que traiga de vuelta al portal.
   */
  vincularTelegram(): Promise<{ url: string }>;
  /** Si la propia cuenta ya vinculó Telegram y puede recibir alertas de reseñas 1-3★. */
  telegramVinculado(): Promise<{ vinculado: boolean }>;
  /** Desvincula Telegram de la propia cuenta. */
  desvincularTelegram(): Promise<{ ok: boolean }>;

  /**
   * La carta completa del cliente (platos + categorías), tal como vive en `business_profile`. `[]`
   * en cada array si el cliente no tiene carta todavía — nunca `null`.
   */
  obtenerMenu(clientId: string): Promise<MenuCarta>;
  /**
   * Reemplaza la carta completa. Manda SIEMPRE los dos arrays enteros, nunca un parche parcial —
   * mismo criterio que `editarIdea` pero sin el recorte de campos: acá no hay "subconjunto editado",
   * el servidor exige las dos claves completas (`PATCH /clients/:id/menu`, `menuPatchSchema`).
   */
  guardarMenu(clientId: string, carta: MenuCarta): Promise<void>;

  /** El perfil de seguros del cliente (licencia/experiencia/red). `null` si no lo cargó todavía —
   *  mismo criterio que el resto de esta interfaz: nunca un objeto a medias inventado acá. */
  obtenerPerfilSeguros(clientId: string): Promise<PerfilSeguros | null>;
  /** Reemplaza el perfil de seguros completo. Mismo criterio que guardarMenu: manda siempre el objeto
   *  entero, el servidor no hace merge parcial de campo por campo. */
  actualizarPerfilSeguros(clientId: string, datos: PerfilSeguros): Promise<void>;

  /**
   * El contenido editorial de la home (bienvenida + destacados + testimonios), para CUALQUIER
   * vertical (Bloque E, última pieza). Mismo criterio que `obtenerMenu`: los tres campos siempre
   * presentes, arrays nunca `null`. Lanza 404 si el cliente no existe o no es visible — no se
   * traduce a `null` acá, mismo criterio que `obtenerMenu`/`obtenerPerfilSeguros` (que tampoco lo
   * hacen): un cliente sin nada cargado igual responde 200 con los defaults, así que un 404 real
   * solo puede significar "el cliente en sí no existe/no es visible".
   */
  obtenerContenido(clientId: string): Promise<Contenido>;
  /** Reemplaza el contenido completo. Mismo criterio que `guardarMenu`/`actualizarPerfilSeguros`:
   *  manda SIEMPRE las tres claves juntas — el servidor no hace merge parcial de campo por campo. */
  actualizarContenido(clientId: string, datos: Contenido): Promise<void>;
}

export function crearApi(opts: ApiOpts): ClienteApi {
  const fetchFn = opts.fetchFn ?? fetch;

  /**
   * La petición autenticada, **sin interpretar el cuerpo**: headers, la política de 401 → refrescar →
   * reintentar-una-vez, y el mapeo de un `!ok` a `ApiError`. Devuelve la `Response` cruda.
   *
   * Está separada de `pedir` porque la descarga del informe necesita **exactamente esta política** con un
   * `Blob` en vez de JSON. Si la descarga hiciera su propio `fetch`, el token vencido no se refrescaría
   * ahí y el 401 llegaría al usuario como un error de la nada — la clase de agujero que se abre cuando la
   * segunda ruta HTTP no pasa por la primera.
   */
  async function pedirRes(
    method: string,
    path: string,
    body?: unknown,
    yaReintento = false,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    const token = opts.getToken();
    const tenant = opts.getTenant();
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (tenant) headers['x-amg-tenant'] = tenant;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const res = await fetchFn(`${opts.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    // Token vencido: refrescar UNA vez y reintentar. `getToken` se relee, así que el retry ya lleva
    // el token nuevo. Una sola vez: si el refresh no alcanza, el 401 se propaga (no un bucle).
    if (res.status === 401 && opts.refrescar && !yaReintento) {
      if (await opts.refrescar()) return pedirRes(method, path, body, true);
    }

    if (!res.ok) {
      let mensaje = `${res.status} ${res.statusText}`;
      let codigo: string | undefined;
      let campos: Array<{ ruta: string; mensaje: string }> | undefined;
      try {
        const j = (await res.json()) as {
          error?: string;
          codigo?: string;
          campos?: Array<{ ruta: string; mensaje: string }>;
        };
        if (j?.error) mensaje = j.error;
        // Solo si viene y es una cadena: un `codigo` inventado acá haría que la pantalla eligiera una
        // rama por un dato que el servidor no mandó.
        if (typeof j?.codigo === 'string') codigo = j.codigo;
        // Mismo criterio que `codigo`: solo si viene de verdad, y tal cual — no se reconstruye ni se
        // completa nada que el servidor no haya mandado.
        if (Array.isArray(j?.campos)) campos = j.campos;
      } catch {
        /* el cuerpo no era JSON; nos quedamos con el status */
      }
      const err = new Error(mensaje) as ApiError;
      err.status = res.status;
      if (codigo !== undefined) err.codigo = codigo;
      if (campos !== undefined) err.campos = campos;
      throw err;
    }

    return res;
  }

  /** Lo mismo, ya desenvuelto como JSON. Es lo que usan todos los endpoints menos la descarga. */
  async function pedir<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await pedirRes(method, path, body);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    async listarRuns(clientId) {
      /*
       * Una cadena vacía NO es «todos los runs»: es un id que no llegó — un `:id` ausente en la ruta,
       * un signal todavía sin escribir. Sin esta línea caía en la rama sin query y pedía `GET /runs`,
       * **la lista de research de toda la cartera**, que es justo lo que el portal retiró al mudar el
       * research bajo la ficha del cliente. Y fallaba en silencio: 200, más filas, ninguna alarma.
       *
       * Se distingue de OMITIRLO (`listarRuns()`), que sigue siendo la lista sin filtro a propósito:
       * quien la quiera tiene que decirlo, no llegar ahí por un valor vacío que se coló.
       */
      if (clientId === '') {
        throw new Error('listarRuns: clientId vacío. Omitilo si querés la lista sin filtrar.');
      }
      const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const { runs } = await pedir<{ runs: RunSummary[] }>('GET', `/runs${qs}`);
      return runs;
    },
    async listarIdeas(clientId, estado) {
      // Mismo motivo que `listarRuns('')`: un clientId vacío no filtra nada, así que sin esta guarda
      // la query quedaría `?estado=…` a secas (o vacía del todo) y `GET /ideas` degradaría a la
      // cartera entera — el módulo de ideas no expone ese modo desde este tab.
      if (clientId === '') {
        throw new Error('listarIdeas: clientId vacío. Este tab siempre necesita un cliente.');
      }
      const params = new URLSearchParams({ clientId });
      if (estado) params.set('estado', estado);
      const { ideas } = await pedir<{ ideas: IdeaResumen[] }>('GET', `/ideas?${params.toString()}`);
      return ideas;
    },
    async listarTodasLasIdeas(estado) {
      // Sin `clientId`: acá no hay guarda de vacío que hacer porque el parámetro ni existe. `GET
      // /ideas` ya trata `clientId` como opcional (`api/src/app.ts`), así que omitirlo del query es
      // justamente pedir la cartera entera — el modo que `listarIdeas` deliberadamente no ofrece.
      const params = new URLSearchParams();
      if (estado) params.set('estado', estado);
      const qs = params.toString();
      const { ideas } = await pedir<{ ideas: IdeaResumen[] }>('GET', `/ideas${qs ? `?${qs}` : ''}`);
      return ideas;
    },
    async obtenerIdea(id) {
      try {
        const { idea } = await pedir<{ idea: IdeaDetalle }>('GET', `/ideas/${encodeURIComponent(id)}`);
        return idea;
      } catch (e) {
        // Solo el 404 se traduce a `null`. Cualquier otro status (401, 500, …) se relanza tal cual:
        // tragárselo acá lo disfrazaría de "no existe" cuando en realidad es "no se pudo preguntar".
        if ((e as ApiError).status === 404) return null;
        throw e;
      }
    },
    async cambiarEstadoIdea(id, estado) {
      // Objeto armado a mano y no un `{ estado }` reenviado: dice, en el propio código, que este
      // PATCH NUNCA lleva nada más — es la mitad de la garantía "el cambio de estado va solo" (la
      // otra mitad la impone el servidor, que rechaza la mezcla).
      await pedir('PATCH', `/ideas/${encodeURIComponent(id)}`, { estado });
    },
    async editarIdea(id, cambios) {
      await pedir('PATCH', `/ideas/${encodeURIComponent(id)}`, cambios);
    },
    async crearRun(nuevo) {
      const { runId } = await pedir<{ runId: string }>('POST', '/runs', nuevo);
      return runId;
    },
    verBrief(runId) {
      return pedir<Brief>('GET', `/runs/${encodeURIComponent(runId)}`);
    },
    verInforme(runId) {
      return pedir<Informe>('GET', `/runs/${encodeURIComponent(runId)}/informe`);
    },
    async descargarInformeMd(runId) {
      const res = await pedirRes('GET', `/runs/${encodeURIComponent(runId)}/informe.md`);
      return {
        // El fallback lleva el runId y no un `informe.md` a secas: si el header no llega —un proxy que
        // filtre cabeceras, un `exposeHeaders` recortado—, bajar dos informes de dos runs distintos tiene
        // que seguir dando dos archivos distinguibles. Ver `nombreDeDescarga`.
        nombre: nombreDeDescarga(res.headers.get('content-disposition'), `informe-${runId}.md`),
        blob: await res.blob(),
      };
    },
    async verEntregableMd(runId) {
      // `pedirRes` y no `pedir`: el cuerpo es `text/markdown`, no JSON. Pasa por la MISMA política de
      // 401 → refrescar → reintentar que todo lo demás, que es el motivo por el que `pedirRes` existe
      // separado (ver su comentario): una segunda ruta HTTP que no pasara por ahí dejaría el token
      // vencido sin refrescar justo en esta pantalla.
      const res = await pedirRes('GET', `/runs/${encodeURIComponent(runId)}/entregable.md`);
      return res.text();
    },
    async aprobarPagina(pageId) {
      await pedir('POST', `/pages/${encodeURIComponent(pageId)}/approve`);
    },
    async editarPagina(pageId, cambios) {
      await pedir('PATCH', `/pages/${encodeURIComponent(pageId)}`, cambios);
    },
    async verPost(pageId) {
      try {
        const { post } = await pedir<{ post: PostDePagina }>('GET', `/pages/${encodeURIComponent(pageId)}/post`);
        return post;
      } catch (e) {
        // Solo el 404 se traduce a `null` — mismo criterio que `obtenerIdea`: cualquier otro status
        // (401, 500, …) se relanza tal cual, no se disfraza de "no hay post todavía".
        if ((e as ApiError).status === 404) return null;
        throw e;
      }
    },
    async editarPost(pageId, cambios) {
      await pedir('PATCH', `/pages/${encodeURIComponent(pageId)}`, cambios);
    },
    async solicitarPublicacionPost(pageId) {
      // Objeto armado a mano, mismo criterio que `marcarResenaVista`: el endpoint compara la forma
      // EXACTA del body (`api/src/app.ts`), así que el código dice, mirándolo, que nunca viaja nada más.
      await pedir('PATCH', `/pages/${encodeURIComponent(pageId)}`, { publicar_post: true });
    },
    async aprobarRun(runId, destino) {
      await pedir('POST', `/runs/${encodeURIComponent(runId)}/approve`, { destino });
    },

    async listarClientes() {
      const { clientes } = await pedir<{ clientes: ClienteAgencia[] }>('GET', '/clients');
      return clientes;
    },
    async verCliente(id) {
      const { cliente } = await pedir<{ cliente: ClienteAgencia }>('GET', `/clients/${encodeURIComponent(id)}`);
      return cliente;
    },
    async crearCliente(datos) {
      const { id } = await pedir<{ id: string }>('POST', '/clients', datos);
      return id;
    },
    async actualizarCliente(id, cambios) {
      await pedir('PATCH', `/clients/${encodeURIComponent(id)}`, cambios);
    },
    async archivarCliente(id) {
      await pedir('POST', `/clients/${encodeURIComponent(id)}/archive`);
    },
    async desarchivarCliente(id) {
      await pedir('POST', `/clients/${encodeURIComponent(id)}/desarchivar`);
    },

    async listarMiembros() {
      const { miembros } = await pedir<{ miembros: Miembro[] }>('GET', '/members');
      return miembros;
    },
    async cambiarRolMiembro(userId, cambio) {
      // El body se arma acá campo por campo, no se reenvía el objeto que venga: `PATCH /members` ya
      // tiene su allowlist en el servidor, pero mandar solo lo que el endpoint acepta evita que un
      // día alguien pase un objeto más grande y crea que el resto también viaja.
      await pedir('PATCH', `/members/${encodeURIComponent(userId)}`, {
        rol: cambio.rol,
        // `client_id` solo cuando el rol es `cliente`: para cualquier otro rol la base lo fuerza a
        // null igual (`cliente_exige_client_id`, 0001), y mandarlo sugeriría que se conserva.
        ...(cambio.rol === 'cliente' ? { client_id: cambio.client_id ?? null } : {}),
      });
    },

    async listarResenas(clientId) {
      const { resenas } = await pedir<{ resenas: ResenaGoogle[] }>(
        'GET',
        `/clients/${encodeURIComponent(clientId)}/resenas`,
      );
      return resenas;
    },
    async marcarResenaVista(clientId, resenaId) {
      // Cuerpo armado a mano, mismo criterio que `cambiarEstadoIdea`: el endpoint solo acepta esta
      // forma exacta (`api/src/app.ts` la compara entera), así que el código dice, mirándolo, que
      // nunca viaja nada más.
      await pedir(
        'PATCH',
        `/clients/${encodeURIComponent(clientId)}/resenas/${encodeURIComponent(resenaId)}`,
        { vista: true },
      );
    },
    async editarBorradorResena(clientId, resenaId, texto) {
      await pedir(
        'PATCH',
        `/clients/${encodeURIComponent(clientId)}/resenas/${encodeURIComponent(resenaId)}`,
        { borrador_respuesta: texto },
      );
    },
    async publicarRespuestaResena(clientId, resenaId) {
      await pedir(
        'PATCH',
        `/clients/${encodeURIComponent(clientId)}/resenas/${encodeURIComponent(resenaId)}`,
        { publicar: true },
      );
    },
    async conectarGoogle(clientId) {
      return pedir<{ url: string }>('POST', `/clients/${encodeURIComponent(clientId)}/google/conectar`);
    },
    async desconectarGoogle(clientId) {
      await pedir('POST', `/clients/${encodeURIComponent(clientId)}/google/desconectar`);
    },

    async vincularTelegram() {
      return pedir<{ url: string }>('POST', '/me/telegram/vincular');
    },
    async telegramVinculado() {
      return pedir<{ vinculado: boolean }>('GET', '/me/telegram');
    },
    async desvincularTelegram() {
      return pedir<{ ok: boolean }>('POST', '/me/telegram/desvincular');
    },

    async obtenerMenu(clientId) {
      return pedir<MenuCarta>('GET', `/clients/${encodeURIComponent(clientId)}/menu`);
    },
    async guardarMenu(clientId, carta) {
      await pedir('PATCH', `/clients/${encodeURIComponent(clientId)}/menu`, carta);
    },

    async obtenerPerfilSeguros(clientId) {
      const { seguros } = await pedir<{ seguros: PerfilSeguros | null }>(
        'GET',
        `/clients/${encodeURIComponent(clientId)}/seguros`,
      );
      return seguros;
    },
    async actualizarPerfilSeguros(clientId, datos) {
      await pedir('PATCH', `/clients/${encodeURIComponent(clientId)}/seguros`, datos);
    },

    async obtenerContenido(clientId) {
      return pedir<Contenido>('GET', `/clients/${encodeURIComponent(clientId)}/contenido`);
    },
    async actualizarContenido(clientId, datos) {
      await pedir('PATCH', `/clients/${encodeURIComponent(clientId)}/contenido`, datos);
    },
  };
}

import type {
  Brief,
  CambioRolMiembro,
  CambiosClienteAgencia,
  CambiosPagina,
  ClienteAgencia,
  Informe,
  Miembro,
  NuevoClienteAgencia,
  NuevoRun,
  RunSummary,
} from './models';
import { RUN_SIN_WORKFLOW, SIN_PAGINAS_APROBADAS } from './codigos';

/**
 * Error de la API con el status HTTP, para que la UI distinga 401 (relogin) de 403/409/500.
 *
 * `codigo` es opcional porque **solo los 409 lo llevan** (`api/src/codigos.ts` lo dice y acota el
 * alcance): los 400/403/404 que ya existían responden `{ error }` a secas y el portal no ramifica
 * sobre ellos. Ausente significa ausente — no se rellena con el status ni con una cadena vacía, o
 * dejaría de poder distinguirse «este 409 es aquel caso» de «este 409 es cualquier otro».
 */
export interface ApiError extends Error {
  status: number;
  codigo?: string;
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
 * ¿Este error es el 409 de «nadie está esperando la aprobación de este run»? (bloque C0).
 *
 * El portal apaga el botón por adelantado leyendo `run.tiene_workflow`, así que llegar acá significa
 * que la pantalla y la base **no coincidían**: otra pestaña, el endpoint llamado a mano, o un dato
 * pintado desde algo que no era la base. La UI es un atajo, la autoridad es el backend — y cuando se
 * contradicen, gana el backend y hay que contarlo con palabras.
 *
 * Mismo criterio que arriba: el **código**, nunca la frase ni el status.
 */
export function esRunSinWorkflow(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as ApiError).codigo === RUN_SIN_WORKFLOW;
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
  listarRuns(clientId?: string): Promise<RunSummary[]>;
  crearRun(nuevo: NuevoRun): Promise<string>;
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
  aprobarRun(runId: string): Promise<void>;

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
      try {
        const j = (await res.json()) as { error?: string; codigo?: string };
        if (j?.error) mensaje = j.error;
        // Solo si viene y es una cadena: un `codigo` inventado acá haría que la pantalla eligiera una
        // rama por un dato que el servidor no mandó.
        if (typeof j?.codigo === 'string') codigo = j.codigo;
      } catch {
        /* el cuerpo no era JSON; nos quedamos con el status */
      }
      const err = new Error(mensaje) as ApiError;
      err.status = res.status;
      if (codigo !== undefined) err.codigo = codigo;
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
      const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const { runs } = await pedir<{ runs: RunSummary[] }>('GET', `/runs${qs}`);
      return runs;
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
    async aprobarRun(runId) {
      await pedir('POST', `/runs/${encodeURIComponent(runId)}/approve`);
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
  };
}

import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
import { MembresiaService } from '../../services/membresia';
import type { PaginaPropuesta, PostDePagina } from '../../core/models';
import { estadoDePost, type EstadoPost } from '../../core/posts-estado';
import { htmlATextoPlano } from '../../core/html-a-texto';
import { Vigencia } from '../../core/vigencia';

/** Una fila de esta pantalla: la página aprobada, y su post (`null` = todavía sin generar, 404). */
interface FilaPost {
  pagina: PaginaPropuesta;
  post: PostDePagina | null;
}

const ETIQUETA: Record<EstadoPost, string> = {
  generando: 'Generando…',
  editable: 'Borrador sin publicar',
  publicando: 'Publicando…',
  fallo: 'Falló la publicación',
  publicada: 'Publicada',
};

const CLASE: Record<EstadoPost, string> = {
  generando: 'bg-superficie-2 text-texto-medio',
  editable: 'bg-superficie-2 text-texto-medio',
  publicando: 'bg-alerta-suave text-alerta',
  fallo: 'bg-error-suave text-error',
  publicada: 'bg-respaldo-suave text-respaldo',
};

/**
 * Los posts generados por un run `crear_posts` (Task 11, sub-proyecto de publicación en blog
 * externo): listar, editar y publicar — más el botón "Copiar" para publicación manual mientras
 * `BlogPublisher` sea solo mock (Global Constraints, ver el docblock del botón más abajo).
 *
 * **Cuelga del RUN, no del cliente** — mismo criterio que `informe.ts`/`entregable.ts`, y a
 * diferencia de los tabs de `pages/clientes/` (`cliente-research.ts`, `cliente-resenas.ts`…), que
 * son constantes por cliente. Esta pantalla es sobre UN research puntual que se decidió publicar
 * como posts, así que vive en `research/:runId/posts`, enlazada desde `brief.ts` — mismo patrón que
 * el link "Ver el informe del research →".
 *
 * **No hay un `GET /runs/:id/posts` bulk.** Solo existe `GET /pages/:id/post` (Task 3), así que esta
 * pantalla reusa `verBrief(runId)` —que YA carga esta pantalla via el link de `brief.ts`, y trae
 * `pages` con `id`/`approved`— y pide el post de CADA página aprobada en paralelo. Es la misma
 * cantidad de páginas que ya se le muestran al equipo en el brief, así que el N+1 no es un problema
 * de escala nuevo. **Solo las páginas APROBADAS entran acá**: `workflowDecision` (rama `crear_posts`,
 * `orchestrator/src/workflow.ts`) genera posts únicamente para `paginas.filter(p => p.approved)` — una
 * página propuesta pero nunca aprobada no tiene post que mostrar, y listarla confundiría "sin post
 * porque no se aprobó" con "sin post porque se está generando".
 *
 * **La máquina de 4 estados vive en `core/posts-estado.ts`, pura y testeada aparte** — mismo criterio
 * que `core/evidence.ts` para el brief: un `@if` en el template es fácil de romper sin que nada avise.
 */
@Component({
  selector: 'app-posts',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="space-y-6">
      <a
        [routerLink]="['/clientes', clienteId(), 'research', runId()]"
        class="text-sm text-texto-tenue hover:text-texto"
        >← Volver al brief</a
      >

      <h1 class="text-lg font-semibold text-texto">Posts generados</h1>

      @if (cargando()) {
        <p class="text-sm text-texto-tenue">Cargando…</p>
      } @else if (error()) {
        <p class="text-sm text-error">{{ error() }}</p>
      } @else if (filas().length === 0) {
        <p class="text-sm text-texto-tenue">
          Este research no tiene ninguna página aprobada: no hay posts que generar.
        </p>
      } @else {
        <ul class="space-y-4">
          @for (fila of filas(); track fila.pagina.id) {
            <li class="bg-superficie rounded-xl border border-borde p-4">
              <div class="flex items-center justify-between gap-3">
                <p class="text-sm font-medium text-texto truncate">{{ fila.pagina.keyword_principal }}</p>
                <span class="text-xs shrink-0 rounded-full px-2 py-0.5" [class]="CLASE[estado(fila.post)]">
                  {{ ETIQUETA[estado(fila.post)] }}
                </span>
              </div>

              @if (estado(fila.post) === 'generando') {
                <p class="mt-2 text-sm text-texto-tenue">
                  La página está aprobada, pero el post todavía no se generó.
                </p>
              } @else {
                <!--
                  El post existe (título/cuerpo no son null en esta rama: estado() ya descartó
                  "generando", el único caso post === null). Dos formas de mostrarlo:

                  · EQUIPO: input+textarea editables con el HTML fuente, deshabilitados SOLO en
                    "publicando" (Step 2 del brief) — incluida "publicada" a propósito: el servidor
                    (editarPost, db/) admite corregir el texto de un post YA publicado
                    (post_solicitado_en is null OR post_publicado_en is not null), para que "Copiar"
                    pueda ofrecer una versión corregida aunque la publicación externa no se actualice
                    sola (republicar tras editar es fuera de alcance, spec).
                  · CLIENTE: texto plano de solo lectura (mismo criterio que cliente-resenas.ts con
                    borradorRespuesta) — nunca un textarea con HTML crudo, y nunca un control que
                    la API rechazaría en silencio (acá el rechazo sería silencioso en OTRO sentido: la
                    API sí aceptaría el PATCH de un cliente si RLS se lo permitiera, y no queremos
                    prometer una edición que el rol no tiene — el gate es de UI, ADR-15 lo respalda
                    en RLS del lado del servidor).
                -->
                @if (membresia.esEquipo()) {
                  <div class="mt-3 space-y-2">
                    <input
                      [ngModel]="tituloEditado(fila)"
                      (ngModelChange)="editarTitulo(fila.pagina.id, $event)"
                      [disabled]="estado(fila.post) === 'publicando'"
                      placeholder="Título del post"
                      class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-2 py-1 text-sm disabled:opacity-50"
                    />
                    <textarea
                      [ngModel]="cuerpoEditado(fila)"
                      (ngModelChange)="editarCuerpo(fila.pagina.id, $event)"
                      [disabled]="estado(fila.post) === 'publicando'"
                      rows="5"
                      placeholder="Cuerpo del post (HTML)"
                      class="w-full rounded-md border border-borde-fuerte bg-fondo text-texto px-2 py-1 text-sm font-mono disabled:opacity-50"
                    ></textarea>
                  </div>
                } @else {
                  <div class="mt-3 space-y-1">
                    <p class="text-sm font-medium text-texto">{{ fila.post?.titulo }}</p>
                    <p class="text-sm text-texto-medio whitespace-pre-line">{{ textoPlano(fila.post) }}</p>
                  </div>
                }

                @if (estado(fila.post) === 'publicada' && fila.post?.urlExterna; as url) {
                  <a
                    [href]="url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="mt-2 block w-fit text-sm text-texto hover:underline"
                  >
                    Ver el post publicado →
                  </a>
                }

                <div class="mt-3 flex flex-wrap items-center gap-2">
                  @if (membresia.esEquipo()) {
                    @if (estado(fila.post) !== 'publicando') {
                      <button
                        type="button"
                        (click)="guardar(fila)"
                        [disabled]="trabajando() === fila.pagina.id"
                        class="rounded-md border border-borde px-3 py-1.5 text-xs font-medium text-texto hover:bg-superficie-2 disabled:opacity-40"
                      >
                        Guardar
                      </button>
                    }
                    @if (estado(fila.post) === 'editable') {
                      <button
                        type="button"
                        (click)="publicar(fila.pagina.id)"
                        [disabled]="trabajando() === fila.pagina.id"
                        class="rounded-md bg-accion text-texto-invertido px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-40"
                      >
                        Publicar
                      </button>
                    } @else if (estado(fila.post) === 'fallo') {
                      <button
                        type="button"
                        (click)="publicar(fila.pagina.id)"
                        [disabled]="trabajando() === fila.pagina.id"
                        class="rounded-md bg-accion text-texto-invertido px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-40"
                      >
                        Reintentar publicación
                      </button>
                    }
                  }
                  <!--
                    "Copiar" — publicación manual, mientras BlogPublisher sea solo mock (Global
                    Constraints: hoy "Publicar" no llega a ninguna plataforma real). Disponible en los
                    CUATRO estados con post (incluidos "Publicando…" y "Publicada"): copiar no es
                    "editar", así que nunca se deshabilita por el estado de publicación — y visible
                    para el rol cliente también, porque copiar no escribe nada (no hay nada que RLS
                    tenga que negarle). Ver copiar() para el contrato exacto (dos formatos a la vez).
                  -->
                  <button
                    type="button"
                    (click)="copiar(fila)"
                    class="rounded-md border border-borde px-3 py-1.5 text-xs font-medium text-texto hover:bg-superficie-2"
                  >
                    {{ copiadoId() === fila.pagina.id ? 'Copiado ✓' : 'Copiar' }}
                  </button>
                </div>
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class PostsPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  // El rol sale de `memberships`, no del token: ver la cabecera de `MembresiaService`.
  readonly membresia = inject(MembresiaService);

  /** A qué run corresponde el trabajo en vuelo, y si el componente sigue vivo. Ver `core/vigencia.ts`. */
  private readonly vigencia = new Vigencia();
  private sub: Subscription | null = null;

  /** El id de la URL, para el link de volver. Se escribe junto con la vigencia, nunca por separado. */
  readonly runId = signal('');
  /**
   * El CLIENTE de la URL (`/clientes/:id/research/:runId/posts`), solo para el enlace de vuelta.
   * Acá NO se concilia con el dueño del run — mismo criterio que `informe.ts`: se llega desde el
   * brief, que ya lo hizo.
   */
  readonly clienteId = signal('');

  readonly filas = signal<FilaPost[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');

  /** El `pageId` de la fila con una acción (guardar/publicar) en vuelo, o `null`. Una a la vez. */
  readonly trabajando = signal<string | null>(null);

  /** Buffer de edición local, por `pageId`. Inicializado al cargar — ver `cargar()`. */
  private readonly ediciones = signal<Record<string, { titulo: string; cuerpo: string }>>({});

  /** El `pageId` cuyo botón "Copiar" muestra "Copiado ✓" ahora mismo, o `null`. */
  readonly copiadoId = signal<string | null>(null);
  private timerCopiado: ReturnType<typeof setTimeout> | null = null;

  readonly ETIQUETA = ETIQUETA;
  readonly CLASE = CLASE;
  readonly estado = estadoDePost;

  ngOnInit(): void {
    // Suscripción y no un `ngOnInit` a secas: mismo motivo que `informe.ts`/`brief.ts` — Angular
    // puede reutilizar la instancia al navegar entre los posts de dos runs sin desmontarla.
    this.sub = this.route.paramMap.subscribe((params) => {
      this.clienteId.set(params.get('id') ?? '');
      const id = params.get('runId') ?? '';
      if (id === this.vigencia.actual) return;
      // La vigencia cambia ANTES de pedir nada: lo pedido para el run anterior queda obsoleto solo.
      this.vigencia.cambiarA(id);
      this.runId.set(id);
      this.filas.set([]);
      this.ediciones.set({});
      this.error.set('');
      void this.cargar(id);
    });
  }

  ngOnDestroy(): void {
    // Primero la vigencia: una carga en vuelo que resuelva después no puede escribir sobre un tab ya
    // destruido — mismo orden que `brief.ts`.
    this.vigencia.destruir();
    this.sub?.unsubscribe();
    if (this.timerCopiado) clearTimeout(this.timerCopiado);
  }

  /** `pedido` es el run al que corresponde ESTA carga, capturado antes del `await`. */
  private async cargar(pedido: string): Promise<void> {
    this.cargando.set(true);
    try {
      const brief = await this.api.verBrief(pedido);
      if (this.vigencia.obsoleta(pedido)) return; // llegó tarde: ya es otro run, o nos fuimos
      const aprobadas = brief.pages.filter((p) => p.approved);
      const posts = await Promise.all(aprobadas.map((p) => this.api.verPost(p.id)));
      if (this.vigencia.obsoleta(pedido)) return; // el Promise.all también puede llegar tarde
      const filas = aprobadas.map((pagina, i): FilaPost => ({ pagina, post: posts[i] ?? null }));
      this.filas.set(filas);
      this.ediciones.set(
        Object.fromEntries(
          filas.map((f) => [f.pagina.id, { titulo: f.post?.titulo ?? '', cuerpo: f.post?.cuerpo ?? '' }]),
        ),
      );
    } catch (e) {
      if (this.vigencia.obsoleta(pedido)) return;
      this.error.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(pedido)) this.cargando.set(false);
    }
  }

  tituloEditado(fila: FilaPost): string {
    return this.ediciones()[fila.pagina.id]?.titulo ?? fila.post?.titulo ?? '';
  }
  cuerpoEditado(fila: FilaPost): string {
    return this.ediciones()[fila.pagina.id]?.cuerpo ?? fila.post?.cuerpo ?? '';
  }
  editarTitulo(pageId: string, valor: string): void {
    this.ediciones.update((m) => ({ ...m, [pageId]: { titulo: valor, cuerpo: m[pageId]?.cuerpo ?? '' } }));
  }
  editarCuerpo(pageId: string, valor: string): void {
    this.ediciones.update((m) => ({ ...m, [pageId]: { titulo: m[pageId]?.titulo ?? '', cuerpo: valor } }));
  }

  /** El texto plano del cuerpo, para la vista de solo lectura del rol cliente. `core/html-a-texto.ts`. */
  textoPlano(post: PostDePagina | null): string {
    return post?.cuerpo ? htmlATextoPlano(post.cuerpo) : '';
  }

  /**
   * Un único `PATCH /pages/:id` con `{post_titulo, post_cuerpo}` — no dos requests separados (Step
   * 2 del brief). Refresca SOLO esta fila tras guardar, sin recargar el listado entero.
   */
  async guardar(fila: FilaPost): Promise<void> {
    const pageId = fila.pagina.id;
    const edicion = this.ediciones()[pageId];
    if (!edicion) return;
    this.trabajando.set(pageId);
    this.error.set('');
    try {
      await this.api.editarPost(pageId, { post_titulo: edicion.titulo, post_cuerpo: edicion.cuerpo });
      await this.refrescarUna(pageId);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      if (this.trabajando() === pageId) this.trabajando.set(null);
    }
  }

  /** Publica (o reintenta) — mismo endpoint para las dos acciones: `solicitarPublicacionPost` REINTENTA
   *  sobre una fila con `errorEn` puesto y limpia esa marca (Task 1/3, `db/`). */
  async publicar(pageId: string): Promise<void> {
    this.trabajando.set(pageId);
    this.error.set('');
    try {
      await this.api.solicitarPublicacionPost(pageId);
      await this.refrescarUna(pageId);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      if (this.trabajando() === pageId) this.trabajando.set(null);
    }
  }

  /** Vuelve a pedir el post de UNA página y actualiza esa fila (y su buffer de edición) en local. */
  private async refrescarUna(pageId: string): Promise<void> {
    const post = await this.api.verPost(pageId);
    this.filas.update((fs) => fs.map((f) => (f.pagina.id === pageId ? { ...f, post } : f)));
    this.ediciones.update((m) => ({
      ...m,
      [pageId]: { titulo: post?.titulo ?? '', cuerpo: post?.cuerpo ?? '' },
    }));
  }

  /**
   * El botón "Copiar" (Step 3.5 del brief) — publicación MANUAL, sin depender de `BlogPublisher`:
   * hoy es solo mock (Global Constraints), así que "Publicar" no llega a ninguna plataforma real.
   * Hasta que exista una integración real, el camino con el que el staff publica DE VERDAD es copiar
   * el post y pegarlo a mano donde corresponda (WordPress, Wix, Medium…).
   *
   * Copia DOS FORMATOS a la vez, vía `ClipboardItem`:
   *  - `text/html`: el `post_cuerpo` EXACTO que devolvió la API, ya sanitizado por el servidor
   *    (`db/src/sanitizar-html.ts`) — nunca una reconstrucción manual del DOM (`innerHTML` seguido de
   *    `outerHTML`), que podría reintroducir lo que el sanitizador ya sacó. Así, un editor de destino
   *    con paste-handler rico (WordPress, Wix, Medium, Google Docs) preserva negrita/títulos/links.
   *  - `text/plain`: el título + el mismo cuerpo sin tags (`core/html-a-texto.ts`), como respaldo
   *    para un campo que solo acepta texto plano. El título va acá y NO en el HTML: mezclarlo ahí
   *    dejaría de ser "exactamente `post_cuerpo`" (la garantía que este comentario defiende arriba).
   *
   * Con fallback a `writeText` si `ClipboardItem`/`clipboard.write` no está disponible (contexto no
   * seguro, navegador viejo) — mismo criterio de degradar en vez de fallar que el resto del portal.
   */
  async copiar(fila: FilaPost): Promise<void> {
    const html = fila.post?.cuerpo ?? '';
    if (!html) return;
    const texto = [fila.post?.titulo ?? '', htmlATextoPlano(html)].filter(Boolean).join('\n\n');
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([texto], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(texto);
      }
      this.mostrarCopiado(fila.pagina.id);
    } catch {
      // El portapapeles puede estar bloqueado (permiso denegado, contexto no seguro): sin la
      // confirmación de abajo, quien clickeó ya ve que "Copiado ✓" nunca aparece — eso ya lo dice.
    }
  }

  private mostrarCopiado(pageId: string): void {
    this.copiadoId.set(pageId);
    if (this.timerCopiado) clearTimeout(this.timerCopiado);
    this.timerCopiado = setTimeout(() => this.copiadoId.set(null), 2000);
  }
}

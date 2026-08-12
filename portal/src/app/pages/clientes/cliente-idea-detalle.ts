import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
import type { EstadoIdea, IdeaDetalle } from '../../core/models';
import { transicionesDesde } from '../../core/ideas-transiciones';
import { Vigencia } from '../../core/vigencia';

/** Espeja `ETIQUETA` de `cliente-ideas.ts` — se duplica porque ese archivo está cerrado (Task 1). */
const ETIQUETA_ESTADO: Record<EstadoIdea, string> = {
  nueva: 'Nueva',
  en_revision: 'En revisión',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
};

/** El texto del botón para CADA transición posible. `nueva` no aparece: nada transiciona hacia ahí. */
const ETIQUETA_ACCION: Partial<Record<EstadoIdea, string>> = {
  en_revision: 'Pasar a revisión',
  aprobada: 'Aprobar',
  rechazada: 'Rechazar',
};

/**
 * Las ocho claves posibles de `analisis`, con su etiqueta LEGIBLE — nunca el nombre crudo de la
 * clave en pantalla. Lista cerrada a propósito: si el LLM produjera una clave nueva, se vería con su
 * nombre técnico en vez de desaparecer (`ETIQUETAS_ANALISIS[clave] ?? clave`, más abajo), que es
 * preferible a un `@for` que la calle en silencio.
 */
const ETIQUETAS_ANALISIS: Record<string, string> = {
  audiencia_objetivo: 'Audiencia objetivo',
  canales_comunicacion: 'Canales de comunicación',
  intencion: 'Intención',
  materiales_formatos: 'Materiales y formatos',
  observaciones: 'Observaciones',
  checklist_interpretacion: 'Checklist de interpretación',
  ideas_complementarias: 'Ideas complementarias',
  tipo_accion: 'Tipo de acción',
};

/** Lo que se puede editar en esta pasada: texto libre escrito por un humano de la agencia. */
interface FormularioIdea {
  titulo: string;
  resumen: string;
  mensajeDe: string;
}

function formularioDesde(i: IdeaDetalle): FormularioIdea {
  return { titulo: i.titulo, resumen: i.resumen ?? '', mensajeDe: i.mensaje_de ?? '' };
}

/** Una entrada de `analisis` ya lista para pintar: `lista` si el valor es array, `texto` si no. */
interface EntradaAnalisis {
  clave: string;
  etiqueta: string;
  lista: string[] | null;
  texto: string | null;
}

/**
 * El detalle de UNA idea: `/clientes/:id/ideas/:ideaId` (Task 2 de la pieza 3). Lee la transcripción
 * completa, edita el contenido y mueve la idea por su máquina de estados.
 *
 * **Dos acciones separadas, nunca una sola "Guardar".** `guardar()` (contenido) y `transicionar()`
 * (estado) llaman a dos métodos distintos de la API que arman DOS PATCH distintos — el servidor
 * rechaza con 400 cualquier PATCH que mezcle `estado` con contenido (`api/src/app.ts`: "El cambio de
 * estado va solo"), así que ofrecer un único botón que mande las dos cosas sería prometer una
 * atomicidad que no existe.
 *
 * **Los botones de transición son UX, no autorización.** `transicionesDesde()` (copia en el portal
 * de `TRANSICIONES_IDEA`) solo decide qué botón se OFRECE; la garantía real es el trigger de
 * Postgres, y el servidor rechaza igual si alguien salta el cliente.
 *
 * **Editable en esta pasada: `titulo`, `resumen`, `mensaje_de`.** `transcripcion`, `analisis` y las
 * URLs vienen del origen (el flujo de audio) y no se editan desde acá — ver el reporte de la etapa.
 *
 * Mismo manejo de `:id`/`:ideaId` con `Vigencia` que el resto de las pantallas anidadas bajo la
 * ficha (`informe.ts`, `cliente-ideas.ts`): `:id` es el CLIENTE (solo para el enlace de vuelta),
 * `:ideaId` es la clave de vigencia — cambiar de idea o de cliente mientras la carga está en vuelo
 * no puede pisar la pantalla con datos de otra.
 */
@Component({
  selector: 'app-cliente-idea-detalle',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="space-y-6">
      <a
        [routerLink]="['/clientes', clienteId(), 'ideas']"
        class="text-sm text-texto-tenue hover:text-texto"
      >
        ← Volver a ideas
      </a>

      @if (cargando()) {
        <p class="text-sm text-texto-tenue">Cargando…</p>
      } @else if (error()) {
        <p class="text-sm text-error">{{ error() }}</p>
      } @else if (idea(); as i) {
        <!-- sr-only por el mismo motivo que en el resto de los tabs hoja: la ficha es el contenedor. -->
        <h1 class="sr-only">{{ i.titulo }}</h1>

        <header class="bg-superficie rounded-xl border border-borde p-6 space-y-4">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-lg font-semibold text-texto">{{ i.titulo }}</h2>
            <span class="text-xs shrink-0 rounded-full px-2 py-0.5" [class]="estadoClase(i.estado)">
              {{ ETIQUETA_ESTADO[i.estado] }}
            </span>
          </div>

          @if (transicionesDisponibles().length > 0) {
            <div class="flex flex-wrap gap-3">
              @for (hacia of transicionesDisponibles(); track hacia) {
                <button
                  type="button"
                  (click)="transicionar(hacia)"
                  [disabled]="cambiandoEstado()"
                  class="rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
                >
                  {{ ETIQUETA_ACCION[hacia] ?? hacia }}
                </button>
              }
            </div>
          }
          @if (errorEstado()) {
            <p class="text-sm text-error">{{ errorEstado() }}</p>
          }
        </header>

        <section class="bg-superficie rounded-xl border border-borde p-6 space-y-4">
          @if (!editando()) {
            <div class="space-y-4">
              <div>
                <p class="text-sm text-texto-tenue">Resumen</p>
                <p class="text-base text-texto whitespace-pre-wrap">{{ i.resumen || '—' }}</p>
              </div>
              <div>
                <p class="text-sm text-texto-tenue">Remitente</p>
                <p class="text-base text-texto">{{ i.mensaje_de || '—' }}</p>
              </div>
              <div>
                <p class="text-sm text-texto-tenue">Transcripción</p>
                <p class="text-sm text-texto-medio whitespace-pre-wrap">
                  {{ i.transcripcion || 'Sin transcripción todavía.' }}
                </p>
              </div>
              @if (i.audio_url) {
                <div>
                  <p class="text-sm text-texto-tenue">Audio</p>
                  <a
                    [href]="i.audio_url"
                    target="_blank"
                    rel="noopener"
                    class="text-sm text-accion hover:underline"
                  >
                    Abrir el audio en otra pestaña
                  </a>
                  <audio [src]="i.audio_url" controls class="mt-2 w-full"></audio>
                </div>
              }
              @if (i.carpeta_url) {
                <div>
                  <p class="text-sm text-texto-tenue">Carpeta</p>
                  <a
                    [href]="i.carpeta_url"
                    target="_blank"
                    rel="noopener"
                    class="text-sm text-accion hover:underline"
                  >
                    Abrir la carpeta
                  </a>
                </div>
              }
              @if (analisisEntradas().length > 0) {
                <div class="space-y-3">
                  <p class="text-sm text-texto-tenue">Análisis</p>
                  @for (entrada of analisisEntradas(); track entrada.clave) {
                    <div>
                      <p class="text-sm font-medium text-texto-medio">{{ entrada.etiqueta }}</p>
                      @if (entrada.lista; as items) {
                        <ul class="list-disc pl-5 text-sm text-texto-medio">
                          @for (item of items; track $index) {
                            <li>{{ item }}</li>
                          }
                        </ul>
                      } @else {
                        <p class="text-sm text-texto-medio whitespace-pre-wrap">{{ entrada.texto }}</p>
                      }
                    </div>
                  }
                </div>
              }
              <div class="flex justify-end">
                <button
                  type="button"
                  (click)="editar()"
                  class="rounded-md border border-borde-fuerte px-4 py-2 text-sm font-medium text-texto hover:bg-superficie-2"
                >
                  Editar
                </button>
              </div>
            </div>
          } @else {
            <form (ngSubmit)="guardar()" class="space-y-4">
              <div class="flex flex-col gap-1">
                <label class="text-sm font-medium text-texto-medio" for="idea-titulo">
                  Título <span class="text-error">*</span>
                </label>
                <input
                  id="idea-titulo"
                  name="titulo"
                  type="text"
                  [ngModel]="form().titulo"
                  (ngModelChange)="actualizar('titulo', $event)"
                  class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                />
                @if (intentoGuardar() && !tituloValido()) {
                  <p class="text-xs text-error">El título no puede quedar vacío.</p>
                }
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-sm font-medium text-texto-medio" for="idea-resumen">Resumen</label>
                <textarea
                  id="idea-resumen"
                  name="resumen"
                  rows="3"
                  [ngModel]="form().resumen"
                  (ngModelChange)="actualizar('resumen', $event)"
                  class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                ></textarea>
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-sm font-medium text-texto-medio" for="idea-remitente">Remitente</label>
                <input
                  id="idea-remitente"
                  name="mensajeDe"
                  type="text"
                  [ngModel]="form().mensajeDe"
                  (ngModelChange)="actualizar('mensajeDe', $event)"
                  class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                />
              </div>

              @if (errorGuardar()) {
                <p class="text-sm text-error">{{ errorGuardar() }}</p>
              }

              <div class="flex justify-end gap-3">
                <button
                  type="button"
                  (click)="cancelar()"
                  [disabled]="guardando()"
                  class="rounded-md border border-borde-fuerte px-4 py-2 text-sm font-medium text-texto hover:bg-superficie-2"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  [disabled]="guardando()"
                  class="rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {{ guardando() ? 'Guardando…' : 'Guardar' }}
                </button>
              </div>
            </form>
          }
        </section>
      }
    </div>
  `,
})
export class ClienteIdeaDetallePage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  readonly ETIQUETA_ESTADO = ETIQUETA_ESTADO;
  readonly ETIQUETA_ACCION = ETIQUETA_ACCION;

  /** Ver el docblock de la clase: la clave de vigencia es la IDEA, no el cliente. */
  private readonly vigencia = new Vigencia();

  /** El cliente de la URL, solo para el enlace de vuelta — igual que `informe.ts`. */
  readonly clienteId = signal('');
  readonly ideaId = signal('');

  readonly idea = signal<IdeaDetalle | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');

  readonly editando = signal(false);
  readonly guardando = signal(false);
  readonly errorGuardar = signal('');
  readonly form = signal<FormularioIdea>({ titulo: '', resumen: '', mensajeDe: '' });

  /**
   * Validación de UX para `titulo`: la `0013` solo le puso TECHO (200 B) y ningún piso, así que sin
   * esto el formulario podía guardar `''` — deuda que el plan asignaba a esta etapa y una revisión
   * de integración encontró sin cerrar. Mismo patrón que `cliente-crear.ts`
   * (`intentoEnviar`/`nombreValido`): el error solo se muestra DESPUÉS de un intento de guardar, no
   * mientras se escribe.
   */
  readonly intentoGuardar = signal(false);
  readonly tituloValido = computed(() => this.form().titulo.trim().length > 0);

  readonly cambiandoEstado = signal(false);
  readonly errorEstado = signal('');

  readonly transicionesDisponibles = computed(() => {
    const i = this.idea();
    return i ? transicionesDesde(i.estado) : [];
  });

  /** `analisis` a texto/lista para el `@for`: ver el docblock de `EntradaAnalisis`. */
  readonly analisisEntradas = computed<EntradaAnalisis[]>(() => {
    const a = this.idea()?.analisis ?? {};
    return Object.entries(a).map(([clave, valor]) => ({
      clave,
      etiqueta: ETIQUETAS_ANALISIS[clave] ?? clave,
      lista: Array.isArray(valor) ? valor.map((v) => String(v)) : null,
      texto: Array.isArray(valor) ? null : String(valor),
    }));
  });

  private sub: Subscription | null = null;

  ngOnInit(): void {
    // Suscripción y no un `ngOnInit` a secas: Angular reutiliza la instancia al navegar entre ideas
    // del mismo cliente (o entre clientes) sin desmontar el componente. Mismo motivo que en el resto
    // de las pantallas anidadas bajo la ficha.
    this.sub = this.route.paramMap.subscribe((params) => {
      const clienteId = params.get('id') ?? '';
      this.clienteId.set(clienteId);
      const id = params.get('ideaId') ?? '';
      if (id === this.vigencia.actual) return;
      this.vigencia.cambiarA(id);
      this.ideaId.set(id);
      // La idea anterior no es de ésta: vaciarla antes de pedir evita mostrar el detalle ajeno
      // mientras la respuesta viaja, y evita que un 404 nuevo deje ver el contenido del anterior.
      this.idea.set(null);
      this.error.set('');
      this.editando.set(false);
      void this.cargar(id, clienteId);
    });
  }

  ngOnDestroy(): void {
    this.vigencia.destruir();
    this.sub?.unsubscribe();
  }

  /**
   * `pedidoCliente` es el `:id` de la URL en el momento en que se pidió ESTA idea — capturado antes
   * del `await`, mismo criterio que `pedido` (la clave de vigencia). `GET /ideas/:id` no filtra por
   * cliente (lo que aísla es RLS, por tenant), así que sin este chequeo una URL escrita a mano
   * `/clientes/<B>/ideas/<idea-de-A>` pintaría la idea de A bajo la ficha de B — no es un agujero de
   * seguridad, es una incoherencia de UI que una revisión de integración encontró (M4). Un cliente
   * equivocado se trata IGUAL que "no encontrada": revelar que la idea existe bajo otro cliente no
   * aporta nada y complicaría el mensaje sin necesidad.
   */
  private async cargar(pedido: string, pedidoCliente: string): Promise<void> {
    this.cargando.set(true);
    try {
      const idea = await this.api.obtenerIdea(pedido);
      if (this.vigencia.obsoleta(pedido)) return; // llegó tarde: ya es otra idea, o nos fuimos
      if (idea === null || idea.client_id !== pedidoCliente) {
        this.error.set('Idea no encontrada.');
      } else {
        this.idea.set(idea);
      }
    } catch (e) {
      if (this.vigencia.obsoleta(pedido)) return;
      this.error.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(pedido)) this.cargando.set(false);
    }
  }

  estadoClase(s: EstadoIdea): string {
    if (s === 'aprobada') return 'bg-respaldo-suave text-respaldo';
    if (s === 'rechazada') return 'bg-error-suave text-error';
    if (s === 'en_revision') return 'bg-alerta-suave text-alerta';
    return 'bg-superficie-2 text-texto-medio'; // nueva
  }

  /** Mueve la idea al estado `hacia`. Un PATCH `{ estado }` únicamente — ver el docblock de la clase. */
  async transicionar(hacia: EstadoIdea): Promise<void> {
    const i = this.idea();
    if (!i) return;
    const id = i.id;
    this.cambiandoEstado.set(true);
    this.errorEstado.set('');
    try {
      await this.api.cambiarEstadoIdea(id, hacia);
      const actualizada = await this.api.obtenerIdea(id);
      if (this.vigencia.obsoleta(id)) return; // se navegó a otra idea mientras esto viajaba
      if (actualizada) this.idea.set(actualizada);
    } catch (e) {
      if (this.vigencia.obsoleta(id)) return;
      this.errorEstado.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(id)) this.cambiandoEstado.set(false);
    }
  }

  editar(): void {
    const i = this.idea();
    if (!i) return;
    this.form.set(formularioDesde(i));
    this.errorGuardar.set('');
    this.intentoGuardar.set(false);
    this.editando.set(true);
  }

  cancelar(): void {
    this.editando.set(false);
  }

  actualizar<K extends keyof FormularioIdea>(campo: K, valor: FormularioIdea[K]): void {
    this.form.update((f) => ({ ...f, [campo]: valor }));
  }

  /** Guarda el CONTENIDO. Un PATCH sin `estado` únicamente — ver el docblock de la clase. */
  async guardar(): Promise<void> {
    const i = this.idea();
    if (!i) return;
    this.intentoGuardar.set(true);
    // `titulo` tiene techo en la base (200 B, `idea_titulo_razonable`) pero NUNCA piso: un string
    // vacío es válido para Postgres y para `PATCH /ideas/:id` (ver `ideas-http.ts`). Sin esta guarda
    // acá, el formulario podía guardar un título vacío — es UX, no autorización: el servidor lo
    // seguiría aceptando igual si alguien la salta.
    if (!this.tituloValido()) return;

    const id = i.id;
    this.guardando.set(true);
    this.errorGuardar.set('');
    try {
      const f = this.form();
      await this.api.editarIdea(id, {
        titulo: f.titulo.trim(),
        resumen: f.resumen.trim() === '' ? null : f.resumen,
        mensaje_de: f.mensajeDe.trim() === '' ? null : f.mensajeDe,
      });
      const actualizada = await this.api.obtenerIdea(id);
      if (this.vigencia.obsoleta(id)) return;
      if (actualizada) this.idea.set(actualizada);
      this.editando.set(false);
    } catch (e) {
      if (this.vigencia.obsoleta(id)) return;
      this.errorGuardar.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(id)) this.guardando.set(false);
    }
  }
}

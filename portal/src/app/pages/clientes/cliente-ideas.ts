import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
import type { EstadoIdea, IdeaResumen } from '../../core/models';
import { Vigencia } from '../../core/vigencia';

/** Los cuatro estados posibles, en el orden en que se ofrecen en el filtro. Espeja `ESTADOS_IDEA` de `db/src/ideas.ts` (el portal no la importa — ADR-21 — así que se repite acá). */
const ESTADOS_IDEA: readonly EstadoIdea[] = ['nueva', 'en_revision', 'aprobada', 'rechazada'];

const ETIQUETA: Record<EstadoIdea, string> = {
  nueva: 'Nueva',
  en_revision: 'En revisión',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
};

/**
 * El tab Ideas de la ficha del cliente: el listado RECORTADO de `GET /ideas`, solo lectura.
 *
 * **Por qué este tab no expone la cartera entera.** El backend (`api/src/ideas-http.ts`) sí puede
 * listar sin `clientId`, pero esta pantalla cuelga siempre de `/clientes/:id/ideas` — no hay ninguna
 * ruta global `/ideas` en el portal — así que `core/api-core.ts` no le ofrece ese modo:
 * `listarIdeas('')` lanza en vez de degradar a la lista de todo el tenant. Mismo criterio que
 * `listarRuns('')` en `cliente-research.ts`, un escalón más estricto porque acá no hace falta la
 * variante "sin cliente" que `listarRuns` sí tiene.
 *
 * **De dónde sale el `:id` y por qué hay `Vigencia`.** Igual que `cliente-research.ts`: el `:id` viene
 * de `route.paramMap` gracias a `paramsInheritanceStrategy: 'always'`, y una promesa que llega tarde
 * (cliente A) no puede pisar la pantalla del cliente que ya se está mirando (B). La única diferencia
 * con research es que acá hay una SEGUNDA dimensión que puede volverse obsoleta sin que cambie el
 * cliente: el filtro de `estado`. Cambiar el filtro no toca `Vigencia` (el cliente sigue siendo el
 * mismo), así que `cargar()` compara además el `estado` pedido contra el filtro vigente al volver —
 * ver el comentario ahí.
 *
 * Este tab es SOLO LECTURA: ni edición de contenido ni cambio de estado (eso es el detalle, Task 2).
 */
@Component({
  selector: 'app-cliente-ideas',
  imports: [FormsModule, RouterLink, DatePipe],
  template: `
    <div class="space-y-6">
      <!-- sr-only por el mismo motivo que en cliente-research.ts: la ficha es el contenedor. -->
      <h1 class="sr-only">Ideas</h1>

      <div class="flex items-center gap-2">
        <label for="filtro-estado" class="text-xs text-texto-tenue">Estado</label>
        <select
          id="filtro-estado"
          [ngModel]="filtroEstado()"
          (ngModelChange)="cambiarFiltro($event)"
          name="filtroEstado"
          class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
        >
          <option value="">Todos</option>
          @for (estado of ESTADOS_IDEA; track estado) {
            <option [value]="estado">{{ etiqueta(estado) }}</option>
          }
        </select>
      </div>

      <section>
        @if (cargando()) {
          <p class="text-sm text-texto-tenue">Cargando…</p>
        } @else if (error()) {
          <p class="text-sm text-error">{{ error() }}</p>
        } @else if (ideas().length === 0) {
          <p class="text-sm text-texto-tenue">Todavía no hay ideas.</p>
        } @else {
          <ul class="space-y-2">
            @for (idea of ideas(); track idea.id) {
              <li>
                <a
                  [routerLink]="['/clientes', clienteId(), 'ideas', idea.id]"
                  class="block bg-superficie rounded-lg border border-borde p-4 hover:border-borde-fuerte"
                >
                  <div class="flex items-center justify-between gap-3">
                    <p class="text-sm font-medium text-texto truncate">{{ idea.titulo }}</p>
                    <span class="text-xs shrink-0 rounded-full px-2 py-0.5" [class]="estadoClase(idea.estado)">
                      {{ etiqueta(idea.estado) }}
                    </span>
                  </div>
                  <p class="mt-1 text-xs text-texto-tenue">{{ idea.creada_en | date: 'short' }}</p>
                </a>
              </li>
            }
          </ul>
        }
      </section>
    </div>
  `,
})
export class ClienteIdeasPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  readonly ESTADOS_IDEA = ESTADOS_IDEA;

  /** Ver el docblock de la clase: guarda el CLIENTE, no el filtro — cambiar de filtro no lo toca. */
  private readonly vigencia = new Vigencia();

  /** El cliente del que es esta pantalla. Viene del `:id` del shell — ver `paramsInheritanceStrategy`. */
  readonly clienteId = signal('');

  /** `''` = sin filtrar (todos los estados). Nunca se manda como `estado=''` a la API: ver `cargar()`. */
  readonly filtroEstado = signal<EstadoIdea | ''>('');

  readonly ideas = signal<IdeaResumen[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');

  private sub: Subscription | null = null;

  ngOnInit(): void {
    // Suscripción y no un `ngOnInit` a secas: Angular reutiliza la instancia del tab al navegar entre
    // clientes sin desmontarlo, y ahí `ngOnInit` no vuelve a dispararse. Mismo motivo que en research.
    this.sub = this.route.paramMap.subscribe((params) => {
      const id = params.get('id') ?? '';
      // No repite el GET cuando el `:id` no cambió, y con la vigencia todavía en su valor inicial
      // (`''`) corta el caso «no llegó ningún `:id`»: sin esto se llamaría `listarIdeas('')`, que en
      // `core/api-core.ts` LANZA (no degrada) — pero igual no queremos ni intentarlo.
      if (id === this.vigencia.actual) return;
      this.vigencia.cambiarA(id);
      this.clienteId.set(id);
      // Las ideas del cliente anterior no son de éste: vaciarlas antes de pedir evita mostrar trabajo
      // ajeno mientras la respuesta viaja.
      this.ideas.set([]);
      this.error.set('');
      void this.cargar(id, this.filtroEstado());
    });
  }

  ngOnDestroy(): void {
    this.vigencia.destruir();
    this.sub?.unsubscribe();
  }

  /** El filtro dispara una carga nueva para el MISMO cliente: `Vigencia` no cambia, ver `cargar()`. */
  cambiarFiltro(valor: string): void {
    // El valor sale del `value` de un <option> que este mismo template generó a partir de
    // `ESTADOS_IDEA`, así que el cast es seguro: no es un dato que haya viajado por HTTP.
    const nuevo = valor as EstadoIdea | '';
    this.filtroEstado.set(nuevo);
    // Sin cliente no hay nada que pedir: mismo motivo que la guarda de `ngOnInit`.
    if (!this.clienteId()) return;
    this.ideas.set([]);
    this.error.set('');
    void this.cargar(this.clienteId(), nuevo);
  }

  /**
   * `pedidoCliente`/`pedidoEstado` son a lo que corresponde ESTA carga, capturados antes del `await`.
   *
   * `Vigencia` cubre el cliente (igual que research), pero el filtro puede volverse obsoleto SIN que
   * el cliente cambie —dos cambios de filtro seguidos para el mismo cliente—, y `Vigencia` no lo ve:
   * su clave es el cliente, no el filtro. Por eso, además de `obsoleta(pedidoCliente)`, se compara
   * `pedidoEstado` contra `filtroEstado()` al volver: si no coinciden, esta respuesta es de un filtro
   * que ya no está elegido y pisaría la lista del filtro nuevo.
   */
  private async cargar(pedidoCliente: string, pedidoEstado: EstadoIdea | ''): Promise<void> {
    this.cargando.set(true);
    try {
      const ideas = await this.api.listarIdeas(pedidoCliente, pedidoEstado || undefined);
      if (this.obsoleta(pedidoCliente, pedidoEstado)) return; // llegó tarde
      this.ideas.set(ideas);
    } catch (e) {
      if (this.obsoleta(pedidoCliente, pedidoEstado)) return;
      this.error.set((e as Error).message);
    } finally {
      if (!this.obsoleta(pedidoCliente, pedidoEstado)) this.cargando.set(false);
    }
  }

  private obsoleta(pedidoCliente: string, pedidoEstado: EstadoIdea | ''): boolean {
    return this.vigencia.obsoleta(pedidoCliente) || pedidoEstado !== this.filtroEstado();
  }

  etiqueta(s: EstadoIdea): string {
    return ETIQUETA[s];
  }

  estadoClase(s: EstadoIdea): string {
    if (s === 'aprobada') return 'bg-respaldo-suave text-respaldo';
    if (s === 'rechazada') return 'bg-error-suave text-error';
    if (s === 'en_revision') return 'bg-alerta-suave text-alerta';
    return 'bg-superficie-2 text-texto-medio'; // nueva
  }
}

import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
import { MembresiaService } from '../../services/membresia';
import type { RunStatus, RunSummary } from '../../core/models';
import { mostrarLanzarResearch } from '../../core/features';
import { usdDeMicros } from '../../core/dinero';
import { environment } from '../../../environments/environment';

const ETIQUETA: Record<RunStatus, string> = {
  running: 'Corriendo',
  pending_approval: 'Esperando aprobación',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  failed: 'Falló',
};

/**
 * El tab Research de la ficha del cliente: sus runs, y el formulario para lanzar uno.
 *
 * **Por qué esta pantalla dejó de ser global.** Cuando el research vivía en el menú (`/runs`), la
 * lista mezclaba los runs de toda la cartera y lanzar uno obligaba a pegar el uuid del cliente en un
 * input — un dato que la agencia tenía que ir a buscar, y que se puede escribir mal sin que nada
 * avise. Bajo `/clientes/:id/research` el cliente ya está decidido por la URL: la lista se filtra
 * sola y lanzar no pide ningún identificador.
 *
 * **De dónde sale el `:id`.** De `route.paramMap`, aunque el path de este tab (`research`) no sea
 * vacío: lo permite el `paramsInheritanceStrategy: 'always'` de `app.config.ts`. Si esa opción se
 * perdiera, `params.get('id')` devolvería `null` y el tab se quedaría cargando para siempre, sin un
 * error en consola — por eso hay un test que la fija leyendo el fuente (`app.routes.test.ts`).
 *
 * **El cliente NO se vuelve a pedir acá.** Lo carga una sola vez el shell (`cliente-ficha.ts`);
 * este tab solo necesita su id para filtrar.
 */
@Component({
  selector: 'app-cliente-research',
  imports: [FormsModule, RouterLink, DatePipe],
  template: `
    <div class="space-y-8">
      @if (puedeLanzar()) {
        <section class="bg-superficie rounded-xl border border-borde p-6">
          <h2 class="text-sm font-semibold text-texto mb-3">Lanzar un research</h2>
          <form (ngSubmit)="lanzar()" class="space-y-3">
            <textarea
              [ngModel]="prompt()"
              (ngModelChange)="prompt.set($event)"
              name="prompt"
              rows="2"
              placeholder="Prompt de negocio: ej. Hamburguesería gourmet en Madrid centro…"
              class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
            ></textarea>
            <button
              type="submit"
              [disabled]="lanzando() || !prompt()"
              class="rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {{ lanzando() ? 'Lanzando…' : 'Lanzar research' }}
            </button>
          </form>
        </section>
      }

      <section>
        @if (cargando()) {
          <p class="text-sm text-texto-tenue">Cargando…</p>
        } @else if (error()) {
          <p class="text-sm text-error">{{ error() }}</p>
        } @else if (runs().length === 0) {
          <p class="text-sm text-texto-tenue">Todavía no hay research.</p>
        } @else {
          <ul class="space-y-2">
            @for (run of runs(); track run.id) {
              <li>
                <a
                  [routerLink]="['/runs', run.id]"
                  class="block bg-superficie rounded-lg border border-borde p-4 hover:border-borde-fuerte"
                >
                  <div class="flex items-center justify-between gap-3">
                    <p class="text-sm font-medium text-texto truncate">{{ run.prompt }}</p>
                    <span class="text-xs shrink-0 rounded-full px-2 py-0.5" [class]="estadoClase(run.status)">
                      {{ etiqueta(run.status) }}
                    </span>
                  </div>
                  <!-- Sin coste no hay línea de coste: ver el comentario equivalente en brief.ts. -->
                  <p class="mt-1 text-xs text-texto-tenue">
                    {{ run.created_at | date: 'short' }}
                    @if (usd(run.coste_micros_usd); as coste) {
                      · \${{ coste }}
                    }
                  </p>
                </a>
              </li>
            }
          </ul>
        }
      </section>
    </div>
  `,
})
export class ClienteResearchPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  // El rol sale de `memberships`, no del token: ver la cabecera de `MembresiaService`.
  readonly membresia = inject(MembresiaService);

  /** El cliente del que es esta pantalla. Viene del `:id` del shell — ver `paramsInheritanceStrategy`. */
  readonly clienteId = signal('');

  readonly runs = signal<RunSummary[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');

  readonly prompt = signal('');
  readonly lanzando = signal(false);

  private sub: Subscription | null = null;

  /**
   * ¿Se muestra el formulario de "lanzar research"? Equipo + flag de despliegue. En Fase 1 el flag
   * está apagado (no hay orquestador), así que ni el equipo lo ve. La lógica vive en `features.ts`,
   * testeada; acá solo se cablea al rol y al environment. Ver §A.5.
   */
  readonly puedeLanzar = computed(() =>
    mostrarLanzarResearch(this.membresia.esEquipo(), environment.features.lanzarResearch),
  );

  ngOnInit(): void {
    // Suscripción y no un `ngOnInit` a secas: Angular reutiliza la instancia del tab si algún día se
    // navega de `/clientes/A/research` a `/clientes/B/research` sin desmontarlo, y ahí `ngOnInit` no
    // vuelve a dispararse. El filtro por `clienteId()` evita repetir el GET cuando el id no cambió.
    this.sub = this.route.paramMap.subscribe((params) => {
      const id = params.get('id') ?? '';
      if (id === this.clienteId()) return;
      this.clienteId.set(id);
      // Los runs del cliente anterior no son de éste: vaciarlos antes de pedir evita que la lista
      // muestre trabajo ajeno mientras la respuesta viaja.
      this.runs.set([]);
      void this.cargar();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    try {
      this.runs.set(await this.api.listarRuns(this.clienteId()));
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.cargando.set(false);
    }
  }

  async lanzar(): Promise<void> {
    if (!this.prompt()) return;
    this.lanzando.set(true);
    this.error.set('');
    try {
      await this.api.crearRun({ clientId: this.clienteId(), prompt: this.prompt() });
      this.prompt.set('');
      await this.cargar();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.lanzando.set(false);
    }
  }

  etiqueta(s: RunStatus): string {
    return ETIQUETA[s];
  }

  /** `null` = no hay coste que mostrar, y entonces la línea no se pinta. Ver `core/dinero.ts`. */
  readonly usd = usdDeMicros;

  estadoClase(s: RunStatus): string {
    if (s === 'approved') return 'bg-respaldo-suave text-respaldo';
    if (s === 'failed' || s === 'rejected') return 'bg-error-suave text-error';
    if (s === 'pending_approval') return 'bg-alerta-suave text-alerta';
    return 'bg-superficie-2 text-texto-medio';
  }
}

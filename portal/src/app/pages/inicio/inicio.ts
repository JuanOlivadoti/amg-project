import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { ApiService } from '../../services/api';
import { StatBoxComponent } from '../../shared/components/stat-box';
import type { ClienteAgencia, EstadoIdea, IdeaResumen, RunSummary } from '../../core/models';
import { ETIQUETA_ESTADO_IDEA, claseEstadoIdea } from '../../core/ideas-estado';
import {
  contarIdeasPorEstado,
  contarClientesActivos,
  contarBriefsPendientes,
  ultimasIdeasCon,
  type ConteoPorEstado,
} from './metricas';

/**
 * La pantalla de inicio: seis tiles + la tabla de últimas ideas, alimentados por TRES fuentes
 * independientes (`listarTodasLasIdeas`, `listarClientes`, `listarRuns`). Independientes también en
 * su falla — el requisito central del plan: si una de las tres rechaza, las otras dos se siguen
 * mostrando. Por eso hay tres signals `error` propios en vez de uno solo compartido, y por qué cada
 * `fetch` va en su propio `try/catch` en vez de un único `Promise.all`. El estado "cargando" no
 * lleva signal propia: se infiere de `ideas()`/`clientes()`/`runs()` en `null` sin error (ver
 * `tileIdeas` y `ultimasIdeas` más abajo).
 *
 * Por qué se llaman las cuatro funciones sueltas de `metricas.ts` (`contarIdeasPorEstado`,
 * `contarClientesActivos`, `contarBriefsPendientes`, `ultimasIdeasCon`) en vez de una sola
 * agregadora: cada una necesita distinguir "todavía cargando" de "falló" para SU fuente, y una
 * función que exigiera los tres arrays ya completos no podría pintar esa distinción en el DOM. Acá
 * cada una va gateada por su propio signal de datos crudos.
 *
 * Sin params de ruta que cambien (a diferencia de `cliente-ideas.ts`), así que no hace falta
 * `Vigencia`: la única carrera posible es que una de las tres respuestas llegue después de que el
 * componente se destruya, y alcanza con el flag `destruido` para no escribir sobre nada.
 */
@Component({
  selector: 'app-inicio',
  imports: [StatBoxComponent, RouterLink, DatePipe],
  template: `
    <div class="space-y-6">
      <h1 class="text-lg font-semibold text-texto">Inicio</h1>

      <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
        @if (errorIdeas()) {
          <p class="col-span-2 sm:col-span-3 text-sm text-error">No se pudieron cargar las ideas.</p>
        } @else {
          <app-stat-box titulo="Ideas nuevas" [valor]="tileIdeas('nueva')" />
          <app-stat-box titulo="Ideas en revisión" [valor]="tileIdeas('en_revision')" />
          <app-stat-box titulo="Ideas aprobadas" [valor]="tileIdeas('aprobada')" />
          <app-stat-box titulo="Ideas rechazadas" [valor]="tileIdeas('rechazada')" />
        }

        @if (errorClientes()) {
          <p class="text-sm text-error">No se pudieron cargar los clientes.</p>
        } @else {
          <app-stat-box titulo="Clientes activos" [valor]="clientesActivos() ?? '…'" />
        }

        @if (errorRuns()) {
          <p class="text-sm text-error">No se pudieron cargar los briefs.</p>
        } @else {
          <app-stat-box titulo="Briefs esperando aprobación" [valor]="briefsPendientes() ?? '…'" />
        }
      </div>

      <section class="space-y-2">
        <h2 class="text-sm font-semibold text-texto">Últimas ideas</h2>
        @if (errorIdeas()) {
          <p class="text-sm text-error">No se pudieron cargar las ideas.</p>
        } @else if (ultimasIdeas() === null) {
          <p class="text-sm text-texto-tenue">Cargando…</p>
        } @else if (ultimasIdeas()!.length === 0) {
          <p class="text-sm text-texto-tenue">Todavía no hay ideas.</p>
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-texto-tenue">
                  <th class="py-2 pr-4 font-medium">Título</th>
                  <th class="py-2 pr-4 font-medium">Cliente</th>
                  <th class="py-2 pr-4 font-medium">Estado</th>
                  <th class="py-2 pr-4 font-medium">Fecha</th>
                </tr>
              </thead>
              <tbody>
                @for (idea of ultimasIdeas()!; track idea.id) {
                  <tr class="border-b border-borde last:border-0">
                    <td class="py-2 pr-4">
                      <a
                        [routerLink]="['/clientes', idea.clienteId, 'ideas', idea.id]"
                        class="text-texto hover:underline"
                      >
                        {{ idea.titulo }}
                      </a>
                    </td>
                    <td class="py-2 pr-4 text-texto-medio">{{ idea.clienteNombre }}</td>
                    <td class="py-2 pr-4">
                      <span class="text-xs rounded-full px-2 py-0.5" [class]="estadoClase(idea.estado)">
                        {{ etiqueta(idea.estado) }}
                      </span>
                    </td>
                    <td class="py-2 pr-4 text-texto-tenue">{{ idea.creadaEn | date: 'short' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </div>
  `,
})
export class InicioPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);

  private destruido = false;

  readonly ideas = signal<IdeaResumen[] | null>(null);
  readonly errorIdeas = signal('');

  readonly clientes = signal<ClienteAgencia[] | null>(null);
  readonly errorClientes = signal('');

  readonly runs = signal<RunSummary[] | null>(null);
  readonly errorRuns = signal('');

  readonly conteoIdeas = computed<ConteoPorEstado | null>(() => {
    const i = this.ideas();
    return i ? contarIdeasPorEstado(i) : null;
  });

  readonly clientesActivos = computed<number | null>(() => {
    const c = this.clientes();
    return c ? contarClientesActivos(c) : null;
  });

  readonly briefsPendientes = computed<number | null>(() => {
    const r = this.runs();
    return r ? contarBriefsPendientes(r) : null;
  });

  readonly ultimasIdeas = computed(() => {
    const i = this.ideas();
    if (!i) return null;
    // clientes en null (todavía no llegó, o falló) degrada a [], que hace que ultimasIdeasCon
    // muestre 'Cliente desconocido' en cada fila en vez de romper la tabla entera — el nombre es
    // un enriquecimiento, no la garantía de esta tabla.
    return ultimasIdeasCon(i, this.clientes() ?? [], 5);
  });

  ngOnInit(): void {
    // Las tres en paralelo, cada una con su propio try/catch: NO un Promise.all que todo-o-nada la
    // pantalla si una sola de las tres rechaza.
    void this.cargarIdeas();
    void this.cargarClientes();
    void this.cargarRuns();
  }

  ngOnDestroy(): void {
    this.destruido = true;
  }

  private async cargarIdeas(): Promise<void> {
    try {
      const ideas = await this.api.listarTodasLasIdeas();
      if (this.destruido) return;
      this.ideas.set(ideas);
    } catch (e) {
      if (this.destruido) return;
      this.errorIdeas.set((e as Error).message);
    }
  }

  private async cargarClientes(): Promise<void> {
    try {
      const clientes = await this.api.listarClientes();
      if (this.destruido) return;
      this.clientes.set(clientes);
    } catch (e) {
      if (this.destruido) return;
      this.errorClientes.set((e as Error).message);
    }
  }

  private async cargarRuns(): Promise<void> {
    try {
      const runs = await this.api.listarRuns();
      if (this.destruido) return;
      this.runs.set(runs);
    } catch (e) {
      if (this.destruido) return;
      this.errorRuns.set((e as Error).message);
    }
  }

  /** `'…'` mientras `conteoIdeas()` es `null` (todavía cargando) — un 0 real solo llega con el dato. */
  tileIdeas(clave: keyof ConteoPorEstado): number | string {
    const c = this.conteoIdeas();
    return c ? c[clave] : '…';
  }

  etiqueta(s: EstadoIdea): string {
    return ETIQUETA_ESTADO_IDEA[s];
  }

  estadoClase(s: EstadoIdea): string {
    return claseEstadoIdea(s);
  }
}

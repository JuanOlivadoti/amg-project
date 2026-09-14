import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
import type { ComparativaSeguros } from '../../core/models';
import { Vigencia } from '../../core/vigencia';

/**
 * El tab "Comparativas" de la ficha del cliente (`/clientes/:id/comparativas`): el historial de
 * comparativas de seguros generadas, más nueva primero (ya lo ordena el store — ver el handler
 * `GET /clients/:id/comparativas-seguros` en `api/src/app.ts`).
 *
 * Solo existe como tab para clientes `correduria_seguros` — la condición vive en
 * `pages/clientes/cliente-ficha.ts` (`tabsFicha`), mismo patrón que la etiqueta dinámica de "Pólizas
 * y coberturas". Esta pantalla no repite esa comprobación: si alguien llega acá por URL directa con
 * un cliente de otro vertical, el `POST` que crea la comparativa ya la rechaza con 409 (el handler,
 * Task 6) — acá no hay nada que escribir, así que no hay nada que autorizar de más.
 *
 * **Muestra pendiente/revisado por fila, a propósito**: es la forma en la que el equipo nota lo que
 * quedó sin revisar sin tener que abrir cada una — el gate en sí (deshabilitar Imprimir/Copiar) vive
 * en `resultado.ts`, y acá solo se declara el estado para que se note desde la lista.
 *
 * Mismo patrón de carga que `cliente-ideas.ts`: el `:id` sale de `route.paramMap` (heredado del shell
 * por `paramsInheritanceStrategy: 'always'`), con `Vigencia` para que una respuesta tardía del
 * cliente anterior no pise la lista del cliente que ya se está mirando.
 */
@Component({
  selector: 'app-comparativas-listado',
  imports: [RouterLink, DatePipe],
  template: `
    <div class="space-y-6">
      <!-- sr-only por el mismo motivo que en cliente-research.ts: la ficha es el contenedor. -->
      <h1 class="sr-only">Comparativas</h1>

      <div class="flex items-center justify-between">
        <p class="text-sm text-texto-tenue">Comparativas de seguros generadas para este cliente.</p>
        <a
          [routerLink]="['/clientes', clienteId(), 'comparativas', 'cargar']"
          class="rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          Nueva comparativa
        </a>
      </div>

      @if (cargando()) {
        <p class="text-sm text-texto-tenue">Cargando…</p>
      } @else if (error()) {
        <p class="text-sm text-error">{{ error() }}</p>
      } @else if (comparativas().length === 0) {
        <p class="text-sm text-texto-tenue">Todavía no hay comparativas cargadas.</p>
      } @else {
        <ul class="space-y-2">
          @for (c of comparativas(); track c.id) {
            <li>
              <a
                [routerLink]="['/clientes', clienteId(), 'comparativas', c.id]"
                class="block bg-superficie rounded-lg border border-borde p-4 hover:border-borde-fuerte"
              >
                <div class="flex items-center justify-between gap-3">
                  <p class="text-sm font-medium text-texto truncate">{{ c.clienteFinalNombre }}</p>
                  @if (c.revisadoEn) {
                    <span class="text-xs shrink-0 rounded-full px-2 py-0.5 bg-respaldo-suave text-respaldo">
                      Revisado
                    </span>
                  } @else {
                    <span class="text-xs shrink-0 rounded-full px-2 py-0.5 bg-alerta-suave text-alerta">
                      Pendiente de revisión
                    </span>
                  }
                </div>
                <p class="mt-1 text-xs text-texto-tenue">{{ c.createdAt | date: 'short' }}</p>
              </a>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class ComparativasListadoPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  private readonly vigencia = new Vigencia();
  private sub: Subscription | null = null;

  readonly clienteId = signal('');
  readonly comparativas = signal<ComparativaSeguros[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');

  ngOnInit(): void {
    // Suscripción y no un `ngOnInit` a secas: Angular reutiliza la instancia del tab al navegar entre
    // clientes sin desmontarlo — mismo motivo que `cliente-ideas.ts`/`cliente-research.ts`.
    this.sub = this.route.paramMap.subscribe((params) => {
      const id = params.get('id') ?? '';
      if (id === this.vigencia.actual) return;
      this.vigencia.cambiarA(id);
      this.clienteId.set(id);
      this.comparativas.set([]);
      this.error.set('');
      void this.cargar(id);
    });
  }

  ngOnDestroy(): void {
    this.vigencia.destruir();
    this.sub?.unsubscribe();
  }

  private async cargar(pedido: string): Promise<void> {
    this.cargando.set(true);
    try {
      const comparativas = await this.api.listarComparativas(pedido);
      if (this.vigencia.obsoleta(pedido)) return; // llegó tarde: ya es otro cliente, o nos fuimos
      this.comparativas.set(comparativas);
    } catch (e) {
      if (this.vigencia.obsoleta(pedido)) return;
      this.error.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(pedido)) this.cargando.set(false);
    }
  }
}

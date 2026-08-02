import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { ApiService } from '../../services/api';
import { MembresiaService } from '../../services/membresia';
import type { RunStatus, RunSummary } from '../../core/models';
import { mostrarLanzarResearch } from '../../core/features';
import { environment } from '../../../environments/environment';

const ETIQUETA: Record<RunStatus, string> = {
  running: 'Corriendo',
  pending_approval: 'Esperando aprobación',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  failed: 'Falló',
};

@Component({
  selector: 'app-runs',
  imports: [FormsModule, RouterLink, DatePipe],
  template: `
    <div class="max-w-3xl mx-auto px-4 py-8 space-y-8">
      @if (puedeLanzar()) {
        <section class="bg-superficie rounded-xl border border-borde p-6">
          <h2 class="text-sm font-semibold text-texto mb-3">Lanzar un research</h2>
          <form (ngSubmit)="lanzar()" class="space-y-3">
            <input
              [ngModel]="clientId()"
              (ngModelChange)="clientId.set($event)"
              name="clientId"
              placeholder="ID del cliente (uuid)"
              class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
            />
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
              [disabled]="lanzando() || !clientId() || !prompt()"
              class="rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {{ lanzando() ? 'Lanzando…' : 'Lanzar research' }}
            </button>
          </form>
        </section>
      }

      <section>
        <h2 class="text-sm font-semibold text-texto mb-3">Research</h2>

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
                  <p class="mt-1 text-xs text-texto-tenue">
                    {{ run.created_at | date: 'short' }} · \${{ usd(run.coste_micros_usd) }}
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
export class RunsPage implements OnInit {
  private readonly api = inject(ApiService);
  // El rol sale de `memberships`, no del token: ver la cabecera de `MembresiaService`.
  readonly membresia = inject(MembresiaService);

  readonly runs = signal<RunSummary[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');

  readonly clientId = signal('');
  readonly prompt = signal('');
  readonly lanzando = signal(false);

  /**
   * ¿Se muestra el formulario de "lanzar research"? Equipo + flag de despliegue. En Fase 1 el flag
   * está apagado (no hay orquestador), así que ni el equipo lo ve. La lógica vive en `features.ts`,
   * testeada; acá solo se cablea al rol y al environment. Ver §A.5.
   */
  readonly puedeLanzar = computed(() =>
    mostrarLanzarResearch(this.membresia.esEquipo(), environment.features.lanzarResearch),
  );

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    try {
      this.runs.set(await this.api.listarRuns());
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.cargando.set(false);
    }
  }

  async lanzar(): Promise<void> {
    if (!this.clientId() || !this.prompt()) return;
    this.lanzando.set(true);
    this.error.set('');
    try {
      await this.api.crearRun({ clientId: this.clientId(), prompt: this.prompt() });
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

  usd(micros: number): string {
    return (micros / 1_000_000).toFixed(2);
  }

  estadoClase(s: RunStatus): string {
    if (s === 'approved') return 'bg-respaldo-suave text-respaldo';
    if (s === 'failed' || s === 'rejected') return 'bg-error-suave text-error';
    if (s === 'pending_approval') return 'bg-alerta-suave text-alerta';
    return 'bg-superficie-2 text-texto-medio';
  }
}

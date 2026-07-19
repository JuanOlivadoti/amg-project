import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import type { Brief, PaginaPropuesta } from '../../core/models';
import { separarPorEvidencia, puedeAprobarseRun } from '../../core/evidence';
import { Vigencia } from '../../core/vigencia';

@Component({
  selector: 'app-brief',
  imports: [FormsModule, RouterLink, NgTemplateOutlet],
  template: `
    <div class="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <a routerLink="/runs" class="text-sm text-gray-500 hover:text-gray-900">← Volver</a>

      @if (cargando()) {
        <p class="text-sm text-gray-500">Cargando…</p>
      } @else if (error()) {
        <p class="text-sm text-red-600">{{ error() }}</p>
      } @else if (brief(); as b) {
        <header class="bg-white rounded-xl border border-gray-200 p-6">
          <h1 class="text-lg font-semibold text-gray-900">{{ b.run.prompt }}</h1>
          <p class="mt-1 text-xs text-gray-500">
            Estado: {{ b.run.status }} · Coste: \${{ usd(b.run.coste_micros_usd) }}
          </p>
          @if (auth.esEquipo()) {
            <button
              (click)="aprobarRun()"
              [disabled]="!puedeAprobar() || trabajando()"
              class="mt-4 rounded-md bg-green-700 text-white px-4 py-2 text-sm font-medium hover:bg-green-800 disabled:opacity-40"
            >
              Aprobar el run y publicar
            </button>
            @if (!puedeAprobar()) {
              <p class="mt-2 text-xs text-gray-500">Aprobá al menos una página antes de aprobar el run.</p>
            }
          }
        </header>

        @if (b.run.status === 'running') {
          <div class="bg-white rounded-xl border border-gray-200 p-6 text-sm text-gray-600">
            <span class="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse mr-2"></span>
            El research está corriendo. Esta pantalla se actualiza sola.
          </div>
        } @else {
        <!-- ✅ RESPALDADAS por datos de mercado -->
        <section>
          <h2 class="text-sm font-semibold mb-2" style="color:#15803d">
            ✅ Respaldadas por datos ({{ respaldadas().length }})
          </h2>
          @if (respaldadas().length === 0) {
            <p class="text-sm text-gray-400">Ninguna página tiene datos de mercado que la respalden.</p>
          }
          @for (p of respaldadas(); track p.id) {
            <ng-container [ngTemplateOutlet]="tarjeta" [ngTemplateOutletContext]="{ $implicit: p }" />
          }
        </section>

        <!-- ⚠️ SIN VALIDAR: se muestran igual. Ocultarlas sería mentir. -->
        <section>
          <h2 class="text-sm font-semibold mb-2" style="color:#b45309">
            ⚠️ Sin validar ({{ sinValidar().length }})
          </h2>
          <p class="text-xs text-gray-500 mb-2">
            No hay datos de mercado que las respalden. Se proponen, pero el sistema lo dice.
          </p>
          @for (p of sinValidar(); track p.id) {
            <ng-container [ngTemplateOutlet]="tarjeta" [ngTemplateOutletContext]="{ $implicit: p }" />
          }
        </section>
        }
      }
    </div>

    <!-- Tarjeta de página, reutilizada por los dos grupos -->
    <ng-template #tarjeta let-p>
      <div class="bg-white rounded-lg border border-gray-200 p-4 mb-2">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-gray-900">{{ p.keyword_principal }}</p>
            <p class="text-xs text-gray-500 truncate">{{ p.url_slug }}</p>
            <p class="mt-1 text-xs text-gray-500">
              Vol: {{ p.volumen ?? 'n/d' }} · KD: {{ p.dificultad ?? 'n/d' }} · Score:
              {{ p.opportunity_score }}
            </p>
          </div>
          <span
            class="text-xs shrink-0 rounded-full px-2 py-0.5"
            [class]="p.approved ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'"
          >
            {{ p.approved ? 'Aprobada' : 'Pendiente' }}
          </span>
        </div>

        @if (auth.esEquipo()) {
          @if (editando() === p.id) {
            <div class="mt-3 space-y-2 border-t border-gray-100 pt-3">
              <input
                [ngModel]="edKeyword()"
                (ngModelChange)="edKeyword.set($event)"
                placeholder="Keyword principal"
                class="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
              />
              <input
                [ngModel]="edSlug()"
                (ngModelChange)="edSlug.set($event)"
                placeholder="/url-slug"
                class="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
              />
              <p class="text-xs text-amber-700">Editar quita la aprobación: alguien tendrá que volver a mirarla.</p>
              <div class="flex gap-2">
                <button
                  (click)="guardar(p)"
                  [disabled]="trabajando()"
                  class="rounded-md bg-gray-900 text-white px-3 py-1 text-sm hover:bg-gray-800 disabled:opacity-40"
                >
                  Guardar
                </button>
                <button (click)="editando.set(null)" class="rounded-md border px-3 py-1 text-sm">Cancelar</button>
              </div>
            </div>
          } @else {
            <div class="mt-3 flex gap-2">
              @if (!p.approved) {
                <button
                  (click)="aprobarPagina(p)"
                  [disabled]="trabajando()"
                  class="rounded-md bg-green-700 text-white px-3 py-1 text-sm hover:bg-green-800 disabled:opacity-40"
                >
                  Aprobar
                </button>
              }
              <button (click)="empezarEdicion(p)" class="rounded-md border px-3 py-1 text-sm">Editar</button>
            </div>
          }
        }
      </div>
    </ng-template>
  `,
})
export class BriefPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  /** Cada cuánto se repregunta por un research que sigue corriendo (ADR-21: polling, no realtime). */
  private static readonly POLL_MS = 4000;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** A qué run corresponde el trabajo en vuelo, y si el componente sigue vivo. Ver `vigencia.ts`. */
  private readonly vigencia = new Vigencia();
  private get runId(): string {
    return this.vigencia.actual;
  }
  readonly brief = signal<Brief | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly trabajando = signal(false);

  readonly editando = signal<string | null>(null);
  readonly edKeyword = signal('');
  readonly edSlug = signal('');

  readonly respaldadas = computed(() =>
    this.brief() ? separarPorEvidencia(this.brief()!.pages).respaldadas : [],
  );
  readonly sinValidar = computed(() =>
    this.brief() ? separarPorEvidencia(this.brief()!.pages).sinValidar : [],
  );
  readonly puedeAprobar = computed(() => (this.brief() ? puedeAprobarseRun(this.brief()!.pages) : false));

  private sub: Subscription | null = null;

  /**
   * Se SUSCRIBE al parámetro, no lee el snapshot.
   *
   * Angular **reutiliza el componente** al navegar de `/runs/A` a `/runs/B` (misma ruta): con
   * `snapshot`, `runId` se quedaba en A mientras la pantalla decía B. El polling seguía preguntando
   * por A y —lo grave— **aprobar una página en la pantalla de B iba contra el run A**.
   */
  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      const id = params.get('id') ?? '';
      if (id === this.runId) return;
      // Cambiar la vigencia ANTES de nada: lo que venga del run anterior queda obsoleto solo.
      this.vigencia.cambiarA(id);
      this.pararPolling();
      this.brief.set(null);
      this.editando.set(null);
      this.error.set('');
      void this.cargar();
    });
  }

  ngOnDestroy(): void {
    // Primero destruir la vigencia: una carga en vuelo que resuelva después NO puede crear un timer
    // nuevo (quedaría huérfano, pegándole a la API para siempre).
    this.vigencia.destruir();
    this.pararPolling();
    this.sub?.unsubscribe();
  }

  async cargar(): Promise<void> {
    const pedido = this.runId; // a qué run corresponde ESTA petición
    this.cargando.set(true);
    this.error.set('');
    try {
      const brief = await this.api.verBrief(pedido);
      if (this.vigencia.obsoleta(pedido)) return; // llegó tarde: ya es otro run, o nos fuimos
      this.brief.set(brief);
      this.ajustarPolling();
    } catch (e) {
      if (this.vigencia.obsoleta(pedido)) return;
      this.error.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(pedido)) this.cargando.set(false);
    }
  }

  /**
   * Mientras el research corre, se repregunta cada POLL_MS hasta que cambia de estado. El re-fetch
   * NO toca `cargando` (no queremos el spinner cada 4 s pisando la pantalla) ni `error` transitorio.
   */
  private ajustarPolling(): void {
    // Si el componente ya no existe, NADIE crea un timer: no habría quién lo limpie.
    if (!this.vigencia.viva) {
      this.pararPolling();
      return;
    }
    const corriendo = this.brief()?.run.status === 'running';
    if (corriendo && !this.timer) {
      this.timer = setInterval(() => void this.refetch(), BriefPage.POLL_MS);
    } else if (!corriendo) {
      this.pararPolling();
    }
  }

  private pararPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async refetch(): Promise<void> {
    const pedido = this.runId;
    try {
      const brief = await this.api.verBrief(pedido);
      if (this.vigencia.obsoleta(pedido)) return; // otro run, o ya nos fuimos
      this.brief.set(brief);
      this.ajustarPolling();
    } catch {
      /* un fallo transitorio no rompe el polling; el próximo tick reintenta */
    }
  }

  empezarEdicion(p: PaginaPropuesta): void {
    this.edKeyword.set(p.keyword_principal);
    this.edSlug.set(p.url_slug);
    this.editando.set(p.id);
  }

  private async conTrabajo(fn: () => Promise<void>): Promise<void> {
    this.trabajando.set(true);
    this.error.set('');
    try {
      await fn();
      await this.refetch(); // recarga SIN el spinner de página (la acción ya terminó)
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.trabajando.set(false);
    }
  }

  aprobarPagina(p: PaginaPropuesta): Promise<void> {
    return this.conTrabajo(() => this.api.aprobarPagina(p.id));
  }

  guardar(p: PaginaPropuesta): Promise<void> {
    const cambios = { keyword_principal: this.edKeyword(), url_slug: this.edSlug() };
    this.editando.set(null);
    return this.conTrabajo(() => this.api.editarPagina(p.id, cambios));
  }

  aprobarRun(): Promise<void> {
    return this.conTrabajo(() => this.api.aprobarRun(this.runId));
  }

  usd(micros: number): string {
    return (micros / 1_000_000).toFixed(2);
  }
}

import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ClientesService } from '../../services/clientes';
import { PageBreadcrumbComponent } from '../../shared/components/page-breadcrumb';
import {
  generarIdeasMock,
  generarPostsInstagramMock,
  generarResenasGoogleMock,
  promedioCalificacion,
  type EstadoIdea,
  type EstadoPost,
} from '../../core/cliente-vista-mock';

type TabVista = 'ideas' | 'instagram' | 'reviews';

const ETIQUETA_ESTADO_IDEA: Record<EstadoIdea, string> = {
  nueva: 'Nueva',
  en_revision: 'En revisión',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
};

/** Mismos 4 tokens semánticos que ya usan `clientes-tabla.ts`/`runs.ts` para sus propios badges de estado. */
const CLASE_ESTADO_IDEA: Record<EstadoIdea, string> = {
  nueva: 'bg-superficie-2 text-texto-medio',
  en_revision: 'bg-alerta-suave text-alerta',
  aprobada: 'bg-respaldo-suave text-respaldo',
  rechazada: 'bg-error-suave text-error',
};

const ETIQUETA_ESTADO_POST: Record<EstadoPost, string> = {
  borrador: 'Borrador',
  publicado: 'Publicado',
  programado: 'Programado',
  archivado: 'Archivado',
};

const CLASE_ESTADO_POST: Record<EstadoPost, string> = {
  borrador: 'bg-superficie-2 text-texto-medio',
  programado: 'bg-alerta-suave text-alerta',
  publicado: 'bg-respaldo-suave text-respaldo',
  archivado: 'bg-error-suave text-error',
};

/**
 * Pantalla `/clientes/:id/ver` (Etapa 5d): puerto de `pages/client-view` del origen (Angular 19 +
 * Firestore). Header con logo/nombre/industria del `ClienteAgencia` REAL (mismo patrón de carga por
 * id que `cliente-perfil.ts` — se reusa `ClientesService.verCliente`/`cliente()`/`cargando()`, no se
 * reimplementa esa lógica) + tres tabs (Ideas, Instagram, Reseñas de Google).
 *
 * **Los tres tabs son datos de EJEMPLO**, no una integración real: ni el módulo de ideas, ni
 * Instagram, ni Google Reviews tienen backend en AMG OS todavía (ver
 * `core/cliente-vista-mock.ts` y el brief de esta etapa). El contenido es el mismo para cualquier
 * cliente que abra la pantalla — no se filtra por `cliente().id` porque no hay ningún dato real del
 * que filtrar.
 *
 * Sin el botón "Generar Contenido" del origen (linkeaba a `/generate-instagram-content`, otro
 * producto fuera de todo alcance de este programa) — se omite el botón, no el tab.
 */
@Component({
  selector: 'app-cliente-vista',
  imports: [PageBreadcrumbComponent],
  template: `
    <div class="max-w-6xl mx-auto px-4 py-8 space-y-6">
      @if (clientesService.cliente(); as cliente) {
        <app-page-breadcrumb [titulo]="cliente.nombre" [rutaAtras]="'/clientes/' + cliente.id" etiquetaAtras="Volver al perfil" />

        <div class="flex items-center gap-4">
          <div
            class="w-16 h-16 rounded-lg bg-superficie-2 flex items-center justify-center text-2xl font-bold text-texto-medio"
          >
            {{ cliente.nombre.charAt(0).toUpperCase() }}
          </div>
          <div>
            <h1 class="text-2xl font-bold text-texto">{{ cliente.nombre }}</h1>
            @if (cliente.industria) {
              <p class="text-sm text-texto-tenue mt-1">{{ cliente.industria }}</p>
            }
          </div>
        </div>

        <!-- Datos de EJEMPLO — ver core/cliente-vista-mock.ts -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="bg-superficie rounded-lg border border-borde p-4">
            <p class="text-sm text-texto-tenue">Ideas</p>
            <p class="text-2xl font-bold text-texto">{{ ideas.length }}</p>
          </div>
          <div class="bg-superficie rounded-lg border border-borde p-4">
            <p class="text-sm text-texto-tenue">Posteos</p>
            <p class="text-2xl font-bold text-texto">{{ posts.length }}</p>
          </div>
          <div class="bg-superficie rounded-lg border border-borde p-4">
            <p class="text-sm text-texto-tenue">Calificación</p>
            <p class="text-2xl font-bold text-texto">{{ calificacionPromedio().toFixed(1) }}</p>
          </div>
        </div>

        <div class="border-b border-borde">
          <nav class="-mb-px flex gap-8">
            <button
              type="button"
              (click)="tabActiva.set('ideas')"
              class="pb-3 px-1 border-b-2 font-medium text-sm"
              [class.border-accion]="tabActiva() === 'ideas'"
              [class.text-texto]="tabActiva() === 'ideas'"
              [class.border-transparent]="tabActiva() !== 'ideas'"
              [class.text-texto-tenue]="tabActiva() !== 'ideas'"
            >
              Ideas
            </button>
            <button
              type="button"
              (click)="tabActiva.set('instagram')"
              class="pb-3 px-1 border-b-2 font-medium text-sm"
              [class.border-accion]="tabActiva() === 'instagram'"
              [class.text-texto]="tabActiva() === 'instagram'"
              [class.border-transparent]="tabActiva() !== 'instagram'"
              [class.text-texto-tenue]="tabActiva() !== 'instagram'"
            >
              Instagram
            </button>
            <button
              type="button"
              (click)="tabActiva.set('reviews')"
              class="pb-3 px-1 border-b-2 font-medium text-sm"
              [class.border-accion]="tabActiva() === 'reviews'"
              [class.text-texto]="tabActiva() === 'reviews'"
              [class.border-transparent]="tabActiva() !== 'reviews'"
              [class.text-texto-tenue]="tabActiva() !== 'reviews'"
            >
              Reseñas Google
            </button>
          </nav>
        </div>

        @if (tabActiva() === 'ideas') {
          <div class="space-y-4">
            <h2 class="text-lg font-semibold text-texto">Mis ideas</h2>
            @if (ideas.length > 0) {
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                @for (idea of ideas; track idea.id) {
                  <div class="bg-superficie border border-borde rounded-xl p-6">
                    <span class="inline-block px-2.5 py-1 rounded-full text-xs font-medium" [class]="claseEstadoIdea(idea.estado)">
                      {{ etiquetaEstadoIdea(idea.estado) }}
                    </span>
                    <h3 class="text-base font-semibold text-texto mt-3 mb-1">{{ idea.titulo }}</h3>
                    <p class="text-sm text-texto-tenue mb-4">{{ idea.resumen }}</p>
                    <div class="flex items-center justify-between text-xs text-texto-tenue">
                      <span>{{ formatoFecha(idea.fecha) }}</span>
                      <span>{{ idea.canales }} canales</span>
                    </div>
                  </div>
                }
              </div>
            } @else {
              <p class="text-sm text-texto-tenue py-12 text-center">No hay ideas registradas aún.</p>
            }
          </div>
        }

        @if (tabActiva() === 'instagram') {
          <div class="space-y-4">
            <h2 class="text-lg font-semibold text-texto">Posts generados</h2>
            @if (posts.length > 0) {
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                @for (post of posts; track post.id) {
                  <div class="bg-superficie border border-borde rounded-xl p-4">
                    <p class="text-sm font-semibold text-texto mb-2">{{ post.mensaje }}</p>
                    @if (post.hashtags.length > 0) {
                      <div class="flex flex-wrap gap-2 mb-3">
                        @for (hashtag of post.hashtags; track hashtag) {
                          <span class="text-xs text-accion">#{{ hashtag }}</span>
                        }
                      </div>
                    }
                    <div class="flex items-center justify-between">
                      <span class="px-2 py-1 rounded-full text-xs font-medium" [class]="claseEstadoPost(post.estado)">
                        {{ etiquetaEstadoPost(post.estado) }}
                      </span>
                      <span class="text-xs text-texto-tenue">{{ formatoFecha(post.creadoEn) }}</span>
                    </div>
                  </div>
                }
              </div>
            } @else {
              <p class="text-sm text-texto-tenue py-12 text-center">No hay posts generados aún.</p>
            }
          </div>
        }

        @if (tabActiva() === 'reviews') {
          <div class="space-y-4">
            <h2 class="text-lg font-semibold text-texto">Reseñas de Google</h2>
            @if (resenas.length > 0) {
              <div class="space-y-4">
                @for (resena of resenas; track resena.id) {
                  <div class="bg-superficie border border-borde rounded-xl p-6">
                    <div class="flex items-center justify-between mb-2">
                      <div>
                        <h3 class="font-semibold text-texto">{{ resena.autor }}</h3>
                        <p class="text-sm text-texto-tenue">{{ estrellas(resena.calificacion) }}</p>
                      </div>
                      <span class="text-sm text-texto-tenue">{{ formatoFecha(resena.fecha) }}</span>
                    </div>
                    <p class="text-texto mb-4">{{ resena.texto }}</p>
                    @if (resena.respuesta) {
                      <div class="bg-superficie-2 rounded-lg p-4 border-l-4 border-accion">
                        <p class="text-sm font-medium text-texto mb-1">Respuesta del equipo:</p>
                        <p class="text-sm text-texto-medio">{{ resena.respuesta }}</p>
                      </div>
                    } @else {
                      <p class="text-xs text-texto-tenue">Pendiente de respuesta.</p>
                    }
                  </div>
                }
              </div>
            } @else {
              <p class="text-sm text-texto-tenue py-12 text-center">No hay reseñas de Google aún.</p>
            }
          </div>
        }
      } @else if (clientesService.cargando()) {
        <p class="text-sm text-texto-tenue">Cargando…</p>
      }
    </div>
  `,
})
export class ClienteVistaPage implements OnInit, OnDestroy {
  readonly clientesService = inject(ClientesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private sub: Subscription | null = null;
  /** A qué :id corresponde el último pedido — mismo guard que `cliente-perfil.ts`. */
  private idActual = '';

  readonly tabActiva = signal<TabVista>('ideas');

  /**
   * Datos de EJEMPLO (ver `core/cliente-vista-mock.ts`): no dependen del `:id` de la ruta porque no
   * hay ningún dato real de ideas/Instagram/reviews del que filtrar todavía. Se generan una vez por
   * instancia de esta pantalla, mismo criterio que `CarteraPage` con `generarCarteraMock()`.
   */
  readonly ideas = generarIdeasMock();
  readonly posts = generarPostsInstagramMock();
  readonly resenas = generarResenasGoogleMock();

  /** Stat del header: se calcula del array MOCK, no de ningún campo de `ClienteAgencia` (no tiene ninguno de ideas/reviews). */
  readonly calificacionPromedio = computed(() => promedioCalificacion(this.resenas));

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      const id = params.get('id') ?? '';
      if (id === this.idActual) return;
      this.idActual = id;
      void this.cargar(id);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  private async cargar(id: string): Promise<void> {
    if (!id) {
      await this.router.navigate(['/clientes']);
      return;
    }
    await this.clientesService.verCliente(id);
    if (id !== this.idActual) return;
    if (!this.clientesService.cliente()) {
      await this.router.navigate(['/clientes']);
    }
  }

  formatoFecha(iso: string): string {
    const fecha = new Date(iso);
    if (Number.isNaN(fecha.getTime())) return iso;
    return fecha.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  }

  estrellas(calificacion: number): string {
    const llenas = Math.max(0, Math.min(5, Math.round(calificacion)));
    return '★'.repeat(llenas) + '☆'.repeat(5 - llenas);
  }

  etiquetaEstadoIdea(e: EstadoIdea): string {
    return ETIQUETA_ESTADO_IDEA[e];
  }

  claseEstadoIdea(e: EstadoIdea): string {
    return CLASE_ESTADO_IDEA[e];
  }

  etiquetaEstadoPost(e: EstadoPost): string {
    return ETIQUETA_ESTADO_POST[e];
  }

  claseEstadoPost(e: EstadoPost): string {
    return CLASE_ESTADO_POST[e];
  }
}

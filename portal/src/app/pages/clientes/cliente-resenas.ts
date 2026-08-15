import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
import { ClientesService } from '../../services/clientes';
import { MembresiaService } from '../../services/membresia';
import type { ResenaGoogle } from '../../core/models';
import { Vigencia } from '../../core/vigencia';

/**
 * Tab `/clientes/:id/resenas`: las reseñas de Google del cliente, en el orden que ya fija el SQL de
 * `PgResenas.listarResenas` (1-3★ sin ver primero, más nueva después). Este componente no reordena
 * NADA — reordenar acá sería el mismo error que ya corrigió la migración 0015 para `kr_pages`.
 *
 * **De dónde sale `conectado`, y por qué NO hay un segundo `GET /clients/:id`.** El cliente ya lo
 * carga el shell (`cliente-ficha.ts`) en `ClientesService.cliente()`, con su propia guardia de
 * vigencia (`#idVigente`). Más importante todavía: la ficha solo monta el `<router-outlet>` —donde
 * este tab vive— cuando `clientesService.cliente()` es verdadero (`@if (clientesService.cliente();
 * as cliente) { … <router-outlet /> … }`), así que por construcción este componente nunca se crea
 * antes de que el cliente correcto esté cargado. Pedir `GET /clients/:id` DE NUEVO acá sería un
 * segundo viaje redundante y una segunda carrera para resolver — mismo criterio que
 * `cliente-research.ts` documenta para el cliente en sí: "El cliente NO se vuelve a pedir acá".
 *
 * **Las reseñas sí son un pedido propio**, con la misma guardia de `Vigencia` que `cliente-ideas.ts`:
 * el `:id` del padre puede seguir cambiando mientras un `GET /clients/:id/resenas` sigue en vuelo.
 *
 * **De dónde sale el `:id`.** De `route.paramMap`, gracias al `paramsInheritanceStrategy: 'always'`
 * de `app.config.ts` — mismo patrón que `cliente-ideas.ts`/`cliente-research.ts`, y no
 * `route.parent.paramMap`: ese nivel ya no hace falta con la herencia activada.
 */
@Component({
  selector: 'app-cliente-resenas',
  template: `
    <div class="space-y-4">
      <div class="flex items-center justify-between gap-3">
        <!-- <h1> y no <h2>: esta pantalla es una HOJA de la ruta, la ficha es el contenedor. -->
        <h1 class="text-sm font-semibold text-texto">Reseñas de Google</h1>
        @if (conectado() && membresia.esEquipo()) {
          <button
            type="button"
            (click)="desconectar()"
            class="text-xs text-error shrink-0 hover:underline"
          >
            Desconectar Google
          </button>
        }
      </div>

      @if (cargando()) {
        <p class="text-sm text-texto-tenue">Cargando reseñas…</p>
      } @else if (error()) {
        <div class="bg-error-suave rounded-xl border border-borde p-6">
          <p class="text-sm text-error">{{ error() }}</p>
        </div>
      } @else if (!conectado()) {
        <div class="bg-superficie rounded-xl border border-borde p-8 text-center">
          <p class="text-sm text-texto-tenue max-w-md mx-auto">
            Este cliente todavía no conectó su Google Business Profile.
          </p>
          @if (membresia.esEquipo()) {
            <button
              type="button"
              (click)="conectar()"
              class="mt-4 rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              Conectar Google
            </button>
          }
        </div>
      } @else if (resenas().length === 0) {
        <p class="text-sm text-texto-tenue">Todavía no hay reseñas.</p>
      } @else {
        <ul class="space-y-3">
          @for (r of resenas(); track r.id) {
            <li
              class="bg-superficie rounded-xl border border-borde p-4"
              [class.border-error]="r.puntuacion <= 3 && !r.vistaEn"
            >
              <div class="flex items-center justify-between gap-3">
                <span class="text-sm font-medium text-texto">{{ r.autor }} — {{ r.puntuacion }}★</span>
                @if (!r.vistaEn) {
                  <button
                    type="button"
                    (click)="verla(r)"
                    class="text-xs text-error shrink-0 hover:underline"
                  >
                    sin ver
                  </button>
                }
              </div>
              @if (r.texto) {
                <p class="mt-1 text-sm text-texto-medio">{{ r.texto }}</p>
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class ClienteResenasPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly clientesService = inject(ClientesService);
  // El rol sale de `memberships`, no del token: ver la cabecera de `MembresiaService`.
  readonly membresia = inject(MembresiaService);

  /** A qué cliente corresponde el `GET /clients/:id/resenas` en vuelo. Ver `core/vigencia.ts`. */
  private readonly vigencia = new Vigencia();

  /** El cliente del que es esta pantalla. Viene del `:id` del shell — ver `paramsInheritanceStrategy`. */
  readonly clienteId = signal('');

  readonly resenas = signal<ResenaGoogle[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');

  /**
   * `true` si el cliente conectó su Google Business Profile — leído DIRECTO de lo que ya cargó la
   * ficha, sin ningún pedido propio. Ver el docblock de la clase.
   */
  readonly conectado = computed(() => this.clientesService.cliente()?.google_conectado_en != null);

  private sub: Subscription | null = null;

  ngOnInit(): void {
    // Suscripción y no un `ngOnInit` a secas: Angular puede reutilizar la instancia del tab al saltar
    // entre clientes sin desmontarlo antes de la próxima emisión — mismo motivo que en research/ideas.
    this.sub = this.route.paramMap.subscribe((params) => {
      const id = params.get('id') ?? '';
      if (id === this.vigencia.actual) return;
      this.vigencia.cambiarA(id);
      this.clienteId.set(id);
      // Las reseñas del cliente anterior no son de éste: vaciarlas antes de pedir evita mostrar
      // trabajo ajeno mientras la respuesta viaja.
      this.resenas.set([]);
      this.error.set('');
      void this.cargar(id);
    });
  }

  ngOnDestroy(): void {
    this.vigencia.destruir();
    this.sub?.unsubscribe();
  }

  /** `pedido` es el cliente al que corresponde ESTA carga, capturado antes del `await`. */
  private async cargar(pedido: string): Promise<void> {
    // Sin cliente, o sin conexión con Google, no hay nada que pedir: `conectado()` ya lo sabe SIN red
    // (lo carga el shell), así que esto evita un `GET /clients/:id/resenas` que la base respondería
    // con una lista vacía igual — no es una optimización cosmética, es no inventar un pedido.
    if (!pedido || !this.conectado()) {
      this.cargando.set(false);
      return;
    }
    this.cargando.set(true);
    try {
      const resenas = await this.api.listarResenas(pedido);
      if (this.vigencia.obsoleta(pedido)) return; // llegó tarde: ya es otro cliente, o nos fuimos
      this.resenas.set(resenas);
    } catch (e) {
      if (this.vigencia.obsoleta(pedido)) return;
      this.error.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(pedido)) this.cargando.set(false);
    }
  }

  /** Navega DE VERDAD a la URL de consentimiento — no es un `fetch` que espere JSON de Google. */
  async conectar(): Promise<void> {
    const { url } = await this.api.conectarGoogle(this.clienteId());
    window.location.href = url;
  }

  /**
   * Desconecta la cuenta de Google del cliente (limpia las tres columnas en `clients`) y refresca
   * `clientesService.cliente()` para que `conectado()` vuelva a `false` y el tab muestre el CTA de
   * "Conectar Google" de nuevo. A diferencia de `conectar()`, acá no hay navegación de por medio que
   * fuerce una recarga sola: este tab nunca vuelve a pedir el cliente por su cuenta (ver el docblock
   * de la clase), así que el refresco de `cliente()` es explícito.
   */
  async desconectar(): Promise<void> {
    await this.api.desconectarGoogle(this.clienteId());
    this.resenas.set([]);
    this.error.set('');
    await this.clientesService.verCliente(this.clienteId());
  }

  /** Marca una reseña como vista y actualiza la lista local, sin volver a pedir todo el listado. */
  async verla(r: ResenaGoogle): Promise<void> {
    if (r.vistaEn) return;
    await this.api.marcarResenaVista(this.clienteId(), r.id);
    this.resenas.update((rs) =>
      rs.map((x) => (x.id === r.id ? { ...x, vistaEn: new Date().toISOString() } : x)),
    );
  }
}

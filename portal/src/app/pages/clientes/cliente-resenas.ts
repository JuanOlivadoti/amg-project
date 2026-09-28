import { DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
import { ClientesService } from '../../services/clientes';
import { MembresiaService } from '../../services/membresia';
import type { ResenaGoogle } from '../../core/models';
import { Vigencia } from '../../core/vigencia';
import { esLocationIdInvalido, type ApiError } from '../../core/api-core';

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
  imports: [DatePipe],
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
            <!--
              Campo OPCIONAL: vacío = que el backend descubra la ficha solo (el camino por defecto,
              y el único que vuelve a funcionar cuando Google conceda la cuota). El texto de ayuda
              existe porque la consola de Google MUESTRA el id suelto, y la API v4 direcciona por el
              nombre de recurso completo: quien copia lo primero que ve pega el valor equivocado.
            -->
            <div class="mx-auto mt-4 max-w-md text-left">
              <label for="ficha-google" class="block text-xs font-medium text-texto">
                Nombre de recurso de la ficha (opcional)
              </label>
              <input
                id="ficha-google"
                type="text"
                class="mt-1 w-full rounded-md border border-borde bg-fondo p-2 text-sm text-texto"
                placeholder="accounts/123456789/locations/987654321"
                [value]="ficha()"
                (input)="ficha.set($any($event.target).value)"
              />
              <p class="mt-1 text-xs text-texto-tenue">
                Se copia de la consola de Google Business Profile, y es el nombre COMPLETO
                <code class="text-texto-medio">accounts/&lt;id&gt;/locations/&lt;id&gt;</code>, no el
                id suelto que se ve en pantalla. Si se deja vacío, se intenta descubrir la ficha
                automáticamente.
              </p>
              @if (errorFicha()) {
                <p class="mt-2 text-xs text-error">{{ errorFicha() }}</p>
              }
            </div>
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
              @if (r.puntuacion >= 4) {
                @if (membresia.esEquipo()) {
                  <textarea
                    class="mt-2 w-full rounded-md border border-borde bg-fondo p-2 text-sm text-texto"
                    rows="3"
                    placeholder="Sin borrador todavía — escribí la respuesta acá"
                    [value]="borradorEditado(r)"
                    (input)="editarBorradorLocal(r.id, $any($event.target).value)"
                  ></textarea>
                  <button
                    type="button"
                    (click)="guardarBorrador(r)"
                    class="mt-2 rounded-md bg-accion text-texto-invertido px-3 py-1.5 text-xs font-medium hover:opacity-90"
                  >
                    Guardar
                  </button>
                  <!-- Publicar solo tiene sentido si hay borrador: no tiene sentido publicar un
                       borrador vacío -- "Guardar" ya existe para escribirlo primero. -->
                  @if (r.borradorRespuesta) {
                    @if (r.respuestaPublicadaEn) {
                      <p class="mt-2 text-xs text-texto-tenue">
                        Publicada el {{ r.respuestaPublicadaEn | date: 'short' }}
                      </p>
                    } @else if (r.respuestaSolicitadaEn) {
                      <button
                        type="button"
                        (click)="publicar(r)"
                        class="mt-2 rounded-md border border-borde text-texto px-3 py-1.5 text-xs font-medium hover:opacity-90"
                      >
                        Reintentar publicación
                      </button>
                    } @else {
                      <button
                        type="button"
                        (click)="publicar(r)"
                        class="mt-2 rounded-md bg-accion text-texto-invertido px-3 py-1.5 text-xs font-medium hover:opacity-90"
                      >
                        Publicar respuesta
                      </button>
                    }
                  }
                } @else if (r.borradorRespuesta) {
                  <p class="mt-2 text-sm text-texto-medio">{{ r.borradorRespuesta }}</p>
                } @else {
                  <p class="mt-2 text-xs text-texto-tenue">Sin borrador todavía.</p>
                }
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
   * El nombre de recurso de la ficha de Google, pegado a mano. Vacío = descubrimiento automático.
   *
   * Existe porque las dos APIs de Google que hacen falta para descubrir la ficha están en **cuota 0**
   * con un trámite sin fecha, así que el descubrimiento automático hoy devuelve 429 siempre. No
   * reemplaza al automático: lo puentea mientras tanto.
   */
  readonly ficha = signal('');

  /**
   * El error del FORMULARIO de la ficha, separado de `error()` a propósito. El motivo largo está en
   * el docblock de `conectar()`; el corto: `error()` se lleva puesto el CTA, y este error hay que
   * poder corregirlo sin perder el botón ni lo escrito.
   */
  readonly errorFicha = signal('');

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
      this.ediciones.set({});
      this.error.set('');
      // La ficha es del cliente que se está mirando, no de la pantalla: arrastrarla al siguiente
      // conectaría la ficha EQUIVOCADA, y el backend no tendría cómo saberlo — el valor sería
      // exactamente el que le pidieron.
      this.ficha.set('');
      this.errorFicha.set('');
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

  /**
   * Navega DE VERDAD a la URL de consentimiento — no es un `fetch` que espere JSON de Google.
   *
   * El `try/catch` no es ceremonia: desde el 2026-09-10 este endpoint puede responder **409** cuando
   * el despliegue es de producción y el módulo está en `GOOGLE_REVIEWS_MODO=mock` (el guardarraíl
   * que impide sembrar reseñas inventadas en la base real). Sin capturarlo, la promesa se rechaza sin
   * que nadie la mire y el botón **no hace nada visible**: el peor resultado posible para un
   * guardarraíl, porque quien lo pulsa concluye que la app está rota en vez de leer el motivo.
   *
   * Mismo patrón que `cargar()`: el mensaje del servidor va al signal `error`, que la plantilla ya
   * pinta. No se ramifica por código de error a propósito — no hay nada que decidir, solo que mostrar.
   *
   * **Efecto que conviene saber**: poner `error` además **se lleva puesto el CTA**, porque las ramas
   * de la plantilla son excluyentes (`@else if (error())` viene ANTES de `@else if (!conectado())`) y
   * el error solo se limpia al cambiar de cliente. Para este 409 es lo correcto —va a seguir
   * rechazando hasta que cambie la configuración del despliegue, así que dejar el botón invitaría a
   * pulsarlo en vano—, pero no es lo que uno espera de un "mostrá el error" genérico. Lo señaló el
   * `revisor`.
   *
   * **Y por eso el 400 NO va al mismo lado.** Desde que existe el campo de ficha, este endpoint
   * puede responder **400** cuando el nombre de recurso pegado no tiene la forma
   * `accounts/<id>/locations/<id>`. Ese error es de otra naturaleza que el 409: no es una decisión
   * del despliegue que la persona no puede cambiar, es **un valor que acaba de escribir y puede
   * corregir ahí mismo**. Mandarlo a `error()` le borraría el CTA y el campo —incluido lo que
   * escribió—, y la única salida sería cambiar de cliente y volver. Va a `errorFicha()`, que la
   * plantilla pinta DENTRO del formulario, sin tocar las ramas excluyentes.
   *
   * Se ramifica por el **código** (`esLocationIdInvalido`), no por el texto ni por el status, que es
   * la regla de `core/codigos.ts`: el mensaje se corrige el día que a alguien le molesta una tilde, y
   * el status lo comparte con cualquier otro 400 que este endpoint gane después — confundirlos
   * mandaría a corregir la ficha cuando lo que está mal es otra cosa.
   */
  async conectar(): Promise<void> {
    this.errorFicha.set('');
    try {
      const { url } = await this.api.conectarGoogle(this.clienteId(), this.ficha());
      window.location.href = url;
    } catch (e) {
      const err = e as ApiError;
      if (esLocationIdInvalido(err)) {
        this.errorFicha.set(err.message);
        return;
      }
      this.error.set(err.message);
    }
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

  /**
   * Pide publicar el borrador de vuelta en Google (Bloque F, fase 2, segunda pieza) y actualiza el
   * estado local a "solicitada" de inmediato — mismo criterio optimista que `verla()`. La
   * confirmación real de `respuestaPublicadaEn` llega en el próximo `GET /clients/:id/resenas`
   * completo (al volver a esta pantalla o cambiar de cliente): no hace falta agregar polling nuevo.
   */
  async publicar(r: ResenaGoogle): Promise<void> {
    await this.api.publicarRespuestaResena(this.clienteId(), r.id);
    this.resenas.update((rs) =>
      rs.map((x) => (x.id === r.id ? { ...x, respuestaSolicitadaEn: new Date().toISOString() } : x)),
    );
  }

  /**
   * Texto editado localmente por reseña, antes de guardar. Sin entrada = todavía no se tocó, y el
   * textarea muestra `r.borradorRespuesta` (o vacío si no hay). Un `Record`, no un `Map`, para que
   * el template lo lea directo sin volver a envolver la lectura en un método aparte por cada uso.
   */
  private readonly ediciones = signal<Record<string, string>>({});

  /** El texto que ve el textarea de esta reseña: lo editado localmente, o lo que ya trae el servidor. */
  borradorEditado(r: ResenaGoogle): string {
    return this.ediciones()[r.id] ?? r.borradorRespuesta ?? '';
  }

  editarBorradorLocal(resenaId: string, texto: string): void {
    this.ediciones.update((m) => ({ ...m, [resenaId]: texto }));
  }

  /** Guarda el borrador editado y actualiza la fila local, sin volver a pedir todo el listado. */
  async guardarBorrador(r: ResenaGoogle): Promise<void> {
    const texto = this.borradorEditado(r);
    await this.api.editarBorradorResena(this.clienteId(), r.id, texto);
    this.resenas.update((rs) => rs.map((x) => (x.id === r.id ? { ...x, borradorRespuesta: texto } : x)));
  }
}

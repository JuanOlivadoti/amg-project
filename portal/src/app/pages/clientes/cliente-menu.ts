import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
import { ClientesService } from '../../services/clientes';
import type { MenuCategoria, MenuItem } from '../../core/models';
import { Vigencia } from '../../core/vigencia';

/**
 * El tab Menú de la ficha del cliente: `/clientes/:id/menu`. Lista las categorías y, debajo de cada
 * una, sus platos, con alta/borrado de categorías y borrado de platos. La edición completa de UN
 * plato (todos los campos del menú enriquecido) vive en `cliente-menu-detalle.ts` — esta pantalla
 * solo linkea ahí.
 *
 * **La identidad de un plato es su POSICIÓN en `platos()`**, no un id persistente (`MenuItem` no
 * tiene uno — ver el spec). El link "Agregar plato" apunta al índice `platos().length`: uno pasado
 * el final, que `cliente-menu-detalle.ts` interpreta como "plato nuevo" en vez de "editar el
 * existente en esa posición".
 *
 * Cada mutación (borrar plato, agregar/borrar categoría) guarda de inmediato con
 * `api.guardarMenu()` — no hay un botón "Guardar" aparte para estas acciones de lista, a diferencia
 * del formulario de detalle, donde sí lo hay porque ahí se editan muchos campos a la vez. La
 * excepción es `foto`/`orden` de categoría: son dos campos relacionados que se aplican juntos, así
 * que llevan su propio botón "Guardar" por fila (mismo criterio que el formulario de detalle).
 *
 * Mientras un `guardar()` está en vuelo, `guardando()` deshabilita los botones que disparan otro
 * guardado (borrar categoría, borrar plato, agregar categoría, guardar foto/orden) para que la MISMA
 * persona no dispare dos guardados solapados sin querer — el link "Agregar plato" no se deshabilita
 * porque navega, no guarda. Esto no reemplaza `last-write-wins` (la política aceptada para dos
 * personas editando a la vez), es una salvaguarda distinta para el doble-click de una sola persona.
 */
@Component({
  selector: 'app-cliente-menu',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="space-y-6">
      <h1 class="sr-only">{{ tituloSeccion() }}</h1>

      @if (cargando()) {
        <p class="text-sm text-texto-tenue">Cargando…</p>
      } @else if (error()) {
        <p class="text-sm text-error">{{ error() }}</p>
      } @else {
        <section class="space-y-3">
          <h2 class="text-sm font-medium text-texto">Categorías</h2>
          <ul class="space-y-2">
            @for (cat of categoriasOrdenadas(); track cat.nombre; let i = $index) {
              <li class="flex flex-wrap items-end justify-between gap-3 bg-superficie rounded-lg border border-borde p-3">
                <span class="text-sm text-texto">{{ cat.nombre }}</span>
                <div class="flex items-end gap-2">
                  <div>
                    <label [for]="'cat-foto-' + i" class="block text-xs text-texto-tenue">Foto (URL)</label>
                    <input
                      [id]="'cat-foto-' + i"
                      [attr.name]="'cat-foto-' + i"
                      #fotoInput
                      [value]="cat.foto?.src ?? ''"
                      class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label [for]="'cat-orden-' + i" class="block text-xs text-texto-tenue">Orden</label>
                    <input
                      [id]="'cat-orden-' + i"
                      [attr.name]="'cat-orden-' + i"
                      #ordenInput
                      type="number"
                      [value]="cat.orden ?? ''"
                      class="w-20 rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    class="cta"
                    [disabled]="guardando()"
                    (click)="actualizarCategoria(cat.nombre, fotoInput.value, ordenInput.value)"
                  >
                    Guardar
                  </button>
                  <button
                    type="button"
                    class="text-xs text-error disabled:text-texto-tenue disabled:cursor-not-allowed"
                    [disabled]="platosDeCategoria(cat.nombre).length > 0 || guardando()"
                    [title]="
                      platosDeCategoria(cat.nombre).length > 0
                        ? 'Reasigná o borrá primero los ' + platosDeCategoria(cat.nombre).length + ' platos de esta categoría'
                        : ''
                    "
                    (click)="borrarCategoria(cat.nombre)"
                  >
                    Borrar categoría
                  </button>
                </div>
              </li>
            }
          </ul>

          <form class="flex items-end gap-2" (submit)="agregarCategoria($event)">
            <div>
              <label for="nuevaCategoriaNombre" class="block text-xs text-texto-tenue">Nueva categoría</label>
              <input
                id="nuevaCategoriaNombre"
                name="nuevaCategoriaNombre"
                [ngModel]="nuevaCategoriaNombre()"
                (ngModelChange)="nuevaCategoriaNombre.set($event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <button type="submit" class="cta" [disabled]="!nuevaCategoriaNombre().trim() || guardando()">Agregar categoría</button>
          </form>
        </section>

        <section class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-medium text-texto">{{ esSeguros() ? 'Pólizas' : 'Platos' }}</h2>
            <a [routerLink]="['/clientes', clienteId(), 'menu', platos().length]" class="cta">
              {{ esSeguros() ? 'Agregar póliza' : 'Agregar plato' }}
            </a>
          </div>

          @if (platos().length === 0) {
            <p class="text-sm text-texto-tenue">
              {{ esSeguros() ? 'Todavía no hay pólizas cargadas.' : 'Todavía no hay platos cargados.' }}
            </p>
          } @else {
            @for (grupo of gruposDePlatos(); track grupo.nombre) {
              <div class="space-y-2">
                <h3 class="text-xs uppercase text-texto-tenue">{{ grupo.nombre }}</h3>
                <ul class="space-y-2">
                  @for (entrada of grupo.entradas; track entrada.indice) {
                    <li class="flex items-center justify-between gap-3 bg-superficie rounded-lg border border-borde p-3">
                      <a [routerLink]="['/clientes', clienteId(), 'menu', entrada.indice]" class="text-sm text-texto">
                        {{ entrada.plato.name }}
                      </a>
                      <button
                        type="button"
                        class="text-xs text-error disabled:text-texto-tenue disabled:cursor-not-allowed"
                        [disabled]="guardando()"
                        (click)="borrarPlato(entrada.indice)"
                      >
                        Borrar
                      </button>
                    </li>
                  }
                </ul>
              </div>
            }
          }
        </section>
      }
    </div>
  `,
})
export class ClienteMenuPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly clientesService = inject(ClientesService);

  private readonly vigencia = new Vigencia();

  /** `true` para un cliente de correduría de seguros — condiciona TODO el copy visible de esta
   *  pantalla (el `<h1>` `sr-only`, el `<h2>` "Platos"/"Pólizas", el link "Agregar plato"/"Agregar
   *  póliza" y el estado vacío), mismo criterio que `esSeguros` en `cliente-menu-detalle.ts`. Lee del
   *  mismo `ClientesService` que ya popula `ClienteFichaComponent` al cargar la ficha, así que para
   *  cuando esta pantalla monta el dato ya está disponible. */
  readonly esSeguros = computed(() => this.clientesService.cliente()?.vertical === 'correduria_seguros');

  /** El `<h1>` (oculto, `sr-only`) según el `vertical` del cliente — mismo criterio que el tab de la
   *  ficha (`cliente-ficha.ts`): "Menú" para restauración, "Pólizas y coberturas" para correduría de
   *  seguros. */
  readonly tituloSeccion = computed(() => (this.esSeguros() ? 'Pólizas y coberturas' : 'Menú'));

  readonly clienteId = signal('');
  readonly menu = signal<MenuItem[]>([]);
  readonly categorias = signal<MenuCategoria[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly nuevaCategoriaNombre = signal('');
  readonly guardando = signal(false);

  private sub: Subscription | null = null;

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      const id = params.get('id') ?? '';
      if (id === this.vigencia.actual) return;
      this.vigencia.cambiarA(id);
      this.clienteId.set(id);
      this.menu.set([]);
      this.categorias.set([]);
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
      const carta = await this.api.obtenerMenu(pedido);
      if (this.vigencia.obsoleta(pedido)) return;
      this.menu.set(carta.menu);
      this.categorias.set(carta.menu_categorias);
      // Sin esto, un `guardar()` fallido (borrar plato, alta/baja de categoría) deja `error()` seteado
      // para siempre: su `catch` llama a `cargar()` para resincronizar, pero si ESTA carga sale bien
      // nadie más lo limpia — `ngOnInit` solo lo hace cuando cambia el `:id` de la ruta — y el `@else
      // if (error())` del template tapa la lista aunque los datos ya estén al día.
      this.error.set('');
    } catch (e) {
      if (this.vigencia.obsoleta(pedido)) return;
      this.error.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(pedido)) this.cargando.set(false);
    }
  }

  /**
   * `true` si una mutación llegó MIENTRAS un `guardar()` seguía en vuelo: no alcanza con descartar
   * esa segunda llamada (ver el comentario largo en `guardar()`), hay que mandarla apenas el primer
   * guardado termine. Plano, no signal: nadie lo lee del template, es contabilidad interna de
   * `guardar()`.
   */
  private guardarPendiente = false;

  /**
   * Guarda la carta actual (`menu()` + `categorias()`) y refleja el resultado en la UI.
   *
   * **El `if` de acá abajo, no el `[disabled]` del template, es la constraint real.** Se encontró
   * manejando la app (no en Karma): con `eventCoalescing` la escritura del atributo `disabled` en el
   * DOM queda detrás de un límite de macrotarea — un doble click genuino (dos eventos `click`
   * separados por menos que eso) puede procesar el segundo ANTES de que el botón se vea deshabilitado,
   * y las dos llamadas dispararían dos `guardar()` superpuestos. La lectura de un signal, en cambio,
   * es sincrónica y no depende de que corra un ciclo de detección de cambios: por eso el guard vive
   * acá, en el único punto por el que pasan las cuatro mutaciones, y el `[disabled]` del template
   * queda como lo que siempre fue tratado en este proyecto — UX, no la garantía.
   *
   * **Bloquear el segundo `guardar()` NO alcanza — hay que encolarlo.** Las cuatro mutaciones
   * (`borrarPlato`, `borrarCategoria`, `agregarCategoria`, `actualizarCategoria`) tocan `this.menu`/
   * `this.categorias` ANTES de llamar acá: si el `borrarPlato(0)` del segundo click corre mientras el
   * primero sigue en vuelo, ya sacó un plato DISTINTO del array (el que quedó en el índice 0 después
   * del primer borrado) antes de que este `if` lo frene. Descartar esa segunda llamada sin más deja
   * el estado local con DOS platos menos y al servidor enterado de solo UNO — una divergencia
   * silenciosa que un simple `reload` deja a la vista (encontrado por revisión de código, verificado
   * con un test que reproduce la secuencia exacta antes de este arreglo). Por eso, si termina un
   * guardado y quedó una mutación pendiente, se dispara OTRO `guardar()` que capture `this.menu()`/
   * `this.categorias()` en su estado ACTUAL (ya con las dos mutaciones aplicadas) — un guardado más
   * por el terminado, no uno por click: sigue siendo coalescing, no reintento por mutación.
   */
  private async guardar(): Promise<void> {
    if (this.guardando()) {
      this.guardarPendiente = true; // hay una mutación más nueva que la que ya está en vuelo
      return;
    }
    this.guardando.set(true);
    const clienteId = this.clienteId();
    const carta = { menu: this.menu(), menu_categorias: this.categorias() };
    try {
      await this.api.guardarMenu(clienteId, carta);
      if (this.vigencia.obsoleta(clienteId)) return;
      this.error.set('');
    } catch (e) {
      if (this.vigencia.obsoleta(clienteId)) return;
      this.error.set((e as Error).message);
      // Recargar desde el servidor: el estado local pudo quedar adelantado a lo que en verdad se
      // guardó, y mostrar un plato "borrado" que en realidad sigue ahí sería peor que recargar. No
      // se reintenta la pendiente automáticamente tras un error: `cargar()` va a resincronizar
      // `this.menu()`/`this.categorias()` con lo que el servidor tiene de verdad.
      void this.cargar(clienteId);
      return;
    } finally {
      // Sin condicionar a `vigencia`: es el flag de "hay un guardado en vuelo de ESTA instancia",
      // no un dato que dependa de a qué cliente corresponde — a diferencia de `error`/`cargando`.
      this.guardando.set(false);
    }
    if (this.guardarPendiente) {
      this.guardarPendiente = false;
      void this.guardar(); // captura el estado ACTUAL, que ya incluye lo que se mutó mientras esperábamos
    }
  }

  platos(): MenuItem[] {
    return this.menu();
  }

  platosDeCategoria(nombre: string): MenuItem[] {
    return this.menu().filter((p) => p.category === nombre);
  }

  /**
   * `orden` ausente va al FINAL, no al principio: mismo criterio que el render público
   * (`web-builder/src/render/piezas/carta-categorias.ts`), que trata la ausencia como
   * `Number.POSITIVE_INFINITY` a propósito — mezclar "sin `orden`" con "`orden: 0`" reordenaría
   * categorías que nadie tocó. Una categoría recién creada por `agregarCategoria()` no lleva `orden`,
   * así que sin esto podía saltar antes de una categoría existente con `orden` explícito en el editor,
   * mientras en el sitio publicado seguía yendo al final: dos pantallas mostrando dos órdenes
   * distintos del mismo dato. El `sort` de JS es estable desde ES2019, así que dos categorías sin
   * `orden` conservan su posición relativa en `menu_categorias`; esto NO es exactamente el mismo
   * desempate que usa el renderer (que ordena por primera aparición en `menu`, los platos, no por
   * posición en `menu_categorias`), así que una categoría sin platos o con el primer plato en otro
   * orden puede mostrarse en un orden distinto acá que en el sitio publicado — caso de borde
   * aceptado, no corregido en esta etapa.
   */
  categoriasOrdenadas(): MenuCategoria[] {
    return [...this.categorias()].sort(
      (a, b) => (a.orden ?? Number.POSITIVE_INFINITY) - (b.orden ?? Number.POSITIVE_INFINITY),
    );
  }

  /** Agrupa los platos por categoría, en el orden de `categoriasOrdenadas()`, y agrega al final un
   *  grupo "Sin categoría" para los que no matchean ninguna — mismo criterio de tolerancia que el
   *  render público (`carta-categorias.ts`): un plato huérfano se sigue viendo, agrupado aparte. */
  gruposDePlatos(): Array<{ nombre: string; entradas: Array<{ indice: number; plato: MenuItem }> }> {
    const nombresConocidos = new Set(this.categoriasOrdenadas().map((c) => c.nombre));
    const conIndice = this.menu().map((plato, indice) => ({ indice, plato }));

    const grupos = this.categoriasOrdenadas().map((cat) => ({
      nombre: cat.nombre,
      entradas: conIndice.filter((e) => e.plato.category === cat.nombre),
    }));

    const huerfanos = conIndice.filter((e) => !e.plato.category || !nombresConocidos.has(e.plato.category));
    if (huerfanos.length > 0) grupos.push({ nombre: 'Sin categoría', entradas: huerfanos });

    // Sin filtro adicional: `grupos` ya son exactamente las categorías conocidas (con o sin platos)
    // más, si corresponde, "Sin categoría" — que solo se empuja arriba cuando tiene entradas.
    return grupos;
  }

  agregarCategoria(evento: Event): void {
    evento.preventDefault();
    const nombre = this.nuevaCategoriaNombre().trim();
    if (!nombre) return;
    // Nombre duplicado (insensible a mayúsculas/espacios): no se agrega. `borrarCategoria` filtra por
    // `c.nombre !== nombre`, así que dos categorías con el mismo nombre no se pueden borrar una sin la
    // otra — permitir el alta duplicada dejaría sin forma de deshacerla. El input queda como está para
    // que quien lo escribió elija otro nombre.
    const yaExiste = this.categorias().some((c) => c.nombre.trim().toLowerCase() === nombre.toLowerCase());
    if (yaExiste) return;
    this.categorias.set([...this.categorias(), { nombre }]);
    this.nuevaCategoriaNombre.set('');
    void this.guardar();
  }

  borrarCategoria(nombre: string): void {
    if (this.platosDeCategoria(nombre).length > 0) return; // el botón ya está disabled — defensa
    this.categorias.set(this.categorias().filter((c) => c.nombre !== nombre));
    void this.guardar();
  }

  borrarPlato(indice: number): void {
    this.menu.set(this.menu().filter((_, i) => i !== indice));
    void this.guardar();
  }

  /**
   * Aplica `foto`/`orden` juntos a la categoría `nombre` y guarda. Reemplaza el objeto categoría
   * ENTERO (no hace merge parcial) — coherente con "el PATCH reemplaza el array completo": si el
   * campo Foto queda vacío al guardar, la categoría se queda sin foto, no conserva la vieja en
   * silencio. Mismo estilo de construcción condicional de claves que `platoDesdeFormulario` en
   * `cliente-menu-detalle.ts`: nunca `foto: undefined` explícito, se omite la clave si no hay valor.
   */
  actualizarCategoria(nombre: string, fotoSrc: string, ordenTexto: string): void {
    const orden = ordenTexto.trim() !== '' ? Number(ordenTexto) : NaN;
    this.categorias.set(
      this.categorias().map((c) => {
        if (c.nombre !== nombre) return c;
        const actualizada: MenuCategoria = { nombre: c.nombre };
        if (fotoSrc.trim()) actualizada.foto = { src: fotoSrc.trim() };
        if (Number.isFinite(orden)) actualizada.orden = orden;
        return actualizada;
      }),
    );
    void this.guardar();
  }
}

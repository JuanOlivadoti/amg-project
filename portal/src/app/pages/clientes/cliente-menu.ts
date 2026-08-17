import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
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
 * del formulario de detalle, donde sí lo hay porque ahí se editan muchos campos a la vez.
 */
@Component({
  selector: 'app-cliente-menu',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="space-y-6">
      <h1 class="sr-only">Menú</h1>

      @if (cargando()) {
        <p class="text-sm text-texto-tenue">Cargando…</p>
      } @else if (error()) {
        <p class="text-sm text-error">{{ error() }}</p>
      } @else {
        <section class="space-y-3">
          <h2 class="text-sm font-medium text-texto">Categorías</h2>
          <ul class="space-y-2">
            @for (cat of categoriasOrdenadas(); track cat.nombre) {
              <li class="flex items-center justify-between gap-3 bg-superficie rounded-lg border border-borde p-3">
                <span class="text-sm text-texto">{{ cat.nombre }}</span>
                <button
                  type="button"
                  class="text-xs text-error disabled:text-texto-tenue disabled:cursor-not-allowed"
                  [disabled]="platosDeCategoria(cat.nombre).length > 0"
                  [title]="
                    platosDeCategoria(cat.nombre).length > 0
                      ? 'Reasigná o borrá primero los ' + platosDeCategoria(cat.nombre).length + ' platos de esta categoría'
                      : ''
                  "
                  (click)="borrarCategoria(cat.nombre)"
                >
                  Borrar categoría
                </button>
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
            <button type="submit" class="cta" [disabled]="!nuevaCategoriaNombre().trim()">Agregar categoría</button>
          </form>
        </section>

        <section class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-medium text-texto">Platos</h2>
            <a [routerLink]="['/clientes', clienteId(), 'menu', platos().length]" class="cta">Agregar plato</a>
          </div>

          @if (platos().length === 0) {
            <p class="text-sm text-texto-tenue">Todavía no hay platos cargados.</p>
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
                      <button type="button" class="text-xs text-error" (click)="borrarPlato(entrada.indice)">
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

  private readonly vigencia = new Vigencia();

  readonly clienteId = signal('');
  readonly menu = signal<MenuItem[]>([]);
  readonly categorias = signal<MenuCategoria[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly nuevaCategoriaNombre = signal('');

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

  /** Guarda la carta actual (`menu()` + `categorias()`) y refleja el resultado en la UI. */
  private async guardar(): Promise<void> {
    const clienteId = this.clienteId();
    const carta = { menu: this.menu(), menu_categorias: this.categorias() };
    try {
      await this.api.guardarMenu(clienteId, carta);
    } catch (e) {
      if (this.vigencia.obsoleta(clienteId)) return;
      this.error.set((e as Error).message);
      // Recargar desde el servidor: el estado local pudo quedar adelantado a lo que en verdad se
      // guardó, y mostrar un plato "borrado" que en realidad sigue ahí sería peor que recargar.
      void this.cargar(clienteId);
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
   * `orden` conservan su orden de aparición entre ellas, igual que el renderer.
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

    return grupos.filter((g) => g.entradas.length > 0 || this.categoriasOrdenadas().some((c) => c.nombre === g.nombre));
  }

  agregarCategoria(evento: Event): void {
    evento.preventDefault();
    const nombre = this.nuevaCategoriaNombre().trim();
    if (!nombre) return;
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
}

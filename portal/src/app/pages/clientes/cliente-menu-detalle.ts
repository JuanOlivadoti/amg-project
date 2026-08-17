import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
import type { Alergeno, EtiquetaDietetica, MenuCategoria, MenuItem, PrecioMenu } from '../../core/models';
import { ALERGENOS, ETIQUETA_ALERGENO, ETIQUETAS_DIETETICAS, ETIQUETA_DIETETICA_LABEL } from '../../core/menu-taxonomia';
import { Vigencia } from '../../core/vigencia';

const MAX_PRECIOS = 3;

/** Un precio en edición: los tres campos como string (`comensales` puede quedar vacío). */
interface PrecioForm {
  etiqueta: string;
  importe: string;
  comensales: string;
}

/** El formulario completo de un plato. Todo string/boolean: la conversión a `MenuItem` (recorte de
 *  vacíos, parseo de números) pasa por `platoDesdeFormulario()` recién al guardar. */
interface FormularioPlato {
  name: string;
  description: string;
  category: string;
  nota: string;
  precios: PrecioForm[];
  fotoSrc: string;
  videoSrc: string;
  videoPosterSrc: string;
  videoPosterAlt: string;
  alergenos: Set<Alergeno>;
  etiquetas: Set<EtiquetaDietetica>;
  calorias: string;
  proteinasG: string;
  carbohidratosG: string;
  grasasG: string;
}

function formularioVacio(): FormularioPlato {
  return {
    name: '',
    description: '',
    category: '',
    nota: '',
    precios: [{ etiqueta: '', importe: '', comensales: '' }],
    fotoSrc: '',
    videoSrc: '',
    videoPosterSrc: '',
    videoPosterAlt: '',
    alergenos: new Set(),
    etiquetas: new Set(),
    calorias: '',
    proteinasG: '',
    carbohidratosG: '',
    grasasG: '',
  };
}

/**
 * Arma el formulario a partir de un `MenuItem` ya guardado.
 *
 * **Migra `price` suelto a `precios`** si el plato no tiene `precios` pero sí trae `price` (un
 * cast a `unknown` porque `MenuItem` del portal no declara ese campo — ver Task 4): sin esto, abrir
 * un plato cargado por SQL antes de este editor mostraría el precio vacío, y guardar lo borraría de
 * verdad. Nunca al revés (`precios` nunca se aplana a `price`): el editor del portal siempre escribe
 * con `precios`.
 */
function formularioDesde(item: MenuItem): FormularioPlato {
  const legacyPrice = (item as unknown as { price?: string }).price;
  const precios: PrecioForm[] =
    item.precios && item.precios.length > 0
      ? item.precios.map((p) => ({ etiqueta: p.etiqueta, importe: p.importe, comensales: p.comensales ?? '' }))
      : legacyPrice
        ? [{ etiqueta: 'Precio', importe: legacyPrice, comensales: '' }]
        : [{ etiqueta: '', importe: '', comensales: '' }];

  return {
    name: item.name,
    description: item.description ?? '',
    category: item.category ?? '',
    nota: item.nota ?? '',
    precios,
    fotoSrc: item.foto?.src ?? '',
    videoSrc: item.video?.src ?? '',
    videoPosterSrc: item.video?.poster?.src ?? '',
    videoPosterAlt: item.video?.poster?.alt ?? '',
    alergenos: new Set(item.alergenos ?? []),
    etiquetas: new Set(item.etiquetas ?? []),
    calorias: item.nutricion?.calorias?.toString() ?? '',
    proteinasG: item.nutricion?.proteinas_g?.toString() ?? '',
    carbohidratosG: item.nutricion?.carbohidratos_g?.toString() ?? '',
    grasasG: item.nutricion?.grasas_g?.toString() ?? '',
  };
}

/** El inverso de `formularioDesde`: recorta filas de precio vacías y campos opcionales sin valor —
 *  nunca manda `foto`/`video`/`nutricion` con todas sus claves vacías. */
function platoDesdeFormulario(f: FormularioPlato): MenuItem {
  const precios: PrecioMenu[] = f.precios
    .filter((p) => p.etiqueta.trim() !== '' && p.importe.trim() !== '')
    .map((p) => ({
      etiqueta: p.etiqueta.trim(),
      importe: p.importe.trim(),
      ...(p.comensales.trim() ? { comensales: p.comensales.trim() } : {}),
    }));

  const numero = (s: string): number | undefined => {
    const n = Number(s);
    return s.trim() !== '' && Number.isFinite(n) ? n : undefined;
  };
  const nutricion = {
    calorias: numero(f.calorias),
    proteinas_g: numero(f.proteinasG),
    carbohidratos_g: numero(f.carbohidratosG),
    grasas_g: numero(f.grasasG),
  };
  const hayNutricion = Object.values(nutricion).some((v) => v !== undefined);

  const plato: MenuItem = { name: f.name.trim() };
  if (f.description.trim()) plato.description = f.description.trim();
  if (f.category.trim()) plato.category = f.category.trim();
  if (f.nota.trim()) plato.nota = f.nota.trim();
  if (precios.length > 0) plato.precios = precios;
  if (f.fotoSrc.trim()) plato.foto = { src: f.fotoSrc.trim() };
  if (f.videoSrc.trim()) {
    plato.video = {
      src: f.videoSrc.trim(),
      ...(f.videoPosterSrc.trim()
        ? { poster: { src: f.videoPosterSrc.trim(), ...(f.videoPosterAlt.trim() ? { alt: f.videoPosterAlt.trim() } : {}) } }
        : {}),
    };
  }
  if (f.alergenos.size > 0) plato.alergenos = [...f.alergenos];
  if (f.etiquetas.size > 0) plato.etiquetas = [...f.etiquetas];
  if (hayNutricion) plato.nutricion = nutricion;

  return plato;
}

/**
 * El detalle de UN plato: `/clientes/:id/menu/:index`. Igual que Ideas, dos partes separadas por
 * `Vigencia` (acá con clave `${clienteId}:${index}`, porque la identidad depende de las DOS): la
 * carga vuelve a pedir `GET /clients/:id/menu` cada vez (nunca reutiliza el array de la lista, ver
 * el spec), y `index === menu.length` es "plato nuevo" — ver `cliente-menu.ts`.
 */
@Component({
  selector: 'app-cliente-menu-detalle',
  imports: [FormsModule],
  template: `
    <div class="space-y-6">
      @if (cargando()) {
        <p class="text-sm text-texto-tenue">Cargando…</p>
      } @else if (noEncontrado()) {
        <p class="text-sm text-error">Plato no encontrado.</p>
      } @else {
        <h1 class="text-lg font-medium text-texto">{{ esNuevo() ? 'Plato nuevo' : formulario().name }}</h1>

        @if (errorGuardar()) {
          <p class="text-sm text-error">{{ errorGuardar() }}</p>
        }
        @if (errorValidacion()) {
          <p class="text-sm text-error">{{ errorValidacion() }}</p>
        }

        <form class="space-y-4" (submit)="guardar($event)">
          <div>
            <label for="name" class="block text-xs text-texto-tenue">Nombre</label>
            <input
              id="name"
              name="name"
              [ngModel]="formulario().name"
              (ngModelChange)="actualizar({ name: $event })"
              class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label for="description" class="block text-xs text-texto-tenue">Descripción</label>
            <textarea
              id="description"
              name="description"
              [ngModel]="formulario().description"
              (ngModelChange)="actualizar({ description: $event })"
              class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
            ></textarea>
          </div>

          <div>
            <label for="category" class="block text-xs text-texto-tenue">Categoría</label>
            <select
              id="category"
              name="category"
              [ngModel]="formulario().category"
              (ngModelChange)="actualizar({ category: $event })"
              class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
            >
              <option value="">Sin categoría</option>
              @for (cat of categorias(); track cat.nombre) {
                <option [value]="cat.nombre">{{ cat.nombre }}</option>
              }
            </select>
          </div>

          <div>
            <label for="nota" class="block text-xs text-texto-tenue">Nota</label>
            <input
              id="nota"
              name="nota"
              [ngModel]="formulario().nota"
              (ngModelChange)="actualizar({ nota: $event })"
              class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
            />
          </div>

          <fieldset class="space-y-2">
            <legend class="text-xs text-texto-tenue">Precios (hasta {{ maxPrecios }})</legend>
            @for (precio of formulario().precios; track $index) {
              <div class="flex gap-2">
                <input
                  [name]="'precio' + $index + 'Etiqueta'"
                  [attr.name]="'precio' + $index + 'Etiqueta'"
                  placeholder="Etiqueta (ej. Media)"
                  [ngModel]="precio.etiqueta"
                  (ngModelChange)="actualizarPrecio($index, { etiqueta: $event })"
                  class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                />
                <input
                  [name]="'precio' + $index + 'Importe'"
                  [attr.name]="'precio' + $index + 'Importe'"
                  placeholder="Importe (ej. 9,00 €)"
                  [ngModel]="precio.importe"
                  (ngModelChange)="actualizarPrecio($index, { importe: $event })"
                  class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                />
                <input
                  [name]="'precio' + $index + 'Comensales'"
                  [attr.name]="'precio' + $index + 'Comensales'"
                  placeholder="Comensales (opcional)"
                  [ngModel]="precio.comensales"
                  (ngModelChange)="actualizarPrecio($index, { comensales: $event })"
                  class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                />
              </div>
            }
            @if (formulario().precios.length < maxPrecios) {
              <button type="button" class="text-xs text-accion" (click)="agregarFilaPrecio()">
                + agregar precio
              </button>
            }
          </fieldset>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="fotoSrc" class="block text-xs text-texto-tenue">Foto (URL)</label>
              <input
                id="fotoSrc"
                name="fotoSrc"
                [ngModel]="formulario().fotoSrc"
                (ngModelChange)="actualizar({ fotoSrc: $event })"
                class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label for="videoSrc" class="block text-xs text-texto-tenue">Video (URL)</label>
              <input
                id="videoSrc"
                name="videoSrc"
                [ngModel]="formulario().videoSrc"
                (ngModelChange)="actualizar({ videoSrc: $event })"
                class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
          </div>

          @if (formulario().videoSrc.trim()) {
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label for="videoPosterSrc" class="block text-xs text-texto-tenue">Poster del video (URL)</label>
                <input
                  id="videoPosterSrc"
                  name="videoPosterSrc"
                  [ngModel]="formulario().videoPosterSrc"
                  (ngModelChange)="actualizar({ videoPosterSrc: $event })"
                  class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label for="videoPosterAlt" class="block text-xs text-texto-tenue">Texto alternativo del poster</label>
                <input
                  id="videoPosterAlt"
                  name="videoPosterAlt"
                  [ngModel]="formulario().videoPosterAlt"
                  (ngModelChange)="actualizar({ videoPosterAlt: $event })"
                  class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                />
              </div>
            </div>
            @if (!formulario().videoPosterSrc.trim()) {
              <p class="text-xs text-texto-tenue">
                Advertencia: sin imagen de portada, el video no se va a mostrar en el sitio público.
              </p>
            }
          }

          <fieldset class="space-y-2">
            <legend class="text-xs text-texto-tenue">Alérgenos</legend>
            <div class="grid grid-cols-3 gap-2">
              @for (a of ALERGENOS; track a) {
                <label class="flex items-center gap-2 text-sm text-texto">
                  <input
                    type="checkbox"
                    [name]="'alergeno-' + a"
                    [attr.name]="'alergeno-' + a"
                    [ngModel]="formulario().alergenos.has(a)"
                    (ngModelChange)="alternarAlergeno(a, $event)"
                  />
                  {{ ETIQUETA_ALERGENO[a] }}
                </label>
              }
            </div>
          </fieldset>

          <fieldset class="space-y-2">
            <legend class="text-xs text-texto-tenue">Etiquetas dietéticas</legend>
            <div class="grid grid-cols-3 gap-2">
              @for (e of ETIQUETAS_DIETETICAS; track e) {
                <label class="flex items-center gap-2 text-sm text-texto">
                  <input
                    type="checkbox"
                    [name]="'etiqueta-' + e"
                    [attr.name]="'etiqueta-' + e"
                    [ngModel]="formulario().etiquetas.has(e)"
                    (ngModelChange)="alternarEtiqueta(e, $event)"
                  />
                  {{ ETIQUETA_DIETETICA_LABEL[e] }}
                </label>
              }
            </div>
          </fieldset>

          <fieldset class="grid grid-cols-4 gap-2">
            <legend class="text-xs text-texto-tenue col-span-4">Nutrición (ración de referencia)</legend>
            <div>
              <label for="nutricionCalorias" class="block text-xs text-texto-tenue">Calorías</label>
              <input
                id="nutricionCalorias"
                name="nutricionCalorias"
                type="number"
                [ngModel]="formulario().calorias"
                (ngModelChange)="actualizarNumero('calorias', $event)"
                class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label for="nutricionProteinas" class="block text-xs text-texto-tenue">Proteínas (g)</label>
              <input
                id="nutricionProteinas"
                name="nutricionProteinas"
                type="number"
                [ngModel]="formulario().proteinasG"
                (ngModelChange)="actualizarNumero('proteinasG', $event)"
                class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label for="nutricionCarbohidratos" class="block text-xs text-texto-tenue">Carbohidratos (g)</label>
              <input
                id="nutricionCarbohidratos"
                name="nutricionCarbohidratos"
                type="number"
                [ngModel]="formulario().carbohidratosG"
                (ngModelChange)="actualizarNumero('carbohidratosG', $event)"
                class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label for="nutricionGrasas" class="block text-xs text-texto-tenue">Grasas (g)</label>
              <input
                id="nutricionGrasas"
                name="nutricionGrasas"
                type="number"
                [ngModel]="formulario().grasasG"
                (ngModelChange)="actualizarNumero('grasasG', $event)"
                class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
          </fieldset>

          <button type="submit" class="cta" [disabled]="guardando()">
            {{ guardando() ? 'Guardando…' : 'Guardar' }}
          </button>
        </form>
      }
    </div>
  `,
})
export class ClienteMenuDetallePage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly vigencia = new Vigencia();

  readonly ALERGENOS = ALERGENOS;
  readonly ETIQUETA_ALERGENO = ETIQUETA_ALERGENO;
  readonly ETIQUETAS_DIETETICAS = ETIQUETAS_DIETETICAS;
  readonly ETIQUETA_DIETETICA_LABEL = ETIQUETA_DIETETICA_LABEL;
  readonly maxPrecios = MAX_PRECIOS;

  private clienteId = '';
  private indice = -1;
  private menuCompleto: MenuItem[] = [];
  readonly categorias = signal<MenuCategoria[]>([]);

  readonly formulario = signal<FormularioPlato>(formularioVacio());
  readonly esNuevo = signal(false);
  readonly noEncontrado = signal(false);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly errorGuardar = signal('');
  readonly errorValidacion = signal('');

  private sub: Subscription | null = null;

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      const clienteId = params.get('id') ?? '';
      const indiceParam = params.get('index') ?? '';
      const clave = `${clienteId}:${indiceParam}`;
      if (clave === this.vigencia.actual) return;
      this.vigencia.cambiarA(clave);
      this.clienteId = clienteId;
      this.indice = Number(indiceParam);
      this.noEncontrado.set(false);
      this.errorGuardar.set('');
      this.errorValidacion.set('');
      void this.cargar(clave, clienteId);
    });
  }

  ngOnDestroy(): void {
    this.vigencia.destruir();
    this.sub?.unsubscribe();
  }

  private async cargar(pedido: string, clienteId: string): Promise<void> {
    this.cargando.set(true);
    try {
      const carta = await this.api.obtenerMenu(clienteId);
      if (this.vigencia.obsoleta(pedido)) return;
      this.menuCompleto = carta.menu;
      this.categorias.set(carta.menu_categorias);

      if (this.indice < 0 || this.indice > carta.menu.length || Number.isNaN(this.indice)) {
        this.noEncontrado.set(true);
      } else if (this.indice === carta.menu.length) {
        this.esNuevo.set(true);
        this.formulario.set(formularioVacio());
      } else {
        this.esNuevo.set(false);
        this.formulario.set(formularioDesde(carta.menu[this.indice]!));
      }
    } catch (e) {
      if (this.vigencia.obsoleta(pedido)) return;
      this.errorGuardar.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(pedido)) this.cargando.set(false);
    }
  }

  actualizar(cambios: Partial<FormularioPlato>): void {
    this.formulario.set({ ...this.formulario(), ...cambios });
  }

  actualizarPrecio(indice: number, cambios: Partial<PrecioForm>): void {
    const precios = this.formulario().precios.map((p, i) => (i === indice ? { ...p, ...cambios } : p));
    this.actualizar({ precios });
  }

  /**
   * Setter para los cuatro campos de nutrición, que van con `type="number"` en el template.
   *
   * **Por qué no `actualizar()` a secas.** `NumberValueAccessor` (el value accessor que Angular usa
   * para `[ngModel]` sobre `type="number"`) parsea el input y emite por `(ngModelChange)` un
   * `number | null`, no el string que `FormularioPlato` declara — a pesar de que el atributo HTML es
   * siempre string. Guardar ese valor tal cual en el signal rompía `platoDesdeFormulario()` con un
   * `TypeError: s.trim is not a function` apenas alguien tocaba un campo de nutrición y guardaba (se
   * encontró manejando la pantalla, no en la suite: Karma no ejecuta `NumberValueAccessor` sobre un
   * input real de la misma forma que Chrome). Coercionar acá, en el borde, mantiene el signal fiel al
   * tipo que declara — la alternativa (aflojar `numero()` para aceptar `unknown`) tapa el síntoma en
   * vez de arreglar la fuente.
   */
  actualizarNumero(
    campo: 'calorias' | 'proteinasG' | 'carbohidratosG' | 'grasasG',
    valor: string | number | null,
  ): void {
    this.actualizar({ [campo]: valor === null || valor === undefined ? '' : String(valor) });
  }

  agregarFilaPrecio(): void {
    if (this.formulario().precios.length >= MAX_PRECIOS) return;
    this.actualizar({ precios: [...this.formulario().precios, { etiqueta: '', importe: '', comensales: '' }] });
  }

  alternarAlergeno(a: Alergeno, marcado: boolean): void {
    const alergenos = new Set(this.formulario().alergenos);
    if (marcado) alergenos.add(a);
    else alergenos.delete(a);
    this.actualizar({ alergenos });
  }

  alternarEtiqueta(e: EtiquetaDietetica, marcado: boolean): void {
    const etiquetas = new Set(this.formulario().etiquetas);
    if (marcado) etiquetas.add(e);
    else etiquetas.delete(e);
    this.actualizar({ etiquetas });
  }

  async guardar(evento: Event): Promise<void> {
    evento.preventDefault();
    this.errorValidacion.set('');
    if (!this.formulario().name.trim()) {
      this.errorValidacion.set('El nombre no puede quedar vacío.');
      return;
    }

    const plato = platoDesdeFormulario(this.formulario());
    const nuevoMenu = this.esNuevo()
      ? [...this.menuCompleto, plato]
      : this.menuCompleto.map((p, i) => (i === this.indice ? plato : p));

    const clave = this.vigencia.actual;
    this.guardando.set(true);
    this.errorGuardar.set('');
    try {
      await this.api.guardarMenu(this.clienteId, { menu: nuevoMenu, menu_categorias: this.categorias() });
      if (this.vigencia.obsoleta(clave)) return;
      void this.router.navigate(['/clientes', this.clienteId, 'menu']);
    } catch (e) {
      if (this.vigencia.obsoleta(clave)) return;
      this.errorGuardar.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(clave)) this.guardando.set(false);
    }
  }
}

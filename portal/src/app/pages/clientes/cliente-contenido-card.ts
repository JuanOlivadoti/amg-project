import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api';
import { ComponentCardComponent } from '../../shared/components/component-card';
import type { ClienteAgencia, Contenido, Destacado, Testimonio } from '../../core/models';

const MAX_DESTACADOS = 6;
const MAX_TESTIMONIOS = 12;

/** Un destacado en edición: `texto` siempre string (nunca `undefined`) para que el `ngModel` de la
 *  fila no tenga que distinguir "campo opcional ausente" de "campo vacío" mientras se escribe. */
interface DestacadoForm {
  titulo: string;
  texto: string;
}

/** Mismo criterio que `DestacadoForm` para `autor`. */
interface TestimonioForm {
  texto: string;
  autor: string;
}

interface FormularioContenido {
  bienvenida: string;
  destacados: DestacadoForm[];
  testimonios: TestimonioForm[];
}

function formularioVacio(): FormularioContenido {
  return { bienvenida: '', destacados: [], testimonios: [] };
}

function formularioDesde(c: Contenido | null): FormularioContenido {
  if (!c) return formularioVacio();
  return {
    bienvenida: c.bienvenida,
    destacados: c.destacados.map((d) => ({ titulo: d.titulo, texto: d.texto ?? '' })),
    testimonios: c.testimonios.map((t) => ({ texto: t.texto, autor: t.autor ?? '' })),
  };
}

/**
 * Arma el `Contenido` a mandar al PATCH: las TRES claves SIEMPRE presentes (a diferencia de
 * `perfilDesde` en `cliente-seguros-card.ts`, acá ninguna de las tres se omite — el contrato las
 * exige juntas, `bienvenida: ''` incluida, que es justamente cómo se pide "volver al default de
 * plantilla"). Dentro de cada lista sí se recorta: una fila sin su campo obligatorio (`titulo` de un
 * destacado, `texto` de un testimonio) se descarta en silencio — es lo que queda al tocar "+ agregar"
 * y guardar sin completarla, o al vaciar el campo de una fila existente. El campo opcional de cada
 * fila (`texto` de destacado, `autor` de testimonio) se omite si queda vacío, mismo criterio que
 * `perfilDesde`.
 */
function contenidoDesde(f: FormularioContenido): Contenido {
  const destacados: Destacado[] = f.destacados
    .filter((d) => d.titulo.trim())
    .map((d) => {
      const destacado: Destacado = { titulo: d.titulo.trim() };
      if (d.texto.trim()) destacado.texto = d.texto.trim();
      return destacado;
    });
  const testimonios: Testimonio[] = f.testimonios
    .filter((t) => t.texto.trim())
    .map((t) => {
      const testimonio: Testimonio = { texto: t.texto.trim() };
      if (t.autor.trim()) testimonio.autor = t.autor.trim();
      return testimonio;
    });
  return { bienvenida: f.bienvenida.trim(), destacados, testimonios };
}

/**
 * Sexto card de `/clientes/:id/perfil` (Bloque E, última pieza de `docs/proyecto/15-plan-plataforma.md`).
 * A diferencia de `ClienteSegurosCardComponent` (el quinto, condicional a `vertical ===
 * 'correduria_seguros'`), este se monta SIEMPRE en `cliente-perfil.ts`: `bienvenida`/`destacados`/
 * `testimonios` valen para cualquier vertical.
 *
 * Mismo patrón que el card de Seguros en todo lo demás: view/edit con un signal `editando` local,
 * carga propia contra `GET`/`PATCH /clients/:id/contenido` (`business_profile.bienvenida` +
 * `.destacados` + `.testimonios` NO son parte de `ClienteAgencia`, así que este card —como el de
 * Seguros— pide su propio dato en vez de leerlo del `input()`), un `effect()` sobre `cliente().id`
 * con el mismo guard `idVigente` contra la carrera de dos clientes seguidos (ver el comentario largo
 * en `cliente-seguros-card.ts`: es la misma clase de bug, ya encontrado una vez ahí por Codex).
 *
 * La diferencia real con Seguros: acá `destacados`/`testimonios` son LISTAS editables (agregar/quitar
 * filas), no campos escalares. El patrón de alta/baja está tomado de `cliente-menu-detalle.ts`
 * (`agregarFilaPrecio`/`actualizarPrecio` para los precios de un plato) — filas por índice, un botón
 * "+ agregar" que respeta un máximo — pero con la incorporación de "Quitar" por fila, que ese archivo
 * no necesita (los precios de un plato no se borran ahí, solo se agregan). Y a diferencia del
 * auto-guardado de `cliente-menu.ts` (cada alta/baja dispara su propio PATCH), este card sigue el
 * patrón "un solo Editar → se edita todo → un solo Guardar" de `cliente-seguros-card.ts`: agregar o
 * quitar una fila mientras se edita solo toca el `form()` local, nada viaja a la red hasta el submit.
 */
@Component({
  selector: 'app-cliente-contenido-card',
  imports: [FormsModule, ComponentCardComponent],
  template: `
    <app-component-card titulo="Contenido" descripcion="Bienvenida, destacados y testimonios de la home.">
      @if (cargando()) {
        <p class="text-sm text-texto-tenue">Cargando…</p>
      } @else if (!editando()) {
        <div class="space-y-6">
          <div>
            <p class="text-sm text-texto-tenue">Bienvenida</p>
            <p class="text-base text-texto whitespace-pre-wrap">
              {{ contenido()?.bienvenida || '— (usa el texto por defecto de la plantilla)' }}
            </p>
          </div>

          <div>
            <p class="text-sm text-texto-tenue">Destacados ({{ contenido()?.destacados?.length ?? 0 }}/{{ maxDestacados }})</p>
            @if (!contenido()?.destacados?.length) {
              <p class="text-sm text-texto-tenue">Sin destacados.</p>
            } @else {
              <ul class="list-disc pl-5 space-y-1">
                @for (d of contenido()!.destacados; track $index) {
                  <li class="text-sm text-texto">
                    <span class="font-medium">{{ d.titulo }}</span>
                    @if (d.texto) {
                      <span class="text-texto-tenue"> — {{ d.texto }}</span>
                    }
                  </li>
                }
              </ul>
            }
          </div>

          <div>
            <p class="text-sm text-texto-tenue">Testimonios ({{ contenido()?.testimonios?.length ?? 0 }}/{{ maxTestimonios }})</p>
            @if (!contenido()?.testimonios?.length) {
              <p class="text-sm text-texto-tenue">Sin testimonios.</p>
            } @else {
              <ul class="list-disc pl-5 space-y-1">
                @for (t of contenido()!.testimonios; track $index) {
                  <li class="text-sm text-texto">
                    <span>{{ t.texto }}</span>
                    @if (t.autor) {
                      <span class="text-texto-tenue"> — {{ t.autor }}</span>
                    }
                  </li>
                }
              </ul>
            }
          </div>

          @if (error()) {
            <p class="text-sm text-error">{{ error() }}</p>
          }
          <div class="flex justify-end">
            <button
              type="button"
              (click)="editar()"
              class="rounded-md border border-borde-fuerte px-4 py-2 text-sm font-medium text-texto hover:bg-superficie-2"
            >
              Editar
            </button>
          </div>
        </div>
      } @else {
        <form (ngSubmit)="guardar()" class="space-y-6">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium text-texto-medio" for="contenido-bienvenida">Bienvenida</label>
            <textarea
              id="contenido-bienvenida"
              name="bienvenida"
              rows="3"
              placeholder="Vacío = usar el texto por defecto de la plantilla"
              [ngModel]="form().bienvenida"
              (ngModelChange)="actualizarBienvenida($event)"
              class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
            ></textarea>
          </div>

          <fieldset class="space-y-2">
            <legend class="text-sm font-medium text-texto-medio">Destacados (hasta {{ maxDestacados }})</legend>
            @for (d of form().destacados; track $index) {
              <div class="flex flex-wrap gap-2 items-start">
                <input
                  [name]="'destacado' + $index + 'Titulo'"
                  [attr.name]="'destacado' + $index + 'Titulo'"
                  placeholder="Título"
                  [ngModel]="d.titulo"
                  (ngModelChange)="actualizarDestacado($index, { titulo: $event })"
                  class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                />
                <input
                  [name]="'destacado' + $index + 'Texto'"
                  [attr.name]="'destacado' + $index + 'Texto'"
                  placeholder="Texto (opcional)"
                  [ngModel]="d.texto"
                  (ngModelChange)="actualizarDestacado($index, { texto: $event })"
                  class="flex-1 min-w-[10rem] rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                />
                <button type="button" class="text-xs text-error" (click)="quitarDestacado($index)">Quitar</button>
              </div>
            }
            @if (form().destacados.length < maxDestacados) {
              <button type="button" class="text-xs text-accion" (click)="agregarDestacado()">+ agregar destacado</button>
            }
          </fieldset>

          <fieldset class="space-y-2">
            <legend class="text-sm font-medium text-texto-medio">Testimonios (hasta {{ maxTestimonios }})</legend>
            @for (t of form().testimonios; track $index) {
              <div class="flex flex-wrap gap-2 items-start">
                <input
                  [name]="'testimonio' + $index + 'Texto'"
                  [attr.name]="'testimonio' + $index + 'Texto'"
                  placeholder="Texto"
                  [ngModel]="t.texto"
                  (ngModelChange)="actualizarTestimonio($index, { texto: $event })"
                  class="flex-1 min-w-[10rem] rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                />
                <input
                  [name]="'testimonio' + $index + 'Autor'"
                  [attr.name]="'testimonio' + $index + 'Autor'"
                  placeholder="Autor (opcional)"
                  [ngModel]="t.autor"
                  (ngModelChange)="actualizarTestimonio($index, { autor: $event })"
                  class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
                />
                <button type="button" class="text-xs text-error" (click)="quitarTestimonio($index)">Quitar</button>
              </div>
            }
            @if (form().testimonios.length < maxTestimonios) {
              <button type="button" class="text-xs text-accion" (click)="agregarTestimonio()">+ agregar testimonio</button>
            }
          </fieldset>

          @if (error()) {
            <p class="text-sm text-error">{{ error() }}</p>
          }

          <div class="flex justify-end gap-3">
            <button
              type="button"
              (click)="cancelar()"
              [disabled]="guardando()"
              class="rounded-md border border-borde-fuerte px-4 py-2 text-sm font-medium text-texto hover:bg-superficie-2"
            >
              Cancelar
            </button>
            <button
              type="submit"
              [disabled]="guardando()"
              class="rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {{ guardando() ? 'Guardando…' : 'Guardar' }}
            </button>
          </div>
        </form>
      }
    </app-component-card>
  `,
})
export class ClienteContenidoCardComponent {
  readonly cliente = input.required<ClienteAgencia>();
  private readonly api = inject(ApiService);

  readonly maxDestacados = MAX_DESTACADOS;
  readonly maxTestimonios = MAX_TESTIMONIOS;

  readonly contenido = signal<Contenido | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly editando = signal(false);
  readonly guardando = signal(false);
  readonly form = signal<FormularioContenido>(formularioVacio());

  /** El `id` para el que `contenido()`/`cargando()` son válidos — mismo mecanismo que
   *  `ClienteSegurosCardComponent` (ver `portal-angular`, "Carreras asincrónicas"). */
  private idVigente = '';

  constructor() {
    effect(() => {
      const id = this.cliente().id;
      void this.cargar(id);
    });
  }

  private async cargar(id: string): Promise<void> {
    if (id === this.idVigente) return; // ya cargado o en vuelo para este id
    this.idVigente = id;
    this.cargando.set(true);
    this.error.set('');
    // Cambiar de cliente invalida cualquier edición en curso del anterior — mismo motivo que
    // `cliente-seguros-card.ts` (Codex review 2026-08-31, hallazgo 1): sin esto, el formulario y el
    // "Guardando…" de A quedan visibles sobre los datos recién cargados de B.
    this.editando.set(false);
    this.guardando.set(false);
    this.form.set(formularioVacio());
    try {
      const contenido = await this.api.obtenerContenido(id);
      if (this.idVigente !== id) return; // llegó tarde: ya se pidió otro cliente
      this.contenido.set(contenido);
    } catch (e) {
      if (this.idVigente !== id) return;
      this.error.set((e as Error).message);
    } finally {
      if (this.idVigente === id) this.cargando.set(false);
    }
  }

  editar(): void {
    this.form.set(formularioDesde(this.contenido()));
    this.editando.set(true);
  }

  cancelar(): void {
    this.editando.set(false);
  }

  actualizarBienvenida(valor: string): void {
    this.form.update((f) => ({ ...f, bienvenida: valor }));
  }

  agregarDestacado(): void {
    if (this.form().destacados.length >= MAX_DESTACADOS) return; // el botón ya está oculto — defensa
    this.form.update((f) => ({ ...f, destacados: [...f.destacados, { titulo: '', texto: '' }] }));
  }

  quitarDestacado(indice: number): void {
    this.form.update((f) => ({ ...f, destacados: f.destacados.filter((_, i) => i !== indice) }));
  }

  actualizarDestacado(indice: number, cambios: Partial<DestacadoForm>): void {
    this.form.update((f) => ({
      ...f,
      destacados: f.destacados.map((d, i) => (i === indice ? { ...d, ...cambios } : d)),
    }));
  }

  agregarTestimonio(): void {
    if (this.form().testimonios.length >= MAX_TESTIMONIOS) return; // el botón ya está oculto — defensa
    this.form.update((f) => ({ ...f, testimonios: [...f.testimonios, { texto: '', autor: '' }] }));
  }

  quitarTestimonio(indice: number): void {
    this.form.update((f) => ({ ...f, testimonios: f.testimonios.filter((_, i) => i !== indice) }));
  }

  actualizarTestimonio(indice: number, cambios: Partial<TestimonioForm>): void {
    this.form.update((f) => ({
      ...f,
      testimonios: f.testimonios.map((t, i) => (i === indice ? { ...t, ...cambios } : t)),
    }));
  }

  async guardar(): Promise<void> {
    // Capturado ACÁ, no releído después del `await` — mismo guard que `cargar` (ver el hallazgo 1 de
    // la review de `cliente-seguros-card.ts`): si el cliente cambia mientras el PATCH sigue en vuelo,
    // `this.idVigente` ya apunta al nuevo y esta resolución tardía no debe tocar su estado.
    const id = this.idVigente;
    this.guardando.set(true);
    try {
      const datos = contenidoDesde(this.form());
      await this.api.actualizarContenido(id, datos);
      if (this.idVigente !== id) return;
      this.contenido.set(datos);
      this.error.set('');
      this.editando.set(false);
    } catch (e) {
      if (this.idVigente !== id) return;
      this.error.set((e as Error).message);
    } finally {
      if (this.idVigente === id) this.guardando.set(false);
    }
  }
}

import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api';
import { ComponentCardComponent } from '../../shared/components/component-card';
import type { ClienteAgencia, PerfilSeguros } from '../../core/models';

interface FormularioSeguros {
  numeroLicencia: string;
  anosExperiencia: number | null;
  redAfiliacion: string;
}

function formularioVacio(): FormularioSeguros {
  return { numeroLicencia: '', anosExperiencia: null, redAfiliacion: '' };
}

function formularioDesde(p: PerfilSeguros | null): FormularioSeguros {
  if (!p) return formularioVacio();
  return {
    numeroLicencia: p.numeroLicencia ?? '',
    anosExperiencia: p.anosExperiencia ?? null,
    redAfiliacion: p.redAfiliacion ?? '',
  };
}

/** Arma el `PerfilSeguros` a mandar al PATCH: se omite la clave, no se manda vacía, para los tres
 *  campos — mismo criterio que `platoDesdeFormulario`/`actualizarCategoria` en `cliente-menu.ts`. */
function perfilDesde(f: FormularioSeguros): PerfilSeguros {
  const perfil: PerfilSeguros = {};
  if (f.numeroLicencia.trim()) perfil.numeroLicencia = f.numeroLicencia.trim();
  if (f.anosExperiencia !== null) perfil.anosExperiencia = f.anosExperiencia;
  if (f.redAfiliacion.trim()) perfil.redAfiliacion = f.redAfiliacion.trim();
  return perfil;
}

/**
 * Quinto card de `/clientes/:id/perfil` (Task 14), montado SOLO para `vertical === 'correduria_seguros'`
 * (ver `cliente-perfil.ts`). Puerto del mismo patrón visual/edición que `ClienteInfoCardComponent`
 * (view/edit con un signal `editando` local, formulario con `FormsModule` + `ngModel`, botón Guardar),
 * pero con una diferencia real: los otros 4 cards editan `ClienteAgencia.contacto`, que YA llega en el
 * `input()` `cliente`. `numeroLicencia`/`anosExperiencia`/`redAfiliacion` viven en
 * `business_profile.seguros`, que NO es parte de `ClienteAgencia` — así que, a diferencia de los otros
 * cards, este SÍ carga sus propios datos, contra el endpoint dedicado `GET`/`PATCH /clients/:id/seguros`
 * (Task 11), con `ApiService` inyectado directo (mismo criterio que `cliente-menu.ts`, que también
 * necesita un endpoint fuera de `ClientesService`).
 *
 * La carga corre en un `effect()` sobre `cliente().id`: es un caso legítimo de side effect disparado
 * por un input que cambia (a diferencia de un `computed`, acá hace falta un `await`), y el componente
 * ya tiene contexto de inyección porque es un componente, no un servicio instanciado con `new` en
 * `node:test` (ver `portal-angular`). El guard `idVigente` es el mismo patrón que `ClientesService.
 * verCliente`: sin él, si la persona pasa de un cliente de seguros a otro sin salir de esta card
 * (Angular reutiliza la instancia mientras el `@if` de vertical se mantiene en `true`), una respuesta
 * tardía del primer cliente podría pisar el perfil del segundo.
 */
@Component({
  selector: 'app-cliente-seguros-card',
  imports: [FormsModule, ComponentCardComponent],
  template: `
    <app-component-card titulo="Seguros" descripcion="Licencia, experiencia y red de afiliación de la correduría.">
      @if (cargando()) {
        <p class="text-sm text-texto-tenue">Cargando…</p>
      } @else if (!editando()) {
        <div class="space-y-6">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p class="text-sm text-texto-tenue">Número de licencia</p>
              <p class="text-base font-medium text-texto">{{ perfil()?.numeroLicencia || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Años de experiencia</p>
              <p class="text-base font-medium text-texto">{{ perfil()?.anosExperiencia ?? '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Red de afiliación</p>
              <p class="text-base font-medium text-texto">{{ perfil()?.redAfiliacion || '—' }}</p>
            </div>
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
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="seguros-numero-licencia">Número de licencia</label>
              <input
                id="seguros-numero-licencia"
                name="numeroLicencia"
                type="text"
                [ngModel]="form().numeroLicencia"
                (ngModelChange)="actualizar('numeroLicencia', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="seguros-anos-experiencia">Años de experiencia</label>
              <input
                id="seguros-anos-experiencia"
                name="anosExperiencia"
                type="number"
                min="0"
                [ngModel]="form().anosExperiencia"
                (ngModelChange)="actualizar('anosExperiencia', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="seguros-red-afiliacion">Red de afiliación</label>
              <input
                id="seguros-red-afiliacion"
                name="redAfiliacion"
                type="text"
                [ngModel]="form().redAfiliacion"
                (ngModelChange)="actualizar('redAfiliacion', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
          </div>

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
export class ClienteSegurosCardComponent {
  readonly cliente = input.required<ClienteAgencia>();
  private readonly api = inject(ApiService);

  readonly perfil = signal<PerfilSeguros | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly editando = signal(false);
  readonly guardando = signal(false);
  readonly form = signal<FormularioSeguros>(formularioVacio());

  /** El `id` para el que `perfil()`/`cargando()` son válidos — mismo mecanismo que `ClientesService.
   *  verCliente` (ver `portal-angular`, "Carreras asincrónicas"), adaptado a un componente con `effect()`
   *  en vez de a un servicio singleton. */
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
    // Cambiar de cliente invalida cualquier edición en curso del anterior — si no se resetea acá, el
    // formulario y el "Guardando…" de A quedan visibles sobre los datos recién cargados de B (Codex
    // review 2026-08-31, hallazgo 1).
    this.editando.set(false);
    this.guardando.set(false);
    this.form.set(formularioVacio());
    try {
      const perfil = await this.api.obtenerPerfilSeguros(id);
      if (this.idVigente !== id) return; // llegó tarde: ya se pidió otro cliente
      this.perfil.set(perfil);
    } catch (e) {
      if (this.idVigente !== id) return;
      this.error.set((e as Error).message);
    } finally {
      if (this.idVigente === id) this.cargando.set(false);
    }
  }

  editar(): void {
    this.form.set(formularioDesde(this.perfil()));
    this.editando.set(true);
  }

  cancelar(): void {
    this.editando.set(false);
  }

  actualizar<K extends keyof FormularioSeguros>(campo: K, valor: FormularioSeguros[K]): void {
    this.form.update((f) => ({ ...f, [campo]: valor }));
  }

  async guardar(): Promise<void> {
    // Capturado ACÁ, no leído de nuevo después del `await`: si el cliente cambia mientras el PATCH
    // sigue en vuelo, `this.idVigente` ya apunta al nuevo y esta resolución tardía no debe tocar su
    // estado (mismo guard que `cargar`, ver hallazgo 1 de la review).
    const id = this.idVigente;
    this.guardando.set(true);
    try {
      const datos = perfilDesde(this.form());
      await this.api.actualizarPerfilSeguros(id, datos);
      if (this.idVigente !== id) return;
      this.perfil.set(datos);
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

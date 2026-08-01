import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClientesService } from '../../services/clientes';
import { ComponentCardComponent } from '../../shared/components/component-card';
import type { CambiosClienteAgencia, ClienteAgencia } from '../../core/models';
import { mergearContacto, pisarTexto } from './contacto-utils';

interface FormularioDireccion {
  calle: string;
  numero: string;
  ciudad: string;
  codigoPostal: string;
  provincia: string;
  pais: string;
}

function formularioVacio(): FormularioDireccion {
  return { calle: '', numero: '', ciudad: '', codigoPostal: '', provincia: '', pais: '' };
}

/** Lee `contacto.direccion` (un sub-objeto DENTRO del jsonb, no claves sueltas). */
function direccionDesde(c: ClienteAgencia): FormularioDireccion {
  const direccion = (c.contacto?.['direccion'] as Record<string, unknown> | undefined) ?? {};
  const texto = (clave: string): string => {
    const v = direccion[clave];
    return typeof v === 'string' ? v : '';
  };
  return {
    calle: texto('calle'),
    numero: texto('numero'),
    ciudad: texto('ciudad'),
    codigoPostal: texto('codigo_postal'),
    provincia: texto('provincia'),
    pais: texto('pais'),
  };
}

/**
 * Card "Dirección" de `/clientes/:id` (Etapa 5c). Puerto de `client-address-card` del origen, sin
 * modal (edita inline). Único campo que toca: `contacto.direccion` — un sub-objeto DENTRO del jsonb
 * `contacto`. Igual que el resto de los cards de contacto: el merge parte del `contacto` COMPLETO
 * (`mergearContacto(cliente().contacto)`), y solo pisa la clave `direccion` — así no toca
 * `email`/`facebook`/`recursos`/etc. que viven en las otras claves de ese mismo jsonb.
 */
@Component({
  selector: 'app-cliente-direccion-card',
  imports: [FormsModule, ComponentCardComponent],
  template: `
    <app-component-card titulo="Dirección">
      @if (!editando()) {
        <div class="space-y-4">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p class="text-sm text-texto-tenue">Calle y número</p>
              <p class="text-base font-medium text-texto">{{ calleYNumero() || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Ciudad</p>
              <p class="text-base font-medium text-texto">{{ direccion().ciudad || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Código postal</p>
              <p class="text-base font-medium text-texto">{{ direccion().codigoPostal || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Provincia</p>
              <p class="text-base font-medium text-texto">{{ direccion().provincia || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">País</p>
              <p class="text-base font-medium text-texto">{{ direccion().pais || '—' }}</p>
            </div>
          </div>
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
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="direccion-calle">Calle</label>
              <input
                id="direccion-calle"
                name="calle"
                type="text"
                [ngModel]="form().calle"
                (ngModelChange)="actualizar('calle', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="direccion-numero">Número</label>
              <input
                id="direccion-numero"
                name="numero"
                type="text"
                [ngModel]="form().numero"
                (ngModelChange)="actualizar('numero', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="direccion-ciudad">Ciudad</label>
              <input
                id="direccion-ciudad"
                name="ciudad"
                type="text"
                [ngModel]="form().ciudad"
                (ngModelChange)="actualizar('ciudad', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="direccion-codigo-postal">
                Código postal
              </label>
              <input
                id="direccion-codigo-postal"
                name="codigoPostal"
                type="text"
                [ngModel]="form().codigoPostal"
                (ngModelChange)="actualizar('codigoPostal', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="direccion-provincia">Provincia</label>
              <input
                id="direccion-provincia"
                name="provincia"
                type="text"
                [ngModel]="form().provincia"
                (ngModelChange)="actualizar('provincia', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="direccion-pais">País</label>
              <input
                id="direccion-pais"
                name="pais"
                type="text"
                [ngModel]="form().pais"
                (ngModelChange)="actualizar('pais', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
          </div>

          @if (clientesService.error()) {
            <p class="text-sm text-error">{{ clientesService.error() }}</p>
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
export class ClienteDireccionCardComponent {
  readonly cliente = input.required<ClienteAgencia>();
  readonly clientesService = inject(ClientesService);

  readonly editando = signal(false);
  readonly guardando = signal(false);
  readonly form = signal<FormularioDireccion>(formularioVacio());

  readonly direccion = computed(() => direccionDesde(this.cliente()));
  readonly calleYNumero = computed(() => {
    const d = this.direccion();
    return [d.calle, d.numero].filter(Boolean).join(' ');
  });

  editar(): void {
    this.form.set(direccionDesde(this.cliente()));
    this.editando.set(true);
  }

  cancelar(): void {
    this.editando.set(false);
  }

  actualizar<K extends keyof FormularioDireccion>(campo: K, valor: FormularioDireccion[K]): void {
    this.form.update((f) => ({ ...f, [campo]: valor }));
  }

  async guardar(): Promise<void> {
    this.guardando.set(true);
    try {
      const f = this.form();
      const contacto = mergearContacto(this.cliente().contacto);
      const direccion: Record<string, unknown> = {};
      pisarTexto(direccion, 'calle', f.calle);
      pisarTexto(direccion, 'numero', f.numero);
      pisarTexto(direccion, 'ciudad', f.ciudad);
      pisarTexto(direccion, 'codigo_postal', f.codigoPostal);
      pisarTexto(direccion, 'provincia', f.provincia);
      pisarTexto(direccion, 'pais', f.pais);
      if (Object.keys(direccion).length > 0) contacto['direccion'] = direccion;
      else delete contacto['direccion'];

      const cambios: CambiosClienteAgencia = { contacto };

      const id = this.cliente().id;
      await this.clientesService.actualizar(id, cambios);
      if (!this.clientesService.error()) {
        await this.clientesService.verCliente(id);
        // Reviso `error()` DE NUEVO acá: `verCliente` nunca relanza, solo lo setea si el GET de
        // refresco falla. Si cerrara el modo edición sin este segundo chequeo, un PATCH exitoso
        // seguido de un GET fallido cerraría la card en silencio — el error existe en el signal
        // pero nadie lo muestra porque el mensaje de error vive solo en la vista de edición.
        if (!this.clientesService.error()) this.editando.set(false);
      }
    } finally {
      this.guardando.set(false);
    }
  }
}

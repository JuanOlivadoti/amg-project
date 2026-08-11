import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClientesService } from '../../services/clientes';
import { ComponentCardComponent } from '../../shared/components/component-card';
import type { CambiosClienteAgencia, ClienteAgencia } from '../../core/models';
import { mergearContacto, pisarTexto } from './contacto-utils';

interface FormularioMeta {
  facebook: string;
  instagram: string;
  linkedin: string;
  x: string;
  googleMapsUrl: string;
  googlePlaceId: string;
  googleCategoria: string;
  logoUrl: string;
  portadaUrl: string;
}

function formularioVacio(): FormularioMeta {
  return {
    facebook: '',
    instagram: '',
    linkedin: '',
    x: '',
    googleMapsUrl: '',
    googlePlaceId: '',
    googleCategoria: '',
    logoUrl: '',
    portadaUrl: '',
  };
}

function metaDesde(c: ClienteAgencia): FormularioMeta {
  const contacto = c.contacto ?? {};
  const texto = (clave: string): string => {
    const v = contacto[clave];
    return typeof v === 'string' ? v : '';
  };
  return {
    facebook: texto('facebook'),
    instagram: texto('instagram'),
    linkedin: texto('linkedin'),
    x: texto('x'),
    googleMapsUrl: texto('google_maps_url'),
    googlePlaceId: texto('google_place_id'),
    googleCategoria: texto('google_categoria'),
    logoUrl: texto('logo_url'),
    portadaUrl: texto('portada_url'),
  };
}

/**
 * Card "Redes e imágenes" de `/clientes/:id` (Etapa 5c). Puerto de `client-meta-card` del origen,
 * sin modal (edita inline), sin el botón de generar contenido de Instagram (`getContent`/n8n — otro
 * producto, fuera de alcance, ver el brief) y sin el `<img>` de logo/portada renderizado desde una
 * URL sin validar: este portal reserva la validación de imágenes públicas para
 * `business_profile_publico` (ADR-19, allowlist del renderizador); acá dentro del panel autenticado
 * solo se muestra la URL como texto, no una etiqueta `<img>` que dispare la carga de lo que sea que
 * el campo tenga.
 *
 * Igual que `cliente-direccion-card`: el `contacto` que manda siempre parte del completo ya cargado.
 */
@Component({
  selector: 'app-cliente-meta-card',
  imports: [FormsModule, ComponentCardComponent],
  template: `
    <app-component-card titulo="Redes e imágenes">
      @if (!editando()) {
        <div class="space-y-4">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p class="text-sm text-texto-tenue">Facebook</p>
              <p class="text-base font-medium text-texto break-all">{{ form().facebook || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Instagram</p>
              <p class="text-base font-medium text-texto break-all">{{ form().instagram || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">LinkedIn</p>
              <p class="text-base font-medium text-texto break-all">{{ form().linkedin || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">X (Twitter)</p>
              <p class="text-base font-medium text-texto break-all">{{ form().x || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Google Maps URL</p>
              <p class="text-base font-medium text-texto break-all">{{ form().googleMapsUrl || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Google Place ID</p>
              <p class="text-base font-medium text-texto break-all">{{ form().googlePlaceId || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Categoría de Google Business</p>
              <p class="text-base font-medium text-texto">{{ form().googleCategoria || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">URL del logo</p>
              <p class="text-base font-medium text-texto break-all">{{ form().logoUrl || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">URL de portada</p>
              <p class="text-base font-medium text-texto break-all">{{ form().portadaUrl || '—' }}</p>
            </div>
          </div>
          <!--
            Acá había un botón «Ver sitio» que no llevaba al sitio del cliente sino a «Mi Portal»,
            la pantalla de datos inventados que se retiró. No se reemplaza: el sitio público lo
            sirve el renderizador en el dominio del cliente, y el portal no tiene hoy ese enlace.
          -->
          <div class="flex justify-end gap-3">
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
              <label class="text-sm font-medium text-texto-medio" for="meta-facebook">Facebook</label>
              <input
                id="meta-facebook"
                name="facebook"
                type="text"
                [ngModel]="draft().facebook"
                (ngModelChange)="actualizar('facebook', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="meta-instagram">Instagram</label>
              <input
                id="meta-instagram"
                name="instagram"
                type="text"
                [ngModel]="draft().instagram"
                (ngModelChange)="actualizar('instagram', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="meta-linkedin">LinkedIn</label>
              <input
                id="meta-linkedin"
                name="linkedin"
                type="text"
                [ngModel]="draft().linkedin"
                (ngModelChange)="actualizar('linkedin', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="meta-x">X (Twitter)</label>
              <input
                id="meta-x"
                name="x"
                type="text"
                [ngModel]="draft().x"
                (ngModelChange)="actualizar('x', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1 md:col-span-2">
              <label class="text-sm font-medium text-texto-medio" for="meta-google-maps">Google Maps URL</label>
              <input
                id="meta-google-maps"
                name="googleMapsUrl"
                type="url"
                [ngModel]="draft().googleMapsUrl"
                (ngModelChange)="actualizar('googleMapsUrl', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="meta-google-place-id">Google Place ID</label>
              <input
                id="meta-google-place-id"
                name="googlePlaceId"
                type="text"
                [ngModel]="draft().googlePlaceId"
                (ngModelChange)="actualizar('googlePlaceId', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="meta-google-categoria">
                Categoría de Google Business
              </label>
              <input
                id="meta-google-categoria"
                name="googleCategoria"
                type="text"
                [ngModel]="draft().googleCategoria"
                (ngModelChange)="actualizar('googleCategoria', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="meta-logo-url">URL del logo</label>
              <input
                id="meta-logo-url"
                name="logoUrl"
                type="url"
                [ngModel]="draft().logoUrl"
                (ngModelChange)="actualizar('logoUrl', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="meta-portada-url">URL de portada</label>
              <input
                id="meta-portada-url"
                name="portadaUrl"
                type="url"
                [ngModel]="draft().portadaUrl"
                (ngModelChange)="actualizar('portadaUrl', $event)"
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
export class ClienteMetaCardComponent {
  readonly cliente = input.required<ClienteAgencia>();
  readonly clientesService = inject(ClientesService);

  readonly editando = signal(false);
  readonly guardando = signal(false);
  readonly draft = signal<FormularioMeta>(formularioVacio());

  /** Vista de solo-lectura: siempre derivada del `cliente` recién cargado, nunca del draft. */
  readonly form = computed(() => metaDesde(this.cliente()));

  editar(): void {
    this.draft.set(metaDesde(this.cliente()));
    this.editando.set(true);
  }

  cancelar(): void {
    this.editando.set(false);
  }

  actualizar<K extends keyof FormularioMeta>(campo: K, valor: FormularioMeta[K]): void {
    this.draft.update((f) => ({ ...f, [campo]: valor }));
  }

  async guardar(): Promise<void> {
    this.guardando.set(true);
    try {
      const f = this.draft();
      const contacto = mergearContacto(this.cliente().contacto);
      pisarTexto(contacto, 'facebook', f.facebook);
      pisarTexto(contacto, 'instagram', f.instagram);
      pisarTexto(contacto, 'linkedin', f.linkedin);
      pisarTexto(contacto, 'x', f.x);
      pisarTexto(contacto, 'google_maps_url', f.googleMapsUrl);
      pisarTexto(contacto, 'google_place_id', f.googlePlaceId);
      pisarTexto(contacto, 'google_categoria', f.googleCategoria);
      pisarTexto(contacto, 'logo_url', f.logoUrl);
      pisarTexto(contacto, 'portada_url', f.portadaUrl);

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

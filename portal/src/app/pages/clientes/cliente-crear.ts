import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectorMiembroComponent } from '../../shared/components/selector-miembro';
import { Router, RouterLink } from '@angular/router';
import { ClientesService } from '../../services/clientes';
import { PageBreadcrumbComponent } from '../../shared/components/page-breadcrumb';
import { ComponentCardComponent } from '../../shared/components/component-card';
import { OPCIONES_VERTICAL } from '../../core/models';
import type { EstadoContrato, NivelActividad, NuevoClienteAgencia, TipoCliente, Vertical } from '../../core/models';

/**
 * Todos los campos que entran al formulario, como texto plano (incluso los que van a un `select` o
 * a un `<input type="date">`). Puerto de `pages/client-create/client-create.component` del origen
 * (Angular 19 + Reactive Forms) a este portal: acá NO hay `FormGroup` — un solo signal con este
 * shape, más `actualizar()` para tocar un campo a la vez (mismo criterio que documenta el brief de
 * la 5b). `NuevoClienteAgencia` no se usa como shape del formulario porque tiene tipos estrictos
 * (`TipoCliente | null`, arrays) que no calzan con lo que un `<input>`/`<select>` puede emitir
 * directamente (siempre string) — `datos()` (más abajo) hace la traducción una sola vez, al enviar.
 */
interface FormularioCliente {
  nombre: string;
  vertical: Vertical | '';
  empresa: string;
  nombreContacto: string;
  email: string;
  telefono: string;
  sitioWeb: string;
  calle: string;
  numero: string;
  ciudad: string;
  codigoPostal: string;
  provincia: string;
  pais: string;
  tipo: TipoCliente | '';
  industria: string;
  etiquetas: string;
  origen: string;
  nivelActividad: NivelActividad | '';
  asignadoA: string;
  estadoContrato: EstadoContrato | '';
  contratoVenceEn: string;
  facebook: string;
  instagram: string;
  linkedin: string;
  x: string;
  googleMapsUrl: string;
  googlePlaceId: string;
  googleCategoria: string;
  logoUrl: string;
  portadaUrl: string;
  notas: string;
}

function formularioVacio(): FormularioCliente {
  return {
    nombre: '',
    vertical: '',
    empresa: '',
    nombreContacto: '',
    email: '',
    telefono: '',
    sitioWeb: '',
    calle: '',
    numero: '',
    ciudad: '',
    codigoPostal: '',
    provincia: '',
    pais: '',
    tipo: '',
    industria: '',
    etiquetas: '',
    origen: '',
    nivelActividad: '',
    asignadoA: '',
    estadoContrato: '',
    contratoVenceEn: '',
    facebook: '',
    instagram: '',
    linkedin: '',
    x: '',
    googleMapsUrl: '',
    googlePlaceId: '',
    googleCategoria: '',
    logoUrl: '',
    portadaUrl: '',
    notas: '',
  };
}

const OPCIONES_TIPO: ReadonlyArray<{ valor: TipoCliente | ''; etiqueta: string }> = [
  { valor: '', etiqueta: 'Sin clasificar' },
  { valor: 'empresa', etiqueta: 'Empresa' },
  { valor: 'autonomo', etiqueta: 'Autónomo' },
  { valor: 'particular', etiqueta: 'Particular' },
];

const OPCIONES_NIVEL_ACTIVIDAD: ReadonlyArray<{ valor: NivelActividad | ''; etiqueta: string }> = [
  { valor: '', etiqueta: 'Sin medir' },
  { valor: 'bajo', etiqueta: 'Bajo' },
  { valor: 'medio', etiqueta: 'Medio' },
  { valor: 'alto', etiqueta: 'Alto' },
];

const OPCIONES_ESTADO_CONTRATO: ReadonlyArray<{ valor: EstadoContrato | ''; etiqueta: string }> = [
  { valor: '', etiqueta: 'Sin especificar (el servidor pone "sin contrato")' },
  { valor: 'sin_contrato', etiqueta: 'Sin contrato' },
  { valor: 'vigente', etiqueta: 'Vigente' },
  { valor: 'vencido', etiqueta: 'Vencido' },
];

/**
 * Pantalla `/clientes/nuevo`: alta de un cliente del CRM. Puerto de `pages/client-create` del
 * origen — sin el editor de sucursales (`client-branches`, decisión ya tomada con el usuario el
 * 2026-08-01: escribe en `business_profile.locations`, un dato detrás de la allowlist pública de
 * `app_render`/ADR-19, y necesita su propio endpoint + tests de seguridad por mutación) y sin
 * `preferences` (idioma/notificaciones/newsletter: dato de la app Firestore vieja, no existe en
 * este esquema).
 *
 * La validación de "nombre" acá es SOLO UX (mínimo 2 caracteres) — la que vale es la del servidor
 * (`POST /clients`, Etapa 3: `nombre` string requerido + los `check` de la 0011 para
 * tipo/nivel_actividad/estado_contrato). Por eso no se bloquea el envío entero contra un estado
 * "form inválido": si el servidor rechaza algo que el cliente no anticipó, el error de
 * `ClientesService` se muestra igual.
 */
@Component({
  selector: 'app-cliente-crear',
  imports: [FormsModule, RouterLink, PageBreadcrumbComponent, ComponentCardComponent, SelectorMiembroComponent],
  template: `
    <div class="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <app-page-breadcrumb titulo="Nuevo cliente" rutaAtras="/clientes" etiquetaAtras="Clientes" />

      <form (ngSubmit)="guardar()" class="space-y-6">
        <app-component-card titulo="Información básica">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-1 md:col-span-2">
              <label class="text-sm font-medium text-texto-medio" for="cliente-nombre">
                Nombre <span class="text-error">*</span>
              </label>
              <input
                id="cliente-nombre"
                name="nombre"
                type="text"
                [ngModel]="form().nombre"
                (ngModelChange)="actualizar('nombre', $event)"
                placeholder="Nombre del cliente"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
              @if (intentoEnviar() && !nombreValido()) {
                <p class="text-xs text-error">El nombre es obligatorio (mínimo 2 caracteres).</p>
              }
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-empresa">Empresa</label>
              <input
                id="cliente-empresa"
                name="empresa"
                type="text"
                [ngModel]="form().empresa"
                (ngModelChange)="actualizar('empresa', $event)"
                placeholder="Nombre de la empresa"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-contacto">Nombre de contacto</label>
              <input
                id="cliente-contacto"
                name="nombreContacto"
                type="text"
                [ngModel]="form().nombreContacto"
                (ngModelChange)="actualizar('nombreContacto', $event)"
                placeholder="Persona de contacto"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-email">Email</label>
              <input
                id="cliente-email"
                name="email"
                type="email"
                [ngModel]="form().email"
                (ngModelChange)="actualizar('email', $event)"
                placeholder="email@ejemplo.com"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-telefono">Teléfono</label>
              <input
                id="cliente-telefono"
                name="telefono"
                type="tel"
                [ngModel]="form().telefono"
                (ngModelChange)="actualizar('telefono', $event)"
                placeholder="+34 000 000 000"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1 md:col-span-2">
              <label class="text-sm font-medium text-texto-medio" for="cliente-sitio-web">Sitio web</label>
              <input
                id="cliente-sitio-web"
                name="sitioWeb"
                type="url"
                [ngModel]="form().sitioWeb"
                (ngModelChange)="actualizar('sitioWeb', $event)"
                placeholder="https://www.ejemplo.com"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
          </div>
        </app-component-card>

        <app-component-card titulo="Dirección">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-calle">Calle</label>
              <input
                id="cliente-calle"
                name="calle"
                type="text"
                [ngModel]="form().calle"
                (ngModelChange)="actualizar('calle', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-numero">Número</label>
              <input
                id="cliente-numero"
                name="numero"
                type="text"
                [ngModel]="form().numero"
                (ngModelChange)="actualizar('numero', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-ciudad">Ciudad</label>
              <input
                id="cliente-ciudad"
                name="ciudad"
                type="text"
                [ngModel]="form().ciudad"
                (ngModelChange)="actualizar('ciudad', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-codigo-postal">Código postal</label>
              <input
                id="cliente-codigo-postal"
                name="codigoPostal"
                type="text"
                [ngModel]="form().codigoPostal"
                (ngModelChange)="actualizar('codigoPostal', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-provincia">Provincia</label>
              <input
                id="cliente-provincia"
                name="provincia"
                type="text"
                [ngModel]="form().provincia"
                (ngModelChange)="actualizar('provincia', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-pais">País</label>
              <input
                id="cliente-pais"
                name="pais"
                type="text"
                [ngModel]="form().pais"
                (ngModelChange)="actualizar('pais', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
          </div>
        </app-component-card>

        <app-component-card titulo="Clasificación">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-vertical">
                Vertical <span class="text-error">*</span>
              </label>
              <select
                id="cliente-vertical"
                name="vertical"
                [ngModel]="form().vertical"
                (ngModelChange)="actualizar('vertical', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              >
                <option value="" disabled>Seleccionar…</option>
                @for (o of OPCIONES_VERTICAL; track o.valor) {
                  <option [value]="o.valor">{{ o.etiqueta }}</option>
                }
              </select>
              @if (intentoEnviar() && !verticalValido()) {
                <p class="text-xs text-error">Elegí un vertical de negocio.</p>
              }
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-tipo">Tipo de cliente</label>
              <select
                id="cliente-tipo"
                name="tipo"
                [ngModel]="form().tipo"
                (ngModelChange)="actualizar('tipo', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              >
                @for (o of OPCIONES_TIPO; track o.valor) {
                  <option [value]="o.valor">{{ o.etiqueta }}</option>
                }
              </select>
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-industria">Industria / sector</label>
              <input
                id="cliente-industria"
                name="industria"
                type="text"
                [ngModel]="form().industria"
                (ngModelChange)="actualizar('industria', $event)"
                placeholder="Ej: Restaurante, Retail, Tecnología"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1 md:col-span-2">
              <label class="text-sm font-medium text-texto-medio" for="cliente-etiquetas">Etiquetas</label>
              <input
                id="cliente-etiquetas"
                name="etiquetas"
                type="text"
                [ngModel]="form().etiquetas"
                (ngModelChange)="actualizar('etiquetas', $event)"
                placeholder="Separadas por comas (ej: premium, Madrid, restaurante)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
              <p class="text-xs text-texto-tenue">Separá las etiquetas con comas.</p>
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-origen">Fuente</label>
              <input
                id="cliente-origen"
                name="origen"
                type="text"
                [ngModel]="form().origen"
                (ngModelChange)="actualizar('origen', $event)"
                placeholder="Ej: Instagram, Web, Referido"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
          </div>
        </app-component-card>

        <app-component-card titulo="Actividad y gestión">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-nivel-actividad">
                Nivel de actividad
              </label>
              <select
                id="cliente-nivel-actividad"
                name="nivelActividad"
                [ngModel]="form().nivelActividad"
                (ngModelChange)="actualizar('nivelActividad', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              >
                @for (o of OPCIONES_NIVEL_ACTIVIDAD; track o.valor) {
                  <option [value]="o.valor">{{ o.etiqueta }}</option>
                }
              </select>
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-asignado-a">Asignado a</label>
              <app-selector-miembro
                idCampo="cliente-asignado-a"
                [valor]="form().asignadoA"
                (cambio)="actualizar('asignadoA', $event)"
              />
            </div>
          </div>
        </app-component-card>

        <app-component-card titulo="Contrato">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-estado-contrato">
                Estado del contrato
              </label>
              <select
                id="cliente-estado-contrato"
                name="estadoContrato"
                [ngModel]="form().estadoContrato"
                (ngModelChange)="actualizar('estadoContrato', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              >
                @for (o of OPCIONES_ESTADO_CONTRATO; track o.valor) {
                  <option [value]="o.valor">{{ o.etiqueta }}</option>
                }
              </select>
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-contrato-vence">
                Fecha de expiración del contrato
              </label>
              <input
                id="cliente-contrato-vence"
                name="contratoVenceEn"
                type="date"
                [ngModel]="form().contratoVenceEn"
                (ngModelChange)="actualizar('contratoVenceEn', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
          </div>
        </app-component-card>

        <app-component-card titulo="Contacto y redes" descripcion="Se guarda todo en el jsonb libre de contacto.">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-facebook">Facebook</label>
              <input
                id="cliente-facebook"
                name="facebook"
                type="text"
                [ngModel]="form().facebook"
                (ngModelChange)="actualizar('facebook', $event)"
                placeholder="URL o usuario de Facebook"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-instagram">Instagram</label>
              <input
                id="cliente-instagram"
                name="instagram"
                type="text"
                [ngModel]="form().instagram"
                (ngModelChange)="actualizar('instagram', $event)"
                placeholder="Usuario o URL de Instagram"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-linkedin">LinkedIn</label>
              <input
                id="cliente-linkedin"
                name="linkedin"
                type="text"
                [ngModel]="form().linkedin"
                (ngModelChange)="actualizar('linkedin', $event)"
                placeholder="Usuario o URL de LinkedIn"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-x">X (Twitter)</label>
              <input
                id="cliente-x"
                name="x"
                type="text"
                [ngModel]="form().x"
                (ngModelChange)="actualizar('x', $event)"
                placeholder="Usuario o URL de X"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1 md:col-span-2">
              <label class="text-sm font-medium text-texto-medio" for="cliente-google-maps">Google Maps URL</label>
              <input
                id="cliente-google-maps"
                name="googleMapsUrl"
                type="url"
                [ngModel]="form().googleMapsUrl"
                (ngModelChange)="actualizar('googleMapsUrl', $event)"
                placeholder="URL de Google Maps del negocio"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-google-place-id">
                Google Place ID
              </label>
              <input
                id="cliente-google-place-id"
                name="googlePlaceId"
                type="text"
                [ngModel]="form().googlePlaceId"
                (ngModelChange)="actualizar('googlePlaceId', $event)"
                placeholder="ID de Google Places"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-google-categoria">
                Categoría de Google Business
              </label>
              <input
                id="cliente-google-categoria"
                name="googleCategoria"
                type="text"
                [ngModel]="form().googleCategoria"
                (ngModelChange)="actualizar('googleCategoria', $event)"
                placeholder="Categoría de negocio"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-logo-url">URL del logo</label>
              <input
                id="cliente-logo-url"
                name="logoUrl"
                type="url"
                [ngModel]="form().logoUrl"
                (ngModelChange)="actualizar('logoUrl', $event)"
                placeholder="URL del logo del cliente"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="cliente-portada-url">
                URL de imagen de portada
              </label>
              <input
                id="cliente-portada-url"
                name="portadaUrl"
                type="url"
                [ngModel]="form().portadaUrl"
                (ngModelChange)="actualizar('portadaUrl', $event)"
                placeholder="URL de imagen de portada"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
          </div>
        </app-component-card>

        <app-component-card titulo="Notas internas">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium text-texto-medio" for="cliente-notas">Notas</label>
            <textarea
              id="cliente-notas"
              name="notas"
              rows="4"
              [ngModel]="form().notas"
              (ngModelChange)="actualizar('notas', $event)"
              placeholder="Notas internas sobre el cliente…"
              class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
            ></textarea>
          </div>
        </app-component-card>

        @if (clientesService.error()) {
          <p class="text-sm text-error">{{ clientesService.error() }}</p>
        }

        <div class="flex justify-end gap-3">
          <a
            routerLink="/clientes"
            class="rounded-md border border-borde-fuerte px-4 py-2 text-sm font-medium text-texto hover:bg-superficie-2"
          >
            Cancelar
          </a>
          <button
            type="submit"
            [disabled]="enviando()"
            class="rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {{ enviando() ? 'Creando…' : 'Crear cliente' }}
          </button>
        </div>
      </form>
    </div>
  `,
})
export class ClienteCrearPage {
  readonly clientesService = inject(ClientesService);
  private readonly router = inject(Router);

  readonly OPCIONES_VERTICAL = OPCIONES_VERTICAL;
  readonly OPCIONES_TIPO = OPCIONES_TIPO;
  readonly OPCIONES_NIVEL_ACTIVIDAD = OPCIONES_NIVEL_ACTIVIDAD;
  readonly OPCIONES_ESTADO_CONTRATO = OPCIONES_ESTADO_CONTRATO;

  readonly form = signal<FormularioCliente>(formularioVacio());
  readonly enviando = signal(false);
  /** Se pone en `true` recién al intentar enviar — así el error de "nombre" no aparece antes de tiempo. */
  readonly intentoEnviar = signal(false);

  readonly nombreValido = computed(() => this.form().nombre.trim().length >= 2);
  /** A diferencia de `tipo`, acá no hay "sin clasificar": `db`/`api` ya lo exigen (Tasks 1-11 del
   *  sub-proyecto multivertical-clientes), y el formulario no puede dejar enviar sin elegir uno. */
  readonly verticalValido = computed(() => this.form().vertical !== '');

  actualizar<K extends keyof FormularioCliente>(campo: K, valor: FormularioCliente[K]): void {
    this.form.update((f) => ({ ...f, [campo]: valor }));
  }

  /** Arma el `NuevoClienteAgencia` que espera `ClientesService.crear()` a partir del formulario. */
  private datos(): NuevoClienteAgencia {
    const f = this.form();
    const etiquetas = f.etiquetas
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    return {
      nombre: f.nombre.trim(),
      // El formulario no permite submit sin elegir uno (ver `guardar()` + `verticalValido`), así que
      // acá viaja siempre, sin el condicional "si está vacío no se manda" que usan los campos opcionales.
      vertical: f.vertical as Vertical,
      tipo: f.tipo === '' ? null : f.tipo,
      industria: limpio(f.industria),
      etiquetas,
      origen: limpio(f.origen),
      nivel_actividad: f.nivelActividad === '' ? null : f.nivelActividad,
      asignado_a: limpio(f.asignadoA),
      // '' = "no elegido": se omite para que valga el default del servidor (0011_clientes_crm.sql),
      // no un default inventado acá.
      estado_contrato: f.estadoContrato === '' ? undefined : f.estadoContrato,
      contrato_vence_en: f.contratoVenceEn === '' ? null : f.contratoVenceEn,
      contacto: this.contacto(f),
    };
  }

  /**
   * `contacto` es jsonb de forma libre (ver `core/models.ts`): claves en español, y solo se agregan
   * las que el usuario completó — no se guardan strings vacíos ni un objeto `direccion` vacío.
   */
  private contacto(f: FormularioCliente): Record<string, unknown> {
    const contacto: Record<string, unknown> = {};
    agregarSi(contacto, 'empresa', f.empresa);
    agregarSi(contacto, 'nombre_contacto', f.nombreContacto);
    agregarSi(contacto, 'email', f.email);
    agregarSi(contacto, 'telefono', f.telefono);
    agregarSi(contacto, 'sitio_web', f.sitioWeb);
    agregarSi(contacto, 'facebook', f.facebook);
    agregarSi(contacto, 'instagram', f.instagram);
    agregarSi(contacto, 'linkedin', f.linkedin);
    agregarSi(contacto, 'x', f.x);
    agregarSi(contacto, 'google_maps_url', f.googleMapsUrl);
    agregarSi(contacto, 'google_place_id', f.googlePlaceId);
    agregarSi(contacto, 'google_categoria', f.googleCategoria);
    agregarSi(contacto, 'logo_url', f.logoUrl);
    agregarSi(contacto, 'portada_url', f.portadaUrl);
    agregarSi(contacto, 'notas', f.notas);

    const direccion: Record<string, unknown> = {};
    agregarSi(direccion, 'calle', f.calle);
    agregarSi(direccion, 'numero', f.numero);
    agregarSi(direccion, 'ciudad', f.ciudad);
    agregarSi(direccion, 'codigo_postal', f.codigoPostal);
    agregarSi(direccion, 'provincia', f.provincia);
    agregarSi(direccion, 'pais', f.pais);
    if (Object.keys(direccion).length > 0) contacto['direccion'] = direccion;

    return contacto;
  }

  async guardar(): Promise<void> {
    this.intentoEnviar.set(true);
    if (!this.nombreValido() || !this.verticalValido()) return;

    this.enviando.set(true);
    try {
      await this.clientesService.crear(this.datos());
      // `crear()` (Etapa 4) nunca rechaza: atrapa el error del servidor en `clientesService.error`.
      // Solo navegamos si de verdad no quedó nada ahí — si no, el cartel de error se queda en pantalla.
      if (!this.clientesService.error()) {
        await this.router.navigate(['/clientes']);
      }
    } finally {
      this.enviando.set(false);
    }
  }
}

function limpio(valor: string): string | null {
  const v = valor.trim();
  return v === '' ? null : v;
}

function agregarSi(destino: Record<string, unknown>, clave: string, valor: string): void {
  const v = valor.trim();
  if (v !== '') destino[clave] = v;
}

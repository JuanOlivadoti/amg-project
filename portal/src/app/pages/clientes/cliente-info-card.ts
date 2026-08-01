import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClientesService } from '../../services/clientes';
import { ComponentCardComponent } from '../../shared/components/component-card';
import type {
  CambiosClienteAgencia,
  ClienteAgencia,
  EstadoContrato,
  NivelActividad,
  TipoCliente,
} from '../../core/models';
import { limpio, mergearContacto, pisarTexto } from './contacto-utils';

/** Mismas tres listas que `cliente-crear.ts` (Etapa 5b) — se duplican porque ese archivo está cerrado. */
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
  { valor: '', etiqueta: 'Sin especificar' },
  { valor: 'sin_contrato', etiqueta: 'Sin contrato' },
  { valor: 'vigente', etiqueta: 'Vigente' },
  { valor: 'vencido', etiqueta: 'Vencido' },
];

interface FormularioInfo {
  nombre: string;
  tipo: TipoCliente | '';
  industria: string;
  etiquetas: string;
  origen: string;
  nivelActividad: NivelActividad | '';
  asignadoA: string;
  estadoContrato: EstadoContrato | '';
  contratoVenceEn: string;
  score: string;
  empresa: string;
  nombreContacto: string;
  email: string;
  telefono: string;
  sitioWeb: string;
  notas: string;
}

function formularioVacio(): FormularioInfo {
  return {
    nombre: '',
    tipo: '',
    industria: '',
    etiquetas: '',
    origen: '',
    nivelActividad: '',
    asignadoA: '',
    estadoContrato: '',
    contratoVenceEn: '',
    score: '',
    empresa: '',
    nombreContacto: '',
    email: '',
    telefono: '',
    sitioWeb: '',
    notas: '',
  };
}

/** Arma el formulario de edición a partir del `ClienteAgencia` cargado (campos propios + `contacto`). */
function formularioDesde(c: ClienteAgencia): FormularioInfo {
  const contacto = c.contacto ?? {};
  const texto = (clave: string): string => {
    const v = contacto[clave];
    return typeof v === 'string' ? v : '';
  };
  return {
    nombre: c.nombre,
    tipo: c.tipo ?? '',
    industria: c.industria ?? '',
    etiquetas: c.etiquetas.join(', '),
    origen: c.origen ?? '',
    nivelActividad: c.nivel_actividad ?? '',
    asignadoA: c.asignado_a ?? '',
    estadoContrato: c.estado_contrato,
    contratoVenceEn: c.contrato_vence_en ?? '',
    score: c.score === null ? '' : String(c.score),
    empresa: texto('empresa'),
    nombreContacto: texto('nombre_contacto'),
    email: texto('email'),
    telefono: texto('telefono'),
    sitioWeb: texto('sitio_web'),
    notas: texto('notas'),
  };
}

/**
 * Card "Información" de `/clientes/:id` (Etapa 5c). Puerto de `client-info-card` del origen sin
 * modal: edita inline con un signal `editando` local, mismo patrón que el resto de los cards de
 * esta pantalla (ver el brief — el origen resuelve esto con un modal que este portal no tiene).
 *
 * Mezcla campos propios de `ClienteAgencia` (nombre, tipo, ...) con campos de `contacto` (empresa,
 * email, ...): al guardar arma UN solo `CambiosClienteAgencia` con ambos grupos, pero el `contacto`
 * SIEMPRE parte de `mergearContacto(cliente().contacto)` — el completo ya cargado — y recién ahí
 * pisa sus propias claves, para no borrar lo que guardó el card de dirección/redes/recursos (todos
 * comparten el mismo jsonb).
 */
@Component({
  selector: 'app-cliente-info-card',
  imports: [FormsModule, ComponentCardComponent],
  template: `
    <app-component-card titulo="Información">
      @if (!editando()) {
        <div class="space-y-6">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p class="text-sm text-texto-tenue">Nombre</p>
              <p class="text-base font-medium text-texto">{{ cliente().nombre }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Empresa</p>
              <p class="text-base font-medium text-texto">{{ empresa() || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Contacto</p>
              <p class="text-base font-medium text-texto">{{ nombreContacto() || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Email</p>
              <p class="text-base font-medium text-texto">{{ email() || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Teléfono</p>
              <p class="text-base font-medium text-texto">{{ telefono() || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Sitio web</p>
              <p class="text-base font-medium text-texto">{{ sitioWeb() || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Tipo</p>
              <p class="text-base font-medium text-texto">{{ cliente().tipo ?? 'Sin clasificar' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Industria</p>
              <p class="text-base font-medium text-texto">{{ cliente().industria || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Fuente</p>
              <p class="text-base font-medium text-texto">{{ cliente().origen || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Nivel de actividad</p>
              <p class="text-base font-medium text-texto">{{ cliente().nivel_actividad ?? 'Sin medir' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Estado del contrato</p>
              <p class="text-base font-medium text-texto">{{ cliente().estado_contrato }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Contrato vence</p>
              <p class="text-base font-medium text-texto">{{ cliente().contrato_vence_en || '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Score</p>
              <p class="text-base font-medium text-texto">{{ cliente().score ?? '—' }}</p>
            </div>
            <div>
              <p class="text-sm text-texto-tenue">Asignado a</p>
              <p class="text-base font-medium text-texto">{{ cliente().asignado_a || '—' }}</p>
            </div>
          </div>
          @if (notas()) {
            <div>
              <p class="text-sm text-texto-tenue">Notas</p>
              <p class="text-base text-texto whitespace-pre-wrap">{{ notas() }}</p>
            </div>
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
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="info-nombre">Nombre</label>
              <input
                id="info-nombre"
                name="nombre"
                type="text"
                [ngModel]="form().nombre"
                (ngModelChange)="actualizar('nombre', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="info-empresa">Empresa</label>
              <input
                id="info-empresa"
                name="empresa"
                type="text"
                [ngModel]="form().empresa"
                (ngModelChange)="actualizar('empresa', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="info-contacto">Nombre de contacto</label>
              <input
                id="info-contacto"
                name="nombreContacto"
                type="text"
                [ngModel]="form().nombreContacto"
                (ngModelChange)="actualizar('nombreContacto', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="info-email">Email</label>
              <input
                id="info-email"
                name="email"
                type="email"
                [ngModel]="form().email"
                (ngModelChange)="actualizar('email', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="info-telefono">Teléfono</label>
              <input
                id="info-telefono"
                name="telefono"
                type="tel"
                [ngModel]="form().telefono"
                (ngModelChange)="actualizar('telefono', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="info-sitio-web">Sitio web</label>
              <input
                id="info-sitio-web"
                name="sitioWeb"
                type="url"
                [ngModel]="form().sitioWeb"
                (ngModelChange)="actualizar('sitioWeb', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="info-tipo">Tipo de cliente</label>
              <select
                id="info-tipo"
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
              <label class="text-sm font-medium text-texto-medio" for="info-industria">Industria</label>
              <input
                id="info-industria"
                name="industria"
                type="text"
                [ngModel]="form().industria"
                (ngModelChange)="actualizar('industria', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1 md:col-span-2">
              <label class="text-sm font-medium text-texto-medio" for="info-etiquetas">Etiquetas</label>
              <input
                id="info-etiquetas"
                name="etiquetas"
                type="text"
                [ngModel]="form().etiquetas"
                (ngModelChange)="actualizar('etiquetas', $event)"
                placeholder="Separadas por comas"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="info-origen">Fuente</label>
              <input
                id="info-origen"
                name="origen"
                type="text"
                [ngModel]="form().origen"
                (ngModelChange)="actualizar('origen', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="info-nivel-actividad">
                Nivel de actividad
              </label>
              <select
                id="info-nivel-actividad"
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
              <label class="text-sm font-medium text-texto-medio" for="info-estado-contrato">
                Estado del contrato
              </label>
              <select
                id="info-estado-contrato"
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
              <label class="text-sm font-medium text-texto-medio" for="info-contrato-vence">Contrato vence</label>
              <input
                id="info-contrato-vence"
                name="contratoVenceEn"
                type="date"
                [ngModel]="form().contratoVenceEn"
                (ngModelChange)="actualizar('contratoVenceEn', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="info-score">Score</label>
              <input
                id="info-score"
                name="score"
                type="number"
                [ngModel]="form().score"
                (ngModelChange)="actualizar('score', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-texto-medio" for="info-asignado-a">Asignado a</label>
              <input
                id="info-asignado-a"
                name="asignadoA"
                type="text"
                [ngModel]="form().asignadoA"
                (ngModelChange)="actualizar('asignadoA', $event)"
                placeholder="uuid del usuario responsable"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1 md:col-span-2">
              <label class="text-sm font-medium text-texto-medio" for="info-notas">Notas</label>
              <textarea
                id="info-notas"
                name="notas"
                rows="3"
                [ngModel]="form().notas"
                (ngModelChange)="actualizar('notas', $event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
              ></textarea>
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
export class ClienteInfoCardComponent {
  readonly cliente = input.required<ClienteAgencia>();
  readonly clientesService = inject(ClientesService);

  readonly OPCIONES_TIPO = OPCIONES_TIPO;
  readonly OPCIONES_NIVEL_ACTIVIDAD = OPCIONES_NIVEL_ACTIVIDAD;
  readonly OPCIONES_ESTADO_CONTRATO = OPCIONES_ESTADO_CONTRATO;

  readonly editando = signal(false);
  readonly guardando = signal(false);
  readonly form = signal<FormularioInfo>(formularioVacio());

  private texto(clave: string): string {
    const v = this.cliente().contacto?.[clave];
    return typeof v === 'string' ? v : '';
  }
  readonly empresa = computed(() => this.texto('empresa'));
  readonly nombreContacto = computed(() => this.texto('nombre_contacto'));
  readonly email = computed(() => this.texto('email'));
  readonly telefono = computed(() => this.texto('telefono'));
  readonly sitioWeb = computed(() => this.texto('sitio_web'));
  readonly notas = computed(() => this.texto('notas'));

  editar(): void {
    this.form.set(formularioDesde(this.cliente()));
    this.editando.set(true);
  }

  cancelar(): void {
    this.editando.set(false);
  }

  actualizar<K extends keyof FormularioInfo>(campo: K, valor: FormularioInfo[K]): void {
    this.form.update((f) => ({ ...f, [campo]: valor }));
  }

  async guardar(): Promise<void> {
    this.guardando.set(true);
    try {
      const f = this.form();
      const contacto = mergearContacto(this.cliente().contacto);
      pisarTexto(contacto, 'empresa', f.empresa);
      pisarTexto(contacto, 'nombre_contacto', f.nombreContacto);
      pisarTexto(contacto, 'email', f.email);
      pisarTexto(contacto, 'telefono', f.telefono);
      pisarTexto(contacto, 'sitio_web', f.sitioWeb);
      pisarTexto(contacto, 'notas', f.notas);

      const cambios: CambiosClienteAgencia = {
        nombre: f.nombre.trim(),
        tipo: f.tipo === '' ? null : f.tipo,
        industria: limpio(f.industria),
        etiquetas: f.etiquetas
          .split(',')
          .map((e) => e.trim())
          .filter(Boolean),
        origen: limpio(f.origen),
        nivel_actividad: f.nivelActividad === '' ? null : f.nivelActividad,
        estado_contrato: f.estadoContrato === '' ? undefined : f.estadoContrato,
        contrato_vence_en: f.contratoVenceEn === '' ? null : f.contratoVenceEn,
        score: f.score.trim() === '' ? null : Number(f.score),
        asignado_a: limpio(f.asignadoA),
        contacto,
      };

      const id = this.cliente().id;
      await this.clientesService.actualizar(id, cambios);
      if (!this.clientesService.error()) {
        await this.clientesService.verCliente(id);
        this.editando.set(false);
      }
    } finally {
      this.guardando.set(false);
    }
  }
}

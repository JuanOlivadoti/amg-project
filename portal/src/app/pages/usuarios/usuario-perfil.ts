import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MembresiaService } from '../../services/membresia';
import { ClientesService } from '../../services/clientes';
import { AuthService } from '../../services/auth';
import { ApiService } from '../../services/api';
import { PageBreadcrumbComponent } from '../../shared/components/page-breadcrumb';
import { ComponentCardComponent } from '../../shared/components/component-card';
import { UsuarioCapacidadesCardComponent } from './usuario-capacidades-card';
import { ROLES_ASIGNABLES, motivoParaNoGuardar, nombreDe } from '../../core/miembros';

/**
 * Pantalla `/usuarios/:id`: la ficha de un miembro y, si quien mira es `maestro`, el cambio de rol.
 *
 * Del `user-profile` del origen se portan la ficha y la tarjeta de capacidades (reescrita como
 * derivada, ver `usuario-capacidades-card.ts`). **No se porta `user-activity-card`**: AMG no registra
 * actividad por usuario y `auth.users.last_sign_in_at` no está disponible —el portal lee `memberships`
 * a través de una vista que expone `email` y `raw_app_meta_data`, nada más, y ampliarla para llenar
 * una tarjeta sería exactamente la clase de concesión que esta pieza vino a evitar. Una tarjeta de
 * ceros es peor que ninguna tarjeta.
 *
 * El cambio de rol se oculta para quien no es `maestro` y para la propia fila. **Ocultar no es
 * autorizar**: quien fuerce el PATCH igual cae en `membership_update` (0012), que exige ser maestro
 * y que no sea su propia fila, y la API devuelve 403. Lo de acá es cortesía, no defensa.
 *
 * **La tarjeta de Telegram (Bloque F, fase 2, RF-018) va SOLO en el propio perfil** (`esPropio()`),
 * al revés que "Cambiar el rol" (que un `maestro` ve sobre cualquier fila): nadie vincula el Telegram
 * de otra persona. El `GET /me/telegram` ni siquiera se pide si se está mirando el perfil ajeno.
 */
@Component({
  selector: 'app-usuario-perfil',
  imports: [FormsModule, PageBreadcrumbComponent, ComponentCardComponent, UsuarioCapacidadesCardComponent],
  template: `
    <div class="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <app-page-breadcrumb titulo="Miembro" etiquetaAtras="Usuarios" rutaAtras="/usuarios" />

      @if (!membresia.resuelto() && !membresia.error()) {
        <p class="text-sm text-texto-tenue">Cargando…</p>
      } @else if (!miembro()) {
        <app-component-card>
          <p class="text-sm text-texto-medio">
            No encontramos ese miembro, o tu rol no te deja verlo.
          </p>
        </app-component-card>
      } @else {
        <app-component-card titulo="Ficha">
          <dl class="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt class="text-texto-tenue">Nombre</dt>
              <dd class="text-texto">{{ nombre() }}</dd>
            </div>
            <div>
              <dt class="text-texto-tenue">Email</dt>
              <dd class="text-texto">{{ miembro()!.email ?? 'sin email en Auth' }}</dd>
            </div>
            <div>
              <dt class="text-texto-tenue">Rol</dt>
              <dd class="text-texto">{{ miembro()!.rol }}</dd>
            </div>
            <div>
              <dt class="text-texto-tenue">Miembro desde</dt>
              <dd class="text-texto">{{ miembro()!.created_at?.slice(0, 10) ?? '—' }}</dd>
            </div>
            <div class="sm:col-span-2">
              <dt class="text-texto-tenue">Identificador en Auth</dt>
              <dd><code class="text-xs text-texto-medio">{{ miembro()!.user_id }}</code></dd>
            </div>
          </dl>
        </app-component-card>

        @if (puedeCambiar()) {
          <app-component-card
            titulo="Cambiar el rol"
            descripcion="Cambia lo que esta persona puede hacer en todo el tenant."
          >
            <div class="flex flex-col gap-3">
              <label class="flex flex-col gap-1 text-sm">
                <span class="text-texto-tenue">Rol</span>
                <select
                  id="usuario-rol"
                  name="rol"
                  [ngModel]="rolElegido()"
                  (ngModelChange)="rolElegido.set($event)"
                  class="rounded-md border border-borde-fuerte bg-superficie px-3 py-2 text-sm text-texto"
                >
                  @for (r of rolesAsignables; track r.valor) {
                    <option [value]="r.valor">{{ r.etiqueta }}</option>
                  }
                </select>
              </label>

              @if (rolElegido() === 'cliente') {
                <label class="flex flex-col gap-1 text-sm">
                  <span class="text-texto-tenue">Negocio asignado</span>
                  <select
                    id="usuario-cliente"
                    name="clientId"
                    [ngModel]="clienteElegido()"
                    (ngModelChange)="clienteElegido.set($event)"
                    class="rounded-md border border-borde-fuerte bg-superficie px-3 py-2 text-sm text-texto"
                  >
                    <option value="">— Elegí un negocio —</option>
                    @for (c of clientes.clientes(); track c.id) {
                      <option [value]="c.id">{{ c.nombre }}</option>
                    }
                  </select>
                  <span class="text-xs text-texto-tenue">
                    Un rol cliente solo ve su propio negocio, y solo de lectura.
                  </span>
                </label>
              }

              @if (motivo()) {
                <p class="text-sm text-texto-medio">{{ motivo() }}</p>
              }
              @if (errorGuardar()) {
                <p class="text-sm text-error">{{ errorGuardar() }}</p>
              }
              @if (confirmando()) {
                <div class="rounded-md border border-borde bg-superficie-2 p-3 text-sm flex flex-col gap-3">
                  <p class="text-texto">
                    Vas a cambiar el rol de {{ nombre() }} a «{{ rolElegido() }}». Es un cambio de
                    privilegios en todo el tenant.
                  </p>
                  <div class="flex gap-2">
                    <button
                      type="button"
                      (click)="guardar()"
                      [disabled]="guardando()"
                      class="rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                    >
                      {{ guardando() ? 'Guardando…' : 'Sí, cambiar el rol' }}
                    </button>
                    <button
                      type="button"
                      (click)="confirmando.set(false)"
                      class="rounded-md border border-borde px-4 py-2 text-sm text-texto hover:bg-superficie-2"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              } @else {
                <div>
                  <button
                    type="button"
                    (click)="confirmando.set(true)"
                    [disabled]="motivo().length > 0 || sinCambio()"
                    class="rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    Cambiar el rol
                  </button>
                </div>
              }
            </div>
          </app-component-card>
        } @else if (esPropio()) {
          <app-component-card titulo="Cambiar el rol">
            <p class="text-sm text-texto-medio">
              Nadie puede cambiar su propio rol, ni siquiera un maestro. Es lo que evita que alguien
              se deje afuera de la pantalla que arreglaría el error. Pedíselo a otro maestro.
            </p>
          </app-component-card>
        }

        <!-- Solo el propio perfil: nadie puede vincular el Telegram de otra persona. Ocultarla acá es
             cortesía, no defensa -- la autorización real la impone quién puede pedir /me/telegram/*. -->
        @if (esPropio()) {
          <app-component-card
            titulo="Alertas de Telegram"
            descripcion="Recibí un aviso en Telegram cuando llegue una reseña de Google de 1 a 3 estrellas."
          >
            @if (cargandoTelegram()) {
              <p class="text-sm text-texto-tenue">Cargando…</p>
            } @else if (telegramVinculado()) {
              <div class="flex flex-col gap-3">
                <p class="text-sm text-texto">Telegram vinculado.</p>
                <div>
                  <button
                    type="button"
                    (click)="desvincularTelegram()"
                    class="rounded-md border border-borde px-4 py-2 text-sm font-medium text-texto hover:bg-superficie-2"
                  >
                    Desvincular
                  </button>
                </div>
              </div>
            } @else {
              <div class="flex flex-col gap-3">
                <div>
                  <button
                    type="button"
                    (click)="vincularTelegram()"
                    class="rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90"
                  >
                    Vincular Telegram
                  </button>
                </div>
                @if (mensajeTelegram()) {
                  <p class="text-sm text-texto-medio">{{ mensajeTelegram() }}</p>
                }
              </div>
            }
            @if (errorTelegram()) {
              <p class="text-sm text-error">{{ errorTelegram() }}</p>
            }
          </app-component-card>
        }

        <app-usuario-capacidades-card [rol]="miembro()!.rol" />
      }
    </div>
  `,
})
export class UsuarioPerfilPage implements OnInit {
  readonly membresia = inject(MembresiaService);
  readonly clientes = inject(ClientesService);
  private readonly auth = inject(AuthService);
  private readonly ruta = inject(ActivatedRoute);
  private readonly api = inject(ApiService);

  readonly rolesAsignables = ROLES_ASIGNABLES;

  private readonly userId = signal('');
  readonly rolElegido = signal('');
  readonly clienteElegido = signal('');
  readonly confirmando = signal(false);
  readonly guardando = signal(false);
  readonly errorGuardar = signal('');

  /** Estado de la tarjeta de Telegram (Bloque F, fase 2). Solo se pide si `esPropio()`. */
  readonly cargandoTelegram = signal(true);
  readonly telegramVinculado = signal(false);
  readonly mensajeTelegram = signal('');
  readonly errorTelegram = signal('');

  readonly miembro = computed(() => this.membresia.miembros().find((m) => m.user_id === this.userId()) ?? null);
  readonly nombre = computed(() => {
    const m = this.miembro();
    return m ? nombreDe(m) : '';
  });

  readonly esPropio = computed(() => this.userId() === (this.auth.sesion()?.userId ?? ''));

  /** Ocultar el formulario es cortesía; la autorización la impone `membership_update` (0012). */
  readonly puedeCambiar = computed(
    () => this.membresia.rol() === 'maestro' && !this.esPropio() && this.miembro() !== null,
  );

  readonly sinCambio = computed(() => {
    const m = this.miembro();
    if (!m) return true;
    const mismoCliente = (this.clienteElegido() || null) === m.client_id;
    return this.rolElegido() === m.rol && (this.rolElegido() !== 'cliente' || mismoCliente);
  });

  readonly motivo = computed(() =>
    motivoParaNoGuardar({
      userIdObjetivo: this.userId(),
      userIdPropio: this.auth.sesion()?.userId ?? '',
      rol: this.rolElegido(),
      clientId: this.clienteElegido() || null,
    }),
  );

  async ngOnInit(): Promise<void> {
    this.userId.set(this.ruta.snapshot.paramMap.get('id') ?? '');
    await Promise.all([this.membresia.resolver(), this.clientes.cargar()]);
    const m = this.miembro();
    if (m) {
      this.rolElegido.set(m.rol);
      this.clienteElegido.set(m.client_id ?? '');
    }
    // Sin esto, mirar el perfil de otra persona dispararía un GET /me/telegram que no tiene sentido:
    // es sobre la propia cuenta, nunca sobre la fila que se está mirando.
    if (this.esPropio()) {
      await this.cargarTelegram();
    } else {
      this.cargandoTelegram.set(false);
    }
  }

  private async cargarTelegram(): Promise<void> {
    this.cargandoTelegram.set(true);
    try {
      const { vinculado } = await this.api.telegramVinculado();
      this.telegramVinculado.set(vinculado);
    } catch (e) {
      this.errorTelegram.set(e instanceof Error ? e.message : 'No se pudo consultar el estado de Telegram.');
    } finally {
      this.cargandoTelegram.set(false);
    }
  }

  /**
   * Abre la URL de `https://t.me/<bot>?start=<código>` en una pestaña NUEVA (`window.open`), no en
   * la propia (`window.location.href` como hace `conectar()` de Google) — acá no hay callback que
   * traiga de vuelta a esta pestaña, así que navegar afuera del todo dejaría al usuario varado. No
   * hay forma de saber en tiempo real cuándo el orquestador procesó el `/start` (mismo límite que
   * "Publicada el ..." en `cliente-resenas.ts`), así que se lo dice y punto: hay que recargar a mano.
   */
  async vincularTelegram(): Promise<void> {
    this.errorTelegram.set('');
    try {
      const { url } = await this.api.vincularTelegram();
      window.open(url, '_blank');
      this.mensajeTelegram.set(
        'Abrí el link, apretá Start en Telegram, y volvé a cargar esta página para confirmar.',
      );
    } catch (e) {
      this.errorTelegram.set(e instanceof Error ? e.message : 'No se pudo generar el link de Telegram.');
    }
  }

  async desvincularTelegram(): Promise<void> {
    this.errorTelegram.set('');
    try {
      await this.api.desvincularTelegram();
      this.telegramVinculado.set(false);
      this.mensajeTelegram.set('');
    } catch (e) {
      this.errorTelegram.set(e instanceof Error ? e.message : 'No se pudo desvincular Telegram.');
    }
  }

  async guardar(): Promise<void> {
    this.guardando.set(true);
    this.errorGuardar.set('');
    try {
      await this.membresia.cambiarRol(
        this.userId(),
        this.rolElegido(),
        this.rolElegido() === 'cliente' ? this.clienteElegido() || null : null,
      );
      this.confirmando.set(false);
    } catch (e) {
      // El mensaje que llega es el de la API. Los tres casos que importan tienen texto propio del
      // servidor: 403 de RLS (no sos maestro), 400 por la constraint del último maestro, 404 por
      // tenant ajeno. No se traduce acá para no inventar una causa distinta de la real.
      this.errorGuardar.set(e instanceof Error ? e.message : 'No se pudo cambiar el rol.');
    } finally {
      this.guardando.set(false);
    }
  }
}

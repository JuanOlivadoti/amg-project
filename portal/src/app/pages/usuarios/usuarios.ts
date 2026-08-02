import { Component, OnInit, computed, inject } from '@angular/core';
import { MembresiaService } from '../../services/membresia';
import { ClientesService } from '../../services/clientes';
import { PageBreadcrumbComponent } from '../../shared/components/page-breadcrumb';
import { ComponentCardComponent } from '../../shared/components/component-card';
import { UsuariosTablaComponent } from './usuarios-tabla';
import { AuthService } from '../../services/auth';

/**
 * Pantalla `/usuarios`: quién tiene acceso al tenant y con qué rol.
 *
 * **No hay alta de usuarios, y no es un pendiente.** Crear una cuenta es crearla en Supabase Auth, y
 * la API no recibe ninguna credencial de Supabase (cuatro claves, ninguna service key). Esta
 * pantalla trabaja sobre personas que YA existen en Auth: reparte accesos, no cuentas. El aviso lo
 * dice en la pantalla en vez de esconder un botón que fingiría funcionar.
 *
 * Puerto de `pages/users/users.page` del origen, reescrito con signals. Del original quedó fuera lo
 * que no tenía correlato: el `console.log('Users from store:')`, el `users$` reasignado dentro de un
 * `subscribe` (que es justo lo que el port a signals elimina de raíz), el `allIdeas` sin usar y un
 * `import { Idea }` que no pertenecía a esta pantalla.
 */
@Component({
  selector: 'app-usuarios',
  imports: [PageBreadcrumbComponent, ComponentCardComponent, UsuariosTablaComponent],
  template: `
    <div class="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <app-page-breadcrumb titulo="Usuarios" />

      <app-component-card>
        <div class="flex flex-col gap-4">
          <div class="flex items-start justify-between gap-3">
            <p class="text-sm text-texto-tenue">{{ membresia.miembros().length }} miembro(s)</p>
          </div>

          <p class="text-sm text-texto-medio">
            Las cuentas se crean en Supabase Auth. Desde acá se reparte el acceso al tenant: quién
            entra y con qué rol.
          </p>

          @if (membresia.error()) {
            <p class="text-sm text-error">{{ membresia.error() }}</p>
          } @else if (!membresia.resuelto()) {
            <p class="text-sm text-texto-tenue">Cargando…</p>
          } @else {
            @if (soloVeSuFila()) {
              <p class="text-sm text-texto-medio">
                Con tu rol solo ves tu propia membresía.
              </p>
            }
            <app-usuarios-tabla
              [miembros]="membresia.miembros()"
              [propio]="userId()"
              [nombreDeCliente]="nombreDeCliente()"
            />
          }
        </div>
      </app-component-card>
    </div>
  `,
})
export class UsuariosPage implements OnInit {
  readonly membresia = inject(MembresiaService);
  private readonly clientes = inject(ClientesService);
  private readonly auth = inject(AuthService);

  readonly userId = computed(() => this.auth.sesion()?.userId ?? '');

  /** Para mostrar el negocio por nombre y no por uuid. Si no llegó la cartera, se cae al uuid. */
  readonly nombreDeCliente = computed<Record<string, string>>(() => {
    const mapa: Record<string, string> = {};
    for (const c of this.clientes.clientes()) mapa[c.id] = c.nombre;
    return mapa;
  });

  /**
   * Que la lista tenga una sola fila y esa fila sea la propia no lo decide esta pantalla: es lo que
   * la vista `membresias_perfil` deja pasar para un rol `cliente`. Se explica para que no parezca un
   * error de carga.
   */
  readonly soloVeSuFila = computed(() => {
    const m = this.membresia.miembros();
    return m.length === 1 && m[0]?.user_id === this.userId();
  });

  async ngOnInit(): Promise<void> {
    // La cartera solo se usa para traducir `client_id` a un nombre; que falle no rompe la pantalla.
    await Promise.all([this.membresia.resolver(), this.clientes.cargar()]);
  }
}

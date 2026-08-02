import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Miembro } from '../../core/models';
import { nombreDe } from '../../core/miembros';

/**
 * Tabla de miembros del tenant. Consume la lista tal como llegó de `GET /members` — no filtra ni
 * decide qué filas se ven: eso lo resolvió la vista `membresias_perfil` (0012) dentro de Postgres.
 * Un rol `cliente` que abra esta pantalla ve una sola fila, la suya, y no porque acá haya un `if`.
 *
 * Puerto de `shared/components/tables/users-table` del origen, sin sus columnas de permisos (los 20
 * booleanos que acá no existen) y sin la de actividad: AMG no registra actividad por usuario, y una
 * columna de ceros es peor que no tenerla.
 */
@Component({
  selector: 'app-usuarios-tabla',
  imports: [RouterLink],
  template: `
    <div class="bg-superficie rounded-xl border border-borde overflow-x-auto">
      <table class="min-w-full text-sm">
        <thead>
          <tr class="text-left text-texto-tenue border-b border-borde">
            <th class="px-4 py-2 font-medium">Persona</th>
            <th class="px-4 py-2 font-medium">Rol</th>
            <th class="px-4 py-2 font-medium">Negocio asignado</th>
            <th class="px-4 py-2 font-medium sr-only">Acciones</th>
          </tr>
        </thead>
        <tbody>
          @for (m of miembros(); track m.user_id) {
            <tr class="border-b border-borde last:border-0">
              <td class="px-4 py-2">
                <span class="text-texto font-medium">{{ nombre(m) }}</span>
                @if (m.user_id === propio()) {
                  <span class="ml-2 text-xs rounded-full px-2 py-0.5 bg-superficie-2 text-texto-medio">
                    Vos
                  </span>
                }
                <span class="block text-xs text-texto-tenue">{{ m.email ?? 'sin email en Auth' }}</span>
              </td>
              <td class="px-4 py-2">
                <span class="text-xs rounded-full px-2 py-0.5" [class]="claseRol(m.rol)">
                  {{ etiquetaRol(m.rol) }}
                </span>
              </td>
              <td class="px-4 py-2 text-texto-medio">
                {{ m.rol === 'cliente' ? (nombreDeCliente()[m.client_id ?? ''] ?? m.client_id ?? '—') : '—' }}
              </td>
              <td class="px-4 py-2 text-right">
                <a
                  [routerLink]="['/usuarios', m.user_id]"
                  class="rounded-md px-3 py-1.5 text-texto hover:bg-superficie-2"
                >
                  Ver
                </a>
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="4" class="px-4 py-6 text-center text-texto-tenue">
                No hay miembros que mostrar.
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class UsuariosTablaComponent {
  readonly miembros = input.required<readonly Miembro[]>();
  /** El `user_id` de quien mira, para marcar su propia fila. Solo cosmético. */
  readonly propio = input<string>('');
  /** `client_id → nombre`, para no mostrarle un uuid a nadie. Si falta, cae al uuid. */
  readonly nombreDeCliente = input<Record<string, string>>({});

  nombre(m: Miembro): string {
    return nombreDe(m);
  }

  etiquetaRol(rol: string): string {
    if (rol === 'maestro') return 'Maestro';
    if (rol === 'equipo') return 'Equipo';
    if (rol === 'cliente') return 'Cliente';
    // `servicio` no es una persona: es la identidad de los jobs del orquestador. Se muestra tal
    // cual, y la pantalla de perfil no deja asignarlo (ni cambiarlo desde acá).
    if (rol === 'servicio') return 'Servicio (proceso)';
    return rol || 'Sin rol';
  }

  claseRol(rol: string): string {
    if (rol === 'maestro') return 'bg-respaldo-suave text-respaldo';
    if (rol === 'servicio') return 'bg-error-suave text-error';
    return 'bg-superficie-2 text-texto-medio';
  }
}

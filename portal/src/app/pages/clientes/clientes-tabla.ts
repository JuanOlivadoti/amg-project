import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ClienteAgencia, EstadoContrato, TipoCliente } from '../../core/models';
import { TableDropdownComponent } from '../../shared/components/table-dropdown';

const ETIQUETA_TIPO: Record<TipoCliente, string> = {
  empresa: 'Empresa',
  autonomo: 'Autónomo',
  particular: 'Particular',
};

const ETIQUETA_ESTADO: Record<EstadoContrato, string> = {
  sin_contrato: 'Sin contrato',
  vigente: 'Vigente',
  vencido: 'Vencido',
};

/**
 * Tabla de clientes: consume `ClienteAgencia[]` ya filtrado (por `ClientesPage`, vía
 * `ClientesService.filtrados`) — no filtra ni ordena acá, eso es responsabilidad exclusiva del
 * servicio (Etapa 4). Puerto de `shared/components/tables/clients-table` del origen, sin el
 * `I_Client` viejo, sin paginación propia (no existe todavía en este portal, igual que en
 * `cartera-tabla.ts`) y sin las columnas de ideas (`totalIdeas`, `lastIdeaDate`) que no existen en
 * este dominio.
 *
 * Acciones por fila: ver/editar (links a rutas que se registran en la Etapa 6) y
 * archivar/desarchivar (emitido como evento — la llamada real a la API la hace `ClientesPage` a
 * través de `ClientesService`, esta tabla no toca el servicio). Sin "eliminar": esta pieza no
 * borra clientes.
 */
@Component({
  selector: 'app-clientes-tabla',
  imports: [RouterLink, TableDropdownComponent],
  template: `
    <div class="bg-superficie rounded-xl border border-borde overflow-x-auto">
      <table class="min-w-full text-sm">
        <thead>
          <tr class="text-left text-texto-tenue border-b border-borde">
            <th class="px-4 py-2 font-medium">Cliente</th>
            <th class="px-4 py-2 font-medium">Tipo</th>
            <th class="px-4 py-2 font-medium">Industria</th>
            <th class="px-4 py-2 font-medium">Estado del contrato</th>
            <th class="px-4 py-2 font-medium">Asignado a</th>
            <th class="px-4 py-2 font-medium sr-only">Acciones</th>
          </tr>
        </thead>
        <tbody>
          @for (c of clientes(); track c.id) {
            <tr class="border-b border-borde last:border-0">
              <td class="px-4 py-2 text-texto font-medium">
                {{ c.nombre }}
                @if (c.archived_at) {
                  <span class="ml-2 text-xs rounded-full px-2 py-0.5 bg-superficie-2 text-texto-medio">
                    Archivado
                  </span>
                }
              </td>
              <td class="px-4 py-2 text-texto-medio">{{ c.tipo ? etiquetaTipo(c.tipo) : 'n/d' }}</td>
              <td class="px-4 py-2 text-texto-medio">{{ c.industria ?? 'n/d' }}</td>
              <td class="px-4 py-2">
                <span class="text-xs rounded-full px-2 py-0.5" [class]="claseEstado(c.estado_contrato)">
                  {{ etiquetaEstado(c.estado_contrato) }}
                </span>
              </td>
              <td class="px-4 py-2 text-texto-medio">{{ c.asignado_a ?? 'Sin asignar' }}</td>
              <td class="px-4 py-2 text-right">
                <app-table-dropdown>
                  <button
                    boton
                    type="button"
                    class="text-texto-tenue hover:text-texto px-2 py-1"
                    aria-label="Acciones"
                  >
                    ⋮
                  </button>
                  <div menu class="flex flex-col text-sm">
                    <a
                      menu
                      [routerLink]="['/clientes', c.id]"
                      class="rounded-md px-3 py-1.5 text-texto hover:bg-superficie-2"
                    >
                      Editar
                    </a>
                    <a
                      menu
                      [routerLink]="['/clientes', c.id, 'ver']"
                      class="rounded-md px-3 py-1.5 text-texto hover:bg-superficie-2"
                    >
                      Ver
                    </a>
                    @if (c.archived_at) {
                      <button
                        menu
                        type="button"
                        (click)="desarchivar.emit(c.id)"
                        class="text-left rounded-md px-3 py-1.5 text-texto hover:bg-superficie-2"
                      >
                        Desarchivar
                      </button>
                    } @else {
                      <button
                        menu
                        type="button"
                        (click)="archivar.emit(c.id)"
                        class="text-left rounded-md px-3 py-1.5 text-error hover:bg-error-suave"
                      >
                        Archivar
                      </button>
                    }
                  </div>
                </app-table-dropdown>
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="6" class="px-4 py-6 text-center text-texto-tenue">
                No se encontraron clientes con los filtros aplicados.
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class ClientesTablaComponent {
  readonly clientes = input.required<readonly ClienteAgencia[]>();

  readonly archivar = output<string>();
  readonly desarchivar = output<string>();

  etiquetaTipo(t: TipoCliente): string {
    return ETIQUETA_TIPO[t];
  }

  etiquetaEstado(e: EstadoContrato): string {
    return ETIQUETA_ESTADO[e];
  }

  claseEstado(e: EstadoContrato): string {
    if (e === 'vigente') return 'bg-respaldo-suave text-respaldo';
    if (e === 'vencido') return 'bg-error-suave text-error';
    return 'bg-superficie-2 text-texto-medio';
  }
}

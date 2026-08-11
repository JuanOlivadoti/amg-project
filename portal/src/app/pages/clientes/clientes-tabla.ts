import { Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ClienteAgencia, EstadoContrato, TipoCliente } from '../../core/models';
import { TableDropdownComponent } from '../../shared/components/table-dropdown';
import { MembresiaService } from '../../services/membresia';
import { nombreDe } from '../../core/miembros';

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
 * Acciones por fila: **una** sola de navegación —«Abrir», que lleva a la ficha del cliente— más
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
              <td class="px-4 py-2 text-texto-medio">{{ nombreAsignado(c.asignado_a) }}</td>
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
                    <!--
                      «Abrir» y no «Editar»: desde que la ficha es un shell con tabs, este link
                      lleva a la ficha ENTERA (perfil, research, reseñas, ideas) y no a un
                      formulario. La segunda acción, «Ver», apuntaba a la pantalla «Mi Portal» —la
                      de los datos inventados, retirada— y no se reemplaza por nada.
                    -->
                    <a
                      menu
                      [routerLink]="['/clientes', c.id]"
                      class="rounded-md px-3 py-1.5 text-texto hover:bg-superficie-2"
                    >
                      Abrir
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
  private readonly membresia = inject(MembresiaService);

  /** `user_id -> nombre`, para no mostrar uuids en la tabla. Uno solo, no uno por fila. */
  private readonly porId = computed(() => {
    const mapa = new Map<string, string>();
    for (const m of this.membresia.miembros()) mapa.set(m.user_id, nombreDe(m));
    return mapa;
  });

  /**
   * El uuid se muestra tal cual si no está entre los miembros visibles (una membresía quitada, o un
   * rol `cliente` que solo se ve a sí mismo). Decir "Sin asignar" ahí sería falso: hay alguien.
   */
  nombreAsignado(id: string | null | undefined): string {
    if (!id) return 'Sin asignar';
    return this.porId().get(id) ?? id;
  }

  readonly archivar = output<string>();
  readonly desarchivar = output<string>();

  etiquetaTipo(t: TipoCliente): string {
    return ETIQUETA_TIPO[t];
  }

  /** `null` = la base lo enmascaró para el rol `cliente` (fix de seguridad, Etapa 7) — se muestra
   *  un guion, no el estado real de nadie más. */
  etiquetaEstado(e: EstadoContrato | null): string {
    return e === null ? '—' : ETIQUETA_ESTADO[e];
  }

  claseEstado(e: EstadoContrato | null): string {
    if (e === 'vigente') return 'bg-respaldo-suave text-respaldo';
    if (e === 'vencido') return 'bg-error-suave text-error';
    return 'bg-superficie-2 text-texto-medio';
  }
}

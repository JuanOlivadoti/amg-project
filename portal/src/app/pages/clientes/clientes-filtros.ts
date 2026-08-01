import { Component, input, output } from '@angular/core';
import type { FiltroClientes } from '../../core/clientes-filtro';
import type { EstadoContrato, TipoCliente } from '../../core/models';

const OPCIONES_TIPO: ReadonlyArray<{ valor: TipoCliente | ''; etiqueta: string }> = [
  { valor: '', etiqueta: 'Todos los tipos' },
  { valor: 'empresa', etiqueta: 'Empresa' },
  { valor: 'autonomo', etiqueta: 'Autónomo' },
  { valor: 'particular', etiqueta: 'Particular' },
];

const OPCIONES_ESTADO: ReadonlyArray<{ valor: EstadoContrato | ''; etiqueta: string }> = [
  { valor: '', etiqueta: 'Todos los estados' },
  { valor: 'sin_contrato', etiqueta: 'Sin contrato' },
  { valor: 'vigente', etiqueta: 'Vigente' },
  { valor: 'vencido', etiqueta: 'Vencido' },
];

/**
 * Filtro de `/clientes`. Presentacional puro: recibe el `FiltroClientes` actual y emite el
 * siguiente por `cambio` — no conoce `ClientesService`, así que `ClientesPage` es la única que
 * decide qué hacer con el resultado (llamar a `filtro.set(...)`). Adaptado de
 * `shared/components/filters/clients-filter` del origen: sin el dropdown de `ideaStatus` (módulo
 * de ideas, no se porta) y sin `category` (no existe `clients.category` en el esquema nuevo).
 *
 * "Asignado a" es un campo de texto libre (un uuid pegado a mano), NO un selector de usuarios: en
 * este portal todavía no hay ningún servicio/endpoint que liste membresías del tenant (se buscó
 * `memberships` en `api/src/app.ts` y en `portal/src/app/services/` — no aparece nada). Construir
 * ese selector es trabajo aparte, fuera del alcance de esta tarea (reportado como concern en
 * `.superpowers/sdd/task-5a-report.md`). El checkbox "Solo sin asignar" cubre el caso de
 * `asignadoA === ''` (que en `FiltroClientes` significa "sin asignar", distinto de `null` =
 * "cualquiera") sin necesitar esa lista.
 */
@Component({
  selector: 'app-clientes-filtros',
  template: `
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-texto-medio" for="clientes-filtro-texto">Buscar</label>
        <input
          id="clientes-filtro-texto"
          type="text"
          [value]="filtro().texto"
          (input)="actualizar({ texto: campoTexto.value })"
          #campoTexto
          placeholder="Nombre del cliente…"
          class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-texto-medio" for="clientes-filtro-tipo">Tipo</label>
        <select
          id="clientes-filtro-tipo"
          [value]="filtro().tipo ?? ''"
          (change)="actualizarTipo(campoTipo.value)"
          #campoTipo
          class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
        >
          @for (o of OPCIONES_TIPO; track o.valor) {
            <option [value]="o.valor">{{ o.etiqueta }}</option>
          }
        </select>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-texto-medio" for="clientes-filtro-estado">
          Estado del contrato
        </label>
        <select
          id="clientes-filtro-estado"
          [value]="filtro().estadoContrato ?? ''"
          (change)="actualizarEstado(campoEstado.value)"
          #campoEstado
          class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
        >
          @for (o of OPCIONES_ESTADO; track o.valor) {
            <option [value]="o.valor">{{ o.etiqueta }}</option>
          }
        </select>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-texto-medio" for="clientes-filtro-asignado">Asignado a</label>
        <input
          id="clientes-filtro-asignado"
          type="text"
          [value]="filtro().asignadoA ?? ''"
          (input)="actualizarAsignadoA(campoAsignado.value)"
          [disabled]="soloSinAsignar()"
          #campoAsignado
          placeholder="uuid del usuario"
          class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm disabled:opacity-50"
        />
        <label class="inline-flex items-center gap-2 text-xs text-texto-tenue">
          <input
            type="checkbox"
            [checked]="soloSinAsignar()"
            (change)="alternarSinAsignar(campoSinAsignar.checked)"
            #campoSinAsignar
          />
          Solo sin asignar
        </label>
      </div>
    </div>

    <label class="mt-3 inline-flex items-center gap-2 text-sm text-texto-medio">
      <input
        type="checkbox"
        [checked]="filtro().archivados"
        (change)="actualizar({ archivados: campoArchivados.checked })"
        #campoArchivados
      />
      Mostrar archivados
    </label>
  `,
})
export class ClientesFiltrosComponent {
  readonly filtro = input.required<FiltroClientes>();
  readonly cambio = output<FiltroClientes>();

  readonly OPCIONES_TIPO = OPCIONES_TIPO;
  readonly OPCIONES_ESTADO = OPCIONES_ESTADO;

  actualizar(cambios: Partial<FiltroClientes>): void {
    this.cambio.emit({ ...this.filtro(), ...cambios });
  }

  actualizarTipo(valor: string): void {
    this.actualizar({ tipo: valor === '' ? null : (valor as TipoCliente) });
  }

  actualizarEstado(valor: string): void {
    this.actualizar({ estadoContrato: valor === '' ? null : (valor as EstadoContrato) });
  }

  actualizarAsignadoA(valor: string): void {
    const limpio = valor.trim();
    this.actualizar({ asignadoA: limpio === '' ? null : limpio });
  }

  /** `true` cuando el filtro actual pide explícitamente "sin asignar" (`asignadoA === ''`). */
  soloSinAsignar(): boolean {
    return this.filtro().asignadoA === '';
  }

  alternarSinAsignar(marcado: boolean): void {
    this.actualizar({ asignadoA: marcado ? '' : null });
  }
}

import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ClientesService } from '../../services/clientes';
import { PageBreadcrumbComponent } from '../../shared/components/page-breadcrumb';
import { ComponentCardComponent } from '../../shared/components/component-card';
import { ClientesFiltrosComponent } from './clientes-filtros';
import { ClientesTablaComponent } from './clientes-tabla';

/**
 * Pantalla `/clientes`: listado del CRM de la agencia. Puerto de `pages/clients/clients.page` del
 * origen (Angular 19 + NgRx) — acá sin store: todo el estado (lista, filtro, filtrados, carga,
 * error) sale de `ClientesService` (Etapa 4), esta pantalla solo lo cablea al template.
 *
 * El botón "Nuevo cliente" apunta a `/clientes/nuevo`, que todavía no existe como ruta — se
 * registra recién en la Etapa 6 junto con el resto de las rutas de `/clientes`. Angular Router no
 * valida el destino hasta que se navega, así que el link vive bien acá sin romper nada mientras
 * tanto (mismo criterio que documenta el brief de esta tarea).
 */
@Component({
  selector: 'app-clientes',
  imports: [RouterLink, PageBreadcrumbComponent, ComponentCardComponent, ClientesFiltrosComponent, ClientesTablaComponent],
  template: `
    <div class="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <app-page-breadcrumb titulo="Clientes" />

      <app-component-card>
        <div class="flex flex-col gap-4">
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm text-texto-tenue">{{ clientesService.filtrados().length }} cliente(s)</p>
            <a
              routerLink="/clientes/nuevo"
              class="rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              Nuevo cliente
            </a>
          </div>

          <app-clientes-filtros
            [filtro]="clientesService.filtro()"
            (cambio)="clientesService.filtro.set($event)"
          />

          @if (clientesService.cargando()) {
            <p class="text-sm text-texto-tenue">Cargando…</p>
          } @else if (clientesService.error()) {
            <p class="text-sm text-error">{{ clientesService.error() }}</p>
          } @else {
            <app-clientes-tabla
              [clientes]="clientesService.filtrados()"
              (archivar)="onArchivar($event)"
              (desarchivar)="onDesarchivar($event)"
            />
          }
        </div>
      </app-component-card>
    </div>
  `,
})
export class ClientesPage implements OnInit {
  readonly clientesService = inject(ClientesService);

  async ngOnInit(): Promise<void> {
    await this.clientesService.cargar();
  }

  async onArchivar(id: string): Promise<void> {
    await this.clientesService.archivar(id);
  }

  async onDesarchivar(id: string): Promise<void> {
    await this.clientesService.desarchivar(id);
  }
}

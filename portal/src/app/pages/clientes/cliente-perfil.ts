import { Component, inject } from '@angular/core';
import { ClientesService } from '../../services/clientes';
import { ClienteInfoCardComponent } from './cliente-info-card';
import { ClienteDireccionCardComponent } from './cliente-direccion-card';
import { ClienteMetaCardComponent } from './cliente-meta-card';
import { ClienteRecursosCardComponent } from './cliente-recursos-card';
import { ClienteSegurosCardComponent } from './cliente-seguros-card';

/**
 * Tab `/clientes/:id/perfil`: los cuatro cards editables del CRM, más un quinto —"Seguros"— SOLO
 * para `vertical === 'correduria_seguros'` (Task 14). Los cuatro primeros valen para cualquier
 * vertical; el quinto edita `business_profile.seguros` (licencia/experiencia/red), una extensión que
 * no tiene sentido para un cliente de restauración.
 *
 * **No carga nada.** El cliente lo pide el shell (`cliente-ficha.ts`) una sola vez para los cuatro
 * tabs; acá solo se lee. Antes esta pantalla tenía la suscripción a `paramMap`, el redirect y la
 * guardia de carrera: todo eso subió al shell cuando la ficha pasó a tener tabs. Si algún día este
 * componente vuelve a necesitar el `:id`, sale de `route.paramMap` gracias a
 * `paramsInheritanceStrategy: 'always'` (ver `app.config.ts`) — no hace falta volver a cargar.
 * (El card de Seguros es la excepción: carga SU PROPIO dato, no parte de `ClienteAgencia` — ver el
 * comentario de `cliente-seguros-card.ts`.)
 *
 * El `@if` sobre `cliente()` es defensa, no lógica: el shell no monta el outlet sin cliente, pero un
 * componente que asume que su padre ya validó algo es un componente que se rompe cuando alguien
 * cambia el padre.
 */
@Component({
  selector: 'app-cliente-perfil',
  imports: [
    ClienteInfoCardComponent,
    ClienteDireccionCardComponent,
    ClienteMetaCardComponent,
    ClienteRecursosCardComponent,
    ClienteSegurosCardComponent,
  ],
  template: `
    @if (clientesService.cliente(); as cliente) {
      <div class="space-y-6">
        <!--
          El h1 del documento, y va sr-only a propósito: la ficha es un contenedor y no declara
          ninguno (ver cliente-ficha.ts), así que sin esto la pantalla se queda sin encabezado
          principal. Visible sería ruido — la barra de tabs, con el tab activo marcado, ya dice dónde
          estás; el árbol de accesibilidad no tiene esa pista y necesita el título escrito.
        -->
        <h1 class="sr-only">Perfil</h1>
        <app-cliente-info-card [cliente]="cliente" />
        <app-cliente-direccion-card [cliente]="cliente" />
        <app-cliente-meta-card [cliente]="cliente" />
        <app-cliente-recursos-card [cliente]="cliente" />
        @if (cliente.vertical === 'correduria_seguros') {
          <app-cliente-seguros-card [cliente]="cliente" />
        }
      </div>
    }
  `,
})
export class ClientePerfilPage {
  readonly clientesService = inject(ClientesService);
}

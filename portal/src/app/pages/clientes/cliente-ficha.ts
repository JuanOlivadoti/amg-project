import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ClientesService } from '../../services/clientes';
import { PageBreadcrumbComponent } from '../../shared/components/page-breadcrumb';

interface TabFicha {
  readonly etiqueta: string;
  readonly ruta: string;
}

/**
 * Los tabs de la ficha. Se amplía en la tarea 4 (Reseñas, Ideas) — y el orden acá ES el orden en
 * pantalla. `Perfil` va primero porque es el tab por defecto (el `redirectTo` de `app.routes.ts`).
 */
export const TABS_FICHA: readonly TabFicha[] = [
  { etiqueta: 'Perfil', ruta: 'perfil' },
  { etiqueta: 'Research', ruta: 'research' },
];

/**
 * Shell de `/clientes/:id`: la ficha del cliente como CONTENEDOR de sus secciones, no como pantalla.
 *
 * **La carga del cliente vive acá y no en cada tab**, y eso es lo que hace que saltar entre tabs no
 * dispare un `GET /clients/:id` por clic. Es la misma lógica que tenía `cliente-perfil.ts` antes de
 * esta refactorización, guardia de carrera incluida: se SUSCRIBE a `paramMap` (Angular reutiliza la
 * instancia al navegar de `/clientes/A/perfil` a `/clientes/B/perfil`, así que `ngOnInit` no vuelve
 * a dispararse) y compara contra `idActual` DESPUÉS del `await`, para no navegar por una respuesta
 * que ya quedó vieja.
 *
 * Los `routerLink` de los tabs se arman con la ruta ABSOLUTA (`['/clientes', id(), tab.ruta]`) y no
 * con el string relativo `tab.ruta`: el relativo funciona, pero depende de contra qué ruta activada
 * se resuelve, y eso es exactamente el tipo de magia que se rompe en silencio cuando alguien anida
 * un nivel más.
 *
 * **El `!` de `routerLinkActive` no es adorno.** Entre dos utilidades de Tailwind que pisan la misma
 * propiedad y tienen la misma especificidad gana la que va DESPUÉS en la hoja, no la que va después
 * en el atributo `class` — y Tailwind las emite por orden alfabético. Medido en el CSS servido:
 * `.border-transparent` sale después de `.border-accion`, y `.text-texto-tenue` después de
 * `.text-texto`. Sin el `!`, el tab activo conserva el borde transparente y el texto tenue: se ve
 * exactamente igual que los inactivos. **Ningún test de DOM lo caza** —las dos clases ESTÁN en el
 * elemento—, así que lo fija leyendo el fuente `core/marca-activa.test.ts`, que barre TODA plantilla
 * con `routerLinkActive` (el sidebar tenía el mismo defecto, sin cubrir, hasta que ese barrido dejó
 * de mirar un solo archivo).
 */
@Component({
  selector: 'app-cliente-ficha',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, PageBreadcrumbComponent],
  template: `
    <div class="max-w-5xl mx-auto px-4 py-8 space-y-6">
      @if (clientesService.cliente(); as cliente) {
        <app-page-breadcrumb [titulo]="cliente.nombre" rutaAtras="/clientes" etiquetaAtras="Clientes" />

        <div class="flex items-center gap-4">
          <div
            class="w-16 h-16 rounded-lg bg-superficie-2 flex items-center justify-center text-2xl font-bold text-texto-medio"
          >
            {{ cliente.nombre.charAt(0).toUpperCase() }}
          </div>
          <div>
            <h1 class="text-2xl font-bold text-texto">{{ cliente.nombre }}</h1>
            @if (cliente.industria) {
              <p class="text-sm text-texto-tenue mt-1">{{ cliente.industria }}</p>
            }
          </div>
        </div>

        @if (cliente.etiquetas && cliente.etiquetas.length > 0) {
          <div class="flex flex-wrap gap-2">
            @for (etiqueta of cliente.etiquetas; track etiqueta) {
              <span class="rounded-full bg-superficie-2 text-texto-medio px-3 py-1 text-xs font-medium">
                {{ etiqueta }}
              </span>
            }
          </div>
        }

        <div class="border-b border-borde">
          <nav class="-mb-px flex gap-8">
            @for (tab of tabs; track tab.ruta) {
              <a
                [routerLink]="['/clientes', id(), tab.ruta]"
                routerLinkActive="border-accion! text-texto!"
                class="pb-3 px-1 border-b-2 border-transparent text-texto-tenue font-medium text-sm hover:text-texto"
              >
                {{ tab.etiqueta }}
              </a>
            }
          </nav>
        </div>

        <router-outlet />
      } @else if (clientesService.cargando()) {
        <p class="text-sm text-texto-tenue">Cargando…</p>
      }
    </div>
  `,
})
export class ClienteFichaComponent implements OnInit, OnDestroy {
  readonly clientesService = inject(ClientesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly tabs = TABS_FICHA;
  /** El `:id` de la URL, para armar los `routerLink` de los tabs. */
  readonly id = signal('');

  private sub: Subscription | null = null;
  /** A qué `:id` corresponde el último pedido — para no repetirlo si `paramMap` emite sin cambios. */
  private idActual = '';

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      const id = params.get('id') ?? '';
      if (id === this.idActual) return;
      this.idActual = id;
      this.id.set(id);
      void this.cargar(id);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  private async cargar(id: string): Promise<void> {
    if (!id) {
      await this.router.navigate(['/clientes']);
      return;
    }
    await this.clientesService.verCliente(id);
    // Si mientras tanto se navegó a OTRO :id, esa carga más nueva ya está en curso (o resuelta):
    // no toques nada acá, la suscripción de esa carga hace su propio chequeo.
    if (id !== this.idActual) return;
    if (!this.clientesService.cliente()) {
      // 404 (no existe / es de otro tenant) o cualquier otro fallo al traerlo.
      await this.router.navigate(['/clientes']);
    }
  }
}

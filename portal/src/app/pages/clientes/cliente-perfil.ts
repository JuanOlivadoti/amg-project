import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ClientesService } from '../../services/clientes';
import { PageBreadcrumbComponent } from '../../shared/components/page-breadcrumb';
import { ClienteInfoCardComponent } from './cliente-info-card';
import { ClienteDireccionCardComponent } from './cliente-direccion-card';
import { ClienteMetaCardComponent } from './cliente-meta-card';
import { ClienteRecursosCardComponent } from './cliente-recursos-card';

/**
 * Pantalla `/clientes/:id`: perfil de un cliente del CRM (Etapa 5c). Puerto de
 * `pages/client-profile` del origen (Angular 19) — sin la tabla de ideas (`<ideas-table>`, AMG OS
 * no tiene ese módulo todavía) y sin el botón de "ver sitio" del meta-card usando `router.navigate`
 * imperativo: acá es un `routerLink` directo (Etapa 5d registra la ruta).
 *
 * Se SUSCRIBE a `paramMap`, no lee el snapshot: Angular reutiliza esta instancia al navegar de
 * `/clientes/A` a `/clientes/B` (misma ruta, `ngOnInit` no vuelve a dispararse) — mismo criterio que
 * documenta `BriefPage` (`pages/brief/brief.ts`). `ClientesService.verCliente()` ya trae su propio
 * guard de vigencia (ver el comentario ahí) para la respuesta en sí; acá solo hace falta no repetir
 * el pedido si el id no cambió, y no navegar por una respuesta que ya quedó vieja.
 *
 * Los 4 cards son componentes propios (`cliente-info-card.ts`, etc.), hermanos de esta pantalla
 * dentro de `pages/clientes/` — mismo lugar que `clientes-tabla.ts`/`clientes-filtros.ts` de la
 * Etapa 5a (sub-componentes de UNA pantalla, no genéricos como los de `shared/components/`).
 *
 * `etiquetas` (sin card en el origen): se muestra como chips bajo el título, y se edita como texto
 * separado por comas dentro del card de Información — es un campo propio de `ClienteAgencia`
 * (no de `contacto`), mismo criterio que el resto de los campos que ese card ya edita.
 */
@Component({
  selector: 'app-cliente-perfil',
  imports: [
    PageBreadcrumbComponent,
    ClienteInfoCardComponent,
    ClienteDireccionCardComponent,
    ClienteMetaCardComponent,
    ClienteRecursosCardComponent,
  ],
  template: `
    <div class="max-w-4xl mx-auto px-4 py-8 space-y-6">
      @if (clientesService.cliente(); as cliente) {
        <app-page-breadcrumb [titulo]="cliente.nombre" rutaAtras="/clientes" etiquetaAtras="Clientes" />

        @if (cliente.etiquetas.length > 0) {
          <div class="flex flex-wrap gap-2 -mt-4">
            @for (etiqueta of cliente.etiquetas; track etiqueta) {
              <span class="rounded-full bg-superficie-2 text-texto-medio px-3 py-1 text-xs font-medium">
                {{ etiqueta }}
              </span>
            }
          </div>
        }

        <app-cliente-info-card [cliente]="cliente" />
        <app-cliente-direccion-card [cliente]="cliente" />
        <app-cliente-meta-card [cliente]="cliente" />
        <app-cliente-recursos-card [cliente]="cliente" />
      } @else if (clientesService.cargando()) {
        <p class="text-sm text-texto-tenue">Cargando…</p>
      }
    </div>
  `,
})
export class ClientePerfilPage implements OnInit, OnDestroy {
  readonly clientesService = inject(ClientesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private sub: Subscription | null = null;
  /** A qué :id corresponde el último pedido — para no repetirlo si `paramMap` emite sin cambios. */
  private idActual = '';

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      const id = params.get('id') ?? '';
      if (id === this.idActual) return;
      this.idActual = id;
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
      // 404 (no existe / es de otro tenant) o cualquier otro fallo al traerlo: no hay perfil que
      // mostrar, mismo comportamiento que el origen (`router.navigate(['/clientes'])`).
      await this.router.navigate(['/clientes']);
    }
  }
}

import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClientesService } from '../../services/clientes';
import { ComponentCardComponent } from '../../shared/components/component-card';
import type { CambiosClienteAgencia, ClienteAgencia } from '../../core/models';
import { mergearContacto, pisarTexto } from './contacto-utils';

/**
 * Card "Recursos" de `/clientes/:id` (Etapa 5c). Puerto de `client-resources-card` del origen —
 * ahí `resources: string` se renderiza como Markdown con la librería `marked` y
 * `bypassSecurityTrustHtml`. Decisión ya tomada (ver el brief): este portal NO agrega `marked`,
 * así que `contacto.recursos` se guarda y se muestra como texto PLANO, con `white-space: pre-wrap`
 * para conservar los saltos de línea — sin `innerHTML`, sin sanitizer que saltear, ninguna
 * superficie de inyección que vigilar acá.
 */
@Component({
  selector: 'app-cliente-recursos-card',
  imports: [FormsModule, ComponentCardComponent],
  template: `
    <app-component-card titulo="Recursos" descripcion="Texto libre para que los MCP generen contenido alineado.">
      @if (!editando()) {
        <div class="space-y-4">
          @if (recursos()) {
            <p class="text-base text-texto whitespace-pre-wrap">{{ recursos() }}</p>
          } @else {
            <p class="text-sm text-texto-tenue">No hay recursos configurados.</p>
          }
          <div class="flex justify-end">
            <button
              type="button"
              (click)="editar()"
              class="rounded-md border border-borde-fuerte px-4 py-2 text-sm font-medium text-texto hover:bg-superficie-2"
            >
              Editar
            </button>
          </div>
        </div>
      } @else {
        <form (ngSubmit)="guardar()" class="space-y-4">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium text-texto-medio" for="recursos-texto">Recursos (texto plano)</label>
            <textarea
              id="recursos-texto"
              name="recursos"
              rows="10"
              [ngModel]="draft()"
              (ngModelChange)="draft.set($event)"
              placeholder="Valores de marca, propósito, guías de estilo…"
              class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm font-mono"
            ></textarea>
          </div>

          @if (clientesService.error()) {
            <p class="text-sm text-error">{{ clientesService.error() }}</p>
          }

          <div class="flex justify-end gap-3">
            <button
              type="button"
              (click)="cancelar()"
              [disabled]="guardando()"
              class="rounded-md border border-borde-fuerte px-4 py-2 text-sm font-medium text-texto hover:bg-superficie-2"
            >
              Cancelar
            </button>
            <button
              type="submit"
              [disabled]="guardando()"
              class="rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {{ guardando() ? 'Guardando…' : 'Guardar' }}
            </button>
          </div>
        </form>
      }
    </app-component-card>
  `,
})
export class ClienteRecursosCardComponent {
  readonly cliente = input.required<ClienteAgencia>();
  readonly clientesService = inject(ClientesService);

  readonly editando = signal(false);
  readonly guardando = signal(false);
  readonly draft = signal('');

  readonly recursos = computed(() => {
    const v = this.cliente().contacto?.['recursos'];
    return typeof v === 'string' ? v : '';
  });

  editar(): void {
    this.draft.set(this.recursos());
    this.editando.set(true);
  }

  cancelar(): void {
    this.editando.set(false);
  }

  async guardar(): Promise<void> {
    this.guardando.set(true);
    try {
      const contacto = mergearContacto(this.cliente().contacto);
      pisarTexto(contacto, 'recursos', this.draft());

      const cambios: CambiosClienteAgencia = { contacto };

      const id = this.cliente().id;
      await this.clientesService.actualizar(id, cambios);
      if (!this.clientesService.error()) {
        await this.clientesService.verCliente(id);
        this.editando.set(false);
      }
    } finally {
      this.guardando.set(false);
    }
  }
}

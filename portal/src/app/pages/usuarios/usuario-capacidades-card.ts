import { Component, computed, input } from '@angular/core';
import { CAPACIDADES } from '../../core/capacidades';
import { ComponentCardComponent } from '../../shared/components/component-card';

/**
 * Qué puede hacer este miembro. **Derivada y de solo lectura**, sin `isEditing` ni `isSaving`.
 *
 * El origen (`user-permissions-card`) editaba 20 booleanos y los guardaba. Acá eso sería una segunda
 * fuente de verdad que RLS ignora: la pantalla diría "no puede eliminar clientes" y la base lo
 * dejaría igual. La única forma de cambiar lo que alguien puede hacer es **cambiarle el rol**, que
 * es la otra tarjeta de esta pantalla.
 *
 * Cada fila muestra la política que la sostiene, y no de adorno: `capacidades.test.ts` abre el
 * archivo citado y busca el símbolo, así que un renombre en la base tira el test antes de que esta
 * pantalla empiece a mentir.
 */
@Component({
  selector: 'app-usuario-capacidades-card',
  imports: [ComponentCardComponent],
  template: `
    <app-component-card
      titulo="Qué puede hacer"
      descripcion="Se deriva del rol. No se edita acá: la única forma de cambiarlo es cambiar el rol."
    >
      @if (!rol()) {
        <p class="text-sm text-texto-medio">
          Sin membresía en este tenant: no puede ver nada. Asignale un rol para darle acceso.
        </p>
      } @else {
        <ul class="flex flex-col divide-y divide-borde">
          @for (c of filas(); track c.id) {
            <li class="flex items-start gap-3 py-2">
              <span
                class="mt-0.5 text-xs rounded-full px-2 py-0.5 shrink-0"
                [class]="c.puede ? 'bg-respaldo-suave text-respaldo' : 'bg-superficie-2 text-texto-tenue'"
              >
                {{ c.puede ? 'Sí' : 'No' }}
              </span>
              <span class="flex flex-col">
                <span class="text-sm" [class]="c.puede ? 'text-texto' : 'text-texto-tenue'">
                  {{ c.etiqueta }}
                </span>
                <span class="text-xs text-texto-tenue">{{ c.respaldo.nota }}</span>
                <code class="text-xs text-texto-tenue">{{ c.respaldo.archivo }} · {{ c.respaldo.simbolo }}</code>
              </span>
            </li>
          }
        </ul>
      }
    </app-component-card>
  `,
})
export class UsuarioCapacidadesCardComponent {
  readonly rol = input.required<string>();

  /**
   * Se listan TODAS las capacidades, marcando sí/no — no solo las que tiene. Una lista que solo
   * muestra lo permitido no responde la pregunta que la agencia trae a esta pantalla, que es
   * justamente "¿por qué esta persona no puede hacer X?".
   */
  readonly filas = computed(() =>
    CAPACIDADES.map((c) => ({ ...c, puede: (c.roles as readonly string[]).includes(this.rol()) })),
  );
}

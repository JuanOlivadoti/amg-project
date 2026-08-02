import { Component, computed, inject, input, output } from '@angular/core';
import { MembresiaService } from '../../services/membresia';
import { nombreDe } from '../../core/miembros';

/**
 * Elegir a una persona del tenant, por nombre, en vez de pegar un uuid a mano.
 *
 * Existe porque la pieza 1 (clientes) se cerró con un `<input type="text" placeholder="uuid del
 * usuario responsable">`: cuando se construyó, el portal no tenía forma de listar las membresías del
 * tenant. La pieza 2 la construyó, así que le toca volver y cerrarlo. El grafo es
 * `clientes → usuarios → integración`, no un ciclo.
 *
 * **La autoridad sigue siendo la FK compuesta `(tenant_id, asignado_a) → memberships`** (0001): que
 * no se pueda asignar a alguien de otro tenant lo garantiza la base, no este `<select>`. Esto es
 * comodidad de la UI — por eso, si el valor guardado no está en la lista (una membresía que se
 * quitó, o un rol `cliente` que solo ve su propia fila), **se conserva y se muestra el uuid** en vez
 * de descartarlo en silencio: perder el dato al abrir un formulario sería mucho peor que mostrarlo
 * feo.
 */
@Component({
  selector: 'app-selector-miembro',
  template: `
    <!--
      La selección va en [selected] de cada option, NO en un [value] del select: Angular aplica las
      bindings del elemento ANTES de crear sus hijos, así que en el primer render el value se
      escribiría contra un select todavía vacío y el navegador lo descartaría en silencio (queda en
      la primera opción). Con un valor inicial vacío no se nota; con uno guardado, el campo aparece
      en "sin asignar" y el siguiente guardado borra al responsable.
    -->
    <select
      [id]="idCampo()"
      [name]="idCampo()"
      (change)="cambio.emit(campo.value)"
      #campo
      class="rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm"
    >
      <option value="" [selected]="valor() === ''">{{ etiquetaVacio() }}</option>
      @for (o of opciones(); track o.valor) {
        <option [value]="o.valor" [selected]="o.valor === valor()">{{ o.etiqueta }}</option>
      }
    </select>
  `,
})
export class SelectorMiembroComponent {
  private readonly membresia = inject(MembresiaService);

  readonly valor = input<string>('');
  readonly idCampo = input.required<string>();
  readonly etiquetaVacio = input('— Sin asignar —');
  readonly cambio = output<string>();

  readonly opciones = computed(() => {
    const miembros = this.membresia.miembros();
    const lista = miembros.map((m) => ({
      valor: m.user_id,
      etiqueta: m.email && m.email !== nombreDe(m) ? `${nombreDe(m)} · ${m.email}` : nombreDe(m),
    }));
    // El valor guardado que no está en la lista se agrega igual, marcado. Sin esto, abrir el
    // formulario y guardar sin tocar ese campo lo borraría: el `<select>` no tendría esa opción,
    // caería a `''` y el PATCH mandaría "sin asignar".
    const actual = this.valor();
    if (actual && !lista.some((o) => o.valor === actual)) {
      lista.unshift({ valor: actual, etiqueta: `${actual} (fuera de tu vista)` });
    }
    return lista;
  });
}

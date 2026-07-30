import { Component, input } from '@angular/core';
import type { PaginaPropuesta } from '../../core/models';
import { esRespaldada } from '../../core/evidence';

@Component({
  selector: 'app-cartera-tabla',
  template: `
    <div class="bg-superficie rounded-xl border border-borde overflow-x-auto">
      <table class="min-w-full text-sm">
        <thead>
          <tr class="text-left text-texto-tenue border-b border-borde">
            <th class="px-4 py-2 font-medium">Keyword</th>
            <th class="px-4 py-2 font-medium">Volumen</th>
            <th class="px-4 py-2 font-medium">Dificultad</th>
            <th class="px-4 py-2 font-medium">Score</th>
            <th class="px-4 py-2 font-medium">Confianza</th>
            <th class="px-4 py-2 font-medium">Intención</th>
            <th class="px-4 py-2 font-medium">Evidencia</th>
          </tr>
        </thead>
        <tbody>
          @for (p of paginas(); track p.id) {
            <tr class="border-b border-borde last:border-0">
              <td class="px-4 py-2 text-texto">{{ p.keyword_principal }}</td>
              <td class="px-4 py-2 text-texto-medio">{{ p.volumen ?? 'n/d' }}</td>
              <td class="px-4 py-2 text-texto-medio">{{ p.dificultad ?? 'n/d' }}</td>
              <td class="px-4 py-2 text-texto-medio">{{ p.opportunity_score }}</td>
              <td class="px-4 py-2 text-texto-medio">{{ p.score_confidence }}</td>
              <td class="px-4 py-2 text-texto-medio">{{ p.intencion }}</td>
              <td class="px-4 py-2">
                <span
                  class="text-xs rounded-full px-2 py-0.5"
                  [class]="esRespaldada(p) ? 'bg-respaldo-suave text-respaldo' : 'bg-alerta-suave text-alerta'"
                >
                  {{ esRespaldada(p) ? '✅ Respaldada' : '⚠️ Sin validar' }}
                </span>
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="7" class="px-4 py-6 text-center text-texto-tenue">
                Todavía no hay páginas en la cartera.
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class CarteraTablaComponent {
  readonly paginas = input.required<readonly PaginaPropuesta[]>();
  readonly esRespaldada = esRespaldada;
}

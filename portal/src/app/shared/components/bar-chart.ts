import { Component, computed, inject, input } from '@angular/core';
import { NgApexchartsModule } from 'ng-apexcharts';
import type { ApexAxisChartSeries, ApexChart, ApexXAxis } from 'ng-apexcharts';
import { TemaService } from '../../services/tema';

export interface BarraDatos {
  readonly etiqueta: string;
  readonly valor: number;
}

@Component({
  selector: 'app-bar-chart',
  imports: [NgApexchartsModule],
  template: `
    <apx-chart
      [series]="series()"
      [chart]="chart"
      [xaxis]="xaxis()"
      [colors]="colores()"
      [plotOptions]="plotOptions"
      [dataLabels]="dataLabels"
    />
  `,
})
export class BarChartComponent {
  readonly datos = input.required<readonly BarraDatos[]>();
  readonly titulo = input<string>('');

  private readonly tema = inject(TemaService);

  readonly chart: ApexChart = { type: 'bar', height: 280, toolbar: { show: false } };
  readonly plotOptions = { bar: { horizontal: true, borderRadius: 4 } };
  readonly dataLabels = { enabled: false };

  readonly series = computed<ApexAxisChartSeries>(() => [
    { name: this.titulo(), data: this.datos().map((d) => d.valor) },
  ]);

  readonly xaxis = computed<ApexXAxis>(() => ({ categories: this.datos().map((d) => d.etiqueta) }));

  /**
   * Lee el token `--accion` ya resuelto por el navegador — nunca un hex fijo en el código fuente:
   * `contraste.test.ts` prohíbe incrustar colores, y esto lee el que el tema tenga en cada momento.
   * `tema.efectivo()` se lee acá adentro a propósito: es lo que hace que `colores` se recalcule
   * cuando cambia el tema (Angular rastrea qué signals lee un `computed` para saber cuándo invalidarlo).
   * El fallback es `currentColor` (palabra clave CSS, no un literal de color) para SSR o por si el
   * token todavía no está pintado — `contraste.test.ts` también prohíbe un hex de repuesto acá.
   */
  readonly colores = computed<string[]>(() => {
    this.tema.efectivo();
    if (typeof document === 'undefined') return ['currentColor'];
    const valor = getComputedStyle(document.documentElement).getPropertyValue('--accion').trim();
    return [valor || 'currentColor'];
  });
}

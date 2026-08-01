import { Component, computed, inject, input } from '@angular/core';
import { NgApexchartsModule } from 'ng-apexcharts';
import type { ApexAxisChartSeries, ApexChart, ApexStroke, ApexXAxis, ApexYAxis } from 'ng-apexcharts';
import { TemaService } from '../../services/tema';
import { estiloEjes, tokenDelDocumento } from './ejes';

export interface PuntoSerie {
  readonly fecha: string;
  readonly valor: number;
}

@Component({
  selector: 'app-line-chart',
  imports: [NgApexchartsModule],
  template: `
    <apx-chart
      [series]="series()"
      [chart]="chart"
      [xaxis]="xaxis()"
      [yaxis]="yaxis()"
      [colors]="colores()"
      [stroke]="stroke"
      [dataLabels]="dataLabels"
    />
  `,
})
export class LineChartComponent {
  readonly puntos = input.required<readonly PuntoSerie[]>();
  readonly titulo = input<string>('');

  private readonly tema = inject(TemaService);

  readonly chart: ApexChart = { type: 'line', height: 280, toolbar: { show: false } };
  readonly stroke: ApexStroke = { curve: 'smooth', width: 2 };
  readonly dataLabels = { enabled: false };

  readonly series = computed<ApexAxisChartSeries>(() => [
    { name: this.titulo(), data: this.puntos().map((p) => p.valor) },
  ]);

  readonly xaxis = computed<ApexXAxis>(() => ({
    categories: this.puntos().map((p) => p.fecha),
    labels: this.estiloDeEjes().labels,
  }));

  /** Acá el eje Y son los importes en USD; el X, las fechas. Los dos se leen. */
  readonly yaxis = computed<ApexYAxis>(() => ({ labels: this.estiloDeEjes().labels }));

  /** Ver `BarChartComponent.estiloDeEjes`: `tema.efectivo()` es lo que dispara el recálculo. */
  private readonly estiloDeEjes = computed(() => {
    this.tema.efectivo();
    return estiloEjes(tokenDelDocumento);
  });

  /**
   * Lee el token `--respaldo` ya resuelto por el navegador — mismo patrón que `BarChartComponent`.
   * El fallback es `currentColor` (palabra clave CSS, no un literal de color): un hex de repuesto acá
   * también lo cazaría `contraste.test.ts`.
   */
  readonly colores = computed<string[]>(() => {
    this.tema.efectivo();
    if (typeof document === 'undefined') return ['currentColor'];
    const valor = getComputedStyle(document.documentElement).getPropertyValue('--respaldo').trim();
    return [valor || 'currentColor'];
  });
}

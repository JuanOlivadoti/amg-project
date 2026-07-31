import { Component } from '@angular/core';
import { StatBoxComponent } from '../../shared/components/stat-box';
import { BarChartComponent } from '../../shared/components/bar-chart';
import { LineChartComponent } from '../../shared/components/line-chart';
import { CarteraTablaComponent } from './cartera-tabla';
import { generarCarteraMock } from '../../core/cartera-mock';
import { kpisDeCartera, topOportunidades, serieTemporalCoste } from '../../core/cartera';

@Component({
  selector: 'app-cartera',
  imports: [StatBoxComponent, BarChartComponent, LineChartComponent, CarteraTablaComponent],
  template: `
    <div class="space-y-6">
      <h1 class="text-lg font-semibold text-texto">Dashboard de cartera</h1>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <app-stat-box titulo="Sitios activos" [valor]="kpis.sitiosActivos" />
        <app-stat-box titulo="Opportunity score promedio" [valor]="kpis.opportunityScorePromedio" />
        <app-stat-box titulo="Coste total (USD)" [valor]="kpis.costeTotalUsd" />
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="bg-superficie rounded-xl border border-borde p-4">
          <h2 class="text-sm font-semibold text-texto mb-2">Top oportunidades</h2>
          <app-bar-chart [datos]="datosBarras" titulo="Opportunity score" />
        </div>
        <div class="bg-superficie rounded-xl border border-borde p-4">
          <h2 class="text-sm font-semibold text-texto mb-2">Coste por corrida</h2>
          <app-line-chart [puntos]="puntosLinea" titulo="Coste (USD)" />
        </div>
      </div>

      <app-cartera-tabla [paginas]="paginas" />
    </div>
  `,
})
export class CarteraPage {
  private readonly dashboard = generarCarteraMock();

  readonly kpis = kpisDeCartera(this.dashboard);
  readonly datosBarras = topOportunidades(this.dashboard.pages, 8).map((o) => ({
    etiqueta: o.keyword,
    valor: o.score,
  }));
  readonly puntosLinea = serieTemporalCoste(this.dashboard).map((p) => ({
    fecha: p.fecha,
    valor: p.costeUsd,
  }));
  readonly paginas = this.dashboard.pages;
}

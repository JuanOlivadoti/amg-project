import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { BriefPage } from './brief';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';
import type { Brief } from '../../core/models';

/**
 * Guarda el gate del botón "Aprobar el run y publicar" (§A.5 / 10ª review #2), igual que el spec de
 * RunsPage guarda el de "lanzar research". En Fase 1 el botón NO se renderiza —aprobar el run emitiría
 * un evento sin orquestador—, pero la aprobación de PÁGINAS sí sigue disponible.
 */
const BRIEF: Brief = {
  run: {
    id: 'run-1',
    client_id: 'c1',
    status: 'pending_approval',
    prompt: 'Restaurante italiano',
    schema_version: 'kr.v0.5',
    market_country: 'ES',
    market_language: 'es',
    market_location_code: 2724,
    coste_micros_usd: 310800,
    calidad_datos: {},
    config: {},
    created_at: new Date().toISOString(),
    finished_at: null,
  },
  pages: [
    {
      id: 'p1',
      approved: false,
      cluster_id: 'cl1',
      tipo: 'landing_local',
      page_strategy: 'hub',
      url_slug: '/pizza-napolitana-madrid',
      keyword_principal: 'pizza napolitana madrid',
      keywords_secundarias: [],
      intencion: 'transaccional',
      local: true,
      volumen: 390,
      dificultad: 18,
      evidencia: 'datos_mercado',
      opportunity_score: 84,
      score_confidence: 0.82,
      seo: {},
      content_brief: {},
      preguntas_frecuentes: [],
    },
  ],
};

describe('BriefPage — gate del botón "Aprobar el run y publicar" (§A.5 / #2)', () => {
  const flagOriginal = environment.features.aprobarRun;

  afterEach(() => {
    environment.features.aprobarRun = flagOriginal;
  });

  async function render(esEquipo: boolean, aprobarHabilitado: boolean): Promise<HTMLElement> {
    environment.features.aprobarRun = aprobarHabilitado;
    TestBed.configureTestingModule({
      imports: [BriefPage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'run-1' })) } },
        { provide: ApiService, useValue: { verBrief: async () => BRIEF } },
        { provide: AuthService, useValue: { esEquipo: () => esEquipo } },
      ],
    });
    const fixture = TestBed.createComponent(BriefPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('Fase 1 (equipo, flag apagado): el botón de aprobar-run NO se renderiza', async () => {
    const el = await render(true, false);
    expect(el.textContent).not.toContain('Aprobar el run y publicar');
  });

  it('dev/Fase 2 (equipo, flag encendido): el botón SÍ se renderiza', async () => {
    const el = await render(true, true);
    expect(el.textContent).toContain('Aprobar el run y publicar');
  });
});

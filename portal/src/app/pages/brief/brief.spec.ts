import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { BriefPage } from './brief';
import { ApiService } from '../../services/api';
import { MembresiaService } from '../../services/membresia';
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

  async function render(
    esEquipo: boolean,
    aprobarHabilitado: boolean,
    brief: Brief = BRIEF,
  ): Promise<HTMLElement> {
    environment.features.aprobarRun = aprobarHabilitado;
    TestBed.configureTestingModule({
      imports: [BriefPage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'run-1' })) } },
        { provide: ApiService, useValue: { verBrief: async () => brief } },
        { provide: MembresiaService, useValue: { esEquipo: () => esEquipo } },
      ],
    });
    const fixture = TestBed.createComponent(BriefPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /** El mismo brief, con el coste que se le pida. `null` = quien pregunta no es staff. */
  const conCoste = (coste: number | null): Brief => ({
    ...BRIEF,
    run: { ...BRIEF.run, coste_micros_usd: coste },
  });

  it('Fase 1 (equipo, flag apagado): el botón de aprobar-run NO se renderiza', async () => {
    const el = await render(true, false);
    expect(el.textContent).not.toContain('Aprobar el run y publicar');
  });

  it('dev/Fase 2 (equipo, flag encendido): el botón SÍ se renderiza', async () => {
    const el = await render(true, true);
    expect(el.textContent).toContain('Aprobar el run y publicar');
  });

  /**
   * El link al informe (KR-2b).
   *
   * Es lo ÚNICO que hace descubrible la pantalla del informe: no está en el sidebar (cuelga de un run, no
   * del portal) y nadie va a escribir la URL a mano. Y aparece **siempre**, también para un rol que no
   * pueda ver el informe y para un run que todavía no tenga uno: el destino sabe explicar qué pasa, y
   * esconder el link haría que la función no exista para quien la necesita.
   *
   * Sin este test, borrar el link deja la suite entera en verde y la funcionalidad inalcanzable.
   */
  it('🔴 el link al informe está, apuntando a runs/:id/informe', async () => {
    const el = await render(true, false);
    const link = el.querySelector<HTMLAnchorElement>('a[href="/runs/run-1/informe"]');
    expect(link).withContext('no encontré el link al informe del research').not.toBeNull();
    expect(link!.textContent).toContain('Ver el informe');
  });

  it('🔴 el link al informe aparece también para un rol que NO es equipo', async () => {
    // Un rol `cliente` ve el brief de su propio run pero no el informe (política `informe_staff`, 0016).
    // El link sigue estando: la pantalla del informe le dice con palabras que no está disponible, que es
    // mejor que un link que aparece y desaparece según quién mira.
    const el = await render(false, false);
    expect(el.querySelector('a[href="/runs/run-1/informe"]')).not.toBeNull();
  });

  /*
   * El link al ENTREGABLE del restaurante, y su criterio es el OPUESTO al del informe. Los dos tests
   * van juntos: uno solo no dice nada, porque «aparece» y «solo aparece para el equipo» son
   * afirmaciones distintas y las dos hacen falta.
   *
   * Por qué al revés que el del informe: para un rol `cliente` el endpoint del entregable responde
   * 404 —el mismo que un run inexistente, porque `app.es_staff()` va en el predicado de la consulta—
   * y la pantalla solo podría decir «Run no encontrado». Y la decisión del dueño (spec 2026-08-07) es
   * que el entregable lo manda la AGENCIA: no es una pantalla del cliente.
   */
  it('🔴 el link al entregable está para el equipo, apuntando a runs/:id/entregable', async () => {
    // Sin este test, borrar el link deja la suite en verde y la pantalla imprimible inalcanzable: no
    // está en el sidebar (cuelga de un run) y nadie va a escribir la URL a mano.
    const el = await render(true, false);
    const link = el.querySelector<HTMLAnchorElement>('a[href="/runs/run-1/entregable"]');
    expect(link).withContext('no encontré el link al entregable del restaurante').not.toBeNull();
    expect(link!.textContent).toContain('entregable del restaurante');
  });

  it('🔴 el link al entregable NO aparece para un rol que no es equipo', async () => {
    const el = await render(false, false);
    expect(el.querySelector('a[href="/runs/run-1/entregable"]'))
      .withContext('se le está insinuando al cliente una pantalla que la API le va a negar con un 404')
      .toBeNull();
  });

  /*
   * La línea de coste, y sus TRES casos. `coste_micros_usd` es `number | null` desde que
   * `RUN_SUMMARY_COLS` lo envuelve en `case when app.es_staff() then …`: el `null` significa «no te lo
   * mandamos», no «costó cero».
   */
  it('🔴 sin coste (null) la línea NO se pinta: no se dice $0.00', async () => {
    const el = await render(true, false, conCoste(null));
    expect(el.textContent).toContain('Estado: pending_approval');
    expect(el.textContent)
      .withContext('un coste ausente pintado como $0.00 afirma que el research fue gratis')
      .not.toContain('Coste:');
    expect(el.textContent).not.toContain('$0.00');
  });

  it('🔴 un coste de CERO sí se pinta: $0.00 es un dato, y la guarda no puede ser falsy', async () => {
    // La mitad simétrica. Con `@if (b.run.coste_micros_usd)` —guarda falsy— este caso desaparecería
    // junto con el `null`, y los dos se verían igual en pantalla siendo cosas opuestas.
    const el = await render(true, false, conCoste(0));
    expect(el.textContent).toContain('Coste: $0.00');
  });

  it('con coste, la línea se pinta con el importe', async () => {
    const el = await render(true, false, conCoste(310_800));
    expect(el.textContent).toContain('Coste: $0.31');
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { InicioPage } from './inicio';
import { ApiService } from '../../services/api';
import type { ClienteAgencia, IdeaResumen, RunSummary } from '../../core/models';

/**
 * Test de componente (Karma) de `/inicio`. Mismo patrón que `cliente-ideas.spec.ts`: `ApiService`
 * mockeado con `TestBed`, `provideRouter([])` porque hay `routerLink` en la tabla, y el helper
 * `estabilizar` para dejar que las tres promesas en paralelo terminen de resolver.
 */
function ideaDePrueba(overrides: Partial<IdeaResumen> = {}): IdeaResumen {
  return {
    id: 'idea-1',
    client_id: 'c1',
    titulo: 'Reel del brunch de domingo',
    estado: 'nueva',
    creada_en: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function clienteDePrueba(overrides: Partial<ClienteAgencia> = {}): ClienteAgencia {
  return {
    id: 'c1',
    nombre: 'Restaurante Uno',
    tipo: null,
    industria: null,
    etiquetas: null,
    nivel_actividad: null,
    estado_contrato: null,
    contrato_vence_en: null,
    score: null,
    asignado_a: null,
    contacto: null,
    origen: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function runDePrueba(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'run-1',
    client_id: 'c1',
    status: 'pending_approval',
    prompt: 'prompt',
    schema_version: '1',
    market_country: 'ES',
    market_language: 'es',
    market_location_code: 1,
    coste_micros_usd: null,
    calidad_datos: {},
    config: {},
    created_at: '2026-01-01T00:00:00.000Z',
    finished_at: null,
    tiene_workflow: false,
    ...overrides,
  };
}

function crear(opciones: {
  listarTodasLasIdeas?: jasmine.Spy;
  listarClientes?: jasmine.Spy;
  listarRuns?: jasmine.Spy;
} = {}) {
  const listarTodasLasIdeasSpy =
    opciones.listarTodasLasIdeas ?? jasmine.createSpy('listarTodasLasIdeas').and.resolveTo([]);
  const listarClientesSpy = opciones.listarClientes ?? jasmine.createSpy('listarClientes').and.resolveTo([]);
  const listarRunsSpy = opciones.listarRuns ?? jasmine.createSpy('listarRuns').and.resolveTo([]);

  TestBed.configureTestingModule({
    imports: [InicioPage],
    providers: [
      provideRouter([]),
      {
        provide: ApiService,
        useValue: {
          listarTodasLasIdeas: listarTodasLasIdeasSpy,
          listarClientes: listarClientesSpy,
          listarRuns: listarRunsSpy,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(InicioPage);
  return { fixture, listarTodasLasIdeasSpy, listarClientesSpy, listarRunsSpy };
}

async function estabilizar(fixture: ComponentFixture<InicioPage>): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

/** Extrae `{ titulo: valor }` de cada `app-stat-box` renderizado en la pantalla. */
function tiles(el: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  el.querySelectorAll('app-stat-box').forEach((box) => {
    const titulo = box.querySelector('p:first-child')?.textContent?.trim() ?? '';
    const valor = box.querySelector('p:last-child')?.textContent?.trim() ?? '';
    out[titulo] = valor;
  });
  return out;
}

describe('InicioPage', () => {
  it('con las tres fuentes resolviendo datos: los 6 tiles muestran los números correctos y la tabla las filas esperadas', async () => {
    // 7 ideas, no 5: con exactamente 5 de entrada un límite de 5, 10 o 100 pintan la misma tabla y
    // el test no podría distinguirlos (el hallazgo del bloqueante 2 de la revisión de integración).
    // i6 e i7 quedan afuera de la tabla — eso fija el límite real de `ultimasIdeasCon` en
    // `inicio.ts`, no el default (muerto) de `calcularMetricas`.
    const ideas = [
      ideaDePrueba({ id: 'i1', estado: 'nueva' }),
      ideaDePrueba({ id: 'i2', estado: 'nueva' }),
      ideaDePrueba({ id: 'i3', estado: 'en_revision' }),
      ideaDePrueba({ id: 'i4', estado: 'aprobada', titulo: 'Carrusel de maridajes', client_id: 'c1' }),
      ideaDePrueba({ id: 'i5', estado: 'rechazada' }),
      ideaDePrueba({ id: 'i6', estado: 'rechazada' }),
      ideaDePrueba({ id: 'i7', estado: 'rechazada' }),
    ];
    const clientes = [
      clienteDePrueba({ id: 'c1', nombre: 'Restaurante Uno', archived_at: null }),
      clienteDePrueba({ id: 'c2', nombre: 'Restaurante Dos', archived_at: '2026-01-01T00:00:00.000Z' }),
    ];
    const runs = [
      runDePrueba({ id: 'r1', status: 'pending_approval' }),
      runDePrueba({ id: 'r2', status: 'approved' }),
    ];
    const { fixture } = crear({
      listarTodasLasIdeas: jasmine.createSpy('listarTodasLasIdeas').and.resolveTo(ideas),
      listarClientes: jasmine.createSpy('listarClientes').and.resolveTo(clientes),
      listarRuns: jasmine.createSpy('listarRuns').and.resolveTo(runs),
    });
    const el = await estabilizar(fixture);

    const t = tiles(el);
    expect(t['Ideas nuevas']).toBe('2');
    expect(t['Ideas en revisión']).toBe('1');
    expect(t['Ideas aprobadas']).toBe('1');
    expect(t['Ideas rechazadas']).toBe('3'); // i5, i6, i7
    expect(t['Clientes activos']).toBe('1'); // solo c1: c2 tiene archived_at
    expect(t['Briefs esperando aprobación']).toBe('1'); // solo r1: r2 no está pending_approval

    // La tabla: exactamente 5 filas, aunque llegaron 7 ideas — y son las 5 PRIMERAS (i1..i5, las
    // más recientes, tal como las entrega la API), no las últimas ni una selección reordenada.
    const filas = el.querySelectorAll('tbody tr');
    expect(filas.length).toBe(5);
    const hrefs = Array.from(filas).map((tr) => tr.querySelector('a')?.getAttribute('href'));
    expect(hrefs).toEqual([
      '/clientes/c1/ideas/i1',
      '/clientes/c1/ideas/i2',
      '/clientes/c1/ideas/i3',
      '/clientes/c1/ideas/i4',
      '/clientes/c1/ideas/i5',
    ]);
    const enlace = Array.from(el.querySelectorAll('a')).find((a) =>
      a.textContent!.includes('Carrusel de maridajes'),
    );
    expect(enlace).withContext('no encontré el enlace de la idea en la tabla').toBeTruthy();
    expect(enlace!.getAttribute('href')).toBe('/clientes/c1/ideas/i4');
    expect(el.textContent).toContain('Restaurante Uno');
  });

  it('caso "sin datos": las tres fuentes resuelven arrays vacíos → los 6 tiles muestran 0, la tabla muestra "sin ideas"', async () => {
    const { fixture } = crear();
    const el = await estabilizar(fixture);

    const t = tiles(el);
    expect(t['Ideas nuevas']).toBe('0');
    expect(t['Ideas en revisión']).toBe('0');
    expect(t['Ideas aprobadas']).toBe('0');
    expect(t['Ideas rechazadas']).toBe('0');
    expect(t['Clientes activos']).toBe('0');
    expect(t['Briefs esperando aprobación']).toBe('0');
    expect(el.textContent).toContain('Todavía no hay ideas.');
  });

  it('🔴 falla parcial: si listarTodasLasIdeas rechaza, clientes y runs se siguen mostrando igual', async () => {
    const clientes = [clienteDePrueba({ id: 'c1', archived_at: null })];
    const runs = [runDePrueba({ id: 'r1', status: 'pending_approval' })];
    const { fixture } = crear({
      listarTodasLasIdeas: jasmine.createSpy('listarTodasLasIdeas').and.rejectWith(new Error('falló ideas')),
      listarClientes: jasmine.createSpy('listarClientes').and.resolveTo(clientes),
      listarRuns: jasmine.createSpy('listarRuns').and.resolveTo(runs),
    });
    const el = await estabilizar(fixture);

    // El bloque de ideas muestra el error, no los 4 tiles.
    expect(el.textContent).toContain('No se pudieron cargar las ideas.');
    const t = tiles(el);
    expect(t['Ideas nuevas']).toBeUndefined();
    expect(t['Ideas en revisión']).toBeUndefined();
    expect(t['Ideas aprobadas']).toBeUndefined();
    expect(t['Ideas rechazadas']).toBeUndefined();

    // Clientes y runs son independientes: sus tiles muestran sus números igual.
    expect(t['Clientes activos']).toBe('1');
    expect(t['Briefs esperando aprobación']).toBe('1');

    // La tabla de últimas ideas también refleja el error de ideas, no una tabla vacía silenciosa.
    expect(el.textContent).not.toContain('Todavía no hay ideas.');
  });

  it('falla simétrica: si listarClientes rechaza, el tile de clientes muestra error y la tabla de ideas se sigue pintando con "Cliente desconocido"', async () => {
    const ideas = [ideaDePrueba({ id: 'i1', client_id: 'c1' })];
    const runs = [runDePrueba({ id: 'r1', status: 'pending_approval' })];
    const { fixture } = crear({
      listarTodasLasIdeas: jasmine.createSpy('listarTodasLasIdeas').and.resolveTo(ideas),
      listarClientes: jasmine.createSpy('listarClientes').and.rejectWith(new Error('falló clientes')),
      listarRuns: jasmine.createSpy('listarRuns').and.resolveTo(runs),
    });
    const el = await estabilizar(fixture);

    // (a) El tile de clientes muestra su propio error, no un número.
    expect(el.textContent).toContain('No se pudieron cargar los clientes.');
    const t = tiles(el);
    expect(t['Clientes activos']).toBeUndefined();

    // Ideas y runs son independientes de la falla de clientes: sus tiles se pintan igual.
    expect(t['Ideas nuevas']).toBe('1');
    expect(t['Briefs esperando aprobación']).toBe('1');

    // (b) La tabla de últimas ideas se sigue pintando (no se rompe, no queda vacía). `clientes()`
    // quedó en null y `ultimasIdeas` degrada a [] (inicio.ts:144-146), así que cada fila cae al
    // fallback de `ultimasIdeasCon` — esto confirma que la PANTALLA lo usa en este escenario, no
    // solo que la función lo soporta (ese caso ya está en metricas.test.ts).
    const filas = el.querySelectorAll('tbody tr');
    expect(filas.length).toBe(1);
    expect(el.textContent).toContain('Cliente desconocido');
  });
});

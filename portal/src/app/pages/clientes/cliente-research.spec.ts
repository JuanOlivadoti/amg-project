import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ClienteResearchPage } from './cliente-research';
import { ApiService } from '../../services/api';
import { MembresiaService } from '../../services/membresia';
import type { RunSummary } from '../../core/models';
import { environment } from '../../../environments/environment';

/**
 * Test de componente (Karma) del tab `/clientes/:id/research`. Hereda de `runs.spec.ts` el gate del
 * formulario de lanzar (§A.5) y añade lo que da sentido a la mudanza: que la lista pida SOLO los
 * runs de este cliente, y que lanzar no necesite que nadie pegue un UUID a mano.
 *
 * `paramMap` es un `BehaviorSubject` y no un `of(...)` porque hace falta emitir DOS veces: Angular
 * reutiliza la instancia del tab al pasar de `/clientes/A/research` a `/clientes/B/research`, y esa
 * segunda emisión es la que monta la carrera que cubre el test de la respuesta tardía.
 */
function runDePrueba(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'run-1',
    client_id: 'c1',
    status: 'pending_approval',
    prompt: 'Hamburguesería gourmet',
    schema_version: '1.3.0',
    market_country: 'ES',
    market_language: 'es',
    market_location_code: 2724,
    coste_micros_usd: null,
    calidad_datos: {},
    config: {},
    created_at: '2026-01-01T00:00:00.000Z',
    finished_at: null,
    tiene_workflow: false,
    ...overrides,
  };
}

/**
 * `listarRuns` a demanda: cada llamada queda colgada y el test decide cuándo —y en qué orden—
 * contesta. Es lo que permite montar la carrera real: pedir A, pedir B, dejar que conteste B y
 * recién después A. Mismo patrón que `verClienteDiferido` en `cliente-ficha.spec.ts`.
 */
function listarRunsDiferido() {
  const pendientes: Array<(runs: RunSummary[]) => void> = [];
  const spy = jasmine
    .createSpy('listarRuns')
    .and.callFake(() => new Promise<RunSummary[]>((resolve) => pendientes.push(resolve)));
  return { spy, resolver: (i: number, runs: RunSummary[]) => pendientes[i]?.(runs) };
}

function crear(
  esEquipo: boolean,
  flag: boolean,
  opciones: { listarRuns?: jasmine.Spy; params?: BehaviorSubject<ReturnType<typeof convertToParamMap>> } = {},
) {
  const listarRunsSpy = opciones.listarRuns ?? jasmine.createSpy('listarRuns').and.resolveTo([]);
  const crearRunSpy = jasmine.createSpy('crearRun').and.resolveTo('run-1');
  const params = opciones.params ?? new BehaviorSubject(convertToParamMap({ id: 'c1' }));
  environment.features.lanzarResearch = flag;

  TestBed.configureTestingModule({
    imports: [ClienteResearchPage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      { provide: ApiService, useValue: { listarRuns: listarRunsSpy, crearRun: crearRunSpy } },
      { provide: MembresiaService, useValue: { esEquipo: signal(esEquipo) } },
    ],
  });
  const fixture = TestBed.createComponent(ClienteResearchPage);
  return { fixture, listarRunsSpy, crearRunSpy, params };
}

async function estabilizar(fixture: ComponentFixture<ClienteResearchPage>): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ClienteResearchPage', () => {
  // `environment` es un objeto plano compartido por todo el bundle de Karma: sin esto, el último
  // valor que deje este describe viaja a los specs que corran después. Venía de `runs.spec.ts`.
  const flagOriginal = environment.features.lanzarResearch;
  afterEach(() => {
    environment.features.lanzarResearch = flagOriginal;
  });

  it('pide SOLO los runs de este cliente', async () => {
    const { fixture, listarRunsSpy } = crear(true, true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(listarRunsSpy).toHaveBeenCalledWith('c1');
  });

  it('lanzar research toma el cliente de la ruta, sin input de UUID', async () => {
    const { fixture, crearRunSpy } = crear(true, true);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    // El input del UUID ya no existe: si vuelve, este test lo caza.
    expect(el.querySelector('input[name="clientId"]')).toBeNull();

    const prompt = el.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]')!;
    prompt.value = 'Hamburguesería gourmet en Madrid centro';
    prompt.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(crearRunSpy).toHaveBeenCalledWith({
      clientId: 'c1',
      prompt: 'Hamburguesería gourmet en Madrid centro',
    });
  });

  it('🔴 la respuesta que llega tarde NO pisa la lista: cuando A contesta, el :id vigente ya es B', async () => {
    /*
     * El daño exacto que este tab existe para impedir: **el research del cliente A bajo la ficha del
     * cliente B**. `paramMap` emite A y después B (Angular reutiliza la instancia del tab, no hay
     * `ngOnInit` nuevo), B contesta primero y pinta, y la respuesta lenta de A llega después. Una
     * promesa no se cancela: sin `Vigencia` (`core/vigencia.ts`), el `runs.set(...)` de A sobrescribe
     * lo que ya estaba en pantalla y la URL sigue diciendo B. Está MEDIDO, no supuesto — es el
     * hallazgo Importante-2 de la revisión de la tarea 2.
     *
     * Sus tres pantallas hermanas (`brief`, `informe`, `entregable`) ya usan `Vigencia` por lo mismo.
     */
    const diferido = listarRunsDiferido();
    const params = new BehaviorSubject(convertToParamMap({ id: 'A' }));
    const { fixture } = crear(true, false, { listarRuns: diferido.spy, params });

    const el = await estabilizar(fixture); // pide A, queda colgado
    params.next(convertToParamMap({ id: 'B' })); // pide B antes de que A conteste
    await estabilizar(fixture);

    expect(diferido.spy.calls.allArgs())
      .withContext('el escenario no se montó: tienen que haberse pedido los dos clientes, en orden')
      .toEqual([['A'], ['B']]);

    diferido.resolver(1, [runDePrueba({ id: 'run-de-B', prompt: 'el research de B' })]);
    await estabilizar(fixture);
    expect(el.textContent).toContain('el research de B');

    diferido.resolver(0, [runDePrueba({ id: 'run-de-A', prompt: 'el research de A' })]);
    await estabilizar(fixture);

    expect(el.textContent)
      .withContext('la respuesta vieja de A pisó la lista: la ficha es la de B')
      .not.toContain('el research de A');
    expect(el.textContent).toContain('el research de B');
  });

  it('🔴 una respuesta que llega después de destruir el tab no escribe nada', async () => {
    /*
     * La segunda mitad de `Vigencia`, y la que `ngOnDestroy` NO cubre por sí sola: desuscribirse del
     * `paramMap` corta las emisiones futuras, pero la promesa que ya salió sigue viva y vuelve a un
     * componente que no existe. Hoy el daño visible es cero (no hay polling que reiniciar, como sí lo
     * hay en el brief), y por eso se fija ahora: la garantía sin test es la que se pierde cuando
     * alguien añada el polling que la tarea 3 va a querer.
     */
    const diferido = listarRunsDiferido();
    const { fixture } = crear(true, false, { listarRuns: diferido.spy });
    await estabilizar(fixture);

    fixture.destroy();
    diferido.resolver(0, [runDePrueba({ id: 'run-tardio', prompt: 'llegó después del destroy' })]);
    await fixture.whenStable();

    expect(fixture.componentInstance.runs())
      .withContext('la carga en vuelo escribió sobre un tab ya destruido')
      .toEqual([]);
  });

  it('🔴 sin `:id` en la ruta no se pide NADA: `listarRuns(\'\')` sería la lista global', async () => {
    /*
     * `core/api-core.ts` construye el query con `clientId ? '?clientId=…' : ''`, así que un id vacío
     * NO filtra: degrada a `GET /runs`, la lista de toda la cartera que esta tarea retiró — y sin un
     * solo error en consola. La guarda del `ngOnInit` es lo que lo evita acá, y hasta ahora nada la
     * fijaba: leída sin este test parece un dedup redundante y se borra sin miedo.
     *
     * La otra mitad de la garantía está en `core/api-core.test.ts`, donde `listarRuns('')` lanza en
     * vez de degradar: ésta cubre a esta pantalla, aquélla a cualquier llamador futuro.
     */
    const { fixture, listarRunsSpy, crearRunSpy } = crear(true, true, {
      params: new BehaviorSubject(convertToParamMap({})),
    });
    const el = await estabilizar(fixture);

    expect(listarRunsSpy).not.toHaveBeenCalled();

    // Y tampoco se puede lanzar un research sin cliente: `crearRun({ clientId: '' })` crearía un run
    // huérfano, y el `cargar()` que le sigue pediría la lista global.
    const prompt = el.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]')!;
    prompt.value = 'Hamburguesería gourmet en Madrid centro';
    prompt.dispatchEvent(new Event('input'));
    await estabilizar(fixture);
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await estabilizar(fixture);

    expect(crearRunSpy).not.toHaveBeenCalled();
    expect(listarRunsSpy).not.toHaveBeenCalled();
  });

  it('Fase 1 (equipo, flag apagado): el formulario NO se renderiza', () => {
    const { fixture } = crear(true, false);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('form')).toBeNull();
  });

  it('dev/Fase 2 (equipo, flag encendido): el formulario SÍ se renderiza', () => {
    const { fixture } = crear(true, true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('form')).not.toBeNull();
  });

  it('cliente (no equipo): no se renderiza ni con el flag encendido', () => {
    const { fixture } = crear(false, true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('form')).toBeNull();
  });
});

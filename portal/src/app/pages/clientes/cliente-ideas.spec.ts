import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ClienteIdeasPage } from './cliente-ideas';
import { ApiService } from '../../services/api';
import type { IdeaResumen } from '../../core/models';

/**
 * Test de componente (Karma) del tab `/clientes/:id/ideas`. Mismo patrón que
 * `cliente-research.spec.ts`: componente montado directo (sin anfitrión, porque no recibe `input()`),
 * `ActivatedRoute.paramMap` como `BehaviorSubject` para poder emitir dos veces y montar la carrera.
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

/**
 * `listarIdeas` a demanda: cada llamada queda colgada y el test decide cuándo —y en qué orden—
 * contesta. Mismo patrón que `listarRunsDiferido` en `cliente-research.spec.ts`.
 */
function listarIdeasDiferido() {
  const pendientes: Array<(ideas: IdeaResumen[]) => void> = [];
  const spy = jasmine
    .createSpy('listarIdeas')
    .and.callFake(() => new Promise<IdeaResumen[]>((resolve) => pendientes.push(resolve)));
  return { spy, resolver: (i: number, ideas: IdeaResumen[]) => pendientes[i]?.(ideas) };
}

function crear(opciones: {
  listarIdeas?: jasmine.Spy;
  params?: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
} = {}) {
  const listarIdeasSpy = opciones.listarIdeas ?? jasmine.createSpy('listarIdeas').and.resolveTo([]);
  const params = opciones.params ?? new BehaviorSubject(convertToParamMap({ id: 'c1' }));

  TestBed.configureTestingModule({
    imports: [ClienteIdeasPage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      { provide: ApiService, useValue: { listarIdeas: listarIdeasSpy } },
    ],
  });
  const fixture = TestBed.createComponent(ClienteIdeasPage);
  return { fixture, listarIdeasSpy, params };
}

async function estabilizar(fixture: ComponentFixture<ClienteIdeasPage>): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ClienteIdeasPage', () => {
  it('pide SOLO las ideas de este cliente, sin filtro por defecto', async () => {
    const { fixture, listarIdeasSpy } = crear();
    await estabilizar(fixture);

    expect(listarIdeasSpy).toHaveBeenCalledWith('c1', undefined);
  });

  it('🔴 cada idea enlaza a su detalle BAJO EL CLIENTE: /clientes/:id/ideas/:ideaId', async () => {
    /*
     * El detalle (Task 2) todavía no tiene ruta, pero el enlace ya tiene que apuntar ahí: si se
     * escribe `['/ideas', idea.id]` en vez de `['/clientes', clienteId(), 'ideas', idea.id]` la suite
     * queda igual de verde y el síntoma no es un 404 ruidoso — es un clic que no lleva a ningún lado
     * el día que Task 2 agregue la ruta. Mismo argumento que el test gemelo de `cliente-research.spec.ts`.
     */
    const listarIdeas = jasmine
      .createSpy('listarIdeas')
      .and.resolveTo([ideaDePrueba({ id: 'idea-9', titulo: 'Carrusel de maridajes' })]);
    const { fixture } = crear({ listarIdeas });
    const el = await estabilizar(fixture);

    const enlace = Array.from(el.querySelectorAll('a')).find((a) =>
      a.textContent!.includes('Carrusel de maridajes'),
    );
    expect(enlace).withContext('no encontré el enlace de la idea en la lista').toBeTruthy();
    expect(enlace!.getAttribute('href')).toBe('/clientes/c1/ideas/idea-9');
  });

  it('el filtro de estado se manda al servicio', async () => {
    const { fixture, listarIdeasSpy } = crear();
    const el = await estabilizar(fixture);
    listarIdeasSpy.calls.reset();

    const select = el.querySelector<HTMLSelectElement>('select[name="filtroEstado"]')!;
    select.value = 'en_revision';
    select.dispatchEvent(new Event('change'));
    await estabilizar(fixture);

    expect(listarIdeasSpy).toHaveBeenCalledWith('c1', 'en_revision');
  });

  it('🔴 la respuesta que llega tarde NO pisa la lista: cuando A contesta, el :id vigente ya es B', async () => {
    /*
     * El mismo daño que research existe para impedir, replicado acá: las ideas del cliente A bajo la
     * ficha del cliente B. `paramMap` emite A y después B (misma instancia reutilizada), B contesta
     * primero y pinta, y la respuesta lenta de A llega después.
     */
    const diferido = listarIdeasDiferido();
    const params = new BehaviorSubject(convertToParamMap({ id: 'A' }));
    const { fixture } = crear({ listarIdeas: diferido.spy, params });

    const el = await estabilizar(fixture); // pide A, queda colgado
    params.next(convertToParamMap({ id: 'B' })); // pide B antes de que A conteste
    await estabilizar(fixture);

    expect(diferido.spy.calls.allArgs())
      .withContext('el escenario no se montó: tienen que haberse pedido los dos clientes, en orden')
      .toEqual([['A', undefined], ['B', undefined]]);

    diferido.resolver(1, [ideaDePrueba({ id: 'idea-de-B', titulo: 'la idea de B' })]);
    await estabilizar(fixture);
    expect(el.textContent).toContain('la idea de B');

    diferido.resolver(0, [ideaDePrueba({ id: 'idea-de-A', titulo: 'la idea de A' })]);
    await estabilizar(fixture);

    expect(el.textContent)
      .withContext('la respuesta vieja de A pisó la lista: la ficha es la de B')
      .not.toContain('la idea de A');
    expect(el.textContent).toContain('la idea de B');
  });

  it('🔴 una respuesta que llega después de destruir el tab no escribe nada', async () => {
    const diferido = listarIdeasDiferido();
    const { fixture } = crear({ listarIdeas: diferido.spy });
    await estabilizar(fixture);

    fixture.destroy();
    diferido.resolver(0, [ideaDePrueba({ id: 'idea-tardia', titulo: 'llegó después del destroy' })]);
    await fixture.whenStable();

    expect(fixture.componentInstance.ideas())
      .withContext('la carga en vuelo escribió sobre un tab ya destruido')
      .toEqual([]);
  });

  it('🔴 sin `:id` en la ruta no se pide NADA: `listarIdeas(\'\')` lanzaría en vez de degradar', async () => {
    const { listarIdeasSpy } = crear({ params: new BehaviorSubject(convertToParamMap({})) });

    expect(listarIdeasSpy).not.toHaveBeenCalled();
  });

  it('🔴 un cambio de filtro obsoleto no pisa la lista del filtro vigente (mismo cliente, dos filtros seguidos)', async () => {
    /*
     * `Vigencia` guarda el CLIENTE, no el filtro: dos cambios de filtro seguidos para el mismo cliente
     * no lo tocan. Sin la comparación extra en `cargar()` (`pedidoEstado !== filtroEstado()`), la
     * respuesta del primer filtro pisaría la del segundo si llega después.
     */
    const diferido = listarIdeasDiferido();
    const { fixture } = crear({ listarIdeas: diferido.spy });
    const el = await estabilizar(fixture); // carga inicial sin filtro, queda colgada

    const select = el.querySelector<HTMLSelectElement>('select[name="filtroEstado"]')!;
    select.value = 'nueva';
    select.dispatchEvent(new Event('change'));
    await estabilizar(fixture); // pide filtro "nueva", queda colgada

    select.value = 'aprobada';
    select.dispatchEvent(new Event('change'));
    await estabilizar(fixture); // pide filtro "aprobada", queda colgada

    expect(diferido.spy.calls.allArgs()).toEqual([
      ['c1', undefined],
      ['c1', 'nueva'],
      ['c1', 'aprobada'],
    ]);

    // Contesta primero el filtro vigente ("aprobada"), después el obsoleto ("nueva").
    diferido.resolver(2, [ideaDePrueba({ id: 'idea-aprobada', titulo: 'la idea aprobada' })]);
    await estabilizar(fixture);
    expect(el.textContent).toContain('la idea aprobada');

    diferido.resolver(1, [ideaDePrueba({ id: 'idea-nueva', titulo: 'la idea nueva obsoleta' })]);
    await estabilizar(fixture);

    expect(el.textContent)
      .withContext('la respuesta del filtro anterior pisó la lista del filtro vigente')
      .not.toContain('la idea nueva obsoleta');
    expect(el.textContent).toContain('la idea aprobada');
  });
});

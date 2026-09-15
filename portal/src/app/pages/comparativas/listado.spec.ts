import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ComparativasListadoPage } from './listado';
import { ApiService } from '../../services/api';
import type { ComparativaSeguros } from '../../core/models';

/**
 * Test de componente (Karma) del tab `/clientes/:id/comparativas`. Mismo patrón que
 * `cliente-ideas.spec.ts`: componente montado directo, `ActivatedRoute.paramMap` como
 * `BehaviorSubject` para poder emitir dos veces y montar la carrera del `:id`.
 */
function comparativaDePrueba(overrides: Partial<ComparativaSeguros> = {}): ComparativaSeguros {
  return {
    id: 'cmp1',
    clientId: 'c1',
    creadoPor: 'u1',
    clienteFinalNombre: 'Juan Pérez',
    clienteFinalEmail: null,
    opciones: [],
    recomendacion: 'Seguros XYZ',
    informeMd: '# Informe',
    mailAsunto: 'Asunto',
    mailCuerpoMd: 'Cuerpo',
    costoUsd: 1,
    revisadoEn: null,
    revisadoPor: null,
    createdAt: '2026-09-12T00:00:00.000Z',
    ...overrides,
  };
}

/** `listarComparativas` a demanda, para montar la carrera del `:id`. */
function listarComparativasDiferido() {
  const pendientes: Array<(v: ComparativaSeguros[]) => void> = [];
  const spy = jasmine
    .createSpy('listarComparativas')
    .and.callFake(() => new Promise<ComparativaSeguros[]>((resolve) => pendientes.push(resolve)));
  return { spy, resolver: (i: number, v: ComparativaSeguros[]) => pendientes[i]?.(v) };
}

function crear(
  opciones: {
    listarComparativas?: jasmine.Spy;
    params?: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  } = {},
) {
  const listarComparativasSpy =
    opciones.listarComparativas ?? jasmine.createSpy('listarComparativas').and.resolveTo([]);
  const params = opciones.params ?? new BehaviorSubject(convertToParamMap({ id: 'c1' }));

  TestBed.configureTestingModule({
    imports: [ComparativasListadoPage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      { provide: ApiService, useValue: { listarComparativas: listarComparativasSpy } },
    ],
  });
  const fixture = TestBed.createComponent(ComparativasListadoPage);
  return { fixture, listarComparativasSpy, params };
}

async function estabilizar(fixture: ComponentFixture<ComparativasListadoPage>): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ComparativasListadoPage', () => {
  it('pide el historial del cliente de la URL', async () => {
    const { fixture, listarComparativasSpy } = crear();
    await estabilizar(fixture);
    expect(listarComparativasSpy).toHaveBeenCalledWith('c1');
  });

  it('sin comparativas, muestra el mensaje vacío y no una lista', async () => {
    const { fixture } = crear();
    const el = await estabilizar(fixture);
    expect(el.textContent).toContain('Todavía no hay comparativas cargadas.');
    expect(el.querySelectorAll('li').length).toBe(0);
  });

  it('muestra pendiente/revisado por fila, para notar lo que falta revisar', async () => {
    const { fixture } = crear({
      listarComparativas: jasmine.createSpy('listarComparativas').and.resolveTo([
        comparativaDePrueba({ id: 'a', clienteFinalNombre: 'Sin revisar', revisadoEn: null }),
        comparativaDePrueba({ id: 'b', clienteFinalNombre: 'Ya revisada', revisadoEn: '2026-09-12T10:00:00Z' }),
      ]),
    });
    const el = await estabilizar(fixture);

    const filas = [...el.querySelectorAll('li')];
    expect(filas.length).toBe(2);

    const filaPendiente = filas.find((li) => li.textContent?.includes('Sin revisar'));
    expect(filaPendiente?.textContent).toContain('Pendiente de revisión');
    expect(filaPendiente?.querySelector('a')?.getAttribute('href')).toBe('/clientes/c1/comparativas/a');

    const filaRevisada = filas.find((li) => li.textContent?.includes('Ya revisada'));
    expect(filaRevisada?.textContent).toContain('Revisado');
    expect(filaRevisada?.textContent).not.toContain('Pendiente de revisión');
  });

  it('el link "Nueva comparativa" lleva a la pantalla de carga', async () => {
    const { fixture } = crear();
    const el = await estabilizar(fixture);
    const link = [...el.querySelectorAll('a')].find((a) => a.textContent?.includes('Nueva comparativa'));
    expect(link?.getAttribute('href')).toBe('/clientes/c1/comparativas/cargar');
  });

  it('🔴 la respuesta que llega tarde NO pisa la lista: cuando A contesta, el :id vigente ya es B', async () => {
    const diferido = listarComparativasDiferido();
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1' }));
    const { fixture } = crear({ listarComparativas: diferido.spy, params });

    await estabilizar(fixture); // pide c1, queda colgado
    params.next(convertToParamMap({ id: 'c2' })); // pide c2 antes de que c1 conteste
    await estabilizar(fixture);

    expect(diferido.spy.calls.allArgs())
      .withContext('el escenario no se montó: tienen que haberse pedido los dos ids, en orden')
      .toEqual([['c1'], ['c2']]);

    diferido.resolver(0, [comparativaDePrueba({ id: 'de-c1', clienteFinalNombre: 'De otro cliente' })]);
    await estabilizar(fixture);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent)
      .withContext('la respuesta vieja de c1 pisó la lista de c2, que sigue vacía')
      .not.toContain('De otro cliente');
  });

  it('saltar de tab y volver al MISMO :id no vuelve a pedir el historial', async () => {
    const { fixture, listarComparativasSpy, params } = crear();
    await estabilizar(fixture);
    params.next(convertToParamMap({ id: 'c1' }));
    await estabilizar(fixture);

    expect(listarComparativasSpy).toHaveBeenCalledTimes(1);
  });
});

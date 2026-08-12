import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ClienteIdeaDetallePage } from './cliente-idea-detalle';
import { ApiService } from '../../services/api';
import type { IdeaDetalle } from '../../core/models';

/**
 * Test de componente (Karma) de `/clientes/:id/ideas/:ideaId` (Task 2). Mismo patrón que
 * `cliente-ideas.spec.ts` y `cliente-research.spec.ts`: componente montado directo (sin anfitrión,
 * porque no recibe `input()`), `ActivatedRoute.paramMap` como `BehaviorSubject` para poder emitir
 * dos veces y montar la carrera.
 */
function ideaDetalleDePrueba(overrides: Partial<IdeaDetalle> = {}): IdeaDetalle {
  return {
    id: 'idea-1',
    client_id: 'c1',
    titulo: 'Reel del brunch de domingo',
    estado: 'nueva',
    creada_en: '2026-01-01T00:00:00.000Z',
    resumen: 'Grabar un reel corto del brunch de los domingos.',
    transcripcion: 'La transcripción completa de la idea, línea uno.\nLínea dos.',
    audio_url: null,
    carpeta_url: null,
    mensaje_de: 'Juan (dueño)',
    analisis: {
      audiencia_objetivo: 'familias del barrio',
      canales_comunicacion: ['Instagram reels', 'Instagram stories'],
    },
    actualizada_en: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function crear(
  opciones: {
    obtenerIdea?: jasmine.Spy;
    cambiarEstadoIdea?: jasmine.Spy;
    editarIdea?: jasmine.Spy;
    params?: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  } = {},
) {
  const obtenerIdeaSpy =
    opciones.obtenerIdea ?? jasmine.createSpy('obtenerIdea').and.resolveTo(ideaDetalleDePrueba());
  const cambiarEstadoIdeaSpy =
    opciones.cambiarEstadoIdea ?? jasmine.createSpy('cambiarEstadoIdea').and.resolveTo(undefined);
  const editarIdeaSpy = opciones.editarIdea ?? jasmine.createSpy('editarIdea').and.resolveTo(undefined);
  const params = opciones.params ?? new BehaviorSubject(convertToParamMap({ id: 'c1', ideaId: 'idea-1' }));

  TestBed.configureTestingModule({
    imports: [ClienteIdeaDetallePage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      {
        provide: ApiService,
        useValue: {
          obtenerIdea: obtenerIdeaSpy,
          cambiarEstadoIdea: cambiarEstadoIdeaSpy,
          editarIdea: editarIdeaSpy,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(ClienteIdeaDetallePage);
  return { fixture, obtenerIdeaSpy, cambiarEstadoIdeaSpy, editarIdeaSpy, params };
}

async function estabilizar(fixture: ComponentFixture<ClienteIdeaDetallePage>): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

function boton(el: HTMLElement, texto: string): HTMLButtonElement | undefined {
  return Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.trim() === texto);
}

describe('ClienteIdeaDetallePage', () => {
  it('carga el detalle correcto: título, resumen, transcripción y remitente', async () => {
    const idea = ideaDetalleDePrueba({ titulo: 'Sorteo de hamburguesas' });
    const { fixture, obtenerIdeaSpy } = crear({
      obtenerIdea: jasmine.createSpy('obtenerIdea').and.resolveTo(idea),
    });
    const el = await estabilizar(fixture);

    expect(obtenerIdeaSpy).toHaveBeenCalledWith('idea-1');
    expect(el.querySelector('h1')?.textContent).toContain('Sorteo de hamburguesas');
    expect(el.textContent).toContain('Grabar un reel corto del brunch de los domingos.');
    expect(el.textContent).toContain('La transcripción completa de la idea, línea uno.');
    expect(el.textContent).toContain('Juan (dueño)');
  });

  it('🔴 un 404 al cargar (obtenerIdea devuelve null) muestra un estado de error, no una pantalla en blanco', async () => {
    const { fixture } = crear({ obtenerIdea: jasmine.createSpy('obtenerIdea').and.resolveTo(null) });
    const el = await estabilizar(fixture);

    expect(el.querySelector('.text-error')?.textContent).withContext('no se ve ningún error').toBeTruthy();
    expect(el.querySelector('h1')).withContext('no debería haber montado el título sin idea').toBeFalsy();
  });

  it('estado "nueva": solo aparece el botón de pasar a revisión', async () => {
    const { fixture } = crear({
      obtenerIdea: jasmine.createSpy('obtenerIdea').and.resolveTo(ideaDetalleDePrueba({ estado: 'nueva' })),
    });
    const el = await estabilizar(fixture);

    expect(boton(el, 'Pasar a revisión')).withContext('falta el botón de la transición válida').toBeTruthy();
    expect(boton(el, 'Aprobar')).withContext('aprobar no es válido desde nueva').toBeFalsy();
    expect(boton(el, 'Rechazar')).withContext('rechazar no es válido desde nueva').toBeFalsy();
  });

  it('estado "en_revision": aparecen aprobar y rechazar, no pasar a revisión', async () => {
    const { fixture } = crear({
      obtenerIdea: jasmine
        .createSpy('obtenerIdea')
        .and.resolveTo(ideaDetalleDePrueba({ estado: 'en_revision' })),
    });
    const el = await estabilizar(fixture);

    expect(boton(el, 'Aprobar')).toBeTruthy();
    expect(boton(el, 'Rechazar')).toBeTruthy();
    expect(boton(el, 'Pasar a revisión')).withContext('ya no está en nueva').toBeFalsy();
  });

  it('estado terminal "aprobada": ningún botón de transición', async () => {
    const { fixture } = crear({
      obtenerIdea: jasmine.createSpy('obtenerIdea').and.resolveTo(ideaDetalleDePrueba({ estado: 'aprobada' })),
    });
    const el = await estabilizar(fixture);

    expect(boton(el, 'Aprobar')).toBeFalsy();
    expect(boton(el, 'Rechazar')).toBeFalsy();
    expect(boton(el, 'Pasar a revisión')).toBeFalsy();
  });

  it('aprobar llama a cambiarEstadoIdea con el estado destino, y NUNCA a editarIdea', async () => {
    const { fixture, cambiarEstadoIdeaSpy, editarIdeaSpy } = crear({
      obtenerIdea: jasmine
        .createSpy('obtenerIdea')
        .and.resolveTo(ideaDetalleDePrueba({ estado: 'en_revision' })),
    });
    const el = await estabilizar(fixture);

    boton(el, 'Aprobar')!.click();
    await estabilizar(fixture);

    expect(cambiarEstadoIdeaSpy).toHaveBeenCalledWith('idea-1', 'aprobada');
    expect(editarIdeaSpy).not.toHaveBeenCalled();
  });

  it('guardar contenido llama a editarIdea con el subconjunto editado y NUNCA a cambiarEstadoIdea', async () => {
    const { fixture, editarIdeaSpy, cambiarEstadoIdeaSpy } = crear();
    const el = await estabilizar(fixture);

    boton(el, 'Editar')!.click();
    await estabilizar(fixture);

    const inputTitulo = el.querySelector<HTMLInputElement>('input[name="titulo"]')!;
    inputTitulo.value = 'Título editado';
    inputTitulo.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    const form = el.querySelector('form')!;
    form.dispatchEvent(new Event('submit'));
    await estabilizar(fixture);

    expect(editarIdeaSpy).toHaveBeenCalledTimes(1);
    const [id, cambios] = editarIdeaSpy.calls.mostRecent().args as [string, Record<string, unknown>];
    expect(id).toBe('idea-1');
    expect(cambios['titulo']).toBe('Título editado');
    expect(cambios).withContext('editar contenido no debe mandar `estado`: eso es otro PATCH').not.toEqual(
      jasmine.objectContaining({ estado: jasmine.anything() }),
    );
    expect(cambiarEstadoIdeaSpy).not.toHaveBeenCalled();
  });

  it('🔴 un título vacío no se guarda: editarIdea no se llama y se ve el error de validación', async () => {
    // Deuda que el plan (Etapa 5) dejaba anotada: `titulo` solo tiene TECHO en la 0013, nunca piso.
    // Sin esta guarda, vaciar el campo y guardar mandaba `titulo: ''` al servidor sin que nada lo
    // impidiera del lado del cliente.
    const { fixture, editarIdeaSpy } = crear();
    const el = await estabilizar(fixture);

    boton(el, 'Editar')!.click();
    await estabilizar(fixture);

    const inputTitulo = el.querySelector<HTMLInputElement>('input[name="titulo"]')!;
    inputTitulo.value = '   '; // solo espacios: `trim()` lo deja vacío, mismo caso que ''
    inputTitulo.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    const form = el.querySelector('form')!;
    form.dispatchEvent(new Event('submit'));
    await estabilizar(fixture);

    expect(editarIdeaSpy).withContext('un título vacío no debería llegar a pedir el PATCH').not.toHaveBeenCalled();
    expect(el.textContent).toContain('El título no puede quedar vacío.');
  });

  it('🔴 la idea de OTRO cliente se trata como no encontrada: la URL manda, no el client_id de la respuesta', async () => {
    // GET /ideas/:id no filtra por cliente (lo aísla RLS, por tenant) — sin este chequeo, una URL
    // escrita a mano bajo el cliente equivocado pintaría igual el detalle de la idea ajena.
    const idea = ideaDetalleDePrueba({ client_id: 'cliente-ajeno' });
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', ideaId: 'idea-1' }));
    const { fixture } = crear({
      obtenerIdea: jasmine.createSpy('obtenerIdea').and.resolveTo(idea),
      params,
    });
    const el = await estabilizar(fixture);

    expect(el.querySelector('.text-error')?.textContent)
      .withContext('la idea de otro cliente se mostró como si fuera de éste')
      .toContain('Idea no encontrada.');
    expect(el.querySelector('h1')).toBeFalsy();
  });

  it('🔴 la respuesta que llega tarde NO pisa el detalle: cuando A contesta, el :ideaId vigente ya es B', async () => {
    const pendientes: Array<(idea: IdeaDetalle | null) => void> = [];
    const diferido = jasmine
      .createSpy('obtenerIdea')
      .and.callFake(() => new Promise<IdeaDetalle | null>((resolve) => pendientes.push(resolve)));
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', ideaId: 'idea-A' }));
    const { fixture } = crear({ obtenerIdea: diferido, params });

    const el = await estabilizar(fixture); // pide A, queda colgado
    params.next(convertToParamMap({ id: 'c1', ideaId: 'idea-B' })); // pide B antes de que A conteste
    await estabilizar(fixture);

    expect(diferido.calls.allArgs()).toEqual([['idea-A'], ['idea-B']]);

    pendientes[1]?.(ideaDetalleDePrueba({ id: 'idea-B', titulo: 'la idea B' }));
    await estabilizar(fixture);
    expect(el.textContent).toContain('la idea B');

    pendientes[0]?.(ideaDetalleDePrueba({ id: 'idea-A', titulo: 'la idea A' }));
    await estabilizar(fixture);

    expect(el.textContent)
      .withContext('la respuesta vieja de A pisó el detalle: la pantalla es la de B')
      .not.toContain('la idea A');
    expect(el.textContent).toContain('la idea B');
  });
});

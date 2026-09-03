import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { signal } from '@angular/core';
import { PostsPage } from './posts';
import { ApiService } from '../../services/api';
import { MembresiaService } from '../../services/membresia';
import type { Brief, PaginaPropuesta, PostDePagina } from '../../core/models';

/**
 * Test de componente (Karma) de `/clientes/:id/research/:runId/posts` (Task 11, sub-proyecto de
 * publicación en blog externo). Mismo patrón que `cliente-resenas.spec.ts`: componente montado
 * directo (sin anfitrión), `ActivatedRoute.paramMap` como `BehaviorSubject`, y `ApiService`/
 * `MembresiaService` como dobles con signals — la interfaz que el componente consume, nada más.
 */

function pagina(overrides: Partial<PaginaPropuesta> = {}): PaginaPropuesta {
  return {
    id: 'p1',
    approved: true,
    cluster_id: 'cl1',
    tipo: 'landing_local',
    page_strategy: 'hub',
    url_slug: '/pizza-napolitana-madrid',
    keyword_principal: 'pizza napolitana madrid',
    keywords_secundarias: [],
    intencion: 'transactional',
    local: true,
    volumen: 390,
    dificultad: 18,
    evidencia: 'datos_mercado',
    opportunity_score: 84,
    score_confidence: 0.82,
    seo: {},
    content_brief: {},
    preguntas_frecuentes: [],
    ...overrides,
  };
}

function post(overrides: Partial<PostDePagina> = {}): PostDePagina {
  return {
    titulo: 'Pizza napolitana en Madrid: la guía completa',
    cuerpo: '<p>Hola <strong>mundo</strong></p>',
    generadoEn: '2026-09-01T00:00:00.000Z',
    solicitadoEn: null,
    publicadoEn: null,
    urlExterna: null,
    errorEn: null,
    ...overrides,
  };
}

function brief(pages: PaginaPropuesta[]): Brief {
  return {
    run: {
      id: 'run-1',
      client_id: 'c1',
      status: 'approved',
      prompt: 'Restaurante italiano',
      schema_version: 'kr.v0.5',
      market_country: 'ES',
      market_language: 'es',
      market_location_code: 2724,
      coste_micros_usd: null,
      calidad_datos: {},
      config: {},
      created_at: new Date().toISOString(),
      finished_at: null,
      tiene_workflow: true,
      ultimaDecision: { destino: 'crear_posts', resultado: 'completado', decididoEn: new Date().toISOString() },
    },
    pages,
  };
}

function crear(
  opciones: {
    verBrief?: jasmine.Spy;
    verPost?: jasmine.Spy;
    editarPost?: jasmine.Spy;
    solicitarPublicacionPost?: jasmine.Spy;
    esEquipo?: boolean;
    params?: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  } = {},
) {
  const verBriefSpy = opciones.verBrief ?? jasmine.createSpy('verBrief').and.resolveTo(brief([pagina()]));
  const verPostSpy = opciones.verPost ?? jasmine.createSpy('verPost').and.resolveTo(post());
  const editarPostSpy = opciones.editarPost ?? jasmine.createSpy('editarPost').and.resolveTo(undefined);
  const solicitarPublicacionPostSpy =
    opciones.solicitarPublicacionPost ??
    jasmine.createSpy('solicitarPublicacionPost').and.resolveTo(undefined);
  const params = opciones.params ?? new BehaviorSubject(convertToParamMap({ id: 'c1', runId: 'run-1' }));

  // Mismo motivo que `configurar()` en `brief.spec.ts`: el TestBed no se deja reconfigurar una vez
  // instanciado, así que resetear acá es lo mismo que Karma hace solo entre specs.
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [PostsPage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      {
        provide: ApiService,
        useValue: {
          verBrief: verBriefSpy,
          verPost: verPostSpy,
          editarPost: editarPostSpy,
          solicitarPublicacionPost: solicitarPublicacionPostSpy,
        },
      },
      { provide: MembresiaService, useValue: { esEquipo: signal(opciones.esEquipo ?? true) } },
    ],
  });
  const fixture = TestBed.createComponent(PostsPage);
  return { fixture, verBriefSpy, verPostSpy, editarPostSpy, solicitarPublicacionPostSpy, params };
}

async function estabilizar(fixture: ComponentFixture<PostsPage>): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const botones = (el: HTMLElement, texto: string): HTMLButtonElement[] =>
  Array.from(el.querySelectorAll('button')).filter((b) => b.textContent!.trim() === texto);

describe('PostsPage', () => {
  it('solo pide el post de las páginas APROBADAS: una sin aprobar no entra a la lista ni se le pide post', async () => {
    const paginas = [pagina({ id: 'p1', approved: true }), pagina({ id: 'p2', approved: false })];
    const verBriefSpy = jasmine.createSpy('verBrief').and.resolveTo(brief(paginas));
    const verPostSpy = jasmine.createSpy('verPost').and.resolveTo(post());
    const { fixture } = crear({ verBrief: verBriefSpy, verPost: verPostSpy });
    await estabilizar(fixture);

    expect(verPostSpy).toHaveBeenCalledTimes(1);
    expect(verPostSpy).toHaveBeenCalledWith('p1');
  });

  it('sin páginas aprobadas: mensaje vacío, sin pedir ningún post', async () => {
    const verBriefSpy = jasmine.createSpy('verBrief').and.resolveTo(brief([pagina({ approved: false })]));
    const verPostSpy = jasmine.createSpy('verPost');
    const { fixture } = crear({ verBrief: verBriefSpy, verPost: verPostSpy });
    const el = await estabilizar(fixture);

    expect(verPostSpy).not.toHaveBeenCalled();
    expect(el.textContent).toContain('no tiene ninguna página aprobada');
  });

  // -------------------------------------------------------------------- la máquina de 4(+1) estados

  it('estado "generando" (404 → null): mensaje, sin campos de edición ni botón Copiar', async () => {
    const { fixture } = crear({ verPost: jasmine.createSpy('verPost').and.resolveTo(null) });
    const el = await estabilizar(fixture);

    expect(el.textContent).toContain('Generando');
    expect(el.querySelector('input')).toBeNull();
    expect(el.querySelector('textarea')).toBeNull();
    expect(botones(el, 'Copiar').length).toBe(0);
  });

  it('estado "editable": input/textarea habilitados y botón "Publicar"', async () => {
    const { fixture } = crear({ verPost: jasmine.createSpy('verPost').and.resolveTo(post()) });
    const el = await estabilizar(fixture);

    const input = el.querySelector<HTMLInputElement>('input');
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea');
    expect(input).withContext('sin input no hay dónde editar el título').not.toBeNull();
    expect(textarea).withContext('sin textarea no hay dónde editar el cuerpo').not.toBeNull();
    expect(input!.disabled).toBe(false);
    expect(textarea!.disabled).toBe(false);
    expect(botones(el, 'Publicar').length).toBe(1);
    expect(botones(el, 'Reintentar publicación').length).toBe(0);
  });

  it('estado "publicando" (solicitadoEn puesto): campos DESHABILITADOS y sin botón de publicar', async () => {
    const enCurso = post({ solicitadoEn: '2026-09-02T00:00:00.000Z' });
    const { fixture } = crear({ verPost: jasmine.createSpy('verPost').and.resolveTo(enCurso) });
    const el = await estabilizar(fixture);

    expect(el.textContent).toContain('Publicando');
    expect(el.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
    expect(el.querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(true);
    expect(botones(el, 'Publicar').length).toBe(0);
    expect(botones(el, 'Reintentar publicación').length).toBe(0);
  });

  it('🔴 estado "fallo" (errorEn puesto, sin solicitadoEn): campos SIGUEN habilitados y hay "Reintentar publicación"', async () => {
    // El hallazgo Major de la ronda de Codex sobre el plan: sin distinguir errorEn de solicitadoEn,
    // una publicación fallida dejaba el botón deshabilitado PARA SIEMPRE.
    const fallida = post({ errorEn: '2026-09-02T00:00:00.000Z' });
    const { fixture } = crear({ verPost: jasmine.createSpy('verPost').and.resolveTo(fallida) });
    const el = await estabilizar(fixture);

    expect(el.textContent).toContain('Falló la publicación');
    expect(el.querySelector<HTMLInputElement>('input')!.disabled)
      .withContext('el brief exige edición HABILITADA en el estado de fallo')
      .toBe(false);
    expect(botones(el, 'Reintentar publicación').length).toBe(1);
    expect(botones(el, 'Publicar').length).toBe(0);
  });

  it('estado "publicada" (publicadoEn puesto): link a urlExterna, sin ningún botón de publicar', async () => {
    const publicada = post({
      publicadoEn: '2026-09-02T00:00:00.000Z',
      urlExterna: 'https://blog.cliente.test/pizza-napolitana',
    });
    const { fixture } = crear({ verPost: jasmine.createSpy('verPost').and.resolveTo(publicada) });
    const el = await estabilizar(fixture);

    expect(el.textContent).toContain('Publicada');
    const link = el.querySelector<HTMLAnchorElement>('a[href="https://blog.cliente.test/pizza-napolitana"]');
    expect(link).withContext('no encontré el link al post publicado').not.toBeNull();
    expect(botones(el, 'Publicar').length).toBe(0);
    expect(botones(el, 'Reintentar publicación').length).toBe(0);
  });

  // --------------------------------------------------------------------------------- guardar/publicar

  it('"Guardar" manda un ÚNICO PATCH con post_titulo Y post_cuerpo juntos', async () => {
    const editarPostSpy = jasmine.createSpy('editarPost').and.resolveTo(undefined);
    const { fixture } = crear({
      verPost: jasmine.createSpy('verPost').and.resolveTo(post()),
      editarPost: editarPostSpy,
    });
    let el = await estabilizar(fixture);

    const input = el.querySelector<HTMLInputElement>('input')!;
    input.value = 'Título editado';
    input.dispatchEvent(new Event('input'));
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = '<p>Cuerpo editado</p>';
    textarea.dispatchEvent(new Event('input'));
    el = await estabilizar(fixture);

    botones(el, 'Guardar')[0]!.click();
    el = await estabilizar(fixture);

    expect(editarPostSpy).toHaveBeenCalledTimes(1);
    expect(editarPostSpy).toHaveBeenCalledWith('p1', {
      post_titulo: 'Título editado',
      post_cuerpo: '<p>Cuerpo editado</p>',
    });
  });

  it('"Publicar" llama solicitarPublicacionPost con el pageId', async () => {
    const solicitarSpy = jasmine.createSpy('solicitarPublicacionPost').and.resolveTo(undefined);
    const { fixture } = crear({
      verPost: jasmine.createSpy('verPost').and.resolveTo(post()),
      solicitarPublicacionPost: solicitarSpy,
    });
    let el = await estabilizar(fixture);

    botones(el, 'Publicar')[0]!.click();
    el = await estabilizar(fixture);

    expect(solicitarSpy).toHaveBeenCalledWith('p1');
  });

  it('"Reintentar publicación" llama al MISMO endpoint que "Publicar"', async () => {
    const solicitarSpy = jasmine.createSpy('solicitarPublicacionPost').and.resolveTo(undefined);
    const fallida = post({ errorEn: '2026-09-02T00:00:00.000Z' });
    const { fixture } = crear({
      verPost: jasmine.createSpy('verPost').and.resolveTo(fallida),
      solicitarPublicacionPost: solicitarSpy,
    });
    let el = await estabilizar(fixture);

    botones(el, 'Reintentar publicación')[0]!.click();
    el = await estabilizar(fixture);

    expect(solicitarSpy).toHaveBeenCalledWith('p1');
  });

  // ---------------------------------------------------------------------------------- rol cliente

  /*
   * Los CUATRO estados con post, uno por `it()` — no un `for` dentro de un solo test: cada
   * `crear()` llama a `TestBed.configureTestingModule`, y el TestBed no se deja reconfigurar una
   * vez instanciado dentro del mismo test (mismo motivo que documenta `configurar()` en
   * `brief.spec.ts`). Cuatro tests separados es además más fácil de leer cuando uno falla: el
   * nombre del test YA dice qué estado, sin necesitar `withContext`.
   */
  it('🔴 rol cliente, estado editable: sin input/textarea/Guardar/Publicar', async () => {
    const { fixture } = crear({ verPost: jasmine.createSpy('verPost').and.resolveTo(post()), esEquipo: false });
    const el = await estabilizar(fixture);

    expect(el.querySelector('input')).toBeNull();
    expect(el.querySelector('textarea')).toBeNull();
    expect(botones(el, 'Guardar').length).toBe(0);
    expect(botones(el, 'Publicar').length).toBe(0);
    // El contenido SIGUE visible — mismo criterio que cliente-resenas.ts: nunca se le esconde el
    // texto al cliente, solo los controles que la API no le dejaría usar.
    expect(el.textContent).toContain('Pizza napolitana en Madrid');
  });

  it('🔴 rol cliente, estado publicando: sin input/textarea, sin ningún botón de publicar', async () => {
    const enCurso = post({ solicitadoEn: '2026-09-02T00:00:00.000Z' });
    const { fixture } = crear({ verPost: jasmine.createSpy('verPost').and.resolveTo(enCurso), esEquipo: false });
    const el = await estabilizar(fixture);

    expect(el.querySelector('input')).toBeNull();
    expect(el.querySelector('textarea')).toBeNull();
    expect(botones(el, 'Guardar').length).toBe(0);
    expect(el.textContent).toContain('Pizza napolitana en Madrid');
  });

  it('🔴 rol cliente, estado fallo: sin input/textarea, sin "Reintentar publicación"', async () => {
    const fallida = post({ errorEn: '2026-09-02T00:00:00.000Z' });
    const { fixture } = crear({ verPost: jasmine.createSpy('verPost').and.resolveTo(fallida), esEquipo: false });
    const el = await estabilizar(fixture);

    expect(el.querySelector('input')).toBeNull();
    expect(el.querySelector('textarea')).toBeNull();
    expect(botones(el, 'Reintentar publicación').length).toBe(0);
    expect(el.textContent).toContain('Pizza napolitana en Madrid');
  });

  it('🔴 rol cliente, estado publicada: sin input/textarea, el link SIGUE visible', async () => {
    const publicada = post({ publicadoEn: '2026-09-02T00:00:00.000Z', urlExterna: 'https://x.test' });
    const { fixture } = crear({ verPost: jasmine.createSpy('verPost').and.resolveTo(publicada), esEquipo: false });
    const el = await estabilizar(fixture);

    expect(el.querySelector('input')).toBeNull();
    expect(el.querySelector('textarea')).toBeNull();
    expect(el.querySelector('a[href="https://x.test"]'))
      .withContext('el link al post publicado no es un control de edición: se ve igual para cualquier rol')
      .not.toBeNull();
  });

  it('rol cliente: el botón "Copiar" SÍ está visible (copiar no es una acción que RLS module)', async () => {
    const { fixture } = crear({ verPost: jasmine.createSpy('verPost').and.resolveTo(post()), esEquipo: false });
    const el = await estabilizar(fixture);

    expect(botones(el, 'Copiar').length)
      .withContext('copiar no escribe nada: no hay motivo para ocultarlo del cliente')
      .toBe(1);
  });

  // -------------------------------------------------------------------------- "Copiar" (Step 3.5)

  it('🔴 "Copiar" escribe el post al portapapeles en HTML y texto plano', async () => {
    const conFormato = post({ titulo: 'Título del post', cuerpo: '<p>Hola <strong>mundo</strong></p>' });
    const { fixture } = crear({ verPost: jasmine.createSpy('verPost').and.resolveTo(conFormato) });
    const el = await estabilizar(fixture);

    const writeSpy = spyOn(navigator.clipboard, 'write').and.resolveTo(undefined);
    botones(el, 'Copiar')[0]!.click();
    await estabilizar(fixture);

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const item = writeSpy.calls.mostRecent().args[0][0] as ClipboardItem;
    expect(item.types).toContain('text/html');
    expect(item.types).toContain('text/plain');

    const html = await (await item.getType('text/html')).text();
    expect(html)
      .withContext('el HTML copiado tiene que ser EXACTAMENTE post_cuerpo, no una reconstrucción')
      .toBe('<p>Hola <strong>mundo</strong></p>');

    const texto = await (await item.getType('text/plain')).text();
    expect(texto).toContain('Título del post');
    expect(texto).toContain('Hola mundo');
    expect(texto).not.toContain('<p>');
  });

  /*
   * `fakeAsync`/`tick()` y NO `estabilizar()` (que espera `whenStable()`) para las pruebas de
   * "Copiado ✓" de acá abajo: `mostrarCopiado()` programa un `setTimeout(…, 2000)` real para el
   * auto-reset, y `whenStable()` NO se resuelve mientras ese timer siga pendiente — así que con
   * `estabilizar()` la promesa de la aserción esperaba los 2000 ms REALES, el timer disparaba ANTES
   * de que el test pudiera leer el DOM, y "Copiado ✓" ya había vuelto a "Copiar" cuando por fin se
   * comprobaba (medido: las cuatro pruebas fallaban con "Expected 0 to be 1" pero
   * `navigator.clipboard.write` SÍ se había llamado — el bug era del test, no del componente).
   * `fakeAsync` controla el reloj: `tick()` sin argumento avanza solo lo necesario para vaciar
   * microtareas (el `await navigator.clipboard.write(...)`), sin disparar el timer de 2000 ms. El
   * test de arriba, que solo lee `writeSpy` de forma síncrona tras el `await`, no necesitaba esto —
   * la prueba del test-arriba-de-éste ya confirmó ese camino.
   */
  it('"Copiar" muestra "Copiado ✓" tras copiar, y vuelve a "Copiar" solo pasados 2s — estado editable', fakeAsync(() => {
    const { fixture } = crear({ verPost: jasmine.createSpy('verPost').and.resolveTo(post()) });
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    spyOn(navigator.clipboard, 'write').and.resolveTo(undefined);

    botones(el, 'Copiar')[0]!.click();
    tick();
    fixture.detectChanges();

    expect(botones(el, 'Copiado ✓').length).toBe(1);

    tick(2000);
    fixture.detectChanges();
    expect(botones(el, 'Copiado ✓').length).withContext('el auto-reset a los 2s no ocurrió').toBe(0);
    expect(botones(el, 'Copiar').length).toBe(1);
  }));

  it('"Copiar" muestra "Copiado ✓" tras copiar — estado publicando', fakeAsync(() => {
    const enCurso = post({ solicitadoEn: '2026-09-02T00:00:00.000Z' });
    const { fixture } = crear({ verPost: jasmine.createSpy('verPost').and.resolveTo(enCurso) });
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    spyOn(navigator.clipboard, 'write').and.resolveTo(undefined);

    botones(el, 'Copiar')[0]!.click();
    tick();
    fixture.detectChanges();

    expect(botones(el, 'Copiado ✓').length).toBe(1);
    tick(2000);
  }));

  it('"Copiar" muestra "Copiado ✓" tras copiar — estado fallo', fakeAsync(() => {
    const fallida = post({ errorEn: '2026-09-02T00:00:00.000Z' });
    const { fixture } = crear({ verPost: jasmine.createSpy('verPost').and.resolveTo(fallida) });
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    spyOn(navigator.clipboard, 'write').and.resolveTo(undefined);

    botones(el, 'Copiar')[0]!.click();
    tick();
    fixture.detectChanges();

    expect(botones(el, 'Copiado ✓').length).toBe(1);
    tick(2000);
  }));

  it('"Copiar" muestra "Copiado ✓" tras copiar — estado publicada', fakeAsync(() => {
    const publicada = post({ publicadoEn: '2026-09-02T00:00:00.000Z', urlExterna: 'https://x.test' });
    const { fixture } = crear({ verPost: jasmine.createSpy('verPost').and.resolveTo(publicada) });
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    spyOn(navigator.clipboard, 'write').and.resolveTo(undefined);

    botones(el, 'Copiar')[0]!.click();
    tick();
    fixture.detectChanges();

    expect(botones(el, 'Copiado ✓').length).toBe(1);
    tick(2000);
  }));

  it('"Copiar" usa el fallback writeText si ClipboardItem no está disponible', fakeAsync(() => {
    const original = (window as { ClipboardItem?: unknown }).ClipboardItem;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).ClipboardItem = undefined;
    try {
      const { fixture } = crear({ verPost: jasmine.createSpy('verPost').and.resolveTo(post()) });
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const writeTextSpy = spyOn(navigator.clipboard, 'writeText').and.resolveTo(undefined);

      botones(el, 'Copiar')[0]!.click();
      tick();
      fixture.detectChanges();

      expect(writeTextSpy).toHaveBeenCalledTimes(1);
      expect(writeTextSpy.calls.mostRecent().args[0]).toContain('Pizza napolitana en Madrid');
      tick(2000);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ClipboardItem = original;
    }
  }));

  // -------------------------------------------------------------------------------- la carrera de runs

  it('🔴 la respuesta que llega tarde NO pisa la lista: cuando A contesta, el :runId vigente ya es B', async () => {
    const pendientes: Array<(b: Brief) => void> = [];
    const verBriefSpy = jasmine
      .createSpy('verBrief')
      .and.callFake(() => new Promise<Brief>((resolve) => pendientes.push(resolve)));
    const verPostSpy = jasmine.createSpy('verPost').and.resolveTo(post());
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', runId: 'run-A' }));
    const { fixture } = crear({ verBrief: verBriefSpy, verPost: verPostSpy, params });

    const el = await estabilizar(fixture); // pide A, queda colgado
    params.next(convertToParamMap({ id: 'c1', runId: 'run-B' })); // pide B antes de que A conteste
    await estabilizar(fixture);

    expect(verBriefSpy).toHaveBeenCalledTimes(2);

    pendientes[1]!(brief([pagina({ id: 'p-de-B', keyword_principal: 'la página de B' })]));
    await estabilizar(fixture);
    expect(el.textContent).toContain('la página de B');

    pendientes[0]!(brief([pagina({ id: 'p-de-A', keyword_principal: 'la página de A' })]));
    await estabilizar(fixture);

    expect(el.textContent)
      .withContext('la respuesta vieja de A pisó la lista: la pantalla es la de B')
      .not.toContain('la página de A');
    expect(el.textContent).toContain('la página de B');
  });
});

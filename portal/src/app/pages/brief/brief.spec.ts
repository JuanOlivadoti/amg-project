import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { BriefPage } from './brief';
import { ApiService } from '../../services/api';
import { MembresiaService } from '../../services/membresia';
import { environment } from '../../../environments/environment';
import type { Brief } from '../../core/models';
import { MOTIVO_SIN_PAGINAS, MOTIVO_SIN_WORKFLOW } from '../../core/aprobar-run';
import { RUN_SIN_WORKFLOW, SIN_PAGINAS_APROBADAS } from '../../core/codigos';
import type { ApiError } from '../../core/api-core';

/**
 * Guarda el gate del botón "Aprobar el run y publicar" (§A.5 / 10ª review #2), igual que el spec de
 * `ClienteResearchPage` guarda el de "lanzar research". En Fase 1 el botón NO se renderiza —aprobar
 * el run emitiría un evento sin orquestador—, pero la aprobación de PÁGINAS sí sigue disponible.
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
    // El caso NORMAL: el run lo lanzó el pipeline y hay una ejecución durable esperando su
    // aprobación. El run sembrado —el que NO la tiene— es el caso especial, y va en `sinWorkflow()`.
    tiene_workflow: true,
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

  /**
   * El doble de `ApiService`: la interfaz que el componente consume, y nada más. `aprobarRun` solo se
   * pasa en los tests que pulsan el botón — el resto ni lo llama.
   */
  type ApiDoble = { aprobarRun?: (id: string) => Promise<void> };

  /**
   * El fixture **sin el primer `detectChanges`**, que es el ciclo donde corre `ngOnInit`.
   *
   * Se separa de `renderFixture` para poder preparar el escenario antes de que la pantalla haga nada
   * — hoy, espiar al `Router` antes de que la conciliación de cliente pueda navegar. Mismo criterio
   * que `crear()` en `cliente-perfil.spec.ts`.
   */
  function configurar(
    esEquipo: boolean,
    aprobarHabilitado: boolean,
    brief: Brief = BRIEF,
    api: ApiDoble = {},
    // El run vive bajo su cliente: la ruta lleva DOS parámetros y el componente los distingue.
    // `c1` es el `client_id` de `BRIEF`, así que por defecto coinciden y nada redirige.
    params: { id: string; runId: string } = { id: 'c1', runId: 'run-1' },
  ): ComponentFixture<BriefPage> {
    environment.features.aprobarRun = aprobarHabilitado;
    // Un `it` puede renderizar DOS veces (los dos lados de la misma condición), y el TestBed no se
    // deja reconfigurar una vez instanciado. Resetear acá es lo mismo que Karma hace entre specs.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [BriefPage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap(params)) } },
        { provide: ApiService, useValue: { verBrief: async () => brief, ...api } },
        { provide: MembresiaService, useValue: { esEquipo: () => esEquipo } },
      ],
    });
    return TestBed.createComponent(BriefPage);
  }

  async function renderFixture(
    esEquipo: boolean,
    aprobarHabilitado: boolean,
    brief: Brief = BRIEF,
    api: ApiDoble = {},
    params: { id: string; runId: string } = { id: 'c1', runId: 'run-1' },
  ): Promise<ComponentFixture<BriefPage>> {
    const fixture = configurar(esEquipo, aprobarHabilitado, brief, api, params);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  async function render(
    esEquipo: boolean,
    aprobarHabilitado: boolean,
    brief: Brief = BRIEF,
  ): Promise<HTMLElement> {
    return (await renderFixture(esEquipo, aprobarHabilitado, brief)).nativeElement as HTMLElement;
  }

  /** `header button` y no `button` a secas: las tarjetas de página tienen los suyos («Aprobar», «Editar»). */
  const botonDelRun = (el: HTMLElement): HTMLButtonElement =>
    el.querySelector<HTMLButtonElement>('header button')!;

  /**
   * El «← Volver», buscado por su TEXTO y no por posición.
   *
   * Es el único enlace de la pantalla que sale del run —los otros dos entran en sus pantallas hijas—,
   * y es el que se apoya en `clienteId()` sin pasar por el brief cargado. Por eso tiene su propio
   * selector: los dos tests que lo usan (el href y la corrección de URL) miran justo eso.
   */
  const volverDelBrief = (el: HTMLElement): HTMLAnchorElement | undefined =>
    Array.from(el.querySelectorAll('a')).find((a) => a.textContent!.includes('Volver'));

  /** El mismo brief, con el coste que se le pida. `null` = quien pregunta no es staff. */
  const conCoste = (coste: number | null): Brief => ({
    ...BRIEF,
    run: { ...BRIEF.run, coste_micros_usd: coste },
  });

  /**
   * El mismo brief con su única página aprobada. `BRIEF` la trae SIN aprobar, que es el estado en el
   * que un run llega a esta pantalla: recién terminado el research, antes de que nadie mire nada.
   */
  const conPaginaAprobada = (): Brief => ({
    ...BRIEF,
    pages: [{ ...BRIEF.pages[0]!, approved: true }],
  });

  /**
   * El run que NO lanzó el pipeline: el sembrado de la demo, una importación. `tiene_workflow: false`
   * significa que no hay ninguna ejecución durable esperando su aprobación (bloque C0).
   */
  const sinWorkflow = (brief: Brief = BRIEF): Brief => ({
    ...brief,
    run: { ...brief.run, tiene_workflow: false },
  });

  /** Un error de la API tal como lo construye `crearApi`: mensaje para el humano, código para el programa. */
  const error409 = (codigo: string): ApiError =>
    Object.assign(new Error('El run no admite aprobación.'), { status: 409, codigo }) as ApiError;

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
  it('🔴 el link al informe está, apuntando a clientes/:id/research/:runId/informe', async () => {
    const el = await render(true, false);
    const link = el.querySelector<HTMLAnchorElement>('a[href="/clientes/c1/research/run-1/informe"]');
    expect(link).withContext('no encontré el link al informe del research').not.toBeNull();
    expect(link!.textContent).toContain('Ver el informe');
  });

  it('🔴 el link al informe aparece también para un rol que NO es equipo', async () => {
    // Un rol `cliente` ve el brief de su propio run pero no el informe (política `informe_staff`, 0016).
    // El link sigue estando: la pantalla del informe le dice con palabras que no está disponible, que es
    // mejor que un link que aparece y desaparece según quién mira.
    const el = await render(false, false);
    expect(el.querySelector('a[href="/clientes/c1/research/run-1/informe"]')).not.toBeNull();
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
  it('🔴 el link al entregable está para el equipo, apuntando a su URL bajo el cliente', async () => {
    // Sin este test, borrar el link deja la suite en verde y la pantalla imprimible inalcanzable: no
    // está en el sidebar (cuelga de un run) y nadie va a escribir la URL a mano.
    // Con una página aprobada: sin ninguna, el entregable saldría vacío y deja de ser un link (abajo).
    const el = await render(true, false, conPaginaAprobada());
    const link = el.querySelector<HTMLAnchorElement>('a[href="/clientes/c1/research/run-1/entregable"]');
    expect(link).withContext('no encontré el link al entregable del restaurante').not.toBeNull();
    expect(link!.textContent).toContain('entregable del restaurante');
  });

  it('🔴 el link al entregable NO aparece para un rol que no es equipo', async () => {
    const el = await render(false, false, conPaginaAprobada());
    expect(el.querySelector('a[href="/clientes/c1/research/run-1/entregable"]'))
      .withContext('se le está insinuando al cliente una pantalla que la API le va a negar con un 404')
      .toBeNull();
    // Ni siquiera apagado: la variante deshabilitada tampoco puede nombrarle el entregable a un cliente.
    expect(el.textContent)
      .withContext('el cliente no tiene por qué enterarse de que existe una hoja para él')
      .not.toContain('entregable del restaurante');
  });

  /*
   * El entregable sin ninguna página aprobada (B1, 2026-08-07).
   *
   * El endpoint responde 409 —el backend impone la regla— y acá se evita el viaje. Los dos tests van
   * juntos: «no navega» y «se sigue viendo, con el motivo» son afirmaciones distintas, y una sola de
   * las dos se cumple borrando el link, que es justo lo que no queremos.
   */
  it('🔴 sin ninguna página aprobada, el entregable NO navega: no hay ningún <a> que lleve ahí', async () => {
    // Un `<a>` con clase de apagado sigue navegando —y sigue abriéndose en una pestaña nueva con el
    // clic del medio—, así que lo que se comprueba es que NO EXISTE el ancla, no que se vea gris.
    const el = await render(true, false);
    expect(el.querySelector('a[href="/clientes/c1/research/run-1/entregable"]'))
      .withContext('el link lleva a un 409: el entregable saldría vacío')
      .toBeNull();
    expect(el.querySelector('[href*="entregable"]'))
      .withContext('ningún elemento puede seguir apuntando al entregable de un run sin aprobar')
      .toBeNull();
  });

  it('🔴 sin páginas aprobadas el entregable sigue a la vista, con el motivo en el tooltip', async () => {
    // Esconderlo sería la otra forma de equivocarse: quien mira la pantalla no descubriría nunca que
    // existe una hoja para el restaurante, ni qué le falta para poder generarla.
    const el = await render(true, false);
    // Se busca por el tooltip y no por la etiqueta HTML: lo que el usuario tiene que recibir es el
    // MOTIVO, y de qué elemento cuelgue es implementación. `span[title]` y no `[title]` a secas desde
    // C0: el botón de aprobar el run también lleva `title` cuando está apagado, y el suyo es otro.
    const apagado = el.querySelector<HTMLElement>('span[title]');
    expect(apagado).withContext('el entregable se apagó sin decir por qué').not.toBeNull();
    expect(apagado!.textContent)
      .withContext('el tooltip cuelga de otra cosa: no es el del entregable')
      .toContain('entregable del restaurante');
    expect(apagado!.title).toContain('página aprobada');
  });

  it('🔴 el entregable y el botón de aprobar el run se apagan JUNTOS: es la misma condición', async () => {
    /*
     * «Hay algo que entregar» y «hay algo que aprobar» son la MISMA pregunta (`puedeAprobarseRun`), y
     * este test existe para que sigan siéndolo. Dos definiciones separadas no fallan el día que se
     * escriben: fallan el día que alguien cambia una —«no retirada», «no vencida»— y la otra se queda
     * atrás, y entonces el portal ofrece generar un entregable que la API va a rechazar con un 409.
     */
    const sinAprobar = await render(true, true);
    expect(botonDelRun(sinAprobar).disabled).toBe(true);
    expect(sinAprobar.querySelector('a[href="/clientes/c1/research/run-1/entregable"]')).toBeNull();

    const conAprobada = await render(true, true, conPaginaAprobada());
    expect(botonDelRun(conAprobada).disabled).toBe(false);
    expect(conAprobada.querySelector('a[href="/clientes/c1/research/run-1/entregable"]')).not.toBeNull();
  });

  /*
   * ------------------------------------------------------------------ bloque C0
   * Un run que NO lanzó el pipeline no se puede aprobar (15ª review, H1; migración 0019).
   *
   * Hasta el 2026-08-07 esto no mordía porque el flag estaba apagado. Se encendió, y el run sembrado
   * de la demo quedó en `pending_approval` **en producción**: el botón se veía normal, la API
   * respondía 200, se emitía un evento que nadie consumía y no se publicaba nada.
   */
  it('🔴 un run que no lanzó el pipeline: el botón está, pero apagado y diciendo por qué', async () => {
    // CON una página aprobada a propósito: prueba que la condición es INDEPENDIENTE de las páginas.
    // Antes de C0 este mismo run pintaba el botón encendido.
    const el = await render(true, true, sinWorkflow(conPaginaAprobada()));

    const boton = botonDelRun(el);
    expect(boton)
      .withContext('el botón no puede desaparecer: quien mira tiene que enterarse de por qué no puede')
      .not.toBeNull();
    expect(boton.textContent).toContain('Aprobar el run y publicar');
    expect(boton.disabled)
      .withContext('el botón responde a un run que nadie va a publicar')
      .toBe(true);

    // El motivo, en las dos superficies y con el MISMO texto: la línea visible y el tooltip del botón.
    expect(el.textContent).toContain(MOTIVO_SIN_WORKFLOW);
    expect(boton.title).toBe(MOTIVO_SIN_WORKFLOW);
  });

  it('🔴 con los dos motivos a la vez se muestra UNO, y no el que promete algo falso', async () => {
    /*
     * El run sembrado de la demo, tal como está hoy en producción: sin workflow Y sin ninguna página
     * aprobada. Los dos avisos juntos se contradicen —«aprobá al menos una página» promete que
     * aprobando una se destraba, y no se destraba—, así que quien lo lee aprueba páginas, vuelve al
     * botón y lo encuentra igual de muerto.
     */
    const el = await render(true, true, sinWorkflow());

    expect(botonDelRun(el).disabled).toBe(true);
    expect(el.textContent).toContain(MOTIVO_SIN_WORKFLOW);
    expect(el.textContent)
      .withContext('se está mandando a aprobar páginas a alguien a quien aprobar páginas no le sirve')
      .not.toContain(MOTIVO_SIN_PAGINAS);
  });

  it('🔴 el entregable NO se apaga por falta de workflow: son preguntas distintas', async () => {
    /*
     * La mitad simétrica del test de «se apagan juntos». Un run sembrado con páginas aprobadas no se
     * puede publicar, pero SÍ tiene una hoja que mandarle al restaurante: el entregable se genera de
     * las páginas aprobadas. Copiar la condición del botón acá —la tentación obvia— le quitaría a la
     * agencia el entregable de la demo, que es justo el run que se le enseña a Frank.
     */
    const el = await render(true, true, sinWorkflow(conPaginaAprobada()));
    expect(botonDelRun(el).disabled).toBe(true);
    expect(el.querySelector('a[href="/clientes/c1/research/run-1/entregable"]'))
      .withContext('el entregable se apagó por un motivo que no es suyo')
      .not.toBeNull();
  });

  it('🔴 el 409 al pulsar apaga el botón y explica, SIN borrar la pantalla', async () => {
    /*
     * El botón se apaga por adelantado con `run.tiene_workflow`, así que llegar al 409 significa que
     * la pantalla y la base no coincidían (otra pestaña, el endpoint a mano). La UI es un atajo y el
     * backend la autoridad: cuando se contradicen, gana el backend.
     *
     * Y el aviso va AL LADO del botón, no en la rama de error: esa rama reemplaza la pantalla entera,
     * y quien leyera el mensaje se quedaría sin el brief y sin el botón al que el mensaje se refiere.
     */
    const fixture = await renderFixture(true, true, conPaginaAprobada(), {
      aprobarRun: () => Promise.reject(error409(RUN_SIN_WORKFLOW)),
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(botonDelRun(el).disabled).withContext('el arranque de este test no es el que cree').toBe(false);

    botonDelRun(el).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(botonDelRun(el))
      .withContext('la pantalla se fue a la rama de error y se llevó el brief por delante')
      .not.toBeNull();
    expect(botonDelRun(el).disabled).toBe(true);
    expect(el.textContent).toContain(MOTIVO_SIN_WORKFLOW);
    // El brief sigue ahí: el prompt del run y las secciones de páginas.
    expect(el.textContent).toContain('Restaurante italiano');
    expect(el.textContent).toContain('Respaldadas por datos');
  });

  it('🔴 el rechazo del servidor es de SU run: al navegar a otro, el botón vuelve a la vida', async () => {
    /*
     * Angular **reutiliza la instancia** al navegar del run A al B del mismo cliente (mismo
     * `routeConfig`, solo cambia el `:runId`): no hay
     * `ngOnInit` de nuevo, solo una emisión más del `paramMap`. Sin limpiar el rechazo ahí, el 409 de
     * A dejaría el botón de B apagado para siempre contándole a alguien un motivo que no es el suyo —
     * y como el rechazo gana sobre `tiene_workflow`, ni recargar el brief lo destrabaría.
     *
     * Un `BehaviorSubject` y no `of(...)`: hace falta emitir DOS veces, que es justo lo que un
     * `of()` de una sola emisión no puede reproducir.
     */
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', runId: 'run-1' }));
    const briefs: Record<string, Brief> = {
      'run-1': conPaginaAprobada(),
      'run-2': { ...conPaginaAprobada(), run: { ...BRIEF.run, id: 'run-2' } },
    };
    environment.features.aprobarRun = true;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [BriefPage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
        {
          provide: ApiService,
          useValue: {
            verBrief: async (id: string) => briefs[id]!,
            aprobarRun: () => Promise.reject(error409(RUN_SIN_WORKFLOW)),
          },
        },
        { provide: MembresiaService, useValue: { esEquipo: () => true } },
      ],
    });
    const fixture = TestBed.createComponent(BriefPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    botonDelRun(el).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(botonDelRun(el).disabled).withContext('el 409 no apagó el botón de run-1').toBe(true);

    // La MISMA instancia, otro run del MISMO cliente: solo cambia el `:runId`.
    params.next(convertToParamMap({ id: 'c1', runId: 'run-2' }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(botonDelRun(el).disabled)
      .withContext('run-2 heredó el rechazo de run-1: el botón quedó muerto sin motivo propio')
      .toBe(false);
    expect(el.textContent).not.toContain(MOTIVO_SIN_WORKFLOW);
  });

  it('🔴 cualquier OTRO error de aprobar sigue yendo a la rama de error, no al aviso del botón', async () => {
    /*
     * La mitad que impide que el `catch` se trague todo. Con un `catch` que marcara «sin workflow»
     * ante cualquier fallo, un 500 o una caída de red apagarían el botón para siempre contando un
     * motivo falso — y el test de arriba seguiría verde. Se prueba con el OTRO 409 del endpoint, que
     * es el vecino más fácil de confundir.
     */
    const fixture = await renderFixture(true, true, conPaginaAprobada(), {
      aprobarRun: () => Promise.reject(error409(SIN_PAGINAS_APROBADAS)),
    });
    const el = fixture.nativeElement as HTMLElement;

    botonDelRun(el).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.textContent)
      .withContext('un error que no es el de C0 no puede contar el motivo de C0')
      .not.toContain(MOTIVO_SIN_WORKFLOW);
    expect(el.textContent).toContain('El run no admite aprobación.');
  });

  it('🔴 el «← Volver» lleva al tab Research DEL CLIENTE de la ruta', async () => {
    /*
     * El tercer enlace de la pantalla, y el único que no estaba cubierto: los del informe y el
     * entregable tienen sus tests desde KR-2b, éste se quedó fuera. Medido: apuntarlo a `['/clientes']`
     * a secas deja la suite entera en verde, y el usuario sale de la ficha en la que estaba trabajando.
     *
     * Se diferencia de los otros dos en algo que importa: se arma con `clienteId()` **solo**, sin
     * `b.run.id`, así que es el único que sigue estando cuando el brief no cargó — y por eso es el que
     * usa el test de la corrección de URL de más abajo.
     */
    const el = await render(true, false);
    const volver = volverDelBrief(el);
    expect(volver).withContext('no encontré el enlace «← Volver»').toBeTruthy();
    expect(volver!.getAttribute('href')).toBe('/clientes/c1/research');
  });

  /*
   * ------------------------------------------------ la conciliación cliente ↔ dueño del run
   * Con DOS parámetros en la URL (`/clientes/:id/research/:runId`), el cliente que dice la ruta y el
   * dueño real del run son dos afirmaciones independientes: nada obliga a que coincidan.
   *
   * Los dos tests van juntos y ninguno sirve solo: uno solo lo pasaría un componente que redirigiera
   * SIEMPRE —dejando la pantalla navegando sobre sí misma en cada carga—, y el otro solo lo pasaría
   * uno que no conciliara nada.
   */
  it('🔴 run de OTRO cliente que el de la URL: corrige la URL a la ficha del dueño', async () => {
    /*
     * RLS impide ver runs de otro TENANT, pero no impide abrir /clientes/<A>/research/<run-de-B>
     * dentro del mismo tenant: la API devolvería el brief bueno y la cabecera diría el cliente
     * equivocado. No es una fuga; es una pantalla que miente sobre de quién es el trabajo — y en una
     * agencia con cartera, eso es un error de facturación esperando.
     *
     * El fixture se crea SIN el primer `detectChanges` (`configurar`) para instalar el spy antes de
     * que corra `ngOnInit`: la redirección sale de la carga que ese ciclo dispara, así que con
     * `renderFixture` el spy llegaría tarde y el test pasaría sin haber mirado la llamada.
     */
    const fixture = configurar(true, true, BRIEF, {}, { id: 'otro-cliente', runId: 'run-1' });
    const navegar = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // `BRIEF.run.client_id` es 'c1' y la URL dice 'otro-cliente'.
    expect(navegar).toHaveBeenCalledWith(['/clientes', 'c1', 'research', 'run-1']);
  });

  it('🔴 …y si el cliente de la URL SÍ es el dueño, no se navega a ningún lado', async () => {
    // La mitad simétrica. Sin ella, «redirigir siempre» pasa el test de arriba: la pantalla se
    // recargaría a sí misma en cada visita y el `routerLink` de vuelta apuntaría al sitio correcto
    // por accidente. Los params por defecto son `id: 'c1'`, que es el `client_id` de `BRIEF`.
    const fixture = configurar(true, true);
    const navegar = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(navegar)
      .withContext('el brief es de este cliente y la pantalla se fue igual: navegación en bucle')
      .not.toHaveBeenCalled();
  });

  it('🔴 corregida la URL, los enlaces la siguen: el `clienteId` se escribe ANTES de la guarda del run', async () => {
    /*
     * La segunda mitad de la conciliación, y la que no miraba nadie.
     *
     * Cuando `cargar()` corrige la URL, el router reemite el `paramMap` con el `:id` del dueño y el
     * MISMO `:runId`. En `ngOnInit`, la guarda `if (id === this.runId) return` corta ahí — y hace
     * bien: el run no cambió, no hay nada que recargar. Pero `clienteId.set(...)` va **antes** de esa
     * guarda, y ese orden es load-bearing: debajo de ella, la pantalla se queda con el cliente viejo
     * en sus seis `routerLink` justo después de haberlo corregido en la barra de direcciones.
     *
     * El daño no es cosmético: un clic en «Ver el informe» llevaría a
     * `/clientes/<A>/research/<run-de-B>/informe`, y el informe **no concilia** —por diseño, su
     * premisa documentada es que se llega desde el brief, que ya corrigió—. O sea: el error que esta
     * tarea elimina reaparecería un clic más tarde, con la URL ya «arreglada».
     *
     * Medido: mover el `set` debajo de la guarda deja la suite entera en verde sin este test. Es
     * exactamente «una garantía en un comentario es una intención, no una garantía».
     *
     * Un `BehaviorSubject` y no `of(...)`: hacen falta DOS emisiones, que es lo que un `of()` de una
     * sola no puede reproducir.
     */
    const params = new BehaviorSubject(convertToParamMap({ id: 'otro-cliente', runId: 'run-1' }));
    environment.features.aprobarRun = false;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [BriefPage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
        { provide: ApiService, useValue: { verBrief: async () => BRIEF } },
        { provide: MembresiaService, useValue: { esEquipo: () => true } },
      ],
    });
    const fixture = TestBed.createComponent(BriefPage);
    // El spy va antes del primer ciclo: si no, la conciliación navega de verdad y desmonta la
    // pantalla que este test quiere mirar.
    spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(volverDelBrief(el)!.getAttribute('href'))
      .withContext('el escenario no es el que cree: la URL de partida ya era la correcta')
      .toBe('/clientes/otro-cliente/research');

    // Lo que hace el router al aplicar la corrección: el MISMO run, con el `:id` ya arreglado.
    params.next(convertToParamMap({ id: 'c1', runId: 'run-1' }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(volverDelBrief(el)!.getAttribute('href'))
      .withContext('la URL se corrigió y los enlaces siguen apuntando al cliente equivocado')
      .toBe('/clientes/c1/research');
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

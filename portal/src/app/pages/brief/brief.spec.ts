import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { BriefPage } from './brief';
import { ApiService } from '../../services/api';
import { MembresiaService } from '../../services/membresia';
import { environment } from '../../../environments/environment';
import type { Brief, UltimaDecision } from '../../core/models';
import { MOTIVO_SIN_PAGINAS } from '../../core/aprobar-run';
import { SIN_PAGINAS_APROBADAS, TRANSICION_INVALIDA } from '../../core/codigos';
import type { ApiError } from '../../core/api-core';

/**
 * Guarda el gate del selector de destino (§A.5 / 10ª review #2, y el retiro del gate
 * `tiene_workflow` de este sub-proyecto), igual que el spec de `ClienteResearchPage` guarda el de
 * "lanzar research". En Fase 1 el selector NO se renderiza —aprobar el run emitiría un evento sin
 * orquestador—, pero la aprobación de PÁGINAS sí sigue disponible.
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
    tiene_workflow: true,
    // El caso NORMAL: nadie decidió nada todavía sobre este run. El caso con una decisión previa
    // —el que habilita "Construir la web ahora"— va en `conUltimaDecision()`.
    ultimaDecision: null,
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

describe('BriefPage — selector de destino y retiro del gate tiene_workflow', () => {
  const flagAprobarOriginal = environment.features.aprobarRun;
  const flagDestinoPostsOriginal = environment.features.destinoPosts;

  afterEach(() => {
    environment.features.aprobarRun = flagAprobarOriginal;
    environment.features.destinoPosts = flagDestinoPostsOriginal;
  });

  /**
   * El doble de `ApiService`: la interfaz que el componente consume, y nada más. `aprobarRun` solo se
   * pasa en los tests que pulsan el botón — el resto ni lo llama.
   */
  type ApiDoble = {
    aprobarRun?: (id: string, destino: 'crear_web' | 'solo_informe' | 'crear_posts') => Promise<void>;
  };

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

  /**
   * El botón "Confirmar" del selector — `header button` y no `button` a secas: las tarjetas de
   * página tienen los suyos («Aprobar», «Editar»). Es siempre el PRIMER botón del header: "Construir
   * la web ahora" (cuando aparece) va después en el DOM, y `puedeRetomarUI()` solo puede ser `true`
   * si `puedeAprobarRunUI()` también lo es — así que el selector con "Confirmar" ya está montado.
   */
  const botonConfirmar = (el: HTMLElement): HTMLButtonElement =>
    el.querySelector<HTMLButtonElement>('header button')!;

  const botonRetomar = (el: HTMLElement): HTMLButtonElement | null =>
    el.querySelector<HTMLButtonElement>('[data-test="retomar-web"]');

  const selectDestino = (el: HTMLElement): HTMLSelectElement | null =>
    el.querySelector<HTMLSelectElement>('select#destino-run');

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
   * El mismo brief (con su página aprobada, para que el selector esté habilitado) con la ÚLTIMA
   * DECISIÓN que se le pida — lo que sostiene "Construir la web ahora". `status` es opcional y
   * default `'pending_approval'` (el estado con el que ya venían todos los tests que usaban esto
   * antes de `puedeDecidirseRunUI`): pasarlo en `'approved'` es lo que ejercita el gate nuevo de la
   * revisión final del sub-proyecto 2 (Finding 3) — un run `approved` es el caso común tras la
   * primera decisión, y es justo el que antes mostraba el selector sin poder calificar nunca.
   */
  const conUltimaDecision = (
    destino: UltimaDecision['destino'],
    resultado: UltimaDecision['resultado'],
    status: Brief['run']['status'] = 'pending_approval',
  ): Brief => ({
    ...conPaginaAprobada(),
    run: {
      ...conPaginaAprobada().run,
      status,
      ultimaDecision: { destino, resultado, decididoEn: new Date().toISOString() },
    },
  });

  /**
   * Un run `approved` cuya última decisión SÍ es retomable (`solo_informe`/`completado`) pero cuya
   * única página YA NO está aprobada — el "bug relacionado" de Finding 3: `puedeRetomarUI()` solo
   * mira la ÚLTIMA DECISIÓN, no el estado actual de las páginas, así que sin el guard de
   * `motivoNoAprobar()` en el `[disabled]` de "Construir la web ahora", este escenario mostraba el
   * botón HABILITADO y el clic caía en el mismo 409 que el retiro del gate viejo debía eliminar.
   */
  const conDecisionRetomableSinPaginaAprobada = (): Brief => ({
    ...BRIEF,
    run: {
      ...BRIEF.run,
      status: 'approved',
      ultimaDecision: { destino: 'solo_informe', resultado: 'completado', decididoEn: new Date().toISOString() },
    },
  });

  /** Un error de la API tal como lo construye `crearApi`: mensaje para el humano, código para el programa. */
  const error409 = (codigo: string): ApiError =>
    Object.assign(new Error('El run no admite aprobación.'), { status: 409, codigo }) as ApiError;

  // -------------------------------------------------------------------------- el gate equipo + flag

  it('Fase 1 (equipo, flag apagado): el selector de destino NO se renderiza', async () => {
    const el = await render(true, false);
    expect(selectDestino(el)).toBeNull();
    expect(el.textContent).not.toContain('Confirmar');
  });

  it('dev/Fase 2 (equipo, flag encendido): el selector de destino SÍ se renderiza', async () => {
    const el = await render(true, true);
    expect(selectDestino(el)).not.toBeNull();
    expect(el.textContent).toContain('¿Qué hacemos con este research?');
    expect(el.textContent).toContain('Confirmar');
  });

  // ------------------------------------------------------------------------ las dos opciones fijas

  it('el selector siempre ofrece "Crear la web" y "Solo quedarme con el informe"', async () => {
    const el = await render(true, true);
    const valores = Array.from(selectDestino(el)!.querySelectorAll('option')).map((o) => o.value);
    expect(valores).toContain('crear_web');
    expect(valores).toContain('solo_informe');
  });

  // ---------------------------------------------------------------------- "crear_posts", con su flag

  it('🔴 con destinoPosts=true, la opción crear_posts NO está deshabilitada (Task 11: la pantalla ya existe)', async () => {
    environment.features.destinoPosts = true;
    const el = await render(true, true);
    const opcion = selectDestino(el)!.querySelector<HTMLOptionElement>('option[value="crear_posts"]');
    expect(opcion).withContext('la opción crear_posts no está en el selector').not.toBeNull();
    expect(opcion!.disabled)
      .withContext('la pantalla de posts que la consume ya existe: puede quedar usable')
      .toBe(false);
  });

  it('"crear_posts" NO aparece con el flag apagado', async () => {
    // Explícito acá y no apoyado en el default del environment: desde la Task 11,
    // `environment.ts` (dev) trae `destinoPosts: true` — solo `environment.prod.ts` se queda en
    // `false` (decisión de lanzamiento separada, `environment.prod.test.ts` la fija). Sin este test,
    // un flag que se prende solo (o un typo) pasaría en verde.
    environment.features.destinoPosts = false;
    const el = await render(true, true);
    expect(selectDestino(el)!.querySelector('option[value="crear_posts"]')).toBeNull();
  });

  // ---------------------------------------------------------------------------- el destino elegido

  it('🔴 "Confirmar" manda el destino elegido en el selector, no siempre crear_web', async () => {
    let destinoRecibido: string | undefined;
    const fixture = await renderFixture(true, true, conPaginaAprobada(), {
      aprobarRun: async (_id, destino) => {
        destinoRecibido = destino;
      },
    });
    const el = fixture.nativeElement as HTMLElement;
    const select = selectDestino(el)!;
    select.value = 'solo_informe';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    botonConfirmar(el).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(destinoRecibido).toBe('solo_informe');
  });

  it('"Confirmar" manda crear_web por defecto, sin tocar el selector', async () => {
    let destinoRecibido: string | undefined;
    const fixture = await renderFixture(true, true, conPaginaAprobada(), {
      aprobarRun: async (_id, destino) => {
        destinoRecibido = destino;
      },
    });
    const el = fixture.nativeElement as HTMLElement;
    botonConfirmar(el).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(destinoRecibido).toBe('crear_web');
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
   * El link a los POSTS generados (Task 11, sub-proyecto de publicación en blog externo). Mismo
   * criterio que el del informe (aparece para CUALQUIER rol) y NO el del entregable (equipo-only):
   * la pantalla de posts explica sus propios estados y el rol cliente tiene contenido legítimo de
   * solo lectura ahí. A diferencia de los dos anteriores, la condición no es "run/páginas
   * aprobables" sino la ÚLTIMA DECISIÓN del run: solo aparece si alguien aprobó con "crear_posts".
   */
  it('🔴 el link a los posts NO aparece sin una decisión crear_posts (ultimaDecision null)', async () => {
    const el = await render(true, false);
    expect(el.querySelector('a[href="/clientes/c1/research/run-1/posts"]')).toBeNull();
  });

  it('🔴 el link a los posts NO aparece si la última decisión fue OTRO destino', async () => {
    const el = await render(true, false, conUltimaDecision('crear_web', 'completado'));
    expect(el.querySelector('a[href="/clientes/c1/research/run-1/posts"]')).toBeNull();
  });

  it('🔴 el link a los posts aparece cuando la última decisión fue crear_posts, apuntando a research/:runId/posts', async () => {
    const el = await render(true, false, conUltimaDecision('crear_posts', 'pendiente'));
    const link = el.querySelector<HTMLAnchorElement>('a[href="/clientes/c1/research/run-1/posts"]');
    expect(link).withContext('no encontré el link a los posts generados').not.toBeNull();
    expect(link!.textContent).toContain('Ver los posts generados');
  });

  it('el link a los posts aparece también para un rol que NO es equipo', async () => {
    // El rol cliente tiene contenido legítimo en la pantalla de posts (solo lectura, Step 3) — a
    // diferencia del entregable, no se le esconde que la función existe.
    const el = await render(false, false, conUltimaDecision('crear_posts', 'completado'));
    expect(el.querySelector('a[href="/clientes/c1/research/run-1/posts"]')).not.toBeNull();
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
    // MOTIVO, y de qué elemento cuelgue es implementación. `span[title]` y no `[title]` a secas: el
    // botón "Confirmar" también lleva `title` cuando está apagado, y el suyo es otro.
    const apagado = el.querySelector<HTMLElement>('span[title]');
    expect(apagado).withContext('el entregable se apagó sin decir por qué').not.toBeNull();
    expect(apagado!.textContent)
      .withContext('el tooltip cuelga de otra cosa: no es el del entregable')
      .toContain('entregable del restaurante');
    expect(apagado!.title).toContain('página aprobada');
  });

  it('🔴 el entregable y el botón "Confirmar" se apagan JUNTOS: es la misma condición', async () => {
    /*
     * «Hay algo que entregar» y «hay algo que aprobar» son la MISMA pregunta (`puedeAprobarseRun`), y
     * este test existe para que sigan siéndolo. Dos definiciones separadas no fallan el día que se
     * escriben: fallan el día que alguien cambia una —«no retirada», «no vencida»— y la otra se queda
     * atrás, y entonces el portal ofrece generar un entregable que la API va a rechazar con un 409.
     */
    const sinAprobar = await render(true, true);
    expect(botonConfirmar(sinAprobar).disabled).toBe(true);
    expect(sinAprobar.querySelector('a[href="/clientes/c1/research/run-1/entregable"]')).toBeNull();

    const conAprobada = await render(true, true, conPaginaAprobada());
    expect(botonConfirmar(conAprobada).disabled).toBe(false);
    expect(conAprobada.querySelector('a[href="/clientes/c1/research/run-1/entregable"]')).not.toBeNull();
  });

  it('sin ninguna página aprobada, el motivo bajo "Confirmar" es MOTIVO_SIN_PAGINAS', async () => {
    const el = await render(true, true);
    expect(el.textContent).toContain(MOTIVO_SIN_PAGINAS);
    expect(botonConfirmar(el).title).toBe(MOTIVO_SIN_PAGINAS);
  });

  // -------------------------------------------------------------------- "Construir la web ahora"

  it('🔴 "Construir la web ahora" aparece cuando la última decisión fue solo_informe/completado', async () => {
    const el = await render(true, true, conUltimaDecision('solo_informe', 'completado'));
    expect(botonRetomar(el)).not.toBeNull();
  });

  it('"Construir la web ahora" NO aparece si el destino de la última decisión no es solo_informe', async () => {
    const el = await render(true, true, conUltimaDecision('crear_web', 'completado'));
    expect(botonRetomar(el)).toBeNull();
  });

  it('"Construir la web ahora" NO aparece con una decisión pendiente: correría dos workflows a la vez', async () => {
    const el = await render(true, true, conUltimaDecision('solo_informe', 'pendiente'));
    expect(botonRetomar(el)).toBeNull();
  });

  it('"Construir la web ahora" NO aparece con una decisión en error', async () => {
    const el = await render(true, true, conUltimaDecision('solo_informe', 'error'));
    expect(botonRetomar(el)).toBeNull();
  });

  it('"Construir la web ahora" NO aparece sin ninguna decisión previa (ultimaDecision: null)', async () => {
    const el = await render(true, true, conPaginaAprobada());
    expect(botonRetomar(el)).toBeNull();
  });

  /*
   * Los dos negativos que pide la ronda de Codex: `puedeRetomarUI()` tiene que combinar el gate de
   * equipo+flag con la decisión, no mirar solo la decisión. Sin combinarlos, un rol `cliente` —o un
   * despliegue con `aprobarRun` apagado— vería el botón igual y el backend lo rechazaría recién al
   * hacer clic (Corrección Major de la ronda de Codex sobre el plan de este sub-proyecto).
   */
  it('🔴 no muestra "Construir la web ahora" para un rol cliente, aunque la decisión califique', async () => {
    const el = await render(false, true, conUltimaDecision('solo_informe', 'completado'));
    expect(botonRetomar(el)).toBeNull();
  });

  it('🔴 no muestra "Construir la web ahora" con el flag aprobarRun apagado, aunque la decisión califique', async () => {
    const el = await render(true, false, conUltimaDecision('solo_informe', 'completado'));
    expect(botonRetomar(el)).toBeNull();
  });

  it('🔴 "Construir la web ahora" llama a aprobarRun con destino crear_web', async () => {
    let destinoRecibido: string | undefined;
    const fixture = await renderFixture(true, true, conUltimaDecision('solo_informe', 'completado'), {
      aprobarRun: async (_id, destino) => {
        destinoRecibido = destino;
      },
    });
    const el = fixture.nativeElement as HTMLElement;
    botonRetomar(el)!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(destinoRecibido).toBe('crear_web');
  });

  // ------------------------------------------------------- puedeDecidirseRunUI (Finding 3, revisión final)

  /*
   * Hallazgo Important de la revisión final del sub-proyecto 2: sin `puedeDecidirseRunUI()`, el
   * selector de destino se mostraba (y "Confirmar" quedaba habilitado) en CUALQUIER estado del run
   * — incluido `approved` sin decisión retomable, que es el caso común tras la primera decisión
   * exitosa —, y confirmar ahí siempre devolvía 409 `TRANSICION_INVALIDA`. Estos tests exigen que el
   * selector solo se muestre cuando `registrarDecision` podría realmente calificar algo.
   */
  it('🔴 el selector de destino NO se muestra en un run approved sin decisión retomable', async () => {
    const el = await render(true, true, conUltimaDecision('crear_web', 'completado', 'approved'));
    expect(selectDestino(el)).toBeNull();
    expect(el.textContent).not.toContain('Confirmar');
  });

  it('🔴 el selector de destino NO se muestra en un run approved sin ninguna decisión (ultimaDecision null)', async () => {
    const el = await render(true, true, { ...conPaginaAprobada(), run: { ...conPaginaAprobada().run, status: 'approved' } });
    expect(selectDestino(el)).toBeNull();
  });

  it('el selector de destino SÍ se muestra en un run approved con decisión retomable (solo_informe/completado)', async () => {
    // El camino retomable no se rompe: un run approved cuya última decisión calificante es
    // solo_informe/completado sigue pudiendo recibir crear_web vía registrarDecision.
    const el = await render(true, true, conUltimaDecision('solo_informe', 'completado', 'approved'));
    expect(selectDestino(el)).not.toBeNull();
  });

  it('el selector de destino se muestra normalmente en pending_approval (sin cambios)', async () => {
    const el = await render(true, true, conPaginaAprobada());
    expect(selectDestino(el)).not.toBeNull();
  });

  it('🔴 "Construir la web ahora" queda deshabilitado si la página ya no está aprobada, aunque la decisión sea retomable', async () => {
    const el = await render(true, true, conDecisionRetomableSinPaginaAprobada());
    const boton = botonRetomar(el);
    expect(boton).not.toBeNull();
    expect(boton!.disabled).withContext('sin página aprobada, crear_web volvería a devolver 409').toBe(true);
    expect(boton!.title).toBe(MOTIVO_SIN_PAGINAS);
  });

  // --------------------------------------------------------- el 409 TRANSICION_INVALIDA (retiro C0)

  it('🔴 el 409 TRANSICION_INVALIDA muestra el mensaje SIN borrar la pantalla', async () => {
    /*
     * El selector ya intenta acotar lo que se puede pedir, así que llegar al 409 significa que la
     * pantalla y la base no coincidían (otra pestaña, el endpoint a mano). La UI es un atajo y el
     * backend la autoridad: cuando se contradicen, gana el backend.
     *
     * Y el aviso va AL LADO del selector, no en la rama de error: esa rama reemplaza la pantalla
     * entera, y quien leyera el mensaje se quedaría sin el brief y sin el selector al que se refiere.
     */
    const fixture = await renderFixture(true, true, conPaginaAprobada(), {
      aprobarRun: () => Promise.reject(error409(TRANSICION_INVALIDA)),
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(botonConfirmar(el).disabled).withContext('el arranque de este test no es el que cree').toBe(false);

    botonConfirmar(el).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.textContent).toContain('Este run ya no admite esa transición.');
    // El brief sigue ahí: el prompt del run, el selector y las secciones de páginas.
    expect(el.textContent).toContain('Restaurante italiano');
    expect(el.textContent).toContain('Respaldadas por datos');
    expect(selectDestino(el)).not.toBeNull();
  });

  it('🔴 el error de destino es del run ANTERIOR: al navegar a otro, desaparece', async () => {
    /*
     * Angular **reutiliza la instancia** al navegar del run A al B del mismo cliente (mismo
     * `routeConfig`, solo cambia el `:runId`): no hay `ngOnInit` de nuevo, solo una emisión más del
     * `paramMap`. Sin limpiar el error ahí, el 409 de A seguiría mostrándose en la pantalla de B,
     * contando un motivo que no es el suyo.
     *
     * Un `BehaviorSubject` y no `of(...)`: hace falta emitir DOS veces, que es justo lo que un
     * `of()` de una sola emisión no puede reproducir.
     */
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', runId: 'run-1' }));
    const briefs: Record<string, Brief> = {
      'run-1': conPaginaAprobada(),
      'run-2': { ...conPaginaAprobada(), run: { ...conPaginaAprobada().run, id: 'run-2' } },
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
            aprobarRun: () => Promise.reject(error409(TRANSICION_INVALIDA)),
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

    botonConfirmar(el).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent)
      .withContext('el 409 no se mostró en run-1')
      .toContain('Este run ya no admite esa transición.');

    // La MISMA instancia, otro run del MISMO cliente: solo cambia el `:runId`.
    params.next(convertToParamMap({ id: 'c1', runId: 'run-2' }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.textContent)
      .withContext('run-2 heredó el error de run-1: le está contando un motivo que no es suyo')
      .not.toContain('Este run ya no admite esa transición.');
  });

  it('🔴 el destino elegido es del run ANTERIOR: al navegar a otro, vuelve a crear_web', async () => {
    /*
     * Mismo motivo que el test de arriba con `errorAprobar`, y mismo mecanismo: Angular **reutiliza
     * la instancia** al navegar del run A al B del mismo cliente (mismo `routeConfig`, solo cambia
     * el `:runId`). Sin resetear `destinoElegido`, quien cambió el selector en A a "Solo quedarme
     * con el informe" SIN confirmar, y navega a B, se lo encuentra ya en esa posición — una elección
     * que nunca hizo sobre un run que no es el que la originó.
     *
     * Se afirma sobre lo que `aprobarRun()` REALMENTE MANDA al hacer clic en "Confirmar" en B —no
     * sobre `select.value`— por un motivo concreto y medido: entre `brief.set(null)` (al entrar a
     * `ngOnInit`) y que `cargar()` vuelva a poner un brief, el `<select>` pasa por un tramo en el que
     * `@else if (brief(); as b)` no está montado, y Angular puede reconstruir el nodo antes de que el
     * test llame a `detectChanges()` — cuando eso pasa, el DOM del `<select>` recién creado arranca en
     * su primera opción ("Crear la web") **más allá de si el signal se reseteó o no**, así que leer
     * `select.value` ahí no distingue el bug de este archivo del arreglo (los dos muestran
     * "Crear la web" en el DOM, por motivos distintos). `aprobarRun()`, en cambio, lee el signal
     * DIRECTAMENTE (`this.destinoElegido()`) sin pasar por esa reconstrucción del DOM, así que sí
     * distingue los dos casos — y es además lo que de verdad le importa a quien usa la pantalla: qué
     * destino se manda.
     *
     * Un `BehaviorSubject` y no `of(...)`: hace falta emitir DOS veces, que es justo lo que un
     * `of()` de una sola emisión no puede reproducir.
     */
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1', runId: 'run-1' }));
    const briefs: Record<string, Brief> = {
      'run-1': conPaginaAprobada(),
      'run-2': { ...conPaginaAprobada(), run: { ...conPaginaAprobada().run, id: 'run-2' } },
    };
    let destinoRecibido: string | undefined;
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
            aprobarRun: async (_id: string, destino: string) => {
              destinoRecibido = destino;
            },
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

    // Cambia el selector en run-1, SIN confirmar.
    const select = selectDestino(el)!;
    select.value = 'solo_informe';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.componentInstance.destinoElegido())
      .withContext('el arranque de este test no es el que cree')
      .toBe('solo_informe');

    // La MISMA instancia, otro run del MISMO cliente: solo cambia el `:runId`.
    params.next(convertToParamMap({ id: 'c1', runId: 'run-2' }));
    await fixture.whenStable();
    fixture.detectChanges();

    // Sin tocar el selector de nuevo: si el reset no corrió, esto sigue en 'solo_informe'.
    botonConfirmar(el).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(destinoRecibido)
      .withContext('run-2 heredó la elección de run-1: se mandó un destino que nadie eligió ahí')
      .toBe('crear_web');
  });

  it('🔴 cualquier OTRO error de aprobar sigue yendo a la rama de error, no al aviso del selector', async () => {
    /*
     * La mitad que impide que el `catch` se trague todo. Con un `catch` que marcara «transición
     * inválida» ante cualquier fallo, un 500 o una caída de red mostrarían ese mensaje sin que fuera
     * cierto — y el test de arriba seguiría verde. Se prueba con el OTRO 409 del endpoint, que es el
     * vecino más fácil de confundir.
     */
    const fixture = await renderFixture(true, true, conPaginaAprobada(), {
      aprobarRun: () => Promise.reject(error409(SIN_PAGINAS_APROBADAS)),
    });
    const el = fixture.nativeElement as HTMLElement;

    botonConfirmar(el).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.textContent)
      .withContext('un error que no es TRANSICION_INVALIDA no puede contar su motivo')
      .not.toContain('Este run ya no admite esa transición.');
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

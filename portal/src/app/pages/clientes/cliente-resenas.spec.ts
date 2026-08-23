import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { signal } from '@angular/core';
import { ClienteResenasPage } from './cliente-resenas';
import { ApiService } from '../../services/api';
import { ClientesService } from '../../services/clientes';
import { MembresiaService } from '../../services/membresia';
import type { ClienteAgencia, ResenaGoogle } from '../../core/models';

/**
 * Test de componente (Karma) del tab `/clientes/:id/resenas`. Mismo patrón que
 * `cliente-ideas.spec.ts`: componente montado directo (sin anfitrión), `ActivatedRoute.paramMap` como
 * `BehaviorSubject` para poder emitir dos veces y montar la carrera, y `ClientesService`/`MembresiaService`
 * como dobles con signals — la interfaz que el componente consume, nada más.
 */
function clienteDePrueba(overrides: Partial<ClienteAgencia> = {}): ClienteAgencia {
  return {
    id: 'c1',
    nombre: 'Pizza Nonna',
    tipo: 'empresa',
    industria: 'restauración',
    etiquetas: null,
    nivel_actividad: 'alto',
    estado_contrato: 'vigente',
    contrato_vence_en: null,
    score: 80,
    asignado_a: null,
    contacto: null,
    origen: null,
    google_conectado_en: '2026-08-10T00:00:00.000Z',
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function resenaDePrueba(overrides: Partial<ResenaGoogle> = {}): ResenaGoogle {
  return {
    id: 'r1',
    clientId: 'c1',
    puntuacion: 5,
    autor: 'Ana',
    texto: 'Buenísimo',
    publicadaEn: '2026-08-01T00:00:00.000Z',
    vistaEn: '2026-08-01T00:00:00.000Z',
    borradorRespuesta: null,
    respuestaSolicitadaEn: null,
    respuestaPublicadaEn: null,
    ...overrides,
  };
}

/**
 * `listarResenas` a demanda: cada llamada queda colgada y el test decide cuándo —y en qué orden—
 * contesta. Mismo patrón que `listarIdeasDiferido` en `cliente-ideas.spec.ts`.
 */
function listarResenasDiferido() {
  const pendientes: Array<(resenas: ResenaGoogle[]) => void> = [];
  const spy = jasmine
    .createSpy('listarResenas')
    .and.callFake(() => new Promise<ResenaGoogle[]>((resolve) => pendientes.push(resolve)));
  return { spy, resolver: (i: number, resenas: ResenaGoogle[]) => pendientes[i]?.(resenas) };
}

function crear(
  opciones: {
    cliente?: ClienteAgencia | null;
    listarResenas?: jasmine.Spy;
    marcarResenaVista?: jasmine.Spy;
    editarBorradorResena?: jasmine.Spy;
    publicarRespuestaResena?: jasmine.Spy;
    conectarGoogle?: jasmine.Spy;
    desconectarGoogle?: jasmine.Spy;
    verCliente?: jasmine.Spy;
    esEquipo?: boolean;
    params?: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  } = {},
) {
  const listarResenasSpy = opciones.listarResenas ?? jasmine.createSpy('listarResenas').and.resolveTo([]);
  const marcarResenaVistaSpy =
    opciones.marcarResenaVista ?? jasmine.createSpy('marcarResenaVista').and.resolveTo(undefined);
  const editarBorradorResenaSpy =
    opciones.editarBorradorResena ?? jasmine.createSpy('editarBorradorResena').and.resolveTo(undefined);
  const publicarRespuestaResenaSpy =
    opciones.publicarRespuestaResena ??
    jasmine.createSpy('publicarRespuestaResena').and.resolveTo(undefined);
  const conectarGoogleSpy =
    opciones.conectarGoogle ??
    jasmine.createSpy('conectarGoogle').and.resolveTo({ url: 'https://accounts.google.test/consent' });
  const desconectarGoogleSpy =
    opciones.desconectarGoogle ?? jasmine.createSpy('desconectarGoogle').and.resolveTo(undefined);
  const verClienteSpy = opciones.verCliente ?? jasmine.createSpy('verCliente').and.resolveTo(undefined);
  const params = opciones.params ?? new BehaviorSubject(convertToParamMap({ id: 'c1' }));
  const cliente = opciones.cliente === undefined ? clienteDePrueba() : opciones.cliente;

  TestBed.configureTestingModule({
    imports: [ClienteResenasPage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      {
        provide: ApiService,
        useValue: {
          listarResenas: listarResenasSpy,
          marcarResenaVista: marcarResenaVistaSpy,
          editarBorradorResena: editarBorradorResenaSpy,
          publicarRespuestaResena: publicarRespuestaResenaSpy,
          conectarGoogle: conectarGoogleSpy,
          desconectarGoogle: desconectarGoogleSpy,
        },
      },
      { provide: ClientesService, useValue: { cliente: signal(cliente), verCliente: verClienteSpy } },
      { provide: MembresiaService, useValue: { esEquipo: signal(opciones.esEquipo ?? false) } },
    ],
  });
  const fixture = TestBed.createComponent(ClienteResenasPage);
  return {
    fixture,
    listarResenasSpy,
    marcarResenaVistaSpy,
    editarBorradorResenaSpy,
    publicarRespuestaResenaSpy,
    conectarGoogleSpy,
    desconectarGoogleSpy,
    verClienteSpy,
    params,
  };
}

async function estabilizar(fixture: ComponentFixture<ClienteResenasPage>): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ClienteResenasPage', () => {
  it('sin conectar: no pide reseñas, y sin esEquipo no se ve el botón de conectar', async () => {
    const { fixture, listarResenasSpy } = crear({
      cliente: clienteDePrueba({ google_conectado_en: null }),
      esEquipo: false,
    });
    const el = await estabilizar(fixture);

    expect(listarResenasSpy)
      .withContext('sin conexión no hay nada que listar: no debía salir ningún GET')
      .not.toHaveBeenCalled();
    expect(el.textContent).toContain('todavía no conectó su Google Business Profile');
    expect(el.querySelector('button'))
      .withContext('sin esEquipo el CTA "Conectar Google" no debe verse')
      .toBeNull();
  });

  it('sin conectar + esEquipo: el botón "Conectar Google" pide la URL de consentimiento', async () => {
    /*
     * `conectarGoogleSpy` NUNCA resuelve a propósito: el siguiente paso de `conectar()` es
     * `window.location.href = url`, una navegación DE VERDAD que en Karma (Chrome real) tira el
     * runner entero ("Some of your tests did a full page reload!"). No hay forma segura de stubbear
     * `window.location` en un navegador real —está protegido—, así que este test se detiene justo
     * antes: alcanza con fijar que el click llama a `conectarGoogle` con el cliente correcto.
     */
    const conectarGoogleSpy = jasmine.createSpy('conectarGoogle').and.callFake(() => new Promise(() => {}));
    const { fixture } = crear({
      cliente: clienteDePrueba({ google_conectado_en: null }),
      esEquipo: true,
      conectarGoogle: conectarGoogleSpy,
    });
    const el = await estabilizar(fixture);

    const boton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent!.includes('Conectar Google'),
    );
    expect(boton).withContext('no encontré el botón de conectar').toBeTruthy();

    boton!.click();
    expect(conectarGoogleSpy).toHaveBeenCalledWith('c1');
  });

  it('conectado sin esEquipo: no se ve el botón "Desconectar Google"', async () => {
    const { fixture } = crear({ esEquipo: false });
    const el = await estabilizar(fixture);

    const boton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent!.includes('Desconectar Google'),
    );
    expect(boton).withContext('sin esEquipo el botón de desconectar no debe verse').toBeUndefined();
  });

  it('conectado + esEquipo: el botón "Desconectar Google" llama desconectarGoogle y refresca el cliente', async () => {
    const { fixture, desconectarGoogleSpy, verClienteSpy } = crear({ esEquipo: true });
    const el = await estabilizar(fixture);

    const boton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent!.includes('Desconectar Google'),
    );
    expect(boton).withContext('no encontré el botón de desconectar').toBeTruthy();

    boton!.click();
    await estabilizar(fixture);

    expect(desconectarGoogleSpy).toHaveBeenCalledWith('c1');
    expect(verClienteSpy)
      .withContext('sin volver a pedir el cliente, `conectado()` se queda pegado en true')
      .toHaveBeenCalledWith('c1');
  });

  it('conectado sin reseñas: mensaje vacío, sin error y sin el CTA de conectar', async () => {
    const { fixture, listarResenasSpy } = crear();
    const el = await estabilizar(fixture);

    expect(listarResenasSpy).toHaveBeenCalledWith('c1');
    expect(el.textContent).toContain('Todavía no hay reseñas');
    expect(el.textContent).not.toContain('conectó su Google Business Profile');
    expect(el.querySelector('button')).toBeNull();
  });

  it('con reseñas: pinta en el ORDEN que llega, sin reordenar (el SQL ya pone 1-3★ sin ver primero)', async () => {
    const resenas = [
      resenaDePrueba({ id: 'r-mala', puntuacion: 1, autor: 'Carlos', vistaEn: null }),
      resenaDePrueba({ id: 'r-buena', puntuacion: 5, autor: 'Diana', vistaEn: '2026-08-01T00:00:00.000Z' }),
    ];
    const { fixture } = crear({ listarResenas: jasmine.createSpy('listarResenas').and.resolveTo(resenas) });
    const el = await estabilizar(fixture);

    const filas = Array.from(el.querySelectorAll('li'));
    expect(filas.map((li) => li.textContent))
      .withContext('el componente reordenó la lista: el orden es del SQL, no de la pantalla')
      .toEqual([jasmine.stringMatching('Carlos'), jasmine.stringMatching('Diana')]);
    // La 1-3★ sin ver lleva el borde de alerta; la 5★ ya vista, no.
    expect(filas[0]!.className).toContain('border-error');
    expect(filas[1]!.className).not.toContain('border-error');
  });

  it('al hacer click en "sin ver", llama marcarResenaVista y actualiza SOLO esa reseña en local', async () => {
    const resena = resenaDePrueba({ id: 'r1', vistaEn: null });
    const listarResenasSpy = jasmine.createSpy('listarResenas').and.resolveTo([resena]);
    const marcarResenaVistaSpy = jasmine.createSpy('marcarResenaVista').and.resolveTo(undefined);
    const { fixture } = crear({ listarResenas: listarResenasSpy, marcarResenaVista: marcarResenaVistaSpy });
    let el = await estabilizar(fixture);

    expect(el.textContent).toContain('sin ver');
    const boton = Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.trim() === 'sin ver')!;
    boton.click();
    el = await estabilizar(fixture);

    expect(marcarResenaVistaSpy).toHaveBeenCalledWith('c1', 'r1');
    expect(listarResenasSpy)
      .withContext('marcar como vista NO debe volver a pedir todo el listado')
      .toHaveBeenCalledTimes(1);
    expect(el.textContent).not.toContain('sin ver');
  });

  it('si listarResenas rechaza (token de Google vencido, u otro error), muestra el estado de error', async () => {
    const listarResenasSpy = jasmine
      .createSpy('listarResenas')
      .and.rejectWith(new Error('Token de Google vencido. Reconectá la cuenta.'));
    const { fixture } = crear({ listarResenas: listarResenasSpy });
    const el = await estabilizar(fixture);

    expect(el.textContent).toContain('Token de Google vencido. Reconectá la cuenta.');
    expect(el.textContent).not.toContain('Todavía no hay reseñas');
  });

  it('🔴 sin `:id` en la ruta no se pide NADA', async () => {
    const { listarResenasSpy } = crear({ params: new BehaviorSubject(convertToParamMap({})) });

    expect(listarResenasSpy).not.toHaveBeenCalled();
  });

  it('🔴 la respuesta que llega tarde NO pisa la lista: cuando A contesta, el :id vigente ya es B', async () => {
    /*
     * El mismo daño que `cliente-ideas.spec.ts` existe para impedir: las reseñas del cliente A bajo la
     * ficha del cliente B. `paramMap` emite A y después B (misma instancia reutilizada), B contesta
     * primero y pinta, y la respuesta lenta de A llega después.
     */
    const diferido = listarResenasDiferido();
    const params = new BehaviorSubject(convertToParamMap({ id: 'A' }));
    const { fixture } = crear({ listarResenas: diferido.spy, params });

    const el = await estabilizar(fixture); // pide A, queda colgado
    params.next(convertToParamMap({ id: 'B' })); // pide B antes de que A conteste
    await estabilizar(fixture);

    expect(diferido.spy.calls.allArgs())
      .withContext('el escenario no se montó: tienen que haberse pedido los dos clientes, en orden')
      .toEqual([['A'], ['B']]);

    diferido.resolver(1, [resenaDePrueba({ id: 'resena-de-B', autor: 'la reseña de B' })]);
    await estabilizar(fixture);
    expect(el.textContent).toContain('la reseña de B');

    diferido.resolver(0, [resenaDePrueba({ id: 'resena-de-A', autor: 'la reseña de A' })]);
    await estabilizar(fixture);

    expect(el.textContent)
      .withContext('la respuesta vieja de A pisó la lista: la ficha es la de B')
      .not.toContain('la reseña de A');
    expect(el.textContent).toContain('la reseña de B');
  });

  it('🔴 una respuesta que llega después de destruir el tab no escribe nada', async () => {
    const diferido = listarResenasDiferido();
    const { fixture } = crear({ listarResenas: diferido.spy });
    await estabilizar(fixture);

    fixture.destroy();
    diferido.resolver(0, [resenaDePrueba({ id: 'resena-tardia', autor: 'llegó después del destroy' })]);
    await fixture.whenStable();

    expect(fixture.componentInstance.resenas())
      .withContext('la carga en vuelo escribió sobre un tab ya destruido')
      .toEqual([]);
  });

  it('staff: una reseña 5★ sin borrador muestra un textarea vacío editable', async () => {
    const resena = resenaDePrueba({ puntuacion: 5, borradorRespuesta: null });
    const { fixture } = crear({
      listarResenas: jasmine.createSpy('listarResenas').and.resolveTo([resena]),
      esEquipo: true,
    });
    const el = await estabilizar(fixture);

    const textarea = el.querySelector('textarea');
    expect(textarea).withContext('sin textarea, el staff no tiene forma de completar el borrador a mano').toBeTruthy();
    expect(textarea!.value).toBe('');
  });

  it('staff: editar y Guardar dispara editarBorradorResena y actualiza la fila local', async () => {
    const resena = resenaDePrueba({ id: 'r1', puntuacion: 5, borradorRespuesta: null });
    const editarBorradorResenaSpy = jasmine.createSpy('editarBorradorResena').and.resolveTo(undefined);
    const { fixture } = crear({
      listarResenas: jasmine.createSpy('listarResenas').and.resolveTo([resena]),
      esEquipo: true,
      editarBorradorResena: editarBorradorResenaSpy,
    });
    let el = await estabilizar(fixture);

    const textarea = el.querySelector('textarea')!;
    textarea.value = 'Gracias por tu reseña';
    textarea.dispatchEvent(new Event('input'));
    el = await estabilizar(fixture);

    const boton = Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.trim() === 'Guardar')!;
    boton.click();
    el = await estabilizar(fixture);

    expect(editarBorradorResenaSpy).toHaveBeenCalledWith('c1', 'r1', 'Gracias por tu reseña');
    // NO `el.textContent`: un `<textarea>` no refleja su `.value` en el árbol de texto (eso solo pasa
    // con `.defaultValue`, que es otra propiedad) — hay que leer el control, no el texto renderizado.
    expect(el.querySelector('textarea')!.value).toBe('Gracias por tu reseña');
  });

  it('rol cliente: NO ve textarea ni botón Guardar, solo el texto de solo lectura si existe', async () => {
    const resena = resenaDePrueba({ puntuacion: 5, borradorRespuesta: 'Ya generado' });
    const { fixture } = crear({
      listarResenas: jasmine.createSpy('listarResenas').and.resolveTo([resena]),
      esEquipo: false,
    });
    const el = await estabilizar(fixture);

    expect(el.querySelector('textarea')).withContext('el rol cliente nunca ve un control editable').toBeNull();
    expect(el.textContent).toContain('Ya generado');
  });

  it('rol cliente, sin borrador: muestra "sin borrador todavía", sin textarea', async () => {
    const resena = resenaDePrueba({ puntuacion: 5, borradorRespuesta: null });
    const { fixture } = crear({
      listarResenas: jasmine.createSpy('listarResenas').and.resolveTo([resena]),
      esEquipo: false,
    });
    const el = await estabilizar(fixture);

    expect(el.querySelector('textarea')).toBeNull();
    expect(el.textContent).toContain('Sin borrador todavía');
  });

  it('una reseña de 1-3★ nunca muestra textarea ni texto de borrador', async () => {
    const resena = resenaDePrueba({ puntuacion: 2, borradorRespuesta: null });
    const { fixture } = crear({
      listarResenas: jasmine.createSpy('listarResenas').and.resolveTo([resena]),
      esEquipo: true,
    });
    const el = await estabilizar(fixture);

    expect(el.querySelector('textarea')).toBeNull();
    expect(el.textContent).not.toContain('Sin borrador todavía');
  });

  // ---------------------------------------------------------------- publicar respuesta (Bloque F, fase 2)

  it('staff, con borrador y sin solicitud: "Publicar respuesta" llama publicarRespuestaResena y pasa a "Reintentar publicación"', async () => {
    const resena = resenaDePrueba({
      id: 'r1',
      puntuacion: 5,
      borradorRespuesta: 'Gracias por tu reseña',
      respuestaSolicitadaEn: null,
      respuestaPublicadaEn: null,
    });
    const publicarRespuestaResenaSpy = jasmine
      .createSpy('publicarRespuestaResena')
      .and.resolveTo(undefined);
    const { fixture } = crear({
      listarResenas: jasmine.createSpy('listarResenas').and.resolveTo([resena]),
      esEquipo: true,
      publicarRespuestaResena: publicarRespuestaResenaSpy,
    });
    let el = await estabilizar(fixture);

    const boton = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent!.trim() === 'Publicar respuesta',
    );
    expect(boton).withContext('no encontré el botón "Publicar respuesta"').toBeTruthy();

    boton!.click();
    el = await estabilizar(fixture);

    expect(publicarRespuestaResenaSpy).toHaveBeenCalledWith('c1', 'r1');
    expect(el.textContent)
      .withContext('el estado optimista debía cambiar el botón sin recargar, mismo criterio que verla()')
      .toContain('Reintentar publicación');
    expect(
      Array.from(el.querySelectorAll('button')).some((b) => b.textContent!.trim() === 'Publicar respuesta'),
    ).toBeFalse();
  });

  it('con respuestaPublicadaEn puesto: se ve el texto fijo "Publicada el ...", sin ningún botón de publicar', async () => {
    const resena = resenaDePrueba({
      puntuacion: 5,
      borradorRespuesta: 'Gracias por tu reseña',
      respuestaSolicitadaEn: '2026-08-20T00:00:00.000Z',
      respuestaPublicadaEn: '2026-08-21T00:00:00.000Z',
    });
    const { fixture } = crear({
      listarResenas: jasmine.createSpy('listarResenas').and.resolveTo([resena]),
      esEquipo: true,
    });
    const el = await estabilizar(fixture);

    expect(el.textContent).toContain('Publicada el');
    expect(
      Array.from(el.querySelectorAll('button')).some(
        (b) => b.textContent!.trim() === 'Publicar respuesta' || b.textContent!.trim() === 'Reintentar publicación',
      ),
    )
      .withContext('ya publicada: no debe quedar ningún botón de publicar/reintentar')
      .toBeFalse();
  });

  it('🔴 sin borradorRespuesta no se ve ningún botón de publicar, ni siquiera si ya se había solicitado', async () => {
    const resena = resenaDePrueba({
      puntuacion: 5,
      borradorRespuesta: null,
      respuestaSolicitadaEn: '2026-08-20T00:00:00.000Z',
      respuestaPublicadaEn: null,
    });
    const { fixture } = crear({
      listarResenas: jasmine.createSpy('listarResenas').and.resolveTo([resena]),
      esEquipo: true,
    });
    const el = await estabilizar(fixture);

    expect(
      Array.from(el.querySelectorAll('button')).some(
        (b) => b.textContent!.trim() === 'Publicar respuesta' || b.textContent!.trim() === 'Reintentar publicación',
      ),
    )
      .withContext('publicar un borrador vacío no tiene sentido: "Guardar" existe para escribirlo primero')
      .toBeFalse();
  });

  it('🔴 rol cliente: no se ve ningún botón de publicar ni de reintentar, aun con borrador y sin solicitud', async () => {
    const resena = resenaDePrueba({
      puntuacion: 5,
      borradorRespuesta: 'Ya generado',
      respuestaSolicitadaEn: null,
      respuestaPublicadaEn: null,
    });
    const { fixture } = crear({
      listarResenas: jasmine.createSpy('listarResenas').and.resolveTo([resena]),
      esEquipo: false,
    });
    const el = await estabilizar(fixture);

    expect(
      Array.from(el.querySelectorAll('button')).some(
        (b) => b.textContent!.trim() === 'Publicar respuesta' || b.textContent!.trim() === 'Reintentar publicación',
      ),
    )
      .withContext('publicar es una acción de staff: el rol cliente no la ve, mismo criterio que Guardar')
      .toBeFalse();
  });
});

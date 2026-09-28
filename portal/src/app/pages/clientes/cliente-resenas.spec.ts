import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { signal } from '@angular/core';
import { ClienteResenasPage } from './cliente-resenas';
import { ApiService } from '../../services/api';
import { ClientesService } from '../../services/clientes';
import { MembresiaService } from '../../services/membresia';
import { LOCATION_ID_INVALIDO } from '../../core/codigos';
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
    vertical: 'restauracion',
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
    // El segundo argumento es lo pegado en el campo de ficha, vacío mientras nadie escriba nada.
    // Que salga `''` y no la clave `locationId` en el body lo fija `api-core.test.ts`: el backend
    // trata `""` como formato inválido, así que el cliente HTTP tiene que OMITIR la clave.
    expect(conectarGoogleSpy).toHaveBeenCalledWith('c1', '');
  });

  it('sin conectar + esEquipo: lo pegado en el campo de ficha viaja con el pedido de conectar', async () => {
    /*
     * El camino manual existe porque las dos APIs de descubrimiento de la ficha están en cuota 0 y
     * hoy devuelven 429 siempre. El automático NO se borró: es lo que pasa con el campo vacío.
     */
    const conectarGoogleSpy = jasmine.createSpy('conectarGoogle').and.callFake(() => new Promise(() => {}));
    const { fixture } = crear({
      cliente: clienteDePrueba({ google_conectado_en: null }),
      esEquipo: true,
      conectarGoogle: conectarGoogleSpy,
    });
    const el = await estabilizar(fixture);

    const input = el.querySelector('input[type="text"]') as HTMLInputElement | null;
    expect(input).withContext('no encontré el campo para pegar el nombre de recurso de la ficha').toBeTruthy();
    // Que el placeholder MUESTRE la forma importa (quien copia de la consola de Google ve un id
    // suelto y no sabe que la v4 direcciona por nombre completo), pero la FORMA no se afirma acá
    // con una regex copiada a mano: eso la volvía una tercera copia que deriva sola. La ata
    // `cliente-resenas-placeholder.test.ts` contra `db/`, que es la fuente única.
    expect(input!.placeholder)
      .withContext('el campo tiene que traer un ejemplo, no estar vacío')
      .toBeTruthy();

    input!.value = 'accounts/111/locations/222';
    input!.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    const boton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent!.includes('Conectar Google'),
    );
    boton!.click();
    expect(conectarGoogleSpy).toHaveBeenCalledWith('c1', 'accounts/111/locations/222');
  });

  it('🔴 el 400 de formato se pinta SIN llevarse el CTA ni el campo: es un valor corregible', async () => {
    /*
     * La diferencia con el 409 del guardarraíl de mock es el motivo, no el color. El 409 depende de
     * la configuración del despliegue: va a seguir rechazando pulses lo que pulses, así que borrar
     * el CTA es honesto. El 400 es un valor MAL ESCRITO por la persona que está mirando la pantalla:
     * si el error se lleva el CTA y el campo, la única salida es cambiar de cliente y volver, y el
     * texto que acaba de pegar se pierde. Por eso va a un signal aparte y no a `error()`.
     */
    const MENSAJE =
      'locationId inválido: hace falta el nombre de recurso completo de la ficha, ' +
      'con la forma accounts/<id>/locations/<id>.';
    // El `codigo` es lo que la pantalla mira; el `status` va porque el error real lo trae, pero
    // ramificar por él es justo lo que `core/codigos.ts` prohíbe (ver el test de abajo, que lo fija).
    const err = new Error(MENSAJE) as Error & { status: number; codigo: string };
    err.status = 400;
    err.codigo = LOCATION_ID_INVALIDO;
    const conectarGoogleSpy = jasmine.createSpy('conectarGoogle').and.rejectWith(err);
    const { fixture } = crear({
      cliente: clienteDePrueba({ google_conectado_en: null }),
      esEquipo: true,
      conectarGoogle: conectarGoogleSpy,
    });
    const el = await estabilizar(fixture);

    const input = el.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = 'locations/222';
    input.dispatchEvent(new Event('input'));
    await estabilizar(fixture);

    Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent!.includes('Conectar Google'))!
      .click();
    const despues = await estabilizar(fixture);

    expect(despues.textContent).toContain(MENSAJE);
    expect(Array.from(despues.querySelectorAll('button')).find((b) => b.textContent!.includes('Conectar Google')))
      .withContext('el 400 NO puede llevarse el CTA: hay que poder corregir y reintentar ahí mismo')
      .toBeTruthy();
    const inputDespues = despues.querySelector('input[type="text"]') as HTMLInputElement | null;
    expect(inputDespues).withContext('el campo tiene que seguir en pantalla').toBeTruthy();
    expect(inputDespues!.value)
      .withContext('lo que la persona escribió tiene que seguir ahí para poder corregirlo')
      .toBe('locations/222');
  });

  it('🔴 al cambiar de cliente, la ficha pegada y el error de formulario se limpian', async () => {
    /*
     * El campo es del cliente que se está mirando, no de la pantalla. Arrastrar el nombre de recurso
     * del cliente A al formulario del cliente B es peor que un campo vacío: conectaría la ficha
     * EQUIVOCADA, y el backend no tiene cómo saberlo — el valor es exactamente el que le pidieron.
     */
    const err = new Error('locationId inválido') as Error & { status: number; codigo: string };
    err.status = 400;
    err.codigo = LOCATION_ID_INVALIDO;
    const conectarGoogleSpy = jasmine.createSpy('conectarGoogle').and.rejectWith(err);
    const params = new BehaviorSubject(convertToParamMap({ id: 'c1' }));
    const { fixture } = crear({
      cliente: clienteDePrueba({ google_conectado_en: null }),
      esEquipo: true,
      conectarGoogle: conectarGoogleSpy,
      params,
    });
    const el = await estabilizar(fixture);

    const input = el.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = 'accounts/111/locations/222';
    input.dispatchEvent(new Event('input'));
    await estabilizar(fixture);
    Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent!.includes('Conectar Google'))!
      .click();
    let despues = await estabilizar(fixture);
    expect(despues.textContent).toContain('locationId inválido');

    params.next(convertToParamMap({ id: 'c2' }));
    despues = await estabilizar(fixture);

    expect((despues.querySelector('input[type="text"]') as HTMLInputElement).value)
      .withContext('la ficha del cliente anterior no puede quedar escrita en el formulario del siguiente')
      .toBe('');
    expect(despues.textContent).not.toContain('locationId inválido');
  });

  it('🔴 si conectar falla (409 del guardarraíl de mock), el motivo se PINTA — no falla en silencio', async () => {
    /*
     * Desde el 2026-09-10 `POST /clients/:id/google/conectar` puede responder 409: el despliegue es
     * de producción y el módulo está en `GOOGLE_REVIEWS_MODO=mock`, así que conectar sembraría
     * reseñas inventadas en la base real. Sin el `try/catch` de `conectar()` la promesa se rechaza
     * sin que nadie la mire y el botón NO HACE NADA VISIBLE — el peor resultado posible para un
     * guardarraíl: quien lo pulsa concluye que la app está rota en vez de leer el motivo.
     *
     * Este test no navega (el spy rechaza antes de `window.location.href`), así que no corre el
     * riesgo de recarga que documenta el test de arriba.
     */
    const MENSAJE =
      'El módulo de reseñas está en modo mock (GOOGLE_REVIEWS_MODO=mock) y este despliegue es de producción.';
    const conectarGoogleSpy = jasmine.createSpy('conectarGoogle').and.rejectWith(new Error(MENSAJE));
    const { fixture } = crear({
      cliente: clienteDePrueba({ google_conectado_en: null }),
      esEquipo: true,
      conectarGoogle: conectarGoogleSpy,
    });
    const el = await estabilizar(fixture);

    const boton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent!.includes('Conectar Google'),
    );
    boton!.click();
    const despues = await estabilizar(fixture);

    expect(conectarGoogleSpy).toHaveBeenCalledWith('c1', '');
    expect(despues.textContent)
      .withContext('el mensaje del 409 tiene que llegar a la pantalla')
      .toContain(MENSAJE);
    // La otra mitad del contrato, y el contraste con el 400 de formato: este error SÍ se lleva el
    // CTA, a propósito. El 409 depende de la configuración del despliegue y va a seguir rechazando
    // hasta que ésta cambie, así que dejar el botón invitaría a pulsarlo en vano.
    expect(Array.from(despues.querySelectorAll('button')).find((b) => b.textContent!.includes('Conectar Google')))
      .withContext('el 409 no es corregible desde la pantalla: el CTA se va')
      .toBeUndefined();
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

  /*
   * El contraste que hace que el código sirva para algo: un 400 de OTRA cosa —este endpoint puede
   * ganar uno cualquier día, otro campo del body— NO puede pintarse como un error del campo de ficha,
   * porque mandaría a corregir un valor que está bien. Si la pantalla ramificara por `status`, este
   * test pasaría igual y la distinción no existiría.
   */
  it('🔴 un 400 SIN el código de ficha NO se pinta en el formulario: se trata como error de pantalla', async () => {
    const err = new Error('otro 400 cualquiera') as Error & { status: number };
    err.status = 400; // sin `codigo`: es otro 400 del mismo endpoint, no el del campo
    const conectarGoogleSpy = jasmine.createSpy('conectarGoogle').and.rejectWith(err);
    const { fixture } = crear({
      cliente: clienteDePrueba({ google_conectado_en: null }),
      esEquipo: true,
      conectarGoogle: conectarGoogleSpy,
    });
    const el = await estabilizar(fixture);

    Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent!.includes('Conectar Google'))!
      .click();
    const despues = await estabilizar(fixture);

    // Va por el camino de `error()`, que es excluyente y se lleva el CTA. Lo que se fija acá no es
    // ese comportamiento —ya lo fija el test del 409— sino que este 400 NO se confundió con el del
    // campo: si la pantalla ramificara por status, el CTA seguiría en pantalla y esto caería.
    expect(Array.from(despues.querySelectorAll('button')).find((b) => b.textContent!.includes('Conectar Google')))
      .withContext('un 400 ajeno al campo no puede tratarse como un valor corregible del formulario')
      .toBeFalsy();
    expect(despues.textContent).toContain('otro 400 cualquiera');
  });
});

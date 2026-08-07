import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { EntregablePage } from './entregable';
import { ApiService } from '../../services/api';
import { ImpresionService } from '../../shared/services/impresion';
import type { ApiError } from '../../core/api-core';

/**
 * Lo que este spec defiende son DOS propiedades, y la segunda es la razón de ser de la pieza entera.
 *
 * 1. **El documento se pinta como TEXTO.** Lo escribió un LLM sobre datos de un proveedor externo, así
 *    que la pregunta no es si algún día va a llegar una etiqueta ahí dentro, sino qué pasa cuando
 *    llegue. `core/sin-html-crudo.test.ts` prohíbe las herramientas; esto comprueba el resultado en un
 *    DOM de verdad.
 * 2. **La pantalla NO filtra el coste.** El coste no aparece en el entregable porque el servidor no lo
 *    genera (`renderReport(brief, { audiencia: "restaurante" })`), no porque acá haya un `@if`. La forma de
 *    demostrarlo es al revés de como suena: se le da a la pantalla un Markdown que SÍ trae el bloque
 *    de coste y se exige que lo pinte. Si alguien "endurece" esto agregando un filtro en el cliente,
 *    este test cae — y tiene que caer, porque un filtro acá significaría que el dato ya viajó.
 */

/** El ataque de manual, tal como llegaría dentro del Markdown del entregable. */
const HOSTIL = [
  '# Keyword Research — <script>alert("xss")</script>',
  '',
  'Un párrafo con <img src=x onerror="alert(1)"> incrustado.',
  '',
  '| Keyword | Nota |',
  '|---|---|',
  '| pizza | <iframe src="javascript:alert(1)"></iframe> |',
  '',
  '- un ítem con <b>negrita falsa</b>',
  '',
  '> aviso con <svg onload="alert(1)"></svg>',
].join('\n');

/** La cabecera real que emite `renderReport`, medida el 2026-08-07. */
const REAL = [
  '# Keyword Research — La Birra Bar',
  '',
  '_ES · es · 2026-07-30T00:16:15.000Z_',
  '',
  '- Keywords analizadas: **55**',
  '',
  '## Páginas propuestas',
  '',
  '| # | Tipo | Keyword principal |',
  '|---|---|---|',
  '| 1 | landing\\_local | mejor hamburguesa del mundo Madrid |',
].join('\n');

function montar(verEntregableMd: () => Promise<string>, impresion?: Partial<ImpresionService>) {
  TestBed.configureTestingModule({
    imports: [EntregablePage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'run-1' })) } },
      { provide: ApiService, useValue: { verEntregableMd } },
      // Un doble SIEMPRE: el real llama a `window.print()`, y eso le abriría el diálogo de impresión
      // —modal y bloqueante— a quien corre la suite.
      { provide: ImpresionService, useValue: impresion ?? { imprimir: () => {} } },
    ],
  });
  const fixture = TestBed.createComponent(EntregablePage);
  fixture.detectChanges();
  return fixture;
}

async function estabilizar(fixture: ReturnType<typeof montar>) {
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

function render(md: string, impresion?: Partial<ImpresionService>) {
  return estabilizar(montar(async () => md, impresion));
}

function renderConFallo(status: number, mensaje: string, codigo?: string) {
  const err = new Error(mensaje) as ApiError;
  err.status = status;
  if (codigo !== undefined) err.codigo = codigo;
  return estabilizar(
    montar(async () => {
      throw err;
    }),
  );
}

/** La respuesta exacta del endpoint cuando el run no tiene nada aprobado (`api/src/app.ts`). */
const MENSAJE_409 =
  'Este research no tiene ninguna página aprobada, así que el entregable saldría vacío. ' +
  'Aprobá al menos una página antes de generarlo.';

/** La acción que SOLO ofrece la rama del 409. Es lo que la distingue de un error genérico. */
const ACCION_409 = 'Ir al brief y aprobar páginas';

describe('EntregablePage — la hoja que se le manda al restaurante', () => {
  it('🔴 un documento con <script> NO mete un <script> en el DOM, y el texto sí se ve', async () => {
    const { el } = await render(HOSTIL);

    for (const etiqueta of ['script', 'img', 'iframe', 'svg', 'b']) {
      expect(el.querySelector(etiqueta))
        .withContext(`apareció un <${etiqueta}> que venía en el Markdown`)
        .toBeNull();
    }
    // Y no se perdió por el camino: el dato se ve, literal.
    expect(el.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(el.textContent).toContain('<iframe src="javascript:alert(1)"></iframe>');
    expect(el.textContent).toContain('<b>negrita falsa</b>');
    expect(el.textContent).toContain('<svg onload="alert(1)"></svg>');
  });

  it('🔴 la pantalla NO filtra el coste: si el Markdown lo trae, se pinta', async () => {
    /*
     * EL test de la pieza, y el más contraintuitivo de leer.
     *
     * El entregable no lleva coste porque `renderReport` no genera el bloque (`audiencia: "restaurante"`,
     * `contrato/src/informe.ts`) — la decisión vive donde el dato todavía no salió del servidor. Si
     * en cambio esta pantalla lo escondiera con un `@if` o con CSS, el margen de la agencia ya estaría
     * en el DOM, en la caché del navegador y en el «ver código fuente»: oculto, no ausente.
     *
     * Así que se afirma lo aparentemente contrario a lo que se quiere: dado un Markdown CON coste, la
     * hoja lo muestra. Es la única forma de probar la AUSENCIA de un filtro en el cliente. Si algún
     * día este test se pone en rojo, la pregunta correcta no es cómo arreglarlo, es quién agregó el
     * filtro y por qué el bloque llegó hasta acá.
     */
    const conCoste = [
      '# Keyword Research — La Birra Bar',
      '',
      '### Coste del research',
      '',
      '| Proveedor | Coste |',
      '|---|---|',
      '| DataForSEO | $0.25 |',
      '| **TOTAL** | **$0.31** |',
    ].join('\n');

    const { el } = await render(conCoste);
    expect(el.textContent)
      .withContext('alguien agregó un filtro de coste en el cliente: el dato ya viajó al navegador')
      .toContain('Coste del research');
    expect(el.textContent).toContain('$0.31');
  });

  it('🔴 el título del documento sale una sola vez: el h1 no se repite en el cuerpo', async () => {
    // `partirEncabezado` mueve el h1 al encabezado de la hoja. Sin ese corte hay DOS h1 —uno en el
    // header y otro como primer bloque—, que en el PDF se ve como el título impreso dos veces seguidas.
    const { el } = await render(REAL);
    const h1s = el.querySelectorAll('h1');
    expect(h1s.length).toBe(1);
    expect(h1s[0]!.textContent).toContain('La Birra Bar');
    expect(el.querySelector('header')).not.toBeNull();
  });

  it('🔴 los encabezados NO bajan de nivel: acá el documento ES la página', async () => {
    // Al revés que en `InformePage`, donde el informe está anidado bajo el h1 de la pantalla y su `##`
    // se pinta como h3. Acá un `##` es un h2: si bajara de nivel, el PDF tendría un índice con la
    // jerarquía corrida un escalón y ningún h1 en el cuerpo.
    const { el } = await render(REAL);
    expect(el.querySelector('article h2')).not.toBeNull();
    expect(el.querySelector('article h2')!.textContent).toContain('Páginas propuestas');
  });

  it('la fecha del research se muestra legible, no como el ISO crudo', async () => {
    const { el } = await render(REAL);
    expect(el.querySelector('header')!.textContent).toContain(
      'Research realizado el 30/07/2026, 00:16 UTC',
    );
  });

  it('🔴 si el documento no ofrece la fecha sin ambigüedad, no se inventa ninguna', async () => {
    // Dos candidatas en la cabecera ⇒ `fechaDelResearch` devuelve null (regla de `informe-vista.ts`).
    // La línea desaparece; lo que no puede pasar es que la hoja del cliente lleve una fecha elegida a
    // dedo entre dos.
    const { el } = await render(
      '# Keyword Research — Bar X\n\n_ES · es · 2026-07-30T00:16:15.000Z_\n\n- Actualizado: 2026-09-01T00:00:00Z\n',
    );
    expect(el.querySelector('header')!.textContent).not.toContain('Research realizado el');
  });

  it('🔴 un run que no existe (o que este rol no puede ver) muestra el error y NO una hoja vacía', async () => {
    /*
     * El endpoint responde el MISMO 404 en tres casos —run inexistente, otro tenant, y quien pregunta
     * no es staff—, porque `app.es_staff()` va en el predicado de la consulta. La pantalla no puede
     * distinguirlos y no lo intenta: muestra el mensaje de la API.
     *
     * La mitad que importa es la segunda: sin la rama de error, un 404 dejaría una hoja en blanco con
     * el botón de imprimir puesto, y alguien mandaría un PDF vacío.
     */
    const { el } = await renderConFallo(404, 'Run no encontrado.');
    expect(el.textContent).toContain('Run no encontrado.');
    expect(el.textContent).not.toContain('Cargando…');
    expect(el.querySelector('button'))
      .withContext('no hay nada que imprimir de un run que no se puede ver')
      .toBeNull();
    // Control negativo de la rama del 409: un fallo sin código no puede mandar a nadie a aprobar
    // páginas de un run que no existe.
    expect(el.textContent).not.toContain(ACCION_409);
  });

  /*
   * El 409 «este run no tiene ninguna página aprobada» (B1, 2026-08-07).
   *
   * La UI del brief evita el clic —el link llega deshabilitado—, pero la UI no es la regla: entre que
   * alguien abre el brief y pulsa, otro miembro del equipo puede retirar la última página aprobada. Con
   * el link viejo en una pestaña, o escribiendo la URL, se llega igual. Lo que esta pantalla no puede
   * hacer es tratar ese caso como un error cualquiera: es un estado normal con una acción concreta.
   */
  it('🔴 un 409 sin páginas aprobadas explica qué falta y ofrece ir a aprobarlas', async () => {
    const { el } = await renderConFallo(409, MENSAJE_409, 'SIN_PAGINAS_APROBADAS');

    expect(el.textContent).toContain('no tiene ninguna página aprobada');
    const accion = Array.from(el.querySelectorAll('a')).find((a) =>
      a.textContent!.includes(ACCION_409),
    );
    expect(accion).withContext('sin la acción, el usuario sabe qué falta pero no adónde ir').toBeTruthy();
    expect(accion!.getAttribute('href')).toBe('/runs/run-1');
    expect(el.querySelector('button'))
      .withContext('no se ofrece imprimir un documento que el servidor se negó a generar')
      .toBeNull();
  });

  it('🔴 la rama se elige por el CÓDIGO, no por la frase: con el mensaje reescrito sigue igual', async () => {
    /*
     * EL test de la pieza. El mensaje del servidor es para el humano y se puede corregir cualquier día
     * —una tilde, un «Aprueba» por «Aprobá»—; si esta pantalla comparara el texto, esa corrección
     * apagaría la rama en silencio y la descarga volvería a fallar como un error genérico. El código es
     * contrato (`core/codigos.ts`, atado por test al de la API), y es lo único que se compara.
     */
    const { el } = await renderConFallo(409, 'Otra redacción cualquiera.', 'SIN_PAGINAS_APROBADAS');
    expect(el.textContent).toContain(ACCION_409);
    // Y el mensaje que se pinta es el del servidor, no una copia congelada acá.
    expect(el.textContent).toContain('Otra redacción cualquiera.');
  });

  it('🔴 al pasar a OTRO run, el aviso del anterior no se queda pegado', async () => {
    /*
     * Angular REUTILIZA la instancia al navegar de `/runs/A/entregable` a `/runs/B/entregable`: no se
     * dispara `ngOnInit` de nuevo. Si el aviso del 409 no se limpia con el parámetro, el run B —que sí
     * tiene páginas aprobadas y sí trae documento— se pinta con el cartel de «aprobá páginas» encima
     * del run equivocado. Es la misma clase de bug que ya obligó a poner la vigencia en esta pantalla.
     */
    const err = Object.assign(new Error(MENSAJE_409), {
      status: 409,
      codigo: 'SIN_PAGINAS_APROBADAS',
    }) as ApiError;
    const params = new BehaviorSubject(convertToParamMap({ id: 'run-1' }));
    TestBed.configureTestingModule({
      imports: [EntregablePage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: params } },
        {
          provide: ApiService,
          useValue: {
            verEntregableMd: async (id: string) => {
              if (id === 'run-1') throw err;
              return REAL;
            },
          },
        },
        { provide: ImpresionService, useValue: { imprimir: () => {} } },
      ],
    });
    const fixture = TestBed.createComponent(EntregablePage);
    fixture.detectChanges(); // el primero es el que corre ngOnInit y suscribe al paramMap
    const { el } = await estabilizar(fixture);
    expect(el.textContent).toContain(ACCION_409);

    params.next(convertToParamMap({ id: 'run-2' }));
    await estabilizar(fixture);
    expect(el.textContent)
      .withContext('el aviso del run anterior sigue puesto sobre el documento del nuevo')
      .not.toContain(ACCION_409);
    expect(el.textContent).toContain('La Birra Bar');
  });

  it('🔴 un 409 SIN código no se trata como «sin páginas aprobadas»', async () => {
    // La mitad simétrica: ramificar por status confundiría este 409 con el otro el día que el endpoint
    // tenga dos, y el usuario iría a aprobar páginas por un conflicto que no tiene nada que ver.
    const { el } = await renderConFallo(409, 'Otro conflicto distinto.');
    expect(el.textContent).toContain('Otro conflicto distinto.');
    expect(el.textContent).not.toContain(ACCION_409);
  });

  it('🔴 un documento vacío se cuenta con palabras, no con una hoja en blanco', async () => {
    // Hoy no puede pasar (`renderReport` siempre emite su h1), pero la rama existe porque la
    // alternativa es una hoja en blanco CON el botón de imprimir: alguien mandaría un PDF vacío sin
    // enterarse. Las dos mitades: se dice qué pasó, y no se ofrece imprimir nada.
    const { el } = await render('');
    expect(el.textContent).toContain('documento vacío');
    expect(el.querySelector('button')).toBeNull();
    expect(el.textContent).not.toContain('Cargando…');
  });

  it('el botón de imprimir llama al servicio de impresión, una vez', async () => {
    let veces = 0;
    const { fixture, el } = await render(REAL, { imprimir: () => void veces++ });
    el.querySelector('button')!.click();
    await fixture.whenStable();
    expect(veces).toBe(1);
  });

  it('🔴 la tabla scrollea en pantalla pero NO recorta en papel', async () => {
    /*
     * Las dos mitades son un par, y ninguna sirve sola.
     *
     * En pantalla la tabla del research (8 columnas) mide el triple del ancho visible en un móvil: sin
     * `overflow-x-auto` lo que scrollea es la página. En PAPEL ese mismo overflow no puede scrollear:
     * recorta, y las columnas de la derecha desaparecen del PDF sin ningún aviso. `print:overflow-x-visible`
     * es lo que apaga el recorte justo donde el scroll deja de existir.
     */
    const { el } = await render(REAL);
    const contenedor = el.querySelector('table')!.parentElement!;
    expect(contenedor.className).toContain('overflow-x-auto');
    expect(contenedor.className)
      .withContext('sin esto el PDF sale con las columnas de la derecha cortadas')
      .toContain('print:overflow-x-visible');
  });

  it('🔴 la barra de acciones no viaja a la hoja impresa', async () => {
    // «Sin barra de navegación, sin botones»: el link de volver y el botón de imprimir son la única
    // parte de esta pantalla que no es el documento, y en el PDF serían ruido con aspecto de contenido.
    const { el } = await render(REAL);
    const volver = el.querySelector('a')!;
    expect(volver.closest('.print\\:hidden'))
      .withContext('el link de volver se imprimiría')
      .not.toBeNull();
    expect(el.querySelector('button')!.closest('.print\\:hidden'))
      .withContext('el botón de imprimir se imprimiría a sí mismo')
      .not.toBeNull();
  });
});

import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { InformePage } from './informe';
import { ApiService } from '../../services/api';
import { DescargasService } from '../../shared/services/descargas';
import type { ApiError, ArchivoDescargado } from '../../core/api-core';
import type { Informe } from '../../core/models';

/**
 * Lo que este spec defiende es la propiedad central de la pieza: **el informe se pinta como TEXTO**.
 *
 * El contenido lo escribe un LLM sobre datos que vienen de un proveedor externo, así que la pregunta no es
 * si algún día va a llegar una etiqueta ahí dentro, sino qué pasa cuando llegue. `core/sin-html-crudo.test.ts`
 * prohíbe las herramientas para hacerlo mal; esto comprueba el resultado en un DOM de verdad, que es lo
 * único que demuestra que la cadena entera (parser → plantilla → Angular) escapa.
 *
 * Y el otro caso: `informe_md: null` NO es un error. La API responde 200 con null cuando el run existe y no
 * hay informe —o cuando quien pregunta no puede verlo—, y la pantalla lo tiene que decir con palabras.
 */

/** El ataque de manual, tal como llegaría dentro del Markdown del informe. */
const HOSTIL = [
  '# Informe de <script>alert("xss")</script>',
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

/**
 * El montaje, con el `verInforme` INYECTADO como función y no como valor.
 *
 * Que sea una función es lo que permite montar la pantalla con un `verInforme` que **rechaza**, que es el
 * caso del run inexistente (404). Con un valor no había forma de ejercer la rama de error, y esa rama es
 * justamente la que separa «no hay run» de «no hay informe».
 */
function montar(verInforme: () => Promise<Informe>, descargas?: Partial<DescargasService>) {
  TestBed.configureTestingModule({
    imports: [InformePage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'run-1' })) } },
      {
        provide: ApiService,
        useValue: {
          verInforme,
          descargarInformeMd: async (): Promise<ArchivoDescargado> => ({
            nombre: 'informe-run-1.md',
            blob: new Blob(['# Informe'], { type: 'text/markdown' }),
          }),
        },
      },
      // Un doble SIEMPRE, también cuando el test no mira la descarga: el real crea un <a> y lo clickea, y
      // eso le bajaría un archivo a quien corre la suite.
      { provide: DescargasService, useValue: descargas ?? { guardar: () => {} } },
    ],
  });
  const fixture = TestBed.createComponent(InformePage);
  fixture.detectChanges();
  return fixture;
}

async function estabilizar(fixture: ReturnType<typeof montar>) {
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

/** La API responde 200 con lo que se le pase. */
function renderEstable(informe: Informe, descargas?: Partial<DescargasService>) {
  return estabilizar(montar(async () => informe, descargas));
}

/** La API FALLA: `verInforme` rechaza con un `ApiError`, como con un run que no existe. */
function renderEstableConFallo(status: number, mensaje: string) {
  const err = new Error(mensaje) as ApiError;
  err.status = status;
  return estabilizar(
    montar(async () => {
      throw err;
    }),
  );
}

describe('InformePage — el informe se pinta como texto, nunca como HTML', () => {
  it('🔴 un informe con <script> NO mete un <script> en el DOM, y el texto sí se ve', async () => {
    const { el } = await renderEstable({
      informe_md: HOSTIL,
      generado_at: '2026-07-30T00:16:15.597Z',
    });

    for (const etiqueta of ['script', 'img', 'iframe', 'svg', 'b']) {
      expect(el.querySelector(etiqueta))
        .withContext(`apareció un <${etiqueta}> que venía en el Markdown`)
        .toBeNull();
    }

    // Y no se perdió por el camino: el dato se ve, literal. Un sanitizador que borrara la etiqueta
    // dejaría al revisor leyendo un informe con agujeros sin saberlo.
    expect(el.textContent).toContain('<script>alert("xss")</script>');
    expect(el.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(el.textContent).toContain('<iframe src="javascript:alert(1)"></iframe>');
    expect(el.textContent).toContain('<b>negrita falsa</b>');
    expect(el.textContent).toContain('<svg onload="alert(1)"></svg>');
  });

  it('las estructuras del Markdown sí se dibujan (encabezado, tabla, lista, cita)', async () => {
    // El contrapeso del test de arriba: si la pantalla pintara TODO como un párrafo plano, aquél pasaría
    // igual y no habría informe que leer.
    const { el } = await renderEstable({
      informe_md: HOSTIL,
      generado_at: '2026-07-30T00:16:15.597Z',
    });
    // `article h2` y no `h1`: el encabezado del informe baja un nivel porque el h1 de la pantalla es el
    // título de la pantalla (ver el comentario en la plantilla). Se afirma DENTRO del article, así que el
    // h1 de la cabecera no puede hacer pasar este test por accidente.
    expect(el.querySelector('article h2')).not.toBeNull();
    expect(el.querySelectorAll('article h1').length).toBe(0);
    expect(el.querySelectorAll('h1').length).toBe(1);
    expect(el.querySelector('table')).not.toBeNull();
    expect(el.querySelectorAll('table td').length).toBe(2);
    expect(el.querySelector('ul li')).not.toBeNull();
    expect(el.querySelector('blockquote')).not.toBeNull();
  });

  it('🔴 no se cuela un espacio de la plantilla entre una marca y la puntuación que la sigue', async () => {
    /*
     * Encontrado manejando la app, no leyendo el código (2026-08-06). Con el `{{ t.valor }}` suelto e
     * indentado, Angular deja un nodo de texto con la indentación de la plantilla y la colapsa a un
     * espacio PEGADO al dato: `**No es un 0**: es un dato` se veía `No es un 0 : es un dato`, y
     * `**…busque**, así que` se veía `…busque , así que`. Un espacio antes de la coma en el entregable que
     * el cliente lee. Lo arregla el `<ng-container>` de `informe-inline.ts`, y esto es lo que impide que
     * alguien lo "simplifique" de vuelta.
     */
    const { el } = await renderEstable({
      informe_md: '**No es un 0**: es un dato que no tenemos, y _por eso_, va con confianza baja.',
      generado_at: null,
    });
    const parrafo = el.querySelector('article p')!;
    expect(parrafo.textContent).toBe(
      'No es un 0: es un dato que no tenemos, y por eso, va con confianza baja.',
    );
  });

  it('🔴 la tabla vive en un contenedor que scrollea solo, no la página', async () => {
    // El informe real trae dos tablas de 8 columnas (`contrato/src/informe.ts:148`), que en 390 px miden
    // 761 px contra 276 visibles — medido en Chrome. Si ese scroll horizontal fuera de la página, la
    // navegación del portal se rompería en móvil — y eso no lo ve ningún test que no mire el DOM.
    const { el } = await renderEstable({ informe_md: HOSTIL, generado_at: null });
    const tabla = el.querySelector('table');
    const contenedor = tabla?.parentElement;
    expect(contenedor?.className).toContain('overflow-x-auto');
  });

  it('muestra el aviso de que el informe está congelado, con la frase que la spec pide', async () => {
    const { el } = await renderEstable({
      informe_md: '# Informe',
      generado_at: '2026-08-06T17:42:00.000Z',
    });
    expect(el.textContent).toContain('Este render del informe se guardó el 06/08/2026, 17:42 UTC');
    expect(el.textContent).toContain('las ediciones posteriores del revisor no están incluidas');
  });

  it('🔴 las DOS fechas se ven, cada una con su etiqueta, y no se confunden entre sí', async () => {
    /*
     * El caso más confuso posible, y es el de la demo: entre las dos fechas hay DÍAS.
     *
     *  · la del research (cuándo se hizo) sale del encabezado del propio documento;
     *  · la de guardado de este render es `generado_at`, que en la demo es cuándo corrió el seed y en
     *    producción cuándo terminó el step —y un reintento la mueve, por el test de T2—.
     *
     * Sin este test, intercambiar los dos argumentos de `avisoCongelado` en el componente compila (los dos
     * son `string | null`) y deja un aviso con las dos fechas CORRECTAS y las etiquetas cruzadas: el fallo
     * que no parece un fallo. Cada assert ata una fecha a su etiqueta, no solo comprueba que hay dos.
     */
    const { el } = await renderEstable({
      informe_md: '# Keyword Research — La Birra Bar\n\n_ES · es · 2026-07-30T00:16:15.000Z_\n',
      generado_at: '2026-08-06T17:42:00.000Z',
    });
    const aviso = el.querySelector('header p')!.textContent!;

    expect(aviso).toContain('Research hecho el 30/07/2026, 00:16 UTC');
    expect(aviso).toContain('Este render del informe se guardó el 06/08/2026, 17:42 UTC');
    // La mitad que caza el intercambio: cada fecha con la etiqueta de la otra sería esto.
    expect(aviso)
      .withContext('las etiquetas quedaron cruzadas: la fecha de guardado se está contando como research')
      .not.toContain('Research hecho el 06/08/2026');
    expect(aviso)
      .withContext('las etiquetas quedaron cruzadas: la fecha del research se está contando como guardado')
      .not.toContain('se guardó el 30/07/2026');
    // Y se dice que son dos hechos distintos, que es el punto de todo esto.
    expect(aviso).toContain('son dos fechas distintas, no una que cambió');
  });

  it('🔴 si el documento no ofrece la fecha del research sin ambigüedad, el aviso NO la inventa', async () => {
    // Dos candidatas en la cabecera ⇒ `fechaDelResearch` devuelve null. El aviso cambia de REDACCIÓN, no de
    // fecha: sigue diciendo de qué es la que muestra y remite a la del encabezado. Lo que no puede pasar es
    // que elija una de las dos y la presente como la del research.
    const { el } = await renderEstable({
      informe_md:
        '# Keyword Research — Bar X\n\n_ES · es · 2026-07-30T00:16:15.000Z_\n\n- Actualizado: 2026-09-01T00:00:00Z\n',
      generado_at: '2026-08-06T17:42:00.000Z',
    });
    const aviso = el.querySelector('header p')!.textContent!;

    expect(aviso).toContain('la fecha del research —cuándo se hizo— es la que el informe muestra');
    expect(aviso).not.toContain('Research hecho el');
    expect(aviso).toContain('las ediciones posteriores del revisor no están incluidas');
  });

  /*
   * Los dos tests que siguen son UN PAR, y ninguno de los dos sirve solo.
   *
   * El endpoint devuelve TRES cosas y no dos: 404 si el run no existe o no es visible; 200 con
   * `informe_md: null` si el run existe y no hay informe (o el rol no lo ve); y 200 con el informe. Los
   * casos 1 y 2 significan cosas distintas para el revisor —«esta URL no apunta a nada» contra «este run
   * todavía no tiene informe»—, y **la pantalla es lo único que decide cuál de los dos cuenta**: la API
   * los distingue por status y el cliente HTTP los distingue por si lanza, pero entre esas dos capas y el
   * usuario no hay nadie más.
   *
   * Sin el test del 404, borrar la rama `@else if (error())` de la plantilla deja la suite ENTERA en
   * verde (medido: 75 SUCCESS) y hace que un run inexistente afirme «Todavía no hay informe de este
   * research» — la pantalla jurando que el run existe. Por eso cada uno afirma las DOS mitades: el
   * mensaje que corresponde, y la ausencia del otro.
   */
  it('🔴 un run que NO existe (404) muestra el error, y NO dice «todavía no hay informe»', async () => {
    const { el } = await renderEstableConFallo(404, 'Run no encontrado.');

    // Mitad 1: se ve el error de la API, con su mensaje y no uno inventado.
    expect(el.textContent).toContain('Run no encontrado.');
    // Mitad 2: y NO se cuenta el otro caso. Ésta es la que cae si alguien borra la rama de error.
    expect(el.textContent)
      .withContext('un run inexistente NO puede afirmar que el run existe y solo le falta el informe')
      .not.toContain('Todavía no hay informe');
    // El error termina la carga (si no, el mensaje quedaría debajo de un «Cargando…» eterno).
    expect(el.textContent).not.toContain('Cargando…');
    // Y no hay nada que bajar de un run que no existe.
    expect(el.querySelector('button')).toBeNull();
  });

  it('🔴 con informe_md null muestra el mensaje: ni spinner infinito ni error', async () => {
    const { el } = await renderEstable({ informe_md: null, generado_at: null });

    expect(el.textContent).toContain('Todavía no hay informe de este research.');
    expect(el.textContent).not.toContain('Cargando…');
    // El texto del estado de error del componente. Un 200 con null NO es un fallo de nadie.
    expect(el.querySelector('.text-error')).toBeNull();
    // Y sin informe no hay nada que bajar: el botón no puede estar ahí prometiendo un archivo.
    expect(el.querySelector('button')).toBeNull();
  });

  it('el botón de descarga pide el .md y lo manda a guardar con su nombre', async () => {
    const guardados: ArchivoDescargado[] = [];
    const { fixture, el } = await renderEstable(
      { informe_md: '# Informe', generado_at: '2026-07-30T00:16:15.597Z' },
      { guardar: (a: ArchivoDescargado) => void guardados.push(a) },
    );

    el.querySelector('button')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(guardados.length).toBe(1);
    expect(guardados[0]!.nombre).toBe('informe-run-1.md');
  });
});

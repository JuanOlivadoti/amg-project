import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { InformePage } from './informe';
import { ApiService } from '../../services/api';
import { DescargasService } from '../../shared/services/descargas';
import type { ArchivoDescargado } from '../../core/api-core';
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

function render(informe: Informe, descargas?: Partial<DescargasService>) {
  TestBed.configureTestingModule({
    imports: [InformePage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'run-1' })) } },
      {
        provide: ApiService,
        useValue: {
          verInforme: async () => informe,
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

async function renderEstable(informe: Informe, descargas?: Partial<DescargasService>) {
  const fixture = render(informe, descargas);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
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
    // En 390 px el informe real tiene tablas de 6 columnas. Si el scroll horizontal fuera de la página, la
    // navegación del portal se rompería en móvil — y eso no lo ve ningún test que no mire el DOM.
    const { el } = await renderEstable({ informe_md: HOSTIL, generado_at: null });
    const tabla = el.querySelector('table');
    const contenedor = tabla?.parentElement;
    expect(contenedor?.className).toContain('overflow-x-auto');
  });

  it('muestra el aviso de que el informe está congelado, con su fecha', async () => {
    const { el } = await renderEstable({
      informe_md: '# Informe',
      generado_at: '2026-07-30T00:16:15.597Z',
    });
    expect(el.textContent).toContain('Informe generado el 30/07/2026, 00:16 UTC.');
    expect(el.textContent).toContain('las ediciones posteriores del revisor no están incluidas');
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

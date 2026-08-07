import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
import { ImpresionService } from '../../shared/services/impresion';
import { type Bloque, parsearMarkdown } from '../../core/markdown';
import { partirEncabezado } from '../../core/entregable-vista';
import { fechaDelResearch, fechaLegible } from '../../core/informe-vista';
import { Vigencia } from '../../core/vigencia';
import { InformeInlineComponent } from '../../shared/components/informe-inline';

/**
 * El **entregable del restaurante**: el research que la agencia le manda al cliente, listo para
 * imprimir o guardar como PDF desde el navegador.
 *
 * ── LO QUE ESTA PANTALLA NO HACE, Y ES EL PUNTO DE LA PIEZA ENTERA ────────────────────────────────
 *
 * **No oculta el coste. El servidor no lo manda.** `GET /runs/:id/entregable.md` llama a
 * `renderReport(brief, { audiencia: "restaurante" })` y el bloque **no se genera** (`contrato/src/informe.ts`).
 * Si esta pantalla lo tapara con CSS o con un `@if`, el margen de la agencia ya habría viajado al
 * navegador y estaría en el DOM, en la caché y en el «ver código fuente». La diferencia entre ocultar
 * y no enviar es la pieza entera. **Si alguien se encuentra escribiendo un filtro de coste acá, algo
 * se rompió aguas arriba.**
 *
 * Y tampoco decide quién lo ve: el endpoint responde 404 —el mismo 404 que un run inexistente— para
 * quien no es staff, porque `app.es_staff()` va en el predicado de la consulta (ADR-15). El link que
 * lleva acá se muestra solo al equipo, y eso es UX: la autorización ya pasó en Postgres.
 *
 * ── POR QUÉ ESTÁ FUERA DEL SHELL ──────────────────────────────────────────────────────────────────
 *
 * La ruta cuelga de la raíz con `authGuard`, **no** de `AppShellComponent`, y es una desviación
 * consciente del resto del portal. La spec pide una hoja «sin la barra de navegación, sin botones,
 * sin el shell» y lo pone bajo `@media print`; sacar la ruta del shell lo hace verdad de estructura
 * en vez de verdad de CSS, y de paso borra toda una clase de bugs de impresión (un sidebar `fixed`
 * que reaparece en la hoja 2, un `lg:pl-64` que deja margen fantasma). El precio: acá no corre el
 * `effect` del shell que resuelve `MembresiaService`. No hace falta — esta pantalla no consulta el
 * rol para nada, porque quien decide es el 404.
 *
 * ── EL DOCUMENTO ──────────────────────────────────────────────────────────────────────────────────
 *
 * Se pinta como TEXTO, nunca como HTML: el Markdown pasa por `parsearMarkdown` y se dibuja con
 * `@if`/`@for`. El contenido lo escribió un LLM, así que la inyección se hace imposible por
 * construcción y no evitada por configuración. Lo vigila `core/sin-html-crudo.test.ts`.
 *
 * El h1 del propio documento pasa a ser el encabezado de la hoja (`partirEncabezado`) y por eso los
 * encabezados **no bajan de nivel** como en la pantalla del informe: allá el informe está ANIDADO en
 * una pantalla que ya tiene su h1; acá el documento **es** la página.
 */
@Component({
  selector: 'app-entregable',
  imports: [RouterLink, InformeInlineComponent],
  template: `
    <!--
      print:bg-transparent: en pantalla la hoja va sobre el fondo de la app; en papel el fondo de
      página no se imprime igual, y pedirlo evita que un motor que SÍ imprime fondos gaste tinta en
      un rectángulo gris de A4 entero.
    -->
    <div class="min-h-screen bg-fondo text-texto print:min-h-0 print:bg-transparent">
      <!--
        La barra de acciones NO va a la hoja: es la única parte de esta pantalla que no es el
        documento. print:hidden y no una clase propia, para que sea evidente al leer el template.
      -->
      <div
        class="print:hidden max-w-4xl mx-auto px-4 pt-6 flex flex-wrap items-center justify-between gap-3"
      >
        <a [routerLink]="['/runs', runId()]" class="text-sm text-texto-tenue hover:text-texto">
          ← Volver al brief
        </a>
        @if (hayDocumento()) {
          <button
            (click)="imprimir()"
            class="rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            Imprimir o guardar como PDF
          </button>
        }
      </div>

      @if (hayDocumento()) {
        <!--
          El aviso es para la agencia, no para el restaurante: por eso también es print:hidden.
          Explica qué es esta hoja ANTES de que alguien la mande, que es cuando importa.
        -->
        <p class="print:hidden max-w-4xl mx-auto px-4 pt-3 text-xs text-alerta">
          Esta es la versión que se le manda al restaurante: no lleva el coste del research. Se genera
          al vuelo con las páginas aprobadas, así que refleja lo que hay ahora y no el brief original.
        </p>
      }

      <div class="max-w-4xl mx-auto px-4 py-6 print:max-w-none print:px-0 print:py-0">
        @if (cargando()) {
          <p class="text-sm text-texto-tenue">Cargando…</p>
        } @else if (error()) {
          <p class="text-sm text-error">{{ error() }}</p>
        } @else if (!hayDocumento()) {
          <!--
            Un 200 con el cuerpo vacío. Hoy no puede pasar —renderReport SIEMPRE emite al menos su
            h1— pero si pasara, la alternativa a este cartel es una hoja en blanco con el botón de
            imprimir puesto: alguien mandaría un PDF vacío sin enterarse. Se dice con palabras, igual
            que la pantalla del informe con su «todavía no hay informe».
          -->
          <p class="text-sm text-texto-medio">
            La API devolvió un documento vacío. No hay nada que imprimir; si el research terminó,
            avisá — esto no debería pasar.
          </p>
        } @else {
          <!--
            print:border-0 print:p-0 print:rounded-none: en pantalla el documento es una tarjeta;
            en papel, una tarjeta con borde redondeado es un marco alrededor de la hoja.
          -->
          <div
            class="bg-superficie rounded-xl border border-borde p-6 sm:p-8 break-words print:rounded-none print:border-0 print:p-0"
          >
            @if (titulo(); as t) {
              <!--
                break-after-avoid: el encabezado no puede quedarse solo al pie de una página con su
                contenido en la siguiente. Es la mitad de "los saltos no separan un título de lo suyo".
              -->
              <header class="break-after-avoid mb-6 pb-4 border-b border-borde-fuerte">
                <h1 class="text-xl font-semibold text-texto">{{ t }}</h1>
                @if (fecha(); as f) {
                  <p class="mt-1 text-sm text-texto-tenue">Research realizado el {{ f }}</p>
                }
              </header>
            }

            <article class="space-y-4">
              @for (b of cuerpo(); track $index) {
                @if (b.tipo === 'encabezado') {
                  <!--
                    Los encabezados NO bajan de nivel (a diferencia de la pantalla del informe): acá el
                    documento ES la página, y su h1 ya se convirtió en el encabezado de arriba. Así el
                    árbol de accesibilidad —y el índice del PDF— tienen un solo h1 y la jerarquía real.
                    break-after-avoid en los tres: un título al pie de la hoja y su tabla en la
                    siguiente es exactamente lo que la spec pide evitar.
                  -->
                  @if (b.nivel === 1) {
                    <h1 class="break-after-avoid text-xl font-semibold text-texto pt-2">
                      <app-informe-inline [partes]="b.texto" />
                    </h1>
                  } @else if (b.nivel === 2) {
                    <h2
                      class="break-after-avoid text-lg font-semibold text-texto border-b border-borde pb-1 pt-4"
                    >
                      <app-informe-inline [partes]="b.texto" />
                    </h2>
                  } @else {
                    <h3 class="break-after-avoid text-base font-semibold text-texto pt-2">
                      <app-informe-inline [partes]="b.texto" />
                    </h3>
                  }
                } @else if (b.tipo === 'parrafo') {
                  <p class="text-sm text-texto-medio leading-relaxed">
                    <app-informe-inline [partes]="b.texto" />
                  </p>
                } @else if (b.tipo === 'lista') {
                  <ul class="list-disc pl-5 space-y-1 text-sm text-texto-medio">
                    @for (item of b.items; track $index) {
                      <li class="break-inside-avoid"><app-informe-inline [partes]="item" /></li>
                    }
                  </ul>
                } @else if (b.tipo === 'cita') {
                  <blockquote
                    class="break-inside-avoid border-l-4 border-borde-fuerte pl-3 py-1 text-sm text-texto-tenue italic"
                  >
                    <app-informe-inline [partes]="b.texto" />
                  </blockquote>
                } @else {
                  <!--
                    Dos cosas distintas conviven acá:

                    · EN PANTALLA la tabla scrollea sola (overflow-x-auto): las tablas del research
                      tienen 8 columnas y en un móvil miden el triple del ancho visible. Sin esto,
                      lo que scrollea es la página.
                    · EN PAPEL ese mismo overflow RECORTA: un contenedor con overflow auto no puede
                      "scrollear" en una hoja, así que las columnas de la derecha desaparecen sin más.
                      print:overflow-x-visible lo apaga, y print:whitespace-normal deja que las celdas
                      partan el texto para que la tabla entre en el ancho de la hoja.
                    break-inside-avoid mantiene la tabla entera en una página cuando cabe (si no cabe,
                    el navegador la parte igual: es lo que hace todo motor, no algo que podamos exigir)
                    y, fila por fila, impide que una fila quede cortada por la mitad.
                  -->
                  <div class="w-full overflow-x-auto break-inside-avoid print:overflow-x-visible">
                    <table class="min-w-full text-xs text-left">
                      <thead>
                        <tr class="border-b border-borde-fuerte">
                          @for (celda of b.cabecera; track $index) {
                            <th
                              class="px-2 py-1.5 font-semibold text-texto whitespace-nowrap print:whitespace-normal"
                            >
                              <app-informe-inline [partes]="celda" />
                            </th>
                          }
                        </tr>
                      </thead>
                      <tbody>
                        @for (fila of b.filas; track $index) {
                          <tr class="break-inside-avoid border-b border-borde">
                            @for (celda of fila; track $index) {
                              <td
                                class="px-2 py-1.5 text-texto-medio whitespace-nowrap print:whitespace-normal"
                              >
                                <app-informe-inline [partes]="celda" />
                              </td>
                            }
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              }
            </article>
          </div>
        }
      </div>
    </div>
  `,
})
export class EntregablePage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly impresion = inject(ImpresionService);
  private readonly route = inject(ActivatedRoute);

  /**
   * A qué run corresponde el trabajo en vuelo, y si el componente sigue vivo. Ver `core/vigencia.ts`.
   * Angular REUTILIZA la instancia al navegar de `/runs/A/entregable` a `/runs/B/entregable`: sin
   * esto, una respuesta lenta de A puede llegar cuando la URL ya dice B, y acá el daño es el peor de
   * los tres: una hoja con el nombre de un cliente y las páginas de otro, camino a un PDF.
   */
  private readonly vigencia = new Vigencia();
  private sub: Subscription | null = null;

  /** El id de la URL, para el link de volver. Se escribe junto con la vigencia, nunca por separado. */
  readonly runId = signal('');

  readonly md = signal<string | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');

  private readonly documento = computed(() => {
    const md = this.md();
    return partirEncabezado(md === null ? [] : parsearMarkdown(md));
  });

  readonly titulo = computed(() => this.documento().titulo);
  readonly cuerpo = computed<readonly Bloque[]>(() => this.documento().cuerpo);
  /** Hay algo que imprimir: título, cuerpo, o los dos. Un `.md` vacío no ofrece el botón. */
  readonly hayDocumento = computed(
    () => !this.cargando() && !this.error() && (this.titulo() !== null || this.cuerpo().length > 0),
  );

  /**
   * La fecha del research, leída del encabezado del propio documento con la regla mezquina de
   * `core/informe-vista.ts`: cero o dos candidatas ⇒ `null`, y entonces **no se pinta una fecha
   * inventada**. Es la única copia que el portal tiene: el endpoint devuelve Markdown y nada más.
   */
  readonly fecha = computed(() => {
    const md = this.md();
    if (md === null) return null;
    const iso = fechaDelResearch(md);
    return iso === null ? null : fechaLegible(iso);
  });

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      const id = params.get('id') ?? '';
      if (id === this.vigencia.actual) return;
      // La vigencia cambia ANTES de pedir nada: lo que venga del run anterior queda obsoleto solo.
      this.vigencia.cambiarA(id);
      this.runId.set(id);
      // El documento anterior se limpia acá y no al volver: si el run nuevo falla con 404, lo que no
      // puede pasar es que la hoja siga mostrando el entregable del cliente anterior bajo otra URL.
      this.md.set(null);
      this.error.set('');
      void this.cargar(id);
    });
  }

  ngOnDestroy(): void {
    this.vigencia.destruir();
    this.sub?.unsubscribe();
  }

  private async cargar(pedido: string): Promise<void> {
    this.cargando.set(true);
    try {
      const md = await this.api.verEntregableMd(pedido);
      if (this.vigencia.obsoleta(pedido)) return; // llegó tarde: ya es otro run, o nos fuimos
      this.md.set(md);
    } catch (e) {
      if (this.vigencia.obsoleta(pedido)) return;
      this.error.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(pedido)) this.cargando.set(false);
    }
  }

  imprimir(): void {
    this.impresion.imprimir();
  }
}

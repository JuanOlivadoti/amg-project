import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
import { DescargasService } from '../../shared/services/descargas';
import type { Informe } from '../../core/models';
import { type Bloque, parsearMarkdown } from '../../core/markdown';
import { avisoCongelado, fechaDelResearch } from '../../core/informe-vista';
import { Vigencia } from '../../core/vigencia';
import { InformeInlineComponent } from '../../shared/components/informe-inline';

/**
 * El informe de keyword research, en pantalla.
 *
 * Tres cosas que esta pantalla hace y que no son detalles de implementación:
 *
 * 1. **No pinta HTML.** El Markdown pasa por `parsearMarkdown` y se dibuja recorriendo bloques con
 *    `@if`/`@for`. El texto del informe lo escribió un LLM, así que la inyección se hace IMPOSIBLE por
 *    construcción —Angular escapa toda interpolación— en vez de evitada por configuración, que es lo que
 *    sería un sanitizador. Lo vigila `core/sin-html-crudo.test.ts` en todo el árbol.
 * 2. **«No hay informe» es un ESTADO, no un error.** `GET /runs/:id/informe` responde 200 con
 *    `informe_md: null` cuando el run existe y no hay informe —y también cuando quien pregunta es un rol
 *    `cliente`, indistinguible a propósito—. Un spinner infinito ahí sería una mentira que además no
 *    termina, y un cartel rojo culparía al usuario de algo que no pasó. Se dice con palabras.
 * 3. **Dice que está congelado, y distingue sus DOS fechas.** La del research (cuándo se hizo, en el
 *    encabezado del documento) y la de guardado de este render (`generado_at`) son dos hechos distintos, y
 *    entre ellas hay la duración del research —16 min 15 s en la corrida real, días en la demo—. El aviso
 *    lo dice con palabras: un revisor que las ve juntas sin explicación concluye que el sistema se
 *    contradice. Ver `core/informe-vista.ts`.
 *
 * No hace polling, a diferencia del brief: un informe no cambia. El que no existe se genera cuando el
 * research termina, y para eso el revisor ya tiene la pantalla del brief actualizándose sola.
 */
@Component({
  selector: 'app-informe',
  imports: [RouterLink, InformeInlineComponent],
  template: `
    <div class="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <a [routerLink]="['/runs', runId()]" class="text-sm text-texto-tenue hover:text-texto">
        ← Volver al brief
      </a>

      @if (cargando()) {
        <p class="text-sm text-texto-tenue">Cargando…</p>
      } @else if (error()) {
        <p class="text-sm text-error">{{ error() }}</p>
      } @else if (hayInforme()) {
        <header class="bg-superficie rounded-xl border border-borde p-6">
          <h1 class="text-lg font-semibold text-texto">Informe de keyword research</h1>
          <p class="mt-1 text-xs text-alerta">{{ aviso() }}</p>
          <button
            (click)="descargar()"
            [disabled]="bajando()"
            class="mt-4 rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
          >
            {{ bajando() ? 'Preparando…' : 'Descargar (.md)' }}
          </button>
          @if (errorDescarga()) {
            <p class="mt-2 text-xs text-error">{{ errorDescarga() }}</p>
          }
        </header>

        <!--
          break-words no es cosmético: el informe trae slugs y URLs largas sin espacios, y sin esto
          ensanchan la PÁGINA en un móvil. Las tablas resuelven lo suyo aparte, más abajo.
        -->
        <article class="bg-superficie rounded-xl border border-borde p-6 space-y-4 break-words">
          @for (b of bloques(); track $index) {
            <!--
              Los encabezados del informe BAJAN un nivel: su # es h2, su ## es h3 y su ### es h4. El
              informe es un documento ANIDADO en esta pantalla, y el h1 de la pantalla es el de arriba
              («Informe de keyword research»). Sin el desplazamiento había dos h1 en el documento y un
              lector de pantalla veía dos títulos de página. Visto en el árbol de accesibilidad, no en el
              render. El estilo no cambia: la clase manda el tamaño, la etiqueta manda la estructura.
            -->
            @if (b.tipo === 'encabezado') {
              @if (b.nivel === 1) {
                <h2 class="text-lg font-semibold text-texto pt-2">
                  <app-informe-inline [partes]="b.texto" />
                </h2>
              } @else if (b.nivel === 2) {
                <h3 class="text-base font-semibold text-texto border-b border-borde pb-1 pt-4">
                  <app-informe-inline [partes]="b.texto" />
                </h3>
              } @else {
                <h4 class="text-sm font-semibold text-texto pt-2">
                  <app-informe-inline [partes]="b.texto" />
                </h4>
              }
            } @else if (b.tipo === 'parrafo') {
              <p class="text-sm text-texto-medio leading-relaxed">
                <app-informe-inline [partes]="b.texto" />
              </p>
            } @else if (b.tipo === 'lista') {
              <ul class="list-disc pl-5 space-y-1 text-sm text-texto-medio">
                @for (item of b.items; track $index) {
                  <li><app-informe-inline [partes]="item" /></li>
                }
              </ul>
            } @else if (b.tipo === 'cita') {
              <blockquote
                class="border-l-4 border-borde-fuerte pl-3 py-1 text-sm text-texto-tenue italic"
              >
                <app-informe-inline [partes]="b.texto" />
              </blockquote>
            } @else {
              <!--
                La TABLA scrollea sola. Las dos tablas grandes del informe tienen 8 columnas
                (# / Tipo / Keyword principal / Vol. / KD / Score / Conf. / Intención, contadas sobre lo
                que emite contrato/src/informe.ts:148). Medido en Chrome a 390 px: 761 px de contenido
                contra 276 px visibles. Sin este contenedor, lo que scrollea es la página entera y la
                navegación del portal se rompe en móvil.
                w-full en el contenedor + min-w-full en la tabla es lo que hace que el ancho de
                referencia sea el del contenedor y no el del contenido.
              -->
              <div class="w-full overflow-x-auto">
                <table class="min-w-full text-xs text-left">
                  <thead>
                    <tr class="border-b border-borde-fuerte">
                      @for (celda of b.cabecera; track $index) {
                        <th class="px-2 py-1.5 font-semibold text-texto whitespace-nowrap">
                          <app-informe-inline [partes]="celda" />
                        </th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (fila of b.filas; track $index) {
                      <tr class="border-b border-borde">
                        @for (celda of fila; track $index) {
                          <td class="px-2 py-1.5 text-texto-medio whitespace-nowrap">
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
      } @else {
        <div class="bg-superficie rounded-xl border border-borde p-6 space-y-2">
          <h1 class="text-base font-semibold text-texto">Todavía no hay informe de este research.</h1>
          <!--
            Las DOS causas se cuentan juntas porque son indistinguibles desde acá, y eso es una decisión
            de la API, no una limitación del portal: la política informe_staff (0016) no le devuelve la
            fila a un rol cliente, y el endpoint responde lo mismo que si no existiera. Inventar un «no
            tenés permiso» sería adivinar; callarse la segunda causa dejaría a un dueño de negocio
            esperando un informe que no le va a aparecer nunca.
          -->
          <!--
            Desde el 2026-08-07 el rol cliente no ve NINGUNA de las dos mitades del coste, así que la
            razón que da este texto es la entera y no una parte:
              · el TOTAL lo recorta Postgres — RUN_SUMMARY_COLS trae un
                "case when app.es_staff() then coste_micros_usd::int end" (db/src/store.ts), SIN else, así
                que llega null por getRun, listRuns y listAllRuns, y brief.ts ya no pinta la línea;
              · el DESGLOSE nunca viajó: coste_breakdown no está en RUN_SUMMARY_COLS.

            La versión anterior de este comentario decía lo contrario —«la pantalla del brief le muestra
            el coste TOTAL a cualquier rol que vea el run (…) si el total debería o no ser visible es otra
            pieza, y no ésta»—. Era cierto cuando se escribió; esa «otra pieza» se hizo y lo dejó falso.
            Se deja anotado porque el modo de fallo importa más que la corrección: un comentario que
            razona sobre una frontera de seguridad envejece en silencio, y el que lo lea después va a
            confiar en él.
          -->
          <p class="text-sm text-texto-medio">
            El informe se genera solo, cuando el research termina y queda esperando aprobación. Si este
            research ya terminó, entonces el informe no está disponible para tu rol: lleva lo que la
            agencia paga por los datos —el total y el desglose por proveedor—, y eso lo ve el equipo.
          </p>
          <p class="text-sm text-texto-tenue">
            El brief —las páginas propuestas, con su evidencia— sí está disponible en la pantalla
            anterior.
          </p>
        </div>
      }
    </div>
  `,
})
export class InformePage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly descargas = inject(DescargasService);
  private readonly route = inject(ActivatedRoute);

  /**
   * A qué run corresponde el trabajo en vuelo, y si el componente sigue vivo. Ver `core/vigencia.ts`.
   * Mismo motivo que en el brief: Angular REUTILIZA la instancia al navegar de `/runs/A/informe` a
   * `/runs/B/informe`, así que una respuesta lenta de A puede llegar cuando la URL ya dice B. Acá el daño
   * sería pintar el informe de otro run —con su coste— bajo el título del que se está mirando.
   */
  private readonly vigencia = new Vigencia();
  private sub: Subscription | null = null;

  /** El id de la URL, para el link de volver. Se escribe junto con la vigencia, nunca por separado. */
  readonly runId = signal('');

  readonly informe = signal<Informe | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly bajando = signal(false);
  readonly errorDescarga = signal('');

  readonly hayInforme = computed(() => this.informe()?.informe_md != null);
  readonly bloques = computed<Bloque[]>(() => {
    const md = this.informe()?.informe_md;
    return md == null ? [] : parsearMarkdown(md);
  });

  /**
   * La fecha del research, leída del encabezado del propio documento — **no** derivada de `generado_at`,
   * que es la otra cosa (cuándo se guardó este render). Devuelve `null` si el documento no la ofrece sin
   * ambigüedad, y entonces el aviso cambia de redacción en vez de inventarla. Ver `core/informe-vista.ts`.
   */
  readonly fechaResearch = computed(() => {
    const md = this.informe()?.informe_md;
    return md == null ? null : fechaDelResearch(md);
  });

  /**
   * El orden de los argumentos es load-bearing: primero **cuándo se guardó el render**, después **cuándo
   * se hizo el research**. Intercambiarlos compila (los dos son `string | null`) y produce un aviso que
   * miente con las dos fechas correctas — lo tumba el spec de esta pantalla.
   */
  readonly aviso = computed(() =>
    avisoCongelado(this.informe()?.generado_at ?? null, this.fechaResearch()),
  );

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      const id = params.get('id') ?? '';
      if (id === this.vigencia.actual) return;
      // La vigencia cambia ANTES de pedir nada: lo que venga del run anterior queda obsoleto solo.
      this.vigencia.cambiarA(id);
      this.runId.set(id);
      // El informe anterior se limpia acá y no al volver: si el nuevo run falla con 404, lo que NO puede
      // pasar es que la pantalla siga mostrando el informe del run anterior bajo la URL nueva.
      this.informe.set(null);
      this.error.set('');
      this.errorDescarga.set('');
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
      const informe = await this.api.verInforme(pedido);
      if (this.vigencia.obsoleta(pedido)) return; // llegó tarde: ya es otro run, o nos fuimos
      this.informe.set(informe);
    } catch (e) {
      if (this.vigencia.obsoleta(pedido)) return;
      this.error.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(pedido)) this.cargando.set(false);
    }
  }

  /**
   * Pide el `.md` con el token en el header y lo guarda como archivo.
   *
   * El `finally` NO consulta la vigencia (a diferencia de `cargar`): la descarga la pidió el usuario con
   * un click y su resultado no depende de qué run se esté mirando después. Lo único que se evita es dejar
   * el botón en «Preparando…» para siempre.
   */
  async descargar(): Promise<void> {
    this.bajando.set(true);
    this.errorDescarga.set('');
    try {
      this.descargas.guardar(await this.api.descargarInformeMd(this.runId()));
    } catch (e) {
      this.errorDescarga.set(`No se pudo bajar el informe: ${(e as Error).message}`);
    } finally {
      this.bajando.set(false);
    }
  }
}

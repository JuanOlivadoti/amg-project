import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
import { MembresiaService } from '../../services/membresia';
import { ImpresionService } from '../../shared/services/impresion';
import { nombreDe } from '../../core/miembros';
import type { ComparativaSeguros } from '../../core/models';
import { type Bloque, parsearMarkdown } from '../../core/markdown';
import { bloquesAHtml, bloquesATexto, escapar } from '../../core/markdown-render';
import { partirEncabezado } from '../../core/entregable-vista';
import { fechaLegible } from '../../core/informe-vista';
import { Vigencia } from '../../core/vigencia';
import { InformeInlineComponent } from '../../shared/components/informe-inline';

/**
 * El resultado imprimible de una comparativa de seguros (`/clientes/:id/comparativas/:cid`), la
 * última pieza del módulo (Task 9). Molde de ruta y de servicio: `pages/entregable/entregable.ts` +
 * `shared/services/impresion.ts` — fuera del shell, sin sidebar ni `lg:pl-64`, por el mismo motivo:
 * la calidad de la hoja impresa ES el entregable, y un sidebar `fixed` reapareciendo en la hoja 2 no
 * se arregla con `@media print` si la estructura ya lo incluye.
 *
 * ── EL GATE, LA GARANTÍA CENTRAL DEL MÓDULO ───────────────────────────────────────────────────────
 *
 * `revisadoEn`/`revisadoPor` son HECHOS DEL SERVIDOR, nunca un estado de pantalla. Sin revisar,
 * "Imprimir" y "Copiar mail" quedan deshabilitados con el aviso "pendiente de revisión humana"; al
 * marcar como revisado se llama a `POST …/revisar` y —como ESE endpoint responde `{ok:true}` y no la
 * fila actualizada (ver el handler real en `api/src/app.ts`)— se vuelve a pedir la comparativa con
 * `obtenerComparativa()` y se pinta ESO. Un `signal` puesto en `true` al clickear y nunca releído
 * mentiría tras un F5: la comparativa volvería a parecer pendiente aunque el servidor ya la tenga
 * marcada, o al revés, si el signal quedara mal inicializado se podría imprimir algo sin revisar.
 *
 * ── EL DOCUMENTO ──────────────────────────────────────────────────────────────────────────────────
 *
 * `informeMd` se pinta con `parsearMarkdown` + `@if`/`@for`, nunca `[innerHTML]`: mismo criterio que
 * `entregable.ts`, y lo vigila `core/sin-html-crudo.test.ts`. Las celdas ya llegan formateadas por el
 * servidor (Task 7): esta pantalla las pinta tal cual, no reformatea fechas ni números.
 *
 * "Copiar mail" copia `mailAsunto` + el Markdown de `mailCuerpoMd` parseado, en dos formatos a la vez
 * (`text/html` + `text/plain`) vía `ClipboardItem` — molde exacto de `pages/posts/posts.ts`, con el
 * mismo `catch` silencioso si el navegador niega el permiso. La conversión Markdown → HTML/texto vive
 * en `core/markdown-render.ts`, pura: acá el origen es Markdown (no HTML ya sanitizado como en
 * posts.ts), así que hay que parsear antes de poder copiar el enriquecido.
 */
@Component({
  selector: 'app-comparativa-resultado',
  imports: [RouterLink, InformeInlineComponent],
  template: `
    <div class="min-h-screen bg-fondo text-texto print:min-h-0 print:bg-transparent">
      <div
        class="print:hidden max-w-4xl mx-auto px-4 pt-6 flex flex-wrap items-center justify-between gap-3"
      >
        <a
          [routerLink]="['/clientes', clienteId(), 'comparativas']"
          class="text-sm text-texto-tenue hover:text-texto"
        >
          ← Volver al historial
        </a>
        @if (comparativa()) {
          <div class="flex flex-wrap items-center gap-2">
            @if (!revisado()) {
              <button
                type="button"
                (click)="marcarRevisada()"
                [disabled]="guardando()"
                class="rounded-md border border-borde px-4 py-2 text-sm font-medium text-texto hover:bg-superficie-2 disabled:opacity-50"
              >
                {{ guardando() ? 'Guardando…' : 'Marcar como revisado' }}
              </button>
            }
            <button
              type="button"
              (click)="copiarMail()"
              [disabled]="!revisado()"
              class="rounded-md border border-borde px-4 py-2 text-sm font-medium text-texto hover:bg-superficie-2 disabled:opacity-40"
            >
              {{ copiado() ? 'Copiado ✓' : 'Copiar mail' }}
            </button>
            <button
              type="button"
              (click)="imprimir()"
              [disabled]="!revisado()"
              class="rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
            >
              Imprimir
            </button>
          </div>
        }
      </div>

      @if (comparativa(); as c) {
        <!--
          El aviso es la mitad del gate: dice qué significa el estado del botón de arriba, no solo
          que esté deshabilitado. print:hidden porque es para quien revisa, no para la hoja impresa.
        -->
        <div class="print:hidden max-w-4xl mx-auto px-4 pt-3">
          @if (revisado()) {
            <p class="text-xs text-texto-tenue">Revisado por {{ nombreRevisor() }} el {{ fechaRevisado() }}</p>
          } @else {
            <p class="text-xs text-alerta">
              Recomendación generada automáticamente — pendiente de revisión humana
            </p>
          }
        </div>
      }

      <div class="max-w-4xl mx-auto px-4 py-6 print:max-w-none print:px-0 print:py-0">
        @if (cargando()) {
          <p class="text-sm text-texto-tenue">Cargando…</p>
        } @else if (error()) {
          <p class="text-sm text-error">{{ error() }}</p>
        } @else if (comparativa(); as c) {
          <div
            class="bg-superficie rounded-xl border border-borde p-6 sm:p-8 break-words print:rounded-none print:border-0 print:p-0"
          >
            <header class="break-after-avoid mb-6 pb-4 border-b border-borde-fuerte">
              <h1 class="text-xl font-semibold text-texto">{{ titulo() ?? c.clienteFinalNombre }}</h1>
              <p class="mt-1 text-sm text-texto-tenue">Comparativa para {{ c.clienteFinalNombre }}</p>
            </header>

            <article class="space-y-4">
              @for (b of cuerpo(); track $index) {
                @if (b.tipo === 'encabezado') {
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
export class ComparativaResultadoPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly impresion = inject(ImpresionService);
  private readonly membresia = inject(MembresiaService);
  private readonly route = inject(ActivatedRoute);

  /** A qué comparativa corresponde el trabajo en vuelo, y si el componente sigue vivo. */
  private readonly vigencia = new Vigencia();
  private sub: Subscription | null = null;

  /** El cliente de la URL, solo para el link de volver. */
  readonly clienteId = signal('');
  readonly comparativaId = signal('');

  readonly comparativa = signal<ComparativaSeguros | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly guardando = signal(false);
  readonly copiado = signal(false);
  private timerCopiado: ReturnType<typeof setTimeout> | null = null;

  /**
   * El gate: SIEMPRE derivado de `comparativa()`, nunca de un flag propio. Ver el docblock de la
   * clase — es la garantía que este archivo existe para sostener.
   */
  readonly revisado = computed(() => this.comparativa()?.revisadoEn != null);

  readonly nombreRevisor = computed(() => {
    const revisadoPor = this.comparativa()?.revisadoPor;
    if (!revisadoPor) return '';
    const miembro = this.membresia.miembros().find((m) => m.user_id === revisadoPor);
    // Mismo criterio que `clientes-tabla.ts`: el uuid se muestra tal cual si no está entre los
    // miembros visibles. Nunca se inventa un nombre.
    return miembro ? nombreDe(miembro) : revisadoPor;
  });

  readonly fechaRevisado = computed(() => {
    const iso = this.comparativa()?.revisadoEn;
    return iso ? fechaLegible(iso) : '';
  });

  private readonly documento = computed(() => {
    const c = this.comparativa();
    return partirEncabezado(c ? parsearMarkdown(c.informeMd) : []);
  });
  readonly titulo = computed(() => this.documento().titulo);
  readonly cuerpo = computed<readonly Bloque[]>(() => this.documento().cuerpo);

  ngOnInit(): void {
    // Esta ruta vive FUERA del shell (mismo motivo que `entregable.ts`), así que no hereda el
    // `effect` de `app-shell.ts` que resuelve `MembresiaService` — sin este llamado, `nombreRevisor()`
    // caería SIEMPRE al uuid en una carga directa de esta URL (medido en el navegador: entrando desde
    // el historial de la propia sesión el nombre aparecía, porque el shell ya lo había resuelto antes;
    // recargando esta página sola, no). `resolver()` (`MembresiaService`) solo deduplica llamadas
    // concurrentes/solapadas — mientras hay una promesa en vuelo — no evita un segundo `GET` si el
    // shell ya terminó de resolver membresía en una navegación previa: entrar acá desde el historial
    // de la sesión (sin recargar) SÍ dispara un `GET /members` real de más. Sin efecto funcional, solo
    // red: se acepta a cambio de no complicar `MembresiaService` con un caché de "ya resuelto".
    void this.membresia.resolver();
    this.sub = this.route.paramMap.subscribe((params) => {
      this.clienteId.set(params.get('id') ?? '');
      const cid = params.get('cid') ?? '';
      if (cid === this.vigencia.actual) return;
      this.vigencia.cambiarA(cid);
      this.comparativaId.set(cid);
      this.comparativa.set(null);
      this.error.set('');
      void this.cargar(cid);
    });
  }

  ngOnDestroy(): void {
    this.vigencia.destruir();
    this.sub?.unsubscribe();
    if (this.timerCopiado) clearTimeout(this.timerCopiado);
  }

  private async cargar(pedido: string): Promise<void> {
    this.cargando.set(true);
    try {
      const comparativa = await this.api.obtenerComparativa(this.clienteId(), pedido);
      if (this.vigencia.obsoleta(pedido)) return; // llegó tarde: ya es otra comparativa, o nos fuimos
      if (!comparativa) {
        this.error.set('Comparativa no encontrada.');
        return;
      }
      this.comparativa.set(comparativa);
    } catch (e) {
      if (this.vigencia.obsoleta(pedido)) return;
      this.error.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(pedido)) this.cargando.set(false);
    }
  }

  /**
   * `revisar` no trae la fila actualizada (`{ok:true}`, ver el handler real): el gate se relee
   * pidiendo `obtenerComparativa` de nuevo, no se asume localmente. Ver el docblock de la clase.
   */
  async marcarRevisada(): Promise<void> {
    const cid = this.comparativaId();
    this.guardando.set(true);
    this.error.set('');
    try {
      await this.api.revisarComparativa(this.clienteId(), cid);
      const actualizada = await this.api.obtenerComparativa(this.clienteId(), cid);
      if (this.vigencia.obsoleta(cid)) return; // se navegó a otra comparativa mientras tanto
      if (actualizada) this.comparativa.set(actualizada);
    } catch (e) {
      if (!this.vigencia.obsoleta(cid)) this.error.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(cid)) this.guardando.set(false);
    }
  }

  /** El gate también se impone acá, no solo en el `[disabled]` del botón: un clic disparado por
   *  código (o un test) no puede saltarse la condición que el atributo ya expresa en pantalla. */
  imprimir(): void {
    if (!this.revisado()) return;
    this.impresion.imprimir();
  }

  async copiarMail(): Promise<void> {
    if (!this.revisado()) return;
    const c = this.comparativa();
    if (!c) return;
    const bloques = parsearMarkdown(c.mailCuerpoMd);
    const html = `<p><strong>${escapar(c.mailAsunto)}</strong></p>${bloquesAHtml(bloques)}`;
    const texto = [c.mailAsunto, bloquesATexto(bloques)].filter(Boolean).join('\n\n');
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([texto], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(texto);
      }
      this.mostrarCopiado();
    } catch {
      // El portapapeles puede estar bloqueado (permiso denegado, contexto no seguro): mismo catch
      // silencioso que `posts.ts` — sin la confirmación de abajo, quien clickeó ya ve que "Copiado ✓"
      // nunca aparece, y eso ya lo dice.
    }
  }

  private mostrarCopiado(): void {
    this.copiado.set(true);
    if (this.timerCopiado) clearTimeout(this.timerCopiado);
    this.timerCopiado = setTimeout(() => this.copiado.set(false), 2000);
  }
}


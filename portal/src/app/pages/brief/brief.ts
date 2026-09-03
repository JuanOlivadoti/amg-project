import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
import { MembresiaService } from '../../services/membresia';
import type { Brief, PaginaPropuesta } from '../../core/models';
import { separarPorEvidencia, puedeAprobarseRun } from '../../core/evidence';
import { motivoNoAprobable } from '../../core/aprobar-run';
import { esTransicionInvalida } from '../../core/api-core';
import { mostrarAprobarRun, mostrarDestinoPosts } from '../../core/features';
import { usdDeMicros } from '../../core/dinero';
import { environment } from '../../../environments/environment';
import { Vigencia } from '../../core/vigencia';
import { POLL_MS } from '../../core/brief-polling';

@Component({
  selector: 'app-brief',
  imports: [FormsModule, RouterLink, NgTemplateOutlet],
  template: `
    <!--
      Sin max-w, sin mx-auto y sin px/py: esta pantalla monta DENTRO de la ficha del cliente, que ya
      pone su "max-w-5xl mx-auto px-4 py-8". Cuando el brief vivía en /runs/:id era una pantalla
      suelta y los necesitaba; anidada, eran dos contenedores centrados uno dentro de otro — el
      contenido arrancaba más a la derecha que la barra de tabs y el py-8 se pagaba dos veces. Visto
      en el navegador. Mismo patrón que el tab research, que es su hermano: space-y a secas, y el
      ancho lo manda la ficha.
    -->
    <div class="space-y-6">
      <a
        [routerLink]="['/clientes', clienteId(), 'research']"
        class="text-sm text-texto-tenue hover:text-texto"
        >← Volver</a
      >

      @if (cargando()) {
        <p class="text-sm text-texto-tenue">Cargando…</p>
      } @else if (error()) {
        <p class="text-sm text-error">{{ error() }}</p>
      } @else if (brief(); as b) {
        <header class="bg-superficie rounded-xl border border-borde p-6">
          <h1 class="text-lg font-semibold text-texto">{{ b.run.prompt }}</h1>
          <!--
            El coste se pinta SOLO si llegó. coste_micros_usd es number | null, y el null lo decide
            app.es_staff() dentro de Postgres: quien no es staff no recibe el número, no es que lo
            tenga tapado. Pintar $0.00 ahí afirmaría que el research fue gratis.
            El "as" sobre usd(...) es seguro porque devuelve la cadena "0.00" —no vacía, y por lo
            tanto truthy— cuando el coste es cero de verdad: un @if sobre el NÚMERO sí escondería ese
            caso legítimo. Ver core/dinero.ts.
          -->
          <p class="mt-1 text-xs text-texto-tenue">
            Estado: {{ b.run.status }}
            @if (usd(b.run.coste_micros_usd); as coste) {
              · Coste: \${{ coste }}
            }
          </p>
          <!--
            El link al informe aparece SIEMPRE, incluso si este run no tiene informe. Esconderlo haría
            que nadie descubra que la función existe —y la pantalla del informe sabe explicar con
            palabras por qué no hay uno—, así que el que decide qué se cuenta es el destino, no el link.
            Lo fija un test: ver brief.spec.ts.
          -->
          <!--
            block w-fit y no inline-block: con inline-block el link se pegaba en la MISMA línea que el
            botón «Aprobar el run y publicar» y se leía como su etiqueta (visto en el navegador, no en
            los tests). w-fit mantiene el área clickeable del ancho del texto y no de la tarjeta.
          -->
          <a
            [routerLink]="['/clientes', clienteId(), 'research', b.run.id, 'informe']"
            class="mt-2 block w-fit text-sm text-texto hover:underline"
          >
            Ver el informe del research →
          </a>
          <!--
            Los posts generados (Task 11, sub-proyecto de publicación en blog externo) — MISMO
            criterio que el link al informe de arriba y no el del entregable de abajo: se muestra a
            CUALQUIER rol que vea este run, porque la pantalla de posts explica sus propios estados
            con palabras (ver posts.ts) y el rol "cliente" SÍ tiene algo legítimo que mirar ahí
            (contenido de solo lectura, Step 3 del brief) — a diferencia del entregable, que es una
            hoja que la agencia le manda al restaurante y no una pantalla del cliente.

            La condición es la ÚLTIMA DECISIÓN del run, no el flag de despliegue: una vez que alguien
            aprobó con "crear_posts", el link tiene que seguir estando aunque destinoPosts se apague
            después (mismo motivo por el que puedeAprobar() no controla el link al informe).
          -->
          @if (ultimaDecision()?.destino === 'crear_posts') {
            <a
              [routerLink]="['/clientes', clienteId(), 'research', b.run.id, 'posts']"
              class="mt-1 block w-fit text-sm text-texto hover:underline"
            >
              Ver los posts generados →
            </a>
          }
          <!--
            El entregable del restaurante, SOLO para el equipo — y acá el criterio es al revés que en
            el link de arriba, a propósito.

            El del informe aparece siempre porque su destino sabe explicar con palabras por qué no hay
            informe. Éste no: para un rol cliente el endpoint responde 404 —el mismo que un run que no
            existe, porque app.es_staff() va en el predicado de la consulta— y la pantalla solo podría
            decir "Run no encontrado", que es confuso y además falso a medias. Y la decisión del dueño
            (spec, 2026-08-07) es que el entregable lo manda la AGENCIA: no es una pantalla del
            cliente, así que no se le insinúa que existe.

            Esconderlo es UX, no seguridad: quien escriba la URL a mano igual recibe el 404 de Postgres.
          -->
          <!--
            Sin ninguna página aprobada NO hay link, y lo que se muestra es un <span> apagado con el
            motivo en el tooltip. Ojo: la condición es SOLO la de las páginas — un run que no lanzó el
            pipeline (sin tiene_workflow) igual tiene entregable, porque la hoja del restaurante se
            genera de las páginas aprobadas y no depende de que haya algo esperando publicar.

            · POR QUÉ NO SE OFRECE: el endpoint responde 409 (el backend impone la regla), y antes de
              que la impusiera devolvía una hoja con dos títulos de sección y nada debajo. El riesgo no
              era técnico sino humano: que alguien se descargue ese PDF y se lo mande a un restaurante
              sin mirarlo. La división es la de siempre — la UI ahorra el viaje, el backend impone la
              regla para quien llame al endpoint directo.
            · POR QUÉ UN <span> Y NO UN <a> APAGADO: un <a href> con clase de "deshabilitado" sigue
              navegando —con el clic del medio, con Enter desde el teclado, con «abrir en pestaña
              nueva»—; lo único que hace la clase es que no lo parezca. Sin href no hay destino, no hay
              foco y el Router no se entera.
            · POR QUÉ NO SE ESCONDE: esta pantalla es el único sitio desde donde se descubre que existe
              una hoja para el restaurante (no está en el sidebar: cuelga de un run). Escondiéndolo,
              quien no aprobó nada no se entera ni de que existe ni de qué le falta.
            · LA CONDICIÓN ES puedeAprobar(), y es la MISMA que la primera del botón de aprobar el
              run, a propósito: "hay algo que entregar" y "hay algo que aprobar" son la misma pregunta
              (puedeAprobarseRun). Dos definiciones separadas no fallan el día que se escriben, fallan
              el día que alguien cambia una y la otra se queda atrás. Lo fija un test de brief.spec.ts.
              Lo que el botón tiene DE MÁS (que el run lo haya lanzado el pipeline) no se le agrega
              acá: son preguntas distintas, y un run sembrado con páginas aprobadas SÍ tiene una hoja
              que mandarle al restaurante aunque no haya nada que publicar.
          -->
          @if (membresia.esEquipo()) {
            @if (puedeAprobar()) {
              <a
                [routerLink]="['/clientes', clienteId(), 'research', b.run.id, 'entregable']"
                class="mt-1 block w-fit text-sm text-texto hover:underline"
              >
                Ver el entregable del restaurante (sin coste) →
              </a>
            } @else {
              <span
                class="mt-1 block w-fit text-sm text-texto-tenue cursor-not-allowed"
                title="Este research no tiene ninguna página aprobada, así que el entregable saldría vacío. Aprobá al menos una página."
              >
                Ver el entregable del restaurante (sin coste) →
              </span>
            }
          }
          <!--
            El selector de destino y el botón de confirmar — reemplaza el botón único "Aprobar el
            run y publicar". Retiro del gate «tiene_workflow» (bloque C0 se cerró de otra forma: con
            RunSinWorkflowError fuera, cualquier run en pending_approval admite una decisión, nacido
            del pipeline o sembrado).

            · POR QUÉ UN <select> Y NO EL BOTÓN DE ANTES: "aprobar" dejó de ser una sola acción — el
              servidor exige «destino» en el body (POST /runs/:id/approve, Task 10), así que la
              pantalla tiene que preguntarlo. «crear_posts» estuvo DESHABILITADA (visible, avisando
              que la opción existía sin prometer que funcionaba) hasta la Task 11, que construyó la
              pantalla de posts que la consume — mostrarDestinoPostsUI() sigue siendo el mismo gate
              equipo+flag, ahora habilitando la opción de verdad en vez de solo mostrarla.
            · [ngModel]/(ngModelChange) y no [(ngModel)]: destinoElegido es un signal, no una
              propiedad de dos vías — mismo patrón que edKeyword/edSlug más abajo.
            · POR QUÉ EL MOTIVO SALE DE UNA FUNCIÓN: motivoNoAprobar() (core/aprobar-run.ts) ahora
              depende SOLO de que haya una página aprobada — el otro motivo que existía (el run no
              lanzó el pipeline) se fue con el gate retirado. El <p> y el title comparten la misma
              señal a propósito, igual que antes.
            · errorAprobar() es el 409 TRANSICION_INVALIDA del SERVIDOR (la pantalla y la base no
              coincidían: otra pestaña, el endpoint a mano, una decisión que se resolvió mientras esto
              seguía abierto). Se pinta ACÁ, al lado del selector, y NO por error() general: esa rama
              reemplaza la pantalla entera (ver el @else if de arriba), y quien la leyera se quedaría
              sin el brief y sin el selector al que el mensaje se refiere — mismo criterio que antes
              sostenía rechazadoSinWorkflow. Cualquier OTRO error de esta acción sí va a error()
              general, igual que en conTrabajo().
            · puedeDecidirseRunUI() es el gate agregado en la revisión final del sub-proyecto 2: sin
              él, este bloque se mostraba (y "Confirmar" quedaba habilitado) en CUALQUIER estado del
              run, incluido «approved» sin decisión retomable — el caso común tras la primera
              decisión exitosa —, y confirmar ahí siempre devolvía 409. Ver el comentario del
              computed en la clase.
          -->
          @if (puedeAprobarRunUI() && puedeDecidirseRunUI()) {
            <div class="mt-4 space-y-2">
              <label for="destino-run" class="block text-sm font-medium text-texto">
                ¿Qué hacemos con este research?
              </label>
              <select
                id="destino-run"
                [ngModel]="destinoElegido()"
                (ngModelChange)="destinoElegido.set($event)"
                class="rounded-md border border-borde-fuerte bg-superficie text-texto text-sm px-2 py-1"
              >
                <option value="crear_web">Crear la web</option>
                <option value="solo_informe">Solo quedarme con el informe</option>
                @if (mostrarDestinoPostsUI()) {
                  <option value="crear_posts">Crear posts</option>
                }
              </select>
              <div>
                <button
                  (click)="aprobarRun()"
                  [disabled]="motivoNoAprobar() !== null || trabajando()"
                  [attr.title]="motivoNoAprobar()"
                  [attr.aria-describedby]="motivoNoAprobar() ? 'motivo-aprobar-run' : null"
                  class="rounded-md bg-respaldo text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
                >
                  Confirmar
                </button>
              </div>
              @if (motivoNoAprobar(); as motivo) {
                <p id="motivo-aprobar-run" class="text-xs text-texto-tenue">{{ motivo }}</p>
              }
              @if (errorAprobar(); as errAprobar) {
                <p class="text-xs text-error">{{ errAprobar }}</p>
              }
            </div>
          }
          <!--
            "Construir la web ahora" — el retomo que este sub-proyecto existe para habilitar. Solo
            aparece cuando la ÚLTIMA decisión de este run fue «solo_informe» y TERMINÓ
            (resultado: 'completado'): una decisión «pendiente» correría dos workflows a la vez, y
            una «error» no se resuelve reintentando el mismo destino desde acá. puedeRetomarUI()
            combina esto con el MISMO gate equipo+flag que el selector de arriba (corrección Major de
            la ronda de Codex: sin combinarlo, un rol «cliente» —o un despliegue con aprobarRun
            apagado— veía el botón igual y el backend lo rechazaba recién al hacer clic).

            [disabled] también mira motivoNoAprobar(), igual que "Confirmar" (hallazgo Important de
            la revisión final del sub-proyecto 2): puedeRetomarUI() solo mira la ÚLTIMA DECISIÓN, no
            el estado ACTUAL de las páginas — si alguien desaprueba la única página aprobada después
            de que el «solo_informe» terminó, el botón seguía habilitado y «crear_web» volvía a
            exigir una página aprobada que ya no existe: otro 409 evitable.
          -->
          @if (puedeRetomarUI()) {
            <button
              data-test="retomar-web"
              (click)="retomarConWeb()"
              [disabled]="motivoNoAprobar() !== null || trabajando()"
              [attr.title]="motivoNoAprobar()"
              class="mt-4 rounded-md border border-borde px-4 py-2 text-sm text-texto hover:bg-superficie-2 disabled:opacity-40"
            >
              Construir la web ahora
            </button>
          }
        </header>

        @if (b.run.status === 'running') {
          <div class="bg-superficie rounded-xl border border-borde p-6 text-sm text-texto-medio">
            <span class="inline-block h-2 w-2 rounded-full bg-alerta animate-pulse mr-2"></span>
            El research está corriendo. Esta pantalla se actualiza sola.
          </div>
        } @else {
        <!-- ✅ RESPALDADAS por datos de mercado -->
        <section>
          <h2 class="text-sm font-semibold mb-2 text-respaldo">
            ✅ Respaldadas por datos ({{ respaldadas().length }})
          </h2>
          @if (respaldadas().length === 0) {
            <p class="text-sm text-texto-tenue">Ninguna página tiene datos de mercado que la respalden.</p>
          }
          @for (p of respaldadas(); track p.id) {
            <ng-container [ngTemplateOutlet]="tarjeta" [ngTemplateOutletContext]="{ $implicit: p }" />
          }
        </section>

        <!-- ⚠️ SIN VALIDAR: se muestran igual. Ocultarlas sería mentir. -->
        <section>
          <h2 class="text-sm font-semibold mb-2 text-alerta">
            ⚠️ Sin validar ({{ sinValidar().length }})
          </h2>
          <p class="text-xs text-texto-tenue mb-2">
            No hay datos de mercado que las respalden. Se proponen, pero el sistema lo dice.
          </p>
          @for (p of sinValidar(); track p.id) {
            <ng-container [ngTemplateOutlet]="tarjeta" [ngTemplateOutletContext]="{ $implicit: p }" />
          }
        </section>
        }
      }
    </div>

    <!-- Tarjeta de página, reutilizada por los dos grupos -->
    <ng-template #tarjeta let-p>
      <div class="bg-superficie rounded-lg border border-borde p-4 mb-2">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-texto">{{ p.keyword_principal }}</p>
            <p class="text-xs text-texto-tenue truncate">{{ p.url_slug }}</p>
            <p class="mt-1 text-xs text-texto-tenue">
              Vol: {{ p.volumen ?? 'n/d' }} · KD: {{ p.dificultad ?? 'n/d' }} · Score:
              {{ p.opportunity_score }}
            </p>
          </div>
          <span
            class="text-xs shrink-0 rounded-full px-2 py-0.5"
            [class]="p.approved ? 'bg-respaldo-suave text-respaldo' : 'bg-superficie-2 text-texto-medio'"
          >
            {{ p.approved ? 'Aprobada' : 'Pendiente' }}
          </span>
        </div>

        @if (membresia.esEquipo()) {
          @if (editando() === p.id) {
            <div class="mt-3 space-y-2 border-t border-borde pt-3">
              <input
                [ngModel]="edKeyword()"
                (ngModelChange)="edKeyword.set($event)"
                placeholder="Keyword principal"
                class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-2 py-1 text-sm"
              />
              <input
                [ngModel]="edSlug()"
                (ngModelChange)="edSlug.set($event)"
                placeholder="/url-slug"
                class="w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-2 py-1 text-sm"
              />
              <p class="text-xs text-alerta">Editar quita la aprobación: alguien tendrá que volver a mirarla.</p>
              <div class="flex gap-2">
                <button
                  (click)="guardar(p)"
                  [disabled]="trabajando()"
                  class="rounded-md bg-accion text-texto-invertido px-3 py-1 text-sm hover:opacity-90 disabled:opacity-40"
                >
                  Guardar
                </button>
                <button (click)="editando.set(null)" class="rounded-md border px-3 py-1 text-sm">Cancelar</button>
              </div>
            </div>
          } @else {
            <div class="mt-3 flex gap-2">
              @if (!p.approved) {
                <button
                  (click)="aprobarPagina(p)"
                  [disabled]="trabajando()"
                  class="rounded-md bg-respaldo text-texto-invertido px-3 py-1 text-sm hover:opacity-90 disabled:opacity-40"
                >
                  Aprobar
                </button>
              }
              <button (click)="empezarEdicion(p)" class="rounded-md border px-3 py-1 text-sm">Editar</button>
            </div>
          }
        }
      </div>
    </ng-template>
  `,
})
export class BriefPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  // El rol sale de `memberships`, no del token: ver la cabecera de `MembresiaService`.
  readonly membresia = inject(MembresiaService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private timer: ReturnType<typeof setInterval> | null = null;

  /** A qué run corresponde el trabajo en vuelo, y si el componente sigue vivo. Ver `vigencia.ts`. */
  private readonly vigencia = new Vigencia();
  private get runId(): string {
    return this.vigencia.actual;
  }

  /**
   * El CLIENTE de la URL (`/clientes/:id/research/:runId`), para armar los enlaces de esta pantalla.
   *
   * **No es el dueño del run**: es lo que dice la ruta, que puede estar equivocado. Quién es el dueño
   * lo dice `brief().run.client_id`, y `cargar()` los concilia.
   */
  readonly clienteId = signal('');

  readonly brief = signal<Brief | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly trabajando = signal(false);

  /** La última decisión de este run, o `null` si todavía no se decidió nada. Ver el link a "posts". */
  readonly ultimaDecision = computed(() => this.brief()?.run.ultimaDecision ?? null);

  readonly editando = signal<string | null>(null);
  readonly edKeyword = signal('');
  readonly edSlug = signal('');

  readonly respaldadas = computed(() =>
    this.brief() ? separarPorEvidencia(this.brief()!.pages).respaldadas : [],
  );
  readonly sinValidar = computed(() =>
    this.brief() ? separarPorEvidencia(this.brief()!.pages).sinValidar : [],
  );
  readonly puedeAprobar = computed(() => (this.brief() ? puedeAprobarseRun(this.brief()!.pages) : false));

  /**
   * Por qué no se puede aprobar, o `null` si se puede. Depende SOLO de que haya una página aprobada
   * (`core/aprobar-run.ts`) — el gate `tiene_workflow` se retiró: con `RunSinWorkflowError` fuera,
   * cualquier run en `pending_approval` admite una decisión de destino.
   */
  readonly motivoNoAprobar = computed(() => motivoNoAprobable({ hayPaginaAprobada: this.puedeAprobar() }));

  /**
   * ¿Se muestra el selector de destino? Equipo + flag de Fase 1. En Fase 1 está apagado: aprobar el
   * run emite un evento sin orquestador detrás (ver `features.ts`). La aprobación de PÁGINAS —abajo,
   * en cada tarjeta— sigue visible: es lo que demuestra la compuerta.
   */
  readonly puedeAprobarRunUI = computed(() =>
    mostrarAprobarRun(this.membresia.esEquipo(), environment.features.aprobarRun),
  );

  /** Qué destino va a pedir el botón "Confirmar". `crear_web` por defecto: es el camino más común. */
  readonly destinoElegido = signal<'crear_web' | 'solo_informe' | 'crear_posts'>('crear_web');

  /**
   * ¿Se muestra la opción "crear_posts"? Equipo + flag propio (Task 11, sub-proyecto de publicación
   * en blog externo). Hasta esa Task la opción existía en el `<select>` pero SIEMPRE `disabled` —
   * ahora que la pantalla de posts existe, calificar el gate alcanza para habilitarla de verdad.
   */
  readonly mostrarDestinoPostsUI = computed(() =>
    mostrarDestinoPosts(this.membresia.esEquipo(), environment.features.destinoPosts),
  );

  /**
   * ¿La última decisión de este run fue `solo_informe` y TERMINÓ? El único camino "retomable" que
   * `registrarDecision` admite para un run que ya está `approved` (ver la cabecera del método en
   * `db/src/store.ts`). Extraído a su propio computed para que `puedeRetomarUI` y
   * `puedeDecidirseRunUI` compartan la MISMA definición — dos cálculos separados de "es retomable"
   * son exactamente el error que el comentario de la línea ~106 de este archivo ya advertía sobre
   * `puedeAprobar()`/el botón de aprobar: divergen el día que alguien cambia uno y no el otro.
   */
  readonly esRetomable = computed(() => {
    const u = this.brief()?.run.ultimaDecision;
    return u?.destino === 'solo_informe' && u.resultado === 'completado';
  });

  /**
   * ¿El run está en un estado donde `registrarDecision` PODRÍA calificar una decisión nueva?
   * `pending_approval` siempre calza; `approved` solo en el camino retomable (`esRetomable()`).
   * Cualquier otro estado —`running`, `rejected`, `failed`, o `approved` sin decisión completada
   * `solo_informe`— no admite ninguna decisión nueva y el servidor respondería 409
   * `TRANSICION_INVALIDA` si se lo pidiera.
   *
   * Hallazgo Important de la revisión final del sub-proyecto 2: sin este gate, el selector de
   * destino y "Confirmar" se mostraban (y el botón quedaba habilitado) en CUALQUIER estado del run
   * —incluido `approved` sin decisión retomable, que es el caso común tras la primera decisión
   * exitosa—, y confirmar ahí siempre devolvía 409: exactamente la confusión que el retiro del gate
   * viejo (`tiene_workflow`) debía eliminar, no reintroducir de otra forma.
   */
  readonly puedeDecidirseRunUI = computed(() => {
    const run = this.brief()?.run;
    if (!run) return false;
    return run.status === 'pending_approval' || (run.status === 'approved' && this.esRetomable());
  });

  /**
   * ¿Se puede "Construir la web ahora" — retomar un run cuya última decisión fue `solo_informe` y
   * terminó? La razón de ser de este sub-proyecto entero.
   *
   * Corrección Major de la ronda de Codex: la primera versión de este computed solo miraba la
   * decisión, sin combinar el gate de rol/flag — un usuario `cliente`, o un despliegue con
   * `aprobarRun` apagado, veía el botón igual y el backend lo rechazaba recién al hacer clic.
   */
  readonly puedeRetomarUI = computed(() => {
    if (!this.puedeAprobarRunUI()) return false; // mismo gate de equipo+flag que el selector de arriba
    return this.esRetomable();
  });

  /**
   * Lo que dijo el SERVIDOR al rechazar la última decisión con 409 `TRANSICION_INVALIDA`. Separado
   * de `error()` general a propósito — el porqué está en el comentario de `aprobarRun()`.
   *
   * Se limpia al cambiar de run (`ngOnInit`): un error de A no puede seguir contándole a alguien un
   * motivo que no es el de B.
   */
  readonly errorAprobar = signal('');

  private sub: Subscription | null = null;

  /**
   * Se SUSCRIBE a los parámetros, no lee el snapshot.
   *
   * Angular **reutiliza el componente** al navegar de un run a otro (misma ruta): con `snapshot`,
   * `runId` se quedaba en A mientras la pantalla decía B. El polling seguía preguntando por A y —lo
   * grave— **aprobar una página en la pantalla de B iba contra el run A**.
   */
  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      // OJO: `id` es el CLIENTE y `runId` el run. Antes de que el run se mudara bajo la ficha, `id`
      // era el run — leerlo mal acá pide el brief de un uuid de cliente y devuelve 404.
      //
      // Se escribe ANTES de la guarda de abajo a propósito: cuando la conciliación corrige la URL,
      // lo único que cambia es el `:id`, y los enlaces de la pantalla tienen que seguirlo sin
      // recargar el brief (que es el mismo run).
      this.clienteId.set(params.get('id') ?? '');
      const id = params.get('runId') ?? '';
      if (id === this.runId) return;
      // Cambiar la vigencia ANTES de nada: lo que venga del run anterior queda obsoleto solo.
      this.vigencia.cambiarA(id);
      this.pararPolling();
      this.brief.set(null);
      this.editando.set(null);
      this.error.set('');
      // El error era del run ANTERIOR. Sin esto, Angular reutiliza la instancia al navegar del run
      // A al B (mismo cliente, mismo `routeConfig`) y el selector de B mostraría un 409 que no era
      // suyo.
      this.errorAprobar.set('');
      // Mismo motivo que `errorAprobar`: la elección del selector era de A. Sin este reset, quien
      // cambió el destino en A sin confirmar y navega a B se encuentra el selector de B ya movido —
      // una elección que nunca hizo, sobre un run que no es el que la originó.
      this.destinoElegido.set('crear_web');
      void this.cargar();
    });
  }

  ngOnDestroy(): void {
    // Primero destruir la vigencia: una carga en vuelo que resuelva después NO puede crear un timer
    // nuevo (quedaría huérfano, pegándole a la API para siempre).
    this.vigencia.destruir();
    this.pararPolling();
    this.sub?.unsubscribe();
  }

  async cargar(): Promise<void> {
    const pedido = this.runId; // a qué run corresponde ESTA petición
    this.cargando.set(true);
    this.error.set('');
    try {
      const brief = await this.api.verBrief(pedido);
      if (this.vigencia.obsoleta(pedido)) return; // llegó tarde: ya es otro run, o nos fuimos
      this.brief.set(brief);
      this.ajustarPolling();
      // El `:id` de la URL y el dueño real del run son dos afirmaciones independientes: nada obliga a
      // que coincidan. Si no coinciden, la cabecera de la ficha estaría diciendo un cliente y el
      // contenido perteneciendo a otro — en una agencia con cartera, eso es un error de facturación
      // esperando. Se corrige la URL, no se oculta el run.
      const duenio = this.brief()?.run.client_id;
      if (duenio && duenio !== this.clienteId()) {
        await this.router.navigate(['/clientes', duenio, 'research', this.runId]);
        return;
      }
    } catch (e) {
      if (this.vigencia.obsoleta(pedido)) return;
      this.error.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(pedido)) this.cargando.set(false);
    }
  }

  /**
   * Mientras el research corre, se repregunta cada POLL_MS hasta que cambia de estado. El re-fetch
   * NO toca `cargando` (no queremos el spinner cada 4 s pisando la pantalla) ni `error` transitorio.
   */
  private ajustarPolling(): void {
    // Si el componente ya no existe, NADIE crea un timer: no habría quién lo limpie.
    if (!this.vigencia.viva) {
      this.pararPolling();
      return;
    }
    const corriendo = this.brief()?.run.status === 'running';
    if (corriendo && !this.timer) {
      this.timer = setInterval(() => void this.refetch(), POLL_MS);
    } else if (!corriendo) {
      this.pararPolling();
    }
  }

  private pararPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async refetch(): Promise<void> {
    const pedido = this.runId;
    try {
      const brief = await this.api.verBrief(pedido);
      if (this.vigencia.obsoleta(pedido)) return; // otro run, o ya nos fuimos
      this.brief.set(brief);
      this.ajustarPolling();
    } catch {
      /* un fallo transitorio no rompe el polling; el próximo tick reintenta */
    }
  }

  empezarEdicion(p: PaginaPropuesta): void {
    this.edKeyword.set(p.keyword_principal);
    this.edSlug.set(p.url_slug);
    this.editando.set(p.id);
  }

  private async conTrabajo(fn: () => Promise<void>): Promise<void> {
    this.trabajando.set(true);
    this.error.set('');
    try {
      await fn();
      await this.refetch(); // recarga SIN el spinner de página (la acción ya terminó)
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.trabajando.set(false);
    }
  }

  aprobarPagina(p: PaginaPropuesta): Promise<void> {
    return this.conTrabajo(() => this.api.aprobarPagina(p.id));
  }

  guardar(p: PaginaPropuesta): Promise<void> {
    const cambios = { keyword_principal: this.edKeyword(), url_slug: this.edSlug() };
    this.editando.set(null);
    return this.conTrabajo(() => this.api.editarPagina(p.id, cambios));
  }

  /**
   * No usa `conTrabajo` porque necesita tratar UN error distinto del resto: el 409
   * `TRANSICION_INVALIDA`.
   *
   * No es un fallo cualquiera: es la base contradiciendo lo que esta pantalla asumía (otra pestaña,
   * el endpoint a mano, una decisión que se resolvió mientras esto seguía abierto), y tiene su
   * propio sitio en la pantalla —al lado del selector—. Mandarlo a `error` lo pintaría en la rama de
   * error del template, que **reemplaza la pantalla entera**: quien lo lee se quedaría sin el brief
   * y sin el selector al que el mensaje se refiere. Mismo criterio que la pantalla del entregable con
   * su propio 409: el aviso va al lado de la acción, no en lugar del contenido.
   *
   * Cualquier OTRO error (red, 500, etc.) sigue yendo a `error()` general — mismo criterio que
   * `conTrabajo()`. Se ramifica por el **código** y nunca por la frase — ver `core/codigos.ts`.
   */
  async aprobarRun(): Promise<void> {
    const pedido = this.runId; // a qué run corresponde ESTA aprobación
    this.trabajando.set(true);
    this.error.set('');
    this.errorAprobar.set('');
    try {
      await this.api.aprobarRun(pedido, this.destinoElegido());
      await this.refetch(); // recarga SIN el spinner de página (la acción ya terminó)
    } catch (e) {
      // Si ya nos fuimos a otro run, el resultado de éste no puede pintar nada: apagaría el
      // selector de una pantalla que no es la suya.
      if (this.vigencia.obsoleta(pedido)) return;
      if (esTransicionInvalida(e)) this.errorAprobar.set('Este run ya no admite esa transición.');
      else this.error.set((e as Error).message);
    } finally {
      if (!this.vigencia.obsoleta(pedido)) this.trabajando.set(false);
    }
  }

  /**
   * Retoma un run con última decisión `solo_informe`/`completado` hacia `crear_web` — el "más tarde"
   * que este sub-proyecto existe para habilitar. Fuerza el selector a `crear_web` antes de reusar
   * `aprobarRun()`: es la MISMA llamada que hace el botón "Confirmar", con el destino ya decidido.
   */
  async retomarConWeb(): Promise<void> {
    this.destinoElegido.set('crear_web');
    await this.aprobarRun();
  }

  /** `null` = no hay coste que mostrar, y entonces la línea no se pinta. Ver `core/dinero.ts`. */
  readonly usd = usdDeMicros;
}

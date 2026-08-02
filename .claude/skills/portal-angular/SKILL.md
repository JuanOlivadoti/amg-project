---
name: portal-angular
description: Usar al escribir o modificar código Angular del portal de AMG OS (portal/) — una pantalla nueva, un componente, un servicio con estado, una ruta, un formulario, o al decidir dónde poner una pieza de lógica. Cubre la arquitectura de capas, la API de signals que usa el portal, el control flow, las carreras asincrónicas y el rol de la UI frente a RLS.
---

# Angular en el portal de AMG OS

Angular 20, standalone, **signals sin NgRx**, TypeScript strict. Todo lo de acá ya se cumple en el
portal: son las convenciones que hay, no las que estarían bien.

**La regla que ordena a las demás: si se puede escribir como función pura, va a `core/`.** Ahí se
prueba con `node:test` en milisegundos, sin navegador y sin TestBed. Lo que queda en el componente
o el servicio es solo lo que no se puede sacar.

## Las cuatro capas

| Capa | Qué es | Qué NO hace |
|---|---|---|
| `core/` | Funciones y tipos puros, **sin importar nada de `@angular/*`** | No conoce componentes, ni HTTP, ni el DOM |
| `services/` | `@Injectable({providedIn:'root'})` con el estado en signals | No filtra, ordena ni calcula: eso lo llama de `core/` |
| `pages/` | Una pantalla por carpeta; cablea servicio → template | No tiene lógica de negocio ni llama a la API directo |
| `shared/components/` | Presentacionales: `input()` entra, `output()` sale | No inyecta servicios de dominio salvo para mostrar (nunca para decidir) |

`shared/layout/` es el armazón (shell, header, sidebar, backdrop) y `guards/` la puerta.

## Componentes

Standalone —Angular 20 ya no necesita `standalone: true`—, **template inline** con backticks y
**sin `styleUrls`**: el portal tiene un único `styles.css` global y todo lo demás son utilidades de
Tailwind (ver `portal-estilos`).

```ts
@Component({
  selector: 'app-clientes-tabla',
  imports: [RouterLink, TableDropdownComponent],   // explícito, solo lo que el template usa
  template: `
    @for (c of clientes(); track c.id) {
      <tr>…</tr>
    } @empty {
      <tr><td colspan="6">No se encontraron clientes con los filtros aplicados.</td></tr>
    }
  `,
})
export class ClientesTablaComponent {
  readonly clientes = input.required<readonly ClienteAgencia[]>();
  readonly archivar = output<string>();

  /** Un mapa para toda la tabla, no uno por fila. */
  private readonly porId = computed(() => { /* … */ });
}
```

- `input.required<T>()` / `input<T>(default)` y `output<T>()`. Nada de `@Input()`/`@Output()`.
- `inject()` en un campo `readonly`, no constructor con parámetros.
- Control flow **`@if` / `@for` / `@empty` / `@switch`**, siempre con `track`. Nunca `*ngIf`/`*ngFor`.
- Los `readonly` colecciones entran como `readonly T[]`: el componente no muta lo que recibe.
- Naming: pantallas `XxxPage`, componentes `XxxComponent`, selector `app-kebab-case`, y **los nombres
  de dominio en español** (`clientes`, `vigencia`, `miembros`, `filtrados`).

## Servicios con estado

El patrón, tal cual está en `ClientesService`:

```ts
@Injectable({ providedIn: 'root' })
export class ClientesService {
  private readonly api = inject(ApiService);

  readonly #clientes = signal<ClienteAgencia[]>([]);
  readonly clientes = this.#clientes.asReadonly();   // afuera se lee, no se escribe

  readonly filtro = signal<FiltroClientes>(filtroVacio());
  readonly filtrados = computed(() => filtrarClientes(this.#clientes(), this.filtro()));

  readonly cargando = signal(true);
  readonly error = signal('');

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    try {
      this.#clientes.set(await this.api.listarClientes());
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.cargando.set(false);
    }
  }
}
```

- Signal privado con `#` + `asReadonly()` público. Quien lo lee no lo puede pisar.
- `cargando` / `error` con `try/catch/finally` en **cada** método que va a la red.
- `filtrados` es un **`computed` que solo llama a una función pura de `core/`**. Es un valor derivado:
  por eso `computed` y no `effect` — `effect` es para efectos secundarios, y acá no hay ninguno.
- La pantalla llama al servicio en `ngOnInit`; el servicio es singleton y sobrevive a la navegación.

**Cuándo NO usar `effect()`:** casi siempre. Además de la regla anterior, `effect` exige un contexto
de inyección, y eso rompe el patrón de instanciar el servicio con `new` bajo `node:test`. `TemaService`
aplica la clase del tema desde los tres puntos donde puede cambiar (arranque, botón, cambio del
sistema) justamente para conservar sus tests sin navegador.

## La cáscara fina sobre la API

`ApiService` no tiene lógica: le pasa la URL base y de dónde salen token y tenant al cliente puro
`crearApi()` de `core/api-core.ts`, y reexporta sus métodos. Toda la mecánica HTTP —headers, parseo,
errores, el 401 → refrescar → reintentar— vive en `core/`, probada sin red.

Si necesitás un endpoint nuevo: se agrega en `core/api-core.ts` (con su test) y se reexporta en
`ApiService`. No se hace `fetch` desde un componente ni desde un servicio de pantalla.

## Carreras asincrónicas: el guard de vigencia

**Una promesa no se cancela.** Esto produjo dos bugs reales en el portal, y los dos vuelven solos si
se escribe una pantalla nueva sin tenerlo presente:

1. **La respuesta tardía pisa la pantalla.** Se pide A, se navega a B, B contesta primero y pinta, y
   después llega A y sobrescribe. La URL dice B y la pantalla muestra A.
2. **Polling huérfano.** El componente se destruye con una carga en vuelo; `ngOnDestroy` limpia el
   timer, pero la promesa resuelve después y crea un intervalo nuevo que ya no tiene quién lo limpie.

La regla: **anotá a qué corresponde el trabajo ANTES de pedirlo y preguntá al volver si sigue
vigente.** Para un componente con ciclo de vida, `core/vigencia.ts` (`cambiarA`, `obsoleta`,
`destruir`). Para un servicio singleton, alcanza un campo:

```ts
async verCliente(id: string): Promise<void> {
  this.#idVigente = id;
  if (this.#cliente()?.id !== id) this.#cliente.set(null);  // no dejes el anterior si el nuevo falla
  try {
    const cliente = await this.api.verCliente(id);
    if (this.#idVigente !== id) return;   // llegó tarde: ya se pidió otro
    this.#cliente.set(cliente);
  } finally {
    if (this.#idVigente === id) this.cargando.set(false);
  }
}
```

Ojo con el detalle del medio: un signal compartido que no se limpia deja la pantalla mostrando el
registro anterior si el nuevo falla con 404.

Y recordá que Angular **reutiliza la instancia** al navegar entre `/clientes/A` y `/clientes/B`: no
se dispara `ngOnInit` de nuevo, hay que suscribirse a `paramMap`.

## Rutas

Todas con `loadComponent`. El árbol: `/login` suelta, y el resto cuelga de `AppShellComponent` con
`canActivate: [authGuard]`. Comodín `**` al final. Una ruta que todavía no existe no rompe un
`routerLink` —el Router no valida el destino hasta que se navega—, pero dejalo dicho en el comentario.

## Permisos en la UI: cosméticos, y respaldados

**La autorización la hace RLS en Postgres (ADR-15, ADR-20). La UI solo explica lo que la base ya
decidió.** Ocultar un botón es UX, no seguridad; si la única defensa de una acción es que el botón no
se ve, la acción no está protegida.

Dos consecuencias concretas:

- El rol sale de `memberships` (`rolEfectivo(miembros, userId)`), **nunca del token**. Sin fila propia
  el rol es `''` — "sin acceso al tenant" — y no se regala un default permisivo.
- Una capacidad que se muestre en pantalla lleva su `respaldo`: el símbolo exacto de la política,
  función o constante que la sostiene, y el archivo donde vive. `capacidades.test.ts` abre el archivo
  y busca el símbolo: si alguien renombra la política, la fila **cae**. Una capacidad que no se pueda
  respaldar así, no se declara.

## Errores frecuentes

| Error | Por qué duele |
|---|---|
| Poner el filtrado/ordenamiento dentro del `computed` del servicio | Deja de poder probarse sin Angular. Sacalo a `core/` y que el `computed` lo llame |
| Un componente que inyecta un servicio para **decidir** | Los presentacionales reciben por `input()` y avisan por `output()`; quien decide es la página |
| `effect()` para calcular un valor derivado | Es un `computed`. Y `effect` ata el servicio al contexto de inyección |
| `fetch` fuera de `core/api-core.ts` | La política de 401/refresh y el manejo de errores quedan fuera de lo probado |
| Confiar en el rol del token para mostrar u ocultar | El rol se deriva de `memberships`; el token puede decir cualquier cosa |
| `@Input()`/`*ngIf` copiados de un ejemplo de internet | El portal es signals + control flow moderno de punta a punta |
| Un `id` de uuid mostrado como "Sin asignar" | Si hay alguien que no está en la lista visible, se muestra el uuid: decir "sin asignar" es mentir |

## Verificación

Desde `portal/`: `npm test`, `npm run typecheck` (que acá es `ng build --configuration development`),
`npm run test:components`, y manejar la app en el navegador. Los detalles de qué runner usa cada tipo
de test están en `portal-testing`.

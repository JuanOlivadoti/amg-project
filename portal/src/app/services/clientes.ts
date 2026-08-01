import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api';
import type { CambiosClienteAgencia, ClienteAgencia, NuevoClienteAgencia } from '../core/models';
import { filtrarClientes, filtroVacio, type FiltroClientes } from '../core/clientes-filtro';

/**
 * Estado del CRM de clientes en signals (sin NgRx). Mismo criterio que `pages/runs/runs.ts`:
 * `cargando`/`error` con `try/finally`, y acá además un `filtro` + un `filtrados` derivado.
 *
 * El filtrado/ordenamiento en sí NO vive acá: `filtrados` solo LLAMA a la función pura de
 * `clientes-filtro.ts` con `(clientes(), filtro())`. Por eso es un `computed` (valor derivado) y no
 * un `effect` (que sería para un efecto secundario, que acá no hay ninguno).
 */
@Injectable({ providedIn: 'root' })
export class ClientesService {
  private readonly api = inject(ApiService);

  readonly #clientes = signal<ClienteAgencia[]>([]);
  readonly clientes = this.#clientes.asReadonly();

  readonly filtro = signal<FiltroClientes>(filtroVacio());

  readonly filtrados = computed(() => filtrarClientes(this.#clientes(), this.filtro()));

  readonly cargando = signal(true);
  readonly error = signal('');

  /** El cliente de la pantalla de perfil (Etapa 5c). `null` = todavía no cargó, o falló. */
  readonly #cliente = signal<ClienteAgencia | null>(null);
  readonly cliente = this.#cliente.asReadonly();
  /** A qué id corresponde el último `verCliente()` pedido — ver el comentario dentro del método. */
  #idVigente = '';

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

  async crear(datos: NuevoClienteAgencia): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    try {
      await this.api.crearCliente(datos);
      await this.cargar();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.cargando.set(false);
    }
  }

  async actualizar(id: string, cambios: CambiosClienteAgencia): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    try {
      await this.api.actualizarCliente(id, cambios);
      await this.cargar();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.cargando.set(false);
    }
  }

  async archivar(id: string): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    try {
      await this.api.archivarCliente(id);
      await this.cargar();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.cargando.set(false);
    }
  }

  async desarchivar(id: string): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    try {
      await this.api.desarchivarCliente(id);
      await this.cargar();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * Trae UN cliente por id (`GET /clients/:id`, ya expuesto por `ApiService.verCliente` desde la
   * Etapa 4) y lo deja en `cliente()`. Distinto de `cargar()`: esa trae la LISTA completa a
   * `clientes()` — la pantalla de perfil (Etapa 5c) no necesita la lista, solo este cliente.
   *
   * **Guard de vigencia**: Angular reutiliza la instancia de `ClientePerfilPage` al navegar de
   * `/clientes/A` a `/clientes/B` (misma ruta, distinto :id) — no dispara `ngOnInit` de nuevo, la
   * pantalla vuelve a pedir por su suscripción a `paramMap`. Sin este guard, si el pedido de A tarda
   * más que el de B, A pisaría a B en `cliente()` aunque la URL ya diga B (mismo bug que documenta
   * `core/vigencia.ts` para `BriefPage` — acá con un campo simple porque este servicio es un
   * singleton `providedIn: 'root'` que nunca se destruye, no hace falta la vida completa de esa clase).
   *
   * **Por qué limpia `cliente()` a `null` si el id cambió**: `cliente()` es un signal COMPARTIDO
   * (singleton `providedIn: 'root'`) que sobrevive a la navegación. Si no se limpiara y el pedido de
   * un cliente NUEVO fallara (404, red), `cliente()` se quedaría con el cliente ANTERIOR — la
   * pantalla de perfil seguiría mostrando sus datos aunque la URL ya diga otro id. No se limpia
   * cuando el id es el MISMO (un card recién guardó y llama a `verCliente` para refrescar): ahí sí
   * conviene quedarse con el valor viejo mientras llega el nuevo, para no parpadear los 4 cards.
   */
  async verCliente(id: string): Promise<void> {
    this.#idVigente = id;
    if (this.#cliente()?.id !== id) this.#cliente.set(null);
    this.cargando.set(true);
    this.error.set('');
    try {
      const cliente = await this.api.verCliente(id);
      if (this.#idVigente !== id) return; // llegó tarde: ya se pidió otro cliente
      this.#cliente.set(cliente);
    } catch (e) {
      if (this.#idVigente !== id) return;
      this.error.set((e as Error).message);
    } finally {
      if (this.#idVigente === id) this.cargando.set(false);
    }
  }
}

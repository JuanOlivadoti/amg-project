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
}

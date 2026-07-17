import { Injectable, inject } from '@angular/core';
import { crearApi, type ClienteApi } from '../core/api-core';
import { AuthService } from './auth';
import { environment } from '../../environments/environment';

/**
 * Cáscara fina de Angular sobre `crearApi` (el cliente puro y testeado). No agrega lógica: solo le
 * pasa la URL base y de dónde sacar el token y el tenant (del `AuthService`). Toda la mecánica HTTP
 * —headers, parseo, errores— vive en `api-core.ts`, probada sin red.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly auth = inject(AuthService);

  private readonly cliente: ClienteApi = crearApi({
    baseUrl: environment.apiBaseUrl,
    getToken: this.auth.getToken,
    getTenant: this.auth.getTenant,
    // 401 → refrescar y reintentar (la política vive en api-core, probada). Si el refresh falla, el
    // AuthService cierra la sesión y el shell redirige al login.
    refrescar: () => this.auth.refrescar(),
  });

  readonly listarRuns = this.cliente.listarRuns;
  readonly crearRun = this.cliente.crearRun;
  readonly verBrief = this.cliente.verBrief;
  readonly aprobarPagina = this.cliente.aprobarPagina;
  readonly editarPagina = this.cliente.editarPagina;
  readonly aprobarRun = this.cliente.aprobarRun;
}

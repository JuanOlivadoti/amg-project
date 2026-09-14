import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiService } from '../../services/api';
import { ClientesService } from '../../services/clientes';
import { hojaAFilas } from '../../core/hoja-a-filas';

/**
 * Pantalla de carga de comparativas de seguros (`/clientes/:id/comparativas/cargar`).
 *
 * **De dónde sale el cliente.** El cliente ya lo carga el shell (`cliente-ficha.ts`) en
 * `ClientesService.cliente()`. Pedir `GET /clients/:id` de nuevo acá sería redundante.
 *
 * **Dos formas de mandar los datos:**
 * 1. Subir un archivo CSV/XLSX: se parsea con `hojaAFilas()` y se mandan las filas a la API.
 * 2. Pegar un link de Google Sheet: la API baja el CSV desde ese link.
 *
 * **Errores.** Todo error se PINTA en la pantalla, nunca falla en silencio:
 * - Error de `hojaAFilas` (extensión desconocida, CSV malformado): antes de mandar nada a la API.
 * - Error del servidor (400, 409, 422): del response HTTP.
 *
 * **Sin doble envío.** Mientras la petición está en vuelo, el botón se deshabilita.
 */
@Component({
  selector: 'app-comparativas-form',
  imports: [],
  template: `
    <div class="space-y-4">
      <h1 class="text-sm font-semibold text-texto">Cargar comparativa de seguros</h1>

      @if (error()) {
        <div class="bg-error-suave rounded-xl border border-borde p-6">
          <p class="text-sm text-error">{{ error() }}</p>
        </div>
      }

      <div class="bg-superficie rounded-xl border border-borde p-6 space-y-4">
        <div>
          <label class="block text-sm font-medium text-texto mb-2">Cliente final *</label>
          <input
            type="text"
            placeholder="Nombre del cliente/empresa"
            [value]="clienteFinalNombre()"
            (input)="clienteFinalNombre.set($any($event.target).value)"
            class="w-full rounded-md border border-borde bg-fondo p-2 text-sm text-texto"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-texto mb-2">Email (opcional)</label>
          <input
            type="email"
            placeholder="cliente@example.com"
            [value]="clienteFinalEmail()"
            (input)="clienteFinalEmail.set($any($event.target).value)"
            class="w-full rounded-md border border-borde bg-fondo p-2 text-sm text-texto"
          />
        </div>

        <div class="border-t border-borde pt-4">
          <p class="text-xs text-texto-tenue mb-3">Elige una opción:</p>

          <div class="space-y-2">
            <div>
              <label class="block text-sm font-medium text-texto mb-2">Archivo (.csv o .xlsx)</label>
              <input
                type="file"
                accept=".csv,.xlsx"
                (change)="seleccionarArchivo($any($event.target).files?.[0])"
                class="block w-full text-sm text-texto"
              />
              @if (archivoSeleccionado()) {
                <p class="text-xs text-texto-tenue mt-1">{{ archivoSeleccionado()?.name }}</p>
              }
            </div>

            <div class="flex items-center gap-2">
              <div class="flex-1 border-t border-borde"></div>
              <span class="text-xs text-texto-tenue">O</span>
              <div class="flex-1 border-t border-borde"></div>
            </div>

            <div>
              <label class="block text-sm font-medium text-texto mb-2">Link de Google Sheet</label>
              <input
                type="url"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                [value]="googleSheetUrl()"
                (input)="googleSheetUrl.set($any($event.target).value)"
                class="w-full rounded-md border border-borde bg-fondo p-2 text-sm text-texto"
              />
            </div>
          </div>
        </div>

        <button
          type="button"
          (click)="enviar()"
          [disabled]="enviando()"
          class="mt-4 rounded-md bg-accion text-texto-invertido px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {{ enviando() ? 'Cargando...' : 'Crear comparativa' }}
        </button>
      </div>
    </div>
  `,
})
export class ComparativasFormPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly clientesService = inject(ClientesService);
  private readonly router = inject(Router);

  readonly clienteFinalNombre = signal('');
  readonly clienteFinalEmail = signal('');
  readonly archivoSeleccionado = signal<File | null>(null);
  readonly googleSheetUrl = signal('');
  readonly enviando = signal(false);
  readonly error = signal('');

  private sub: Subscription | null = null;
  private clienteId = signal('');

  ngOnInit(): void {
    // El cliente viene del shell, así que extraemos el ID
    const cliente = this.clientesService.cliente();
    if (cliente) {
      this.clienteId.set(cliente.id);
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  seleccionarArchivo(archivo: File | undefined): void {
    if (archivo) {
      this.archivoSeleccionado.set(archivo);
      this.googleSheetUrl.set(''); // Limpiar el link si había
      this.error.set('');
    }
  }

  async enviar(): Promise<void> {
    this.error.set('');

    const nombre = this.clienteFinalNombre().trim();
    if (!nombre) {
      this.error.set('El nombre del cliente es requerido.');
      return;
    }

    const tieneArchivo = this.archivoSeleccionado() !== null;
    const tieneSheet = this.googleSheetUrl().trim() !== '';

    if (!tieneArchivo && !tieneSheet) {
      this.error.set('Debes subir un archivo o pegar un link de Google Sheet.');
      return;
    }

    if (tieneArchivo && tieneSheet) {
      this.error.set('Elige solo una opción: archivo o link de Google Sheet.');
      return;
    }

    this.enviando.set(true);

    try {
      let cuerpo:
        | { filas: string[][]; clienteFinalNombre: string; clienteFinalEmail: string | null }
        | { googleSheetUrl: string; clienteFinalNombre: string; clienteFinalEmail: string | null };

      if (tieneArchivo) {
        // Parsear el archivo
        let filas: string[][];
        try {
          filas = await hojaAFilas(this.archivoSeleccionado()!);
        } catch (e) {
          this.error.set((e as Error).message);
          return;
        }

        cuerpo = {
          filas,
          clienteFinalNombre: nombre,
          clienteFinalEmail: this.clienteFinalEmail().trim() || null,
        };
      } else {
        cuerpo = {
          googleSheetUrl: this.googleSheetUrl().trim(),
          clienteFinalNombre: nombre,
          clienteFinalEmail: this.clienteFinalEmail().trim() || null,
        };
      }

      // Mandar a la API
      const comparativa = await this.api.crearComparativa(this.clienteId(), cuerpo);

      // Navegar al detalle
      await this.router.navigate(['/clientes', this.clienteId(), 'comparativas', comparativa.id]);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.enviando.set(false);
    }
  }
}

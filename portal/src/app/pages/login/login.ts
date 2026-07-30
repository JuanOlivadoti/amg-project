import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-fondo px-4">
      <form
        (ngSubmit)="entrar()"
        class="w-full max-w-sm bg-superficie rounded-xl shadow-sm border border-borde p-8 space-y-5"
      >
        <div>
          <h1 class="text-xl font-semibold text-texto">AMG OS</h1>
          <p class="text-sm text-texto-tenue">Entrá para ver y aprobar los research.</p>
        </div>

        <label class="block">
          <span class="text-sm font-medium text-texto-medio">Email</span>
          <input
            type="email"
            [ngModel]="email()"
            (ngModelChange)="email.set($event)"
            name="email"
            autocomplete="username"
            required
            class="mt-1 w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm focus:border-accion focus:outline-none"
          />
        </label>

        <label class="block">
          <span class="text-sm font-medium text-texto-medio">Contraseña</span>
          <input
            type="password"
            [ngModel]="password()"
            (ngModelChange)="password.set($event)"
            name="password"
            autocomplete="current-password"
            required
            class="mt-1 w-full rounded-md border border-borde-fuerte bg-superficie text-texto px-3 py-2 text-sm focus:border-accion focus:outline-none"
          />
        </label>

        @if (error()) {
          <p class="text-sm text-error">{{ error() }}</p>
        }

        <button
          type="submit"
          [disabled]="cargando()"
          class="w-full rounded-md bg-accion text-texto-invertido py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {{ cargando() ? 'Entrando…' : 'Entrar' }}
        </button>
      </form>
    </div>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly email = signal('');
  readonly password = signal('');
  readonly error = signal('');
  readonly cargando = signal(false);

  async entrar(): Promise<void> {
    this.error.set('');
    this.cargando.set(true);
    try {
      await this.auth.login(this.email(), this.password());
      await this.router.navigate(['/runs']);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.cargando.set(false);
    }
  }
}

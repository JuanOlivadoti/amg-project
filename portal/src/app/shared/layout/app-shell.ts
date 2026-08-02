import { Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppSidebarComponent } from './app-sidebar';
import { AppHeaderComponent } from './app-header';
import { BackdropComponent } from './backdrop';
import { AuthService } from '../../services/auth';
import { MembresiaService } from '../../services/membresia';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, AppSidebarComponent, AppHeaderComponent, BackdropComponent],
  template: `
    <div class="min-h-screen bg-fondo text-texto">
      <app-sidebar />
      <app-backdrop />
      <div class="lg:pl-64">
        <app-header />
        <main class="p-4">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
})
export class AppShellComponent {
  private readonly auth = inject(AuthService);
  private readonly membresia = inject(MembresiaService);

  constructor() {
    // El shell envuelve TODO lo autenticado, así que es el punto donde el rol efectivo tiene que
    // estar resuelto antes de que ninguna pantalla decida qué mostrar. Va en un `effect` sobre la
    // sesión, no en una llamada suelta: tras un logout y un login con OTRO usuario, el shell no se
    // vuelve a construir, y sin esto el segundo heredaría el rol del primero.
    effect(() => {
      if (this.auth.sesion()) void this.membresia.resolver();
    });
  }
}

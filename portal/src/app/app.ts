import { Component, effect, inject } from '@angular/core';
import { RouterOutlet, RouterLink, Router } from '@angular/router';
import { AuthService } from './services/auth';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  constructor() {
    // Si la sesión cae ESTANDO en una pantalla (el refresh falló, el token se revocó), el guard no
    // se entera —no hay navegación—. El effect sí: al quedar sin sesión, al login. En `/login` ya
    // estando deslogueado, navegar es un no-op.
    effect(() => {
      if (!this.auth.autenticado()) void this.router.navigate(['/login']);
    });
  }

  async salir(): Promise<void> {
    this.auth.logout();
    await this.router.navigate(['/login']);
  }
}

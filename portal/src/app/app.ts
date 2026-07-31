import { Component, effect, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
})
export class App {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  constructor() {
    // Si la sesión cae ESTANDO en una pantalla (el refresh falló, el token se revocó), el guard no
    // se entera —no hay navegación—. El effect sí: al quedar sin sesión, al login. En `/login` ya
    // estando deslogueado, navegar es un no-op.
    effect(() => {
      if (!this.auth.autenticado()) void this.router.navigate(['/login']);
    });
  }
}

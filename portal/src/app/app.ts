import { Component, effect, inject } from '@angular/core';
import { RouterOutlet, RouterLink, Router } from '@angular/router';
import { AuthService } from './services/auth';
import { TemaService } from './services/tema';
import type { Tema } from './core/tema';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly auth = inject(AuthService);
  readonly tema = inject(TemaService);
  private readonly router = inject(Router);

  /**
   * El icono tiene que decir en qué posición está el botón, no qué va a hacer si lo toco: son tres
   * estados, y "auto" no se adivina. El `aria-label` lo dice con palabras, que es lo que lee un
   * lector de pantalla y lo que aparece en el tooltip.
   */
  /**
   * `︎` es el selector de variación TEXTO. Sin él, el navegador pinta U+2600 como **emoji de
   * color** —un sol naranja— que ignora `text-texto-tenue` y no cambia con el tema. Se vio en el
   * navegador, no en un test: el typecheck no mira glifos. `◐` y `☾` no tienen forma emoji, así que
   * no lo necesitan.
   */
  readonly ICONO: Record<Tema, string> = { auto: '◐', claro: '☀︎', oscuro: '☾' };
  readonly ETIQUETA: Record<Tema, string> = {
    auto: 'Tema: automático (sigue al sistema). Tocar para pasar a claro',
    claro: 'Tema: claro. Tocar para pasar a oscuro',
    oscuro: 'Tema: oscuro. Tocar para volver a automático',
  };

  constructor() {
    // Si la sesión cae ESTANDO en una pantalla (el refresh falló, el token se revocó), el guard no
    // se entera —no hay navegación—. El effect sí: al quedar sin sesión, al login. En `/login` ya
    // estando deslogueado, navegar es un no-op.
    effect(() => {
      if (!this.auth.autenticado()) void this.router.navigate(['/login']);
    });
  }

  async salir(): Promise<void> {
    void this.auth.logout();
    await this.router.navigate(['/login']);
  }
}

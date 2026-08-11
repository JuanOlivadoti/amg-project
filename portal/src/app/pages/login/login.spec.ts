import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { LoginPage } from './login';
import { AuthService } from '../../services/auth';

/**
 * Test de componente (Karma) de `/login`. Lo que fija es la **única decisión** que esta pantalla
 * toma y que no se ve en su template: a dónde deja al usuario cuando las credenciales son buenas.
 *
 * Nació de un defecto real: al retirar la lista global de runs se cambiaron los dos `redirectTo` de
 * `app.routes.ts` y se dejó el login navegando a `/runs`, una ruta ya inexistente. Aterrizaba bien
 * igual porque el comodín `**` la recogía — el destino correcto por accidente del catch-all, con
 * cero tests mirando. El complemento de este spec vive en `app.routes.test.ts`
 * («el login aterriza en la HOME declarada»), que ata este destino al `redirectTo` de la home: acá
 * se fija el COMPORTAMIENTO (navega, y solo si el login salió bien), allá la COHERENCIA con las
 * rutas. Las dos mitades hacen falta: un spec que compare contra `'/clientes'` escrito a mano se
 * queda verde cuando la home se muda.
 *
 * `NgForm` cablea los value accessors en un microtask, así que hay un `whenStable()` antes de tocar
 * los campos — mismo motivo, explicado largo, que en `cliente-crear.spec.ts`.
 */
async function montar(login: jasmine.Spy): Promise<{
  fixture: ComponentFixture<LoginPage>;
  el: HTMLElement;
  router: Router;
}> {
  TestBed.configureTestingModule({
    imports: [LoginPage],
    providers: [provideRouter([]), { provide: AuthService, useValue: { login } }],
  });
  const fixture = TestBed.createComponent(LoginPage);
  const router = TestBed.inject(Router);
  spyOn(router, 'navigate').and.resolveTo(true);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement, router };
}

function escribir(el: HTMLElement, name: string, valor: string): void {
  const campo = el.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  expect(campo).withContext(`no encontré el input ${name}`).not.toBeNull();
  campo!.value = valor;
  campo!.dispatchEvent(new Event('input'));
}

async function entrar(fixture: ComponentFixture<LoginPage>, el: HTMLElement): Promise<void> {
  escribir(el, 'email', 'ana@amg.es');
  escribir(el, 'password', 'secreta');
  fixture.detectChanges();
  await fixture.whenStable();

  el.querySelector('form')!.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
  await fixture.whenStable();
  // Un render más DESPUÉS de estabilizar: el `catch` que escribe el error corre en un microtask
  // posterior al submit, y sin este pase la pantalla se queda en «Entrando…» y el error no se pinta.
  fixture.detectChanges();
}

describe('LoginPage', () => {
  it('🔴 entrar aterriza en la home del portal (/clientes), no en la ruta retirada /runs', async () => {
    const login = jasmine.createSpy('login').and.resolveTo(undefined);
    const { fixture, el, router } = await montar(login);

    await entrar(fixture, el);

    expect(login).toHaveBeenCalledWith('ana@amg.es', 'secreta');
    expect(router.navigate).toHaveBeenCalledWith(['/clientes']);
  });

  it('si el login falla no navega a ningún lado y muestra el error en pantalla', async () => {
    // La otra mitad del contrato: sin esto, «navega a /clientes» se podría cumplir navegando SIEMPRE
    // —incluido con las credenciales mal— y el usuario entraría al portal sin sesión.
    const login = jasmine.createSpy('login').and.rejectWith(new Error('Credenciales inválidas'));
    const { fixture, el, router } = await montar(login);

    await entrar(fixture, el);

    expect(router.navigate).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Credenciales inválidas');
  });
});

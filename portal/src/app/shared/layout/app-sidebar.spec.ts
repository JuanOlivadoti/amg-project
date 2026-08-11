import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppSidebarComponent } from './app-sidebar';
import { SidebarService } from '../services/sidebar';

describe('AppSidebarComponent', () => {
  function render() {
    TestBed.configureTestingModule({
      imports: [AppSidebarComponent],
      providers: [
        provideRouter([
          { path: 'cartera', children: [] },
          { path: 'clientes', children: [] },
          { path: 'usuarios', children: [] },
        ]),
      ],
    });
    const fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renderiza los ítems de navegación', () => {
    const el = render().nativeElement as HTMLElement;
    // Research YA NO está: el research de un cliente se alcanza desde su ficha, no desde el menú.
    expect(el.textContent).not.toContain('Research');
    expect(el.textContent).toContain('Cartera');
    expect(el.textContent).toContain('Clientes');
    expect(el.textContent).toContain('Usuarios');
  });

  it('el ítem de Usuarios apunta a /usuarios y NO se oculta por rol', () => {
    // Ocultar un link no es autorización, y mostrarlo no filtra nada: la pantalla se defiende sola
    // (un rol `cliente` que entre ve una sola fila, la suya, porque eso deja pasar la vista
    // `membresias_perfil`). Si algún día se decide ocultarlo, tiene que ser ADEMÁS de proteger la
    // ruta en el servidor, nunca en vez de.
    const el = render().nativeElement as HTMLElement;
    const enlaces = [...el.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(enlaces).toContain('/usuarios');
  });

  it('clickear un ítem cierra el drawer mobile', () => {
    const fixture = render();
    const sidebar = TestBed.inject(SidebarService);
    sidebar.alternarMobile();
    expect(sidebar.mobileAbierto()).toBe(true);
    (fixture.nativeElement as HTMLElement)
      .querySelector('a')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(sidebar.mobileAbierto()).toBe(false);
  });
});

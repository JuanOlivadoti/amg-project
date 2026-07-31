import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppHeaderComponent } from './app-header';
import { AuthService } from '../../services/auth';
import { SidebarService } from '../services/sidebar';

describe('AppHeaderComponent', () => {
  function render(autenticado: boolean) {
    TestBed.configureTestingModule({
      imports: [AppHeaderComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            autenticado: () => autenticado,
            email: () => 'ana@amg.test',
            logout: async () => {},
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(AppHeaderComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('autenticado: muestra el email y el botón Salir', () => {
    const el = render(true).nativeElement as HTMLElement;
    expect(el.textContent).toContain('ana@amg.test');
    expect(el.textContent).toContain('Salir');
  });

  it('no autenticado: no muestra email ni Salir', () => {
    const el = render(false).nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('ana@amg.test');
    expect(el.textContent).not.toContain('Salir');
  });

  it('el botón de menú alterna el drawer mobile', () => {
    const fixture = render(true);
    const sidebar = TestBed.inject(SidebarService);
    expect(sidebar.mobileAbierto()).toBe(false);
    (fixture.nativeElement as HTMLElement).querySelector('button[aria-label="Abrir menú"]')!.dispatchEvent(new MouseEvent('click'));
    expect(sidebar.mobileAbierto()).toBe(true);
  });
});

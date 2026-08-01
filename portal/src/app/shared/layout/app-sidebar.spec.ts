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
          { path: 'runs', children: [] },
          { path: 'cartera', children: [] },
          { path: 'clientes', children: [] },
        ]),
      ],
    });
    const fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renderiza los ítems de navegación', () => {
    const el = render().nativeElement as HTMLElement;
    expect(el.textContent).toContain('Research');
    expect(el.textContent).toContain('Cartera');
    expect(el.textContent).toContain('Clientes');
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

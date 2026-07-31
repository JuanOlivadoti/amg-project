import { TestBed } from '@angular/core/testing';
import { BackdropComponent } from './backdrop';
import { SidebarService } from '../services/sidebar';

describe('BackdropComponent', () => {
  function render() {
    TestBed.configureTestingModule({ imports: [BackdropComponent] });
    const fixture = TestBed.createComponent(BackdropComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('con el drawer cerrado, no renderiza nada', () => {
    const fixture = render();
    expect((fixture.nativeElement as HTMLElement).querySelector('div')).toBeNull();
  });

  it('con el drawer abierto, renderiza el overlay', () => {
    const fixture = render();
    TestBed.inject(SidebarService).alternarMobile();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('div')).not.toBeNull();
  });

  it('clickear el overlay cierra el drawer', () => {
    const fixture = render();
    const sidebar = TestBed.inject(SidebarService);
    sidebar.alternarMobile();
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector('div')!.dispatchEvent(new MouseEvent('click'));
    expect(sidebar.mobileAbierto()).toBe(false);
  });
});

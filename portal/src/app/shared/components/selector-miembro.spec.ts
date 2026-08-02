import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SelectorMiembroComponent } from './selector-miembro';
import { MembresiaService } from '../../services/membresia';
import type { Miembro } from '../../core/models';

/**
 * El selector que cierra el pendiente de la pieza 1 (el `<input>` donde había que pegar un uuid).
 *
 * Lo que se prueba con más cuidado es el caso incómodo: un valor guardado que NO está en la lista.
 * Un `<select>` que simplemente no tuviera esa opción caería a `''` y el siguiente guardado borraría
 * el responsable sin que nadie lo pidiera.
 */

function miembro(userId: string, nombre: string | null, email: string | null): Miembro {
  return {
    id: `m-${userId}`,
    tenant_id: 't1',
    user_id: userId,
    rol: 'equipo',
    client_id: null,
    created_at: '2026-08-02T00:00:00Z',
    email,
    raw_app_meta_data: nombre ? { name: nombre } : null,
  };
}

@Component({
  imports: [SelectorMiembroComponent],
  template: `<app-selector-miembro
    idCampo="campo-prueba"
    [valor]="valor()"
    (cambio)="ultimo.set($event)"
  />`,
})
class Anfitrion {
  readonly valor = signal('');
  readonly ultimo = signal<string | null>(null);
}

describe('SelectorMiembroComponent', () => {
  function render(miembros: Miembro[], valor = '') {
    TestBed.configureTestingModule({
      imports: [Anfitrion],
      providers: [{ provide: MembresiaService, useValue: { miembros: signal<readonly Miembro[]>(miembros) } }],
    });
    const fixture = TestBed.createComponent(Anfitrion);
    fixture.componentInstance.valor.set(valor);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const opciones = (el: HTMLElement) =>
    [...el.querySelectorAll('option')].map((o) => ({ valor: o.getAttribute('value'), texto: o.textContent?.trim() }));

  it('lista a los miembros con nombre y email, más la opción vacía', () => {
    const { el } = render([miembro('u1', 'Ana', 'ana@x.test'), miembro('u2', 'Beto', 'beto@x.test')]);
    expect(opciones(el)).toEqual([
      { valor: '', texto: '— Sin asignar —' },
      { valor: 'u1', texto: 'Ana · ana@x.test' },
      { valor: 'u2', texto: 'Beto · beto@x.test' },
    ]);
  });

  it('sin nombre ni email cae al uuid, nunca a un texto inventado', () => {
    const { el } = render([miembro('u-abc', null, null)]);
    expect(opciones(el)[1]).toEqual({ valor: 'u-abc', texto: 'u-abc' });
  });

  it('🔴 un valor guardado que no está en la lista se CONSERVA, no se pierde en silencio', () => {
    // Pasa de verdad: una membresía que se quitó, o un rol `cliente` que solo se ve a sí mismo. Sin
    // esta opción, abrir el formulario y guardar sin tocar el campo borraría al responsable.
    const { el } = render([miembro('u1', 'Ana', 'ana@x.test')], 'u-desconocido');
    const vals = opciones(el).map((o) => o.valor);
    expect(vals).toContain('u-desconocido');
    expect(el.querySelector<HTMLSelectElement>('#campo-prueba')!.value).toBe('u-desconocido');
  });

  it('emite el user_id elegido', () => {
    const { fixture, el } = render([miembro('u1', 'Ana', 'ana@x.test')]);
    const select = el.querySelector<HTMLSelectElement>('#campo-prueba')!;
    select.value = 'u1';
    select.dispatchEvent(new Event('change'));
    expect(fixture.componentInstance.ultimo()).toBe('u1');
  });

  it('emite cadena vacía al volver a "sin asignar"', () => {
    const { fixture, el } = render([miembro('u1', 'Ana', 'ana@x.test')], 'u1');
    const select = el.querySelector<HTMLSelectElement>('#campo-prueba')!;
    select.value = '';
    select.dispatchEvent(new Event('change'));
    expect(fixture.componentInstance.ultimo()).toBe('');
  });
});

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClienteContenidoCardComponent } from './cliente-contenido-card';
import { ApiService } from '../../services/api';
import type { ClienteAgencia, Contenido } from '../../core/models';

/**
 * Test de componente (Karma) del sexto card de `/clientes/:id/perfil` (Bloque E, última pieza). Mismo
 * criterio que `cliente-seguros-card.spec.ts`: componente anfitrión que envuelve al card real con
 * `[cliente]`, se afirma sobre el DOM renderizado, y se mockea `ApiService` (no `ClientesService`)
 * porque este card carga su propio dato con `GET`/`PATCH /clients/:id/contenido`.
 */
function clienteDePrueba(overrides: Partial<ClienteAgencia> = {}): ClienteAgencia {
  return {
    id: 'c1',
    nombre: 'Pizza Nonna',
    vertical: 'restauracion',
    tipo: null,
    industria: null,
    etiquetas: null,
    nivel_actividad: null,
    estado_contrato: null,
    contrato_vence_en: null,
    score: null,
    asignado_a: null,
    contacto: null,
    origen: null,
    google_conectado_en: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function contenidoVacio(): Contenido {
  return { bienvenida: '', destacados: [], testimonios: [] };
}

@Component({
  imports: [ClienteContenidoCardComponent],
  template: `<app-cliente-contenido-card [cliente]="cliente()" />`,
})
class Anfitrion {
  readonly cliente = signal<ClienteAgencia>(clienteDePrueba());
}

function crear(
  opciones: {
    obtenerContenido?: jasmine.Spy;
    actualizarContenido?: jasmine.Spy;
  } = {},
) {
  const obtenerContenidoSpy =
    opciones.obtenerContenido ?? jasmine.createSpy('obtenerContenido').and.resolveTo(contenidoVacio());
  const actualizarContenidoSpy =
    opciones.actualizarContenido ?? jasmine.createSpy('actualizarContenido').and.resolveTo(undefined);

  TestBed.configureTestingModule({
    imports: [Anfitrion],
    providers: [
      {
        provide: ApiService,
        useValue: {
          obtenerContenido: obtenerContenidoSpy,
          actualizarContenido: actualizarContenidoSpy,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(Anfitrion);
  return { fixture, obtenerContenidoSpy, actualizarContenidoSpy };
}

async function estabilizar(fixture: ComponentFixture<Anfitrion>): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

function boton(el: HTMLElement, texto: string): HTMLButtonElement | undefined {
  return Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.trim() === texto);
}

function botones(el: HTMLElement, texto: string): HTMLButtonElement[] {
  return Array.from(el.querySelectorAll('button')).filter((b) => b.textContent!.trim() === texto);
}

describe('ClienteContenidoCardComponent', () => {
  it('carga y muestra bienvenida, destacados y testimonios existentes', async () => {
    const contenido: Contenido = {
      bienvenida: 'Bienvenidos a Pizza Nonna.',
      destacados: [{ titulo: 'Horno de leña', texto: 'Desde 1987.' }],
      testimonios: [{ texto: 'La mejor pizza de Madrid.', autor: 'Marta G.' }],
    };
    const { fixture, obtenerContenidoSpy } = crear({
      obtenerContenido: jasmine.createSpy('obtenerContenido').and.resolveTo(contenido),
    });
    const el = await estabilizar(fixture);

    expect(obtenerContenidoSpy).toHaveBeenCalledWith('c1');
    expect(el.textContent).toContain('Bienvenidos a Pizza Nonna.');
    expect(el.textContent).toContain('Horno de leña');
    expect(el.textContent).toContain('Desde 1987.');
    expect(el.textContent).toContain('La mejor pizza de Madrid.');
    expect(el.textContent).toContain('Marta G.');
  });

  it('muestra "Cargando…" mientras la promesa de obtenerContenido sigue en vuelo', async () => {
    let resolver!: (c: Contenido) => void;
    const pendiente = new Promise<Contenido>((r) => (resolver = r));
    const { fixture } = crear({
      obtenerContenido: jasmine.createSpy('obtenerContenido').and.returnValue(pendiente),
    });

    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Cargando');

    resolver(contenidoVacio());
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Cargando');
  });

  it('agrega y quita un destacado antes de guardar', async () => {
    const { fixture, actualizarContenidoSpy } = crear();
    const el = await estabilizar(fixture);

    boton(el, 'Editar')!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    boton(el, '+ agregar destacado')!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    let titulo = el.querySelector<HTMLInputElement>('[name="destacado0Titulo"]');
    expect(titulo).withContext('no encontré el input de título del destacado 0').not.toBeNull();
    titulo!.value = 'Horno de leña';
    titulo!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    // Segundo destacado, que después se quita: si sobreviviera al guardado, el PATCH llevaría dos.
    boton(el, '+ agregar destacado')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelectorAll('[name="destacado1Titulo"]').length).toBe(1);

    botones(el, 'Quitar')[1]!.click(); // el segundo "Quitar" de la lista es el del destacado 1
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector('[name="destacado1Titulo"]')).withContext('el destacado 1 debería haberse quitado').toBeNull();

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(actualizarContenidoSpy).toHaveBeenCalledWith('c1', {
      bienvenida: '',
      destacados: [{ titulo: 'Horno de leña' }],
      testimonios: [],
    });
  });

  it('agrega y quita un testimonio antes de guardar', async () => {
    const { fixture, actualizarContenidoSpy } = crear();
    const el = await estabilizar(fixture);

    boton(el, 'Editar')!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    boton(el, '+ agregar testimonio')!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const texto = el.querySelector<HTMLInputElement>('[name="testimonio0Texto"]');
    const autor = el.querySelector<HTMLInputElement>('[name="testimonio0Autor"]');
    expect(texto).withContext('no encontré el input de texto del testimonio 0').not.toBeNull();
    texto!.value = 'La mejor pizza de Madrid.';
    texto!.dispatchEvent(new Event('input'));
    autor!.value = 'Marta G.';
    autor!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    // Segundo testimonio, que después se quita.
    boton(el, '+ agregar testimonio')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    botones(el, 'Quitar')[1]!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector('[name="testimonio1Texto"]')).withContext('el testimonio 1 debería haberse quitado').toBeNull();

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(actualizarContenidoSpy).toHaveBeenCalledWith('c1', {
      bienvenida: '',
      destacados: [],
      testimonios: [{ texto: 'La mejor pizza de Madrid.', autor: 'Marta G.' }],
    });
  });

  it('guarda las tres claves juntas, incluida bienvenida, y vuelve a la vista de lectura', async () => {
    const { fixture, actualizarContenidoSpy } = crear();
    const el = await estabilizar(fixture);

    boton(el, 'Editar')!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const bienvenida = el.querySelector<HTMLTextAreaElement>('#contenido-bienvenida');
    expect(bienvenida).withContext('no encontré #contenido-bienvenida en modo edición').not.toBeNull();
    bienvenida!.value = 'Bienvenidos a Pizza Nonna.';
    bienvenida!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    const form = el.querySelector('form');
    expect(form).not.toBeNull();
    form!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(actualizarContenidoSpy).toHaveBeenCalledWith('c1', {
      bienvenida: 'Bienvenidos a Pizza Nonna.',
      destacados: [],
      testimonios: [],
    });
    // Guardar exitoso cierra la edición y vuelve a la vista de lectura, mismo criterio que Seguros.
    fixture.detectChanges();
    expect(el.querySelector('form')).toBeNull();
  });

  it('una fila de destacado sin título se descarta en silencio al guardar, no se manda vacía', async () => {
    const { fixture, actualizarContenidoSpy } = crear();
    const el = await estabilizar(fixture);

    boton(el, 'Editar')!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    boton(el, '+ agregar destacado')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    // No se completa el título: la fila queda vacía.

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(actualizarContenidoSpy).toHaveBeenCalledWith('c1', {
      bienvenida: '',
      destacados: [],
      testimonios: [],
    });
  });

  // Codex review 2026-08-31 (hallazgo 1, contra cliente-seguros-card.ts): el guard `idVigente`
  // protegía la carga pero no el estado de edición ni el guardado. Angular reutiliza la instancia del
  // componente al navegar entre dos clientes, así que este card lleva la misma defensa desde el
  // principio — se verifica acá con la misma mutación que allá.

  it('🔴 cambiar de cliente mientras se edita descarta el formulario del anterior', async () => {
    const contenidoA: Contenido = { bienvenida: 'Bienvenida A', destacados: [], testimonios: [] };
    const contenidoB: Contenido = { bienvenida: 'Bienvenida B', destacados: [], testimonios: [] };
    const obtenerContenidoSpy = jasmine
      .createSpy('obtenerContenido')
      .and.callFake((id: string) => Promise.resolve(id === 'c1' ? contenidoA : contenidoB));
    const { fixture } = crear({ obtenerContenido: obtenerContenidoSpy });
    const el = await estabilizar(fixture);

    boton(el, 'Editar')!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const bienvenida = el.querySelector<HTMLTextAreaElement>('#contenido-bienvenida');
    bienvenida!.value = 'EDITANDO-A-SIN-GUARDAR';
    bienvenida!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('form')).withContext('debe estar en modo edición antes de cambiar de cliente').not.toBeNull();

    fixture.componentInstance.cliente.set(clienteDePrueba({ id: 'c2', nombre: 'Otro cliente' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('form')).withContext('el formulario de A no debe sobrevivir al cambio de cliente').toBeNull();
    expect(el.textContent).toContain('Bienvenida B');
    expect(el.textContent).not.toContain('EDITANDO-A-SIN-GUARDAR');
  });

  it('🔴 un PATCH pendiente del cliente anterior no debe alterar el contenido ni el error del actual', async () => {
    const contenidoA: Contenido = { bienvenida: 'Bienvenida A', destacados: [], testimonios: [] };
    const contenidoB: Contenido = { bienvenida: 'Bienvenida B', destacados: [], testimonios: [] };
    let resolverPatchA!: () => void;
    const patchAPendiente = new Promise<void>((r) => (resolverPatchA = r));
    const obtenerContenidoSpy = jasmine
      .createSpy('obtenerContenido')
      .and.callFake((id: string) => Promise.resolve(id === 'c1' ? contenidoA : contenidoB));
    const actualizarContenidoSpy = jasmine
      .createSpy('actualizarContenido')
      .and.callFake((id: string) => (id === 'c1' ? patchAPendiente : Promise.resolve(undefined)));
    const { fixture } = crear({
      obtenerContenido: obtenerContenidoSpy,
      actualizarContenido: actualizarContenidoSpy,
    });
    const el = await estabilizar(fixture);

    boton(el, 'Editar')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    el.querySelector('form')!.dispatchEvent(new Event('submit')); // guardar() de A arranca, el PATCH queda pendiente
    fixture.detectChanges();

    fixture.componentInstance.cliente.set(clienteDePrueba({ id: 'c2', nombre: 'Otro cliente' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.textContent).toContain('Bienvenida B');
    expect(el.querySelector('form')).withContext('B no debe quedar en modo edición por el submit de A').toBeNull();

    resolverPatchA();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.textContent).toContain('Bienvenida B');
    expect(el.textContent).not.toContain('Bienvenida A');
    expect(el.querySelector('.text-error')).withContext('la resolución tardía de A no debe mostrar error sobre B').toBeNull();
  });
});

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClienteSegurosCardComponent } from './cliente-seguros-card';
import { ApiService } from '../../services/api';
import type { ClienteAgencia, PerfilSeguros } from '../../core/models';

/**
 * Test de componente (Karma) del quinto card de `/clientes/:id/perfil` (Task 14). A diferencia de
 * los otros 4 cards —que se prueban solo indirectamente vía `cliente-perfil.spec.ts`, mockeando
 * `ClientesService`— este SÍ tiene su propio spec, porque el brief lo pide explícito (carga su propio
 * dato contra `ApiService`, no algo que ya venga en `ClienteAgencia`).
 *
 * Mismo patrón "componente anfitrión" que `selector-miembro.spec.ts`: envuelve al card real con
 * `[cliente]` para ejercitar el `input()` como lo hace `cliente-perfil.ts`, y se afirma sobre el DOM
 * renderizado (texto, `#id` de los inputs), nunca sobre campos internos de la clase.
 */
function clienteDePrueba(overrides: Partial<ClienteAgencia> = {}): ClienteAgencia {
  return {
    id: 'c1',
    nombre: 'Correduría Ejemplo',
    vertical: 'correduria_seguros',
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

@Component({
  imports: [ClienteSegurosCardComponent],
  template: `<app-cliente-seguros-card [cliente]="cliente()" />`,
})
class Anfitrion {
  readonly cliente = signal<ClienteAgencia>(clienteDePrueba());
}

function crear(
  opciones: {
    obtenerPerfilSeguros?: jasmine.Spy;
    actualizarPerfilSeguros?: jasmine.Spy;
  } = {},
) {
  const obtenerPerfilSegurosSpy =
    opciones.obtenerPerfilSeguros ?? jasmine.createSpy('obtenerPerfilSeguros').and.resolveTo(null);
  const actualizarPerfilSegurosSpy =
    opciones.actualizarPerfilSeguros ?? jasmine.createSpy('actualizarPerfilSeguros').and.resolveTo(undefined);

  TestBed.configureTestingModule({
    imports: [Anfitrion],
    providers: [
      {
        provide: ApiService,
        useValue: {
          obtenerPerfilSeguros: obtenerPerfilSegurosSpy,
          actualizarPerfilSeguros: actualizarPerfilSegurosSpy,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(Anfitrion);
  return { fixture, obtenerPerfilSegurosSpy, actualizarPerfilSegurosSpy };
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

describe('ClienteSegurosCardComponent', () => {
  it('carga y muestra los tres campos existentes', async () => {
    const perfil: PerfilSeguros = { numeroLicencia: 'J-1479', anosExperiencia: 35, redAfiliacion: 'E2K' };
    const { fixture, obtenerPerfilSegurosSpy } = crear({
      obtenerPerfilSeguros: jasmine.createSpy('obtenerPerfilSeguros').and.resolveTo(perfil),
    });
    const el = await estabilizar(fixture);

    expect(obtenerPerfilSegurosSpy).toHaveBeenCalledWith('c1');
    expect(el.textContent).toContain('J-1479');
    expect(el.textContent).toContain('35');
    expect(el.textContent).toContain('E2K');
  });

  it('muestra "Cargando…" mientras la promesa de obtenerPerfilSeguros sigue en vuelo', async () => {
    let resolver!: (p: PerfilSeguros | null) => void;
    const pendiente = new Promise<PerfilSeguros | null>((r) => (resolver = r));
    const { fixture } = crear({
      obtenerPerfilSeguros: jasmine.createSpy('obtenerPerfilSeguros').and.returnValue(pendiente),
    });

    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Cargando');

    resolver(null);
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Cargando');
  });

  it('guarda los tres campos al enviar', async () => {
    const { fixture, actualizarPerfilSegurosSpy } = crear();
    const el = await estabilizar(fixture);

    const botonEditar = boton(el, 'Editar');
    expect(botonEditar).withContext('no encontré el botón "Editar"').toBeDefined();
    botonEditar!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const numeroLicencia = el.querySelector<HTMLInputElement>('#seguros-numero-licencia');
    const anosExperiencia = el.querySelector<HTMLInputElement>('#seguros-anos-experiencia');
    const redAfiliacion = el.querySelector<HTMLInputElement>('#seguros-red-afiliacion');
    expect(numeroLicencia).withContext('no encontré #seguros-numero-licencia en modo edición').not.toBeNull();
    expect(anosExperiencia).withContext('no encontré #seguros-anos-experiencia en modo edición').not.toBeNull();
    expect(redAfiliacion).withContext('no encontré #seguros-red-afiliacion en modo edición').not.toBeNull();

    numeroLicencia!.value = 'J-1479';
    numeroLicencia!.dispatchEvent(new Event('input'));
    anosExperiencia!.value = '35';
    anosExperiencia!.dispatchEvent(new Event('input'));
    redAfiliacion!.value = 'E2K';
    redAfiliacion!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    const form = el.querySelector('form');
    expect(form).not.toBeNull();
    form!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(actualizarPerfilSegurosSpy).toHaveBeenCalledWith('c1', {
      numeroLicencia: 'J-1479',
      anosExperiencia: 35,
      redAfiliacion: 'E2K',
    });
    // Guardar exitoso cierra la edición y vuelve a la vista de lectura, mismo criterio que los otros cards.
    fixture.detectChanges();
    expect(el.querySelector('form')).toBeNull();
  });
});

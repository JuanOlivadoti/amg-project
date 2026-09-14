import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { ComparativasFormPage } from './form';
import { ApiService } from '../../services/api';
import { ClientesService } from '../../services/clientes';
import type { ClienteAgencia, ComparativaSeguros } from '../../core/models';

/**
 * Test de componente (Karma) de la pantalla de carga de comparativas de seguros.
 * Patrón como `cliente-resenas.spec.ts`: componente montado directo, dobles con signals.
 */
function clienteDePrueba(overrides: Partial<ClienteAgencia> = {}): ClienteAgencia {
  return {
    id: 'c1',
    nombre: 'Seguros MiCasa',
    vertical: 'correduria_seguros',
    tipo: 'empresa',
    industria: 'seguros',
    etiquetas: null,
    nivel_actividad: 'alto',
    estado_contrato: 'vigente',
    contrato_vence_en: null,
    score: 80,
    asignado_a: null,
    contacto: null,
    origen: null,
    google_conectado_en: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function comparativaDePrueba(overrides: Partial<ComparativaSeguros> = {}): ComparativaSeguros {
  return {
    id: 'cmp1',
    clientId: 'c1',
    creadoPor: 'user1',
    clienteFinalNombre: 'Juan Pérez',
    clienteFinalEmail: 'juan@example.com',
    opciones: [
      {
        aseguradora: 'Seguros XYZ',
        producto: 'Hogar Básico',
        prima: 50,
        cobertura: 'Incendio y robo',
        condiciones: null,
        notas: null,
      },
    ],
    recomendacion: 'Seguros XYZ es la mejor opción.',
    informeMd: '# Análisis de comparativas',
    mailAsunto: 'Tu comparativa de seguros',
    mailCuerpoMd: 'Aquí va tu comparativa.',
    costoUsd: 1.5,
    revisadoEn: null,
    revisadoPor: null,
    createdAt: '2026-09-12T00:00:00.000Z',
    ...overrides,
  };
}

function crear(
  opciones: {
    cliente?: ClienteAgencia | null;
    crearComparativa?: jasmine.Spy;
    router?: Partial<Router>;
  } = {},
) {
  const crearComparativaSpy =
    opciones.crearComparativa ??
    jasmine.createSpy('crearComparativa').and.resolveTo(comparativaDePrueba());
  const routerSpy = opciones.router ?? {
    navigate: jasmine.createSpy('navigate').and.resolveTo(true),
  };
  const cliente = opciones.cliente === undefined ? clienteDePrueba() : opciones.cliente;

  TestBed.configureTestingModule({
    imports: [ComparativasFormPage],
    providers: [
      {
        provide: ApiService,
        useValue: {
          crearComparativa: crearComparativaSpy,
        },
      },
      {
        provide: ClientesService,
        useValue: {
          cliente: signal(cliente),
        },
      },
      {
        provide: Router,
        useValue: routerSpy,
      },
    ],
  });

  const fixture = TestBed.createComponent(ComparativasFormPage);
  fixture.detectChanges();

  return { fixture, crearComparativaSpy, routerSpy };
}

describe('ComparativasFormPage', () => {
  it('con Google Sheet URL, navega a la comparativa tras éxito', async () => {
    const comparativaCreada = comparativaDePrueba({ id: 'cmp-nuevo' });
    const { fixture, crearComparativaSpy, routerSpy } = crear({
      crearComparativa: jasmine.createSpy('crearComparativa').and.resolveTo(comparativaCreada),
    });
    const component = fixture.componentInstance;

    component.clienteFinalNombre.set('Juan Pérez');
    component.googleSheetUrl.set('https://docs.google.com/spreadsheets/d/1abc/export?format=csv');

    await component.enviar();
    fixture.detectChanges();

    expect(crearComparativaSpy).toHaveBeenCalled();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/clientes', 'c1', 'comparativas', 'cmp-nuevo']);
  });

  it('un error del servidor se PINTA, no falla en silencio', async () => {
    const { fixture, crearComparativaSpy, routerSpy } = crear({
      crearComparativa: jasmine.createSpy('crearComparativa').and.rejectWith(
        Object.assign(new Error('El cliente no es de correduría de seguros.'), { status: 409 }),
      ),
    });
    const component = fixture.componentInstance;

    component.clienteFinalNombre.set('Juan Pérez');
    component.googleSheetUrl.set('https://docs.google.com/spreadsheets/d/1abc/export?format=csv');

    await component.enviar();
    fixture.detectChanges();

    // El error debe estar en el signal
    expect(component.error()).toBe('El cliente no es de correduría de seguros.');
    // Y NO debe haber navegado
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  it('mientras la petición está en vuelo, el botón se deshabilita', async () => {
    let resolver: (value: ComparativaSeguros) => void;
    const { fixture } = crear({
      crearComparativa: jasmine
        .createSpy('crearComparativa')
        .and.returnValue(new Promise((resolve) => (resolver = resolve))),
    });
    const component = fixture.componentInstance;

    component.clienteFinalNombre.set('Juan Pérez');
    component.googleSheetUrl.set('https://docs.google.com/spreadsheets/d/1abc/export?format=csv');

    // Inicia el envío pero no espera
    const promesa = component.enviar();
    fixture.detectChanges();

    // Mientras está en vuelo, enviando debe ser true
    expect(component.enviando()).toBe(true);

    // Resuelve la promesa
    resolver!(comparativaDePrueba());
    await promesa;
    fixture.detectChanges();

    // Ahora debe ser false
    expect(component.enviando()).toBe(false);
  });

  it('se requiere nombre de cliente', async () => {
    const { fixture, crearComparativaSpy } = crear();
    const component = fixture.componentInstance;

    component.clienteFinalNombre.set('');
    component.googleSheetUrl.set('https://example.com/sheet');

    await component.enviar();
    fixture.detectChanges();

    expect(component.error()).toContain('nombre');
    expect(crearComparativaSpy).not.toHaveBeenCalled();
  });

  it('🔴 escribir un link de Google Sheet limpia el archivo seleccionado (XOR simétrico)', () => {
    const { fixture } = crear();
    const component = fixture.componentInstance;
    const archivo = new File(['a,b'], 'datos.csv', { type: 'text/csv' });

    component.seleccionarArchivo(archivo);
    expect(component.archivoSeleccionado()).toBe(archivo);

    component.seleccionarGoogleSheetUrl('https://docs.google.com/spreadsheets/d/1abc');

    expect(component.archivoSeleccionado()).toBeNull();
    expect(component.googleSheetUrl()).toBe('https://docs.google.com/spreadsheets/d/1abc');
  });

  it('escribir un valor vacío en el link NO limpia el archivo seleccionado', () => {
    const { fixture } = crear();
    const component = fixture.componentInstance;
    const archivo = new File(['a,b'], 'datos.csv', { type: 'text/csv' });

    component.seleccionarArchivo(archivo);
    component.seleccionarGoogleSheetUrl('');

    expect(component.archivoSeleccionado()).toBe(archivo);
  });

  it('se requiere archivo o link, pero no ambos', async () => {
    const { fixture, crearComparativaSpy } = crear();
    const component = fixture.componentInstance;

    component.clienteFinalNombre.set('Juan Pérez');
    // Sin archivo ni link

    await component.enviar();
    fixture.detectChanges();

    expect(component.error()).toContain('archivo');
    expect(crearComparativaSpy).not.toHaveBeenCalled();
  });
});

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { UsuariosPage } from './usuarios';
import { MembresiaService } from '../../services/membresia';
import { ClientesService } from '../../services/clientes';
import { AuthService } from '../../services/auth';
import type { Miembro } from '../../core/models';

/**
 * Lo que se prueba: que la pantalla muestre lo que llegó y **no decida qué filas se ven**. Esa
 * decisión vive en la vista `membresias_perfil` (0012); un `if` acá sería una segunda autorización
 * que nadie mantiene sincronizada.
 */

function miembro(userId: string, rol: string, clientId: string | null = null): Miembro {
  return {
    id: `m-${userId}`,
    tenant_id: 't1',
    user_id: userId,
    rol,
    client_id: clientId,
    created_at: '2026-08-02T00:00:00Z',
    email: `${userId}@agencia.test`,
    raw_app_meta_data: { name: `Persona ${userId}` },
  };
}

describe('UsuariosPage', () => {
  async function render(miembros: Miembro[], userId = 'u1') {
    const sig = signal<readonly Miembro[]>(miembros);
    TestBed.configureTestingModule({
      imports: [UsuariosPage],
      providers: [
        provideRouter([]),
        {
          provide: MembresiaService,
          useValue: {
            miembros: sig,
            error: signal(''),
            resuelto: signal(true),
            resolver: async () => {},
          },
        },
        {
          provide: ClientesService,
          useValue: { clientes: signal([{ id: 'c-1', nombre: 'Pizzería Roma' }]), cargar: async () => {} },
        },
        { provide: AuthService, useValue: { sesion: signal({ userId }) } },
      ],
    });
    const fixture = TestBed.createComponent(UsuariosPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('lista a los miembros con nombre, email y rol', async () => {
    const el = await render([miembro('u1', 'maestro'), miembro('u2', 'equipo')]);
    expect(el.textContent).toContain('Persona u1');
    expect(el.textContent).toContain('u2@agencia.test');
    expect(el.textContent).toContain('Maestro');
    expect(el.textContent).toContain('Equipo');
  });

  it('marca la fila propia', async () => {
    const el = await render([miembro('u1', 'maestro'), miembro('u2', 'equipo')], 'u1');
    expect(el.textContent).toContain('Vos');
  });

  it('muestra el negocio por nombre, no por uuid', async () => {
    const el = await render([miembro('u3', 'cliente', 'c-1')]);
    expect(el.textContent).toContain('Pizzería Roma');
    expect(el.textContent).not.toContain('c-1');
  });

  it('🔴 no hay formulario de alta: las cuentas se crean en Supabase Auth', async () => {
    // La API no recibe ninguna credencial de Supabase. Un botón "Nuevo usuario" fingiría poder algo
    // que el sistema entero no puede — el aviso lo dice en vez de esconderlo.
    const el = await render([miembro('u1', 'maestro')]);
    expect(el.querySelector('form')).toBeNull();
    expect(el.textContent).toContain('Supabase Auth');
  });

  it('🔴 cuando solo llega la fila propia lo explica, en vez de parecer un error de carga', async () => {
    // Es lo que ve un rol `cliente`: la vista le deja pasar una sola fila. La pantalla no lo filtró.
    const el = await render([miembro('u1', 'cliente', 'c-1')], 'u1');
    expect(el.textContent).toContain('solo ves tu propia membresía');
  });

  it('con varias filas NO muestra ese aviso', async () => {
    const el = await render([miembro('u1', 'maestro'), miembro('u2', 'equipo')], 'u1');
    expect(el.textContent).not.toContain('solo ves tu propia membresía');
  });
});

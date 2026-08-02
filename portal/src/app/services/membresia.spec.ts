import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MembresiaService } from './membresia';
import { ApiService } from './api';
import { AuthService } from './auth';
import type { Miembro, Sesion } from '../core/models';

/**
 * Lo que se prueba acá no lo prueba `capacidades.test.ts` (que es puro y ya cubre la derivación):
 * que el rol de la MEMBRESÍA le gane al del token, que un fallo de red no invente ni degrade un rol,
 * y que el estado de una sesión no se filtre a la siguiente. Ese último es el que un test de
 * funciones puras no puede ver: nace de que el servicio sea `providedIn: 'root'` y sobreviva al
 * logout.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';

function sesion(userId: string, rolEnElToken: string): Sesion {
  return {
    accessToken: 'tok',
    refreshToken: 'tok-r',
    expiraEn: Date.now() + 3_600_000,
    userId,
    email: `${userId}@agencia.test`,
    tenantId: TENANT,
    rol: rolEnElToken,
  };
}

function miembro(userId: string, rol: string): Miembro {
  return {
    id: `m-${userId}`,
    tenant_id: TENANT,
    user_id: userId,
    rol,
    client_id: null,
    created_at: '2026-08-02T00:00:00Z',
    email: `${userId}@agencia.test`,
    raw_app_meta_data: null,
  };
}

/** Arma el servicio con un `AuthService` y un `ApiService` de mentira, sin red ni localStorage. */
function montar(inicial: Sesion | null, listar: () => Promise<Miembro[]>) {
  const s = signal<Sesion | null>(inicial);
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { sesion: s } },
      { provide: ApiService, useValue: { listarMiembros: listar, cambiarRolMiembro: async () => {} } },
    ],
  });
  return { servicio: TestBed.inject(MembresiaService), sesionSignal: s };
}

describe('MembresiaService', () => {
  it('mientras la membresía viaja usa el rol del token, para no hacer parpadear la UI', () => {
    const { servicio } = montar(sesion('u1', 'equipo'), async () => []);
    expect(servicio.resuelto()).toBe(false);
    expect(servicio.rol()).toBe('equipo');
    expect(servicio.esEquipo()).toBe(true);
  });

  it('🔴 al resolver, la membresía le gana al token: token equipo + membresía maestro → maestro', async () => {
    const { servicio } = montar(sesion('u1', 'equipo'), async () => [miembro('u1', 'maestro'), miembro('u2', 'equipo')]);
    await servicio.resolver();

    expect(servicio.rol()).toBe('maestro');
    expect(servicio.capacidades().some((c) => c.id === 'cambiar_rol')).toBe(true);
  });

  it('🔴 y en la dirección que importa: token maestro + membresía equipo → equipo', async () => {
    // La API no puede reescribir `app_metadata`, así que un maestro degradado conserva el token
    // viejo indefinidamente. Si el token ganara, la degradación no se vería nunca en la pantalla.
    const { servicio } = montar(sesion('u1', 'maestro'), async () => [miembro('u1', 'equipo')]);
    await servicio.resolver();

    expect(servicio.rol()).toBe('equipo');
    expect(servicio.capacidades().some((c) => c.id === 'cambiar_rol')).toBe(false);
  });

  it('sin fila propia queda "sin acceso al tenant", no un rol por defecto', async () => {
    const { servicio } = montar(sesion('u1', 'equipo'), async () => [miembro('otro', 'maestro')]);
    await servicio.resolver();

    expect(servicio.sinAcceso()).toBe(true);
    expect(servicio.rol()).toBe('');
    expect(servicio.esEquipo()).toBe(false);
    expect(servicio.capacidades()).toEqual([]);
  });

  it('🔴 si la lista no llega, NO se inventa ni se degrada un rol: sigue el del token', async () => {
    // Degradar a "sin acceso" por un 500 dejaría al equipo sin sus botones por un fallo de red; y
    // promover sería peor. El error se muestra, el rol no se toca.
    const { servicio } = montar(sesion('u1', 'equipo'), async () => {
      throw new Error('API caída');
    });
    await servicio.resolver();

    expect(servicio.error()).toBe('API caída');
    expect(servicio.resuelto()).toBe(false);
    expect(servicio.rol()).toBe('equipo');
  });

  it('🔴 el rol resuelto NO sobrevive a un cambio de sesión', async () => {
    // El servicio es providedIn:'root' y sobrevive al logout. Sin atar el estado a la identidad, la
    // persona que entra después vería, hasta que llegara su respuesta, los controles de la anterior.
    let miembros = [miembro('u1', 'maestro')];
    const { servicio, sesionSignal } = montar(sesion('u1', 'maestro'), async () => miembros);
    await servicio.resolver();
    expect(servicio.rol()).toBe('maestro');

    sesionSignal.set(null);
    expect(servicio.rol()).withContext('sin sesión no hay rol que mostrar').toBe('');
    expect(servicio.miembros()).toEqual([]);

    // Entra otra persona, con un token que no dice nada del rol: hasta resolver, no promete nada.
    miembros = [miembro('u2', 'cliente')];
    sesionSignal.set(sesion('u2', ''));
    expect(servicio.rol()).withContext('NO hereda el maestro de la sesión anterior').toBe('');
    expect(servicio.resuelto()).toBe(false);

    await servicio.refrescar();
    expect(servicio.rol()).toBe('cliente');
  });

  it('🔴 una respuesta que llega tarde, de una sesión ya cerrada, no escribe nada', async () => {
    let soltar: (m: Miembro[]) => void = () => {};
    const { servicio, sesionSignal } = montar(
      sesion('u1', 'equipo'),
      () => new Promise<Miembro[]>((r) => (soltar = r)),
    );

    const enVuelo = servicio.resolver();
    sesionSignal.set(null); // logout mientras la lista viajaba
    soltar([miembro('u1', 'maestro')]);
    await enVuelo;

    sesionSignal.set(sesion('u1', 'equipo')); // vuelve a entrar el mismo usuario
    expect(servicio.resuelto()).withContext('el resultado en vuelo no se guardó').toBe(false);
    expect(servicio.rol()).toBe('equipo');
  });
});

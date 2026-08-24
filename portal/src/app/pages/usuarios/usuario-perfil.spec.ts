import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { UsuarioPerfilPage } from './usuario-perfil';
import { MembresiaService } from '../../services/membresia';
import { ClientesService } from '../../services/clientes';
import { AuthService } from '../../services/auth';
import { ApiService } from '../../services/api';
import type { Miembro } from '../../core/models';

/**
 * El cambio de rol es una acción de privilegios, y lo que se prueba acá es sobre todo **cuándo NO se
 * ofrece**: a quien no es maestro, sobre la propia fila, y sin confirmación explícita. Nada de esto
 * autoriza —la política `membership_update` (0012) es la que decide—, pero una pantalla que ofrece
 * un botón que siempre da 403 es una pantalla rota.
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

const MIEMBROS = [miembro('u1', 'maestro'), miembro('u2', 'equipo'), miembro('u3', 'cliente', 'c-1')];

describe('UsuarioPerfilPage', () => {
  let cambios: { userId: string; rol: string; clientId: string | null }[];

  beforeEach(() => {
    cambios = [];
  });

  async function render(
    idEnLaRuta: string,
    rolPropio: string,
    userIdPropio = 'u1',
    apiOverrides: {
      telegramVinculado?: jasmine.Spy;
      vincularTelegram?: jasmine.Spy;
      desvincularTelegram?: jasmine.Spy;
    } = {},
  ) {
    const telegramVinculadoSpy =
      apiOverrides.telegramVinculado ??
      jasmine.createSpy('telegramVinculado').and.resolveTo({ vinculado: false });
    const vincularTelegramSpy =
      apiOverrides.vincularTelegram ??
      jasmine.createSpy('vincularTelegram').and.resolveTo({ url: 'https://t.me/amg_bot?start=abc' });
    const desvincularTelegramSpy =
      apiOverrides.desvincularTelegram ??
      jasmine.createSpy('desvincularTelegram').and.resolveTo({ ok: true });

    TestBed.configureTestingModule({
      imports: [UsuarioPerfilPage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: idEnLaRuta }) } } },
        {
          provide: MembresiaService,
          useValue: {
            miembros: signal<readonly Miembro[]>(MIEMBROS),
            error: signal(''),
            resuelto: signal(true),
            rol: signal(rolPropio),
            resolver: async () => {},
            cambiarRol: async (userId: string, rol: string, clientId: string | null) => {
              cambios.push({ userId, rol, clientId });
            },
          },
        },
        {
          provide: ClientesService,
          useValue: { clientes: signal([{ id: 'c-1', nombre: 'Pizzería Roma' }]), cargar: async () => {} },
        },
        { provide: AuthService, useValue: { sesion: signal({ userId: userIdPropio }) } },
        {
          provide: ApiService,
          useValue: {
            telegramVinculado: telegramVinculadoSpy,
            vincularTelegram: vincularTelegramSpy,
            desvincularTelegram: desvincularTelegramSpy,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(UsuarioPerfilPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return {
      fixture,
      el: fixture.nativeElement as HTMLElement,
      telegramVinculadoSpy,
      vincularTelegramSpy,
      desvincularTelegramSpy,
    };
  }

  const boton = (el: HTMLElement, texto: string): HTMLButtonElement | undefined =>
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(texto));

  it('muestra la ficha del miembro', async () => {
    const { el } = await render('u2', 'maestro');
    expect(el.textContent).toContain('Persona u2');
    expect(el.textContent).toContain('u2@agencia.test');
  });

  it('🔴 un equipo no ve el formulario de cambio de rol', async () => {
    // Ocultarlo es cortesía; la autorización la impone membership_update.with check. Pero ofrecerlo
    // sería prometer algo que siempre termina en 403.
    const { el } = await render('u3', 'equipo', 'u2');
    expect(boton(el, 'Cambiar el rol')).toBeUndefined();
  });

  it('🔴 un maestro NO puede cambiarse el rol a sí mismo, y la pantalla explica por qué', async () => {
    const { el } = await render('u1', 'maestro', 'u1');
    expect(boton(el, 'Cambiar el rol')).toBeUndefined();
    expect(el.textContent).toContain('Nadie puede cambiar su propio rol');
  });

  it('un maestro sí ve el formulario para otro miembro', async () => {
    const { el } = await render('u2', 'maestro', 'u1');
    expect(boton(el, 'Cambiar el rol')).toBeDefined();
  });

  it('🔴 el `select` de roles no ofrece `servicio`', async () => {
    const { el } = await render('u2', 'maestro', 'u1');
    const opciones = [...el.querySelectorAll('#usuario-rol option')].map((o) => o.getAttribute('value'));
    expect(opciones).toEqual(['maestro', 'equipo', 'cliente']);
  });

  it('🔴 guardar exige una confirmación explícita: un click no cambia privilegios', async () => {
    const { fixture, el } = await render('u2', 'maestro', 'u1');
    const componente = fixture.componentInstance;
    componente.rolElegido.set('maestro');
    fixture.detectChanges();

    boton(el, 'Cambiar el rol')!.click();
    fixture.detectChanges();
    expect(cambios).withContext('el primer click solo abre la confirmación').toEqual([]);

    boton(el, 'Sí, cambiar el rol')!.click();
    await fixture.whenStable();
    expect(cambios).toEqual([{ userId: 'u2', rol: 'maestro', clientId: null }]);
  });

  it('🔴 pasar a rol cliente sin negocio no se manda, y lo dice', async () => {
    const { fixture, el } = await render('u2', 'maestro', 'u1');
    fixture.componentInstance.rolElegido.set('cliente');
    fixture.componentInstance.clienteElegido.set('');
    fixture.detectChanges();

    expect(el.textContent).toContain('atado a un negocio');
    expect(boton(el, 'Cambiar el rol')!.disabled).toBe(true);
  });

  it('con negocio elegido sí manda el client_id', async () => {
    const { fixture, el } = await render('u2', 'maestro', 'u1');
    fixture.componentInstance.rolElegido.set('cliente');
    fixture.componentInstance.clienteElegido.set('c-1');
    fixture.detectChanges();

    boton(el, 'Cambiar el rol')!.click();
    fixture.detectChanges();
    boton(el, 'Sí, cambiar el rol')!.click();
    await fixture.whenStable();
    expect(cambios).toEqual([{ userId: 'u2', rol: 'cliente', clientId: 'c-1' }]);
  });

  it('🔴 la tarjeta de capacidades es de solo lectura: no tiene con qué guardar', async () => {
    // El origen editaba 20 booleanos y los guardaba. Eso sería una segunda fuente de verdad que RLS
    // ignora. La única forma de cambiar lo que alguien puede es cambiarle el rol.
    const { el } = await render('u3', 'equipo', 'u2');
    const tarjeta = el.querySelector('app-usuario-capacidades-card')!;
    expect(tarjeta.textContent).toContain('Qué puede hacer');
    expect(tarjeta.querySelectorAll('button').length).toBe(0);
    expect(tarjeta.querySelectorAll('input, select').length).toBe(0);
  });

  it('🔴 no se porta la tarjeta de actividad: AMG no registra actividad por usuario', async () => {
    // Regla del plan: o sale de un dato real, o no se muestra. No mostrar ceros.
    const { el } = await render('u2', 'maestro', 'u1');
    expect(el.textContent).not.toContain('Actividad');
    expect(el.textContent).not.toContain('Último acceso');
  });

  // ---------------------------------------------------------------- Telegram (Bloque F, fase 2, RF-018)

  it('🔴 viendo el perfil de OTRA persona, la tarjeta de Telegram no aparece y no se pide GET /me/telegram', async () => {
    // Nadie vincula el Telegram de otro. Al revés que "Cambiar el rol" (que un maestro ve sobre
    // cualquier fila), esto va condicionado a esPropio() -- y sin siquiera pedir el estado.
    const { el, telegramVinculadoSpy } = await render('u2', 'maestro', 'u1');
    expect(el.textContent).not.toContain('Alertas de Telegram');
    expect(telegramVinculadoSpy).not.toHaveBeenCalled();
  });

  it('perfil propio, sin vincular: se ve el botón "Vincular Telegram"', async () => {
    const { el, telegramVinculadoSpy } = await render('u1', 'maestro', 'u1', {
      telegramVinculado: jasmine.createSpy('telegramVinculado').and.resolveTo({ vinculado: false }),
    });
    expect(telegramVinculadoSpy).toHaveBeenCalled();
    expect(el.textContent).toContain('Alertas de Telegram');
    expect(boton(el, 'Vincular Telegram')).toBeDefined();
    expect(boton(el, 'Desvincular')).toBeUndefined();
  });

  it('perfil propio, vinculado: se ve "Telegram vinculado." y el botón "Desvincular"', async () => {
    const { el } = await render('u1', 'maestro', 'u1', {
      telegramVinculado: jasmine.createSpy('telegramVinculado').and.resolveTo({ vinculado: true }),
    });
    expect(el.textContent).toContain('Telegram vinculado.');
    expect(boton(el, 'Desvincular')).toBeDefined();
    expect(boton(el, 'Vincular Telegram')).toBeUndefined();
  });

  it('el botón "Vincular Telegram" pide la URL y la abre en una pestaña nueva (no navega la propia)', async () => {
    const abrirSpy = spyOn(window, 'open');
    const vincularTelegramSpy = jasmine
      .createSpy('vincularTelegram')
      .and.resolveTo({ url: 'https://t.me/amg_bot?start=codigo123' });
    const { fixture, el } = await render('u1', 'maestro', 'u1', {
      telegramVinculado: jasmine.createSpy('telegramVinculado').and.resolveTo({ vinculado: false }),
      vincularTelegram: vincularTelegramSpy,
    });

    boton(el, 'Vincular Telegram')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(vincularTelegramSpy).toHaveBeenCalled();
    expect(abrirSpy).toHaveBeenCalledWith('https://t.me/amg_bot?start=codigo123', '_blank');
    expect(el.textContent).toContain('Abrí el link');
  });

  it('el botón "Desvincular" llama desvincularTelegram y el estado local pasa a "no vinculado" sin recargar', async () => {
    const desvincularTelegramSpy = jasmine.createSpy('desvincularTelegram').and.resolveTo({ ok: true });
    const telegramVinculadoSpy = jasmine.createSpy('telegramVinculado').and.resolveTo({ vinculado: true });
    const { fixture, el } = await render('u1', 'maestro', 'u1', {
      telegramVinculado: telegramVinculadoSpy,
      desvincularTelegram: desvincularTelegramSpy,
    });

    boton(el, 'Desvincular')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(desvincularTelegramSpy).toHaveBeenCalled();
    // Sin recargar: `telegramVinculado` NO debe haberse pedido una segunda vez.
    expect(telegramVinculadoSpy).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('Vincular Telegram');
    expect(boton(el, 'Desvincular')).toBeUndefined();
  });
});

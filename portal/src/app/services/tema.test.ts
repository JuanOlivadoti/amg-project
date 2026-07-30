import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TemaService } from './tema';
import { CLASE_OSCURO, CLAVE_TEMA } from '../core/tema';

const CONSULTA = '(prefers-color-scheme: dark)';

/**
 * Lo que se prueba acá NO lo prueba `core/tema.test.ts`: que la preferencia **persista**, que la
 * clase termine en `<html>`, y que un cambio de tema del sistema **no mueva nada** si el usuario
 * eligió claro u oscuro explícito.
 *
 * Sin esto, borrar el `setItem`, quitar el listener o aplicar la clase en el lugar equivocado deja
 * todo en verde.
 */
function crear(opts: { guardado?: string; sistemaOscuro?: boolean; sinAlmacen?: boolean } = {}) {
  const almacen = new Map<string, string>();
  if (opts.guardado !== undefined) almacen.set(CLAVE_TEMA, opts.guardado);
  (globalThis as { localStorage?: unknown }).localStorage = opts.sinAlmacen
    ? {
        // Modo privado: cada acceso tira. El tema tiene que seguir funcionando en memoria.
        getItem: () => {
          throw new Error('sin localStorage');
        },
        setItem: () => {
          throw new Error('sin localStorage');
        },
      }
    : {
        getItem: (k: string) => almacen.get(k) ?? null,
        setItem: (k: string, v: string) => {
          almacen.set(k, v);
        },
      };

  const clases = new Set<string>();
  (globalThis as { document?: unknown }).document = {
    documentElement: {
      classList: {
        toggle: (c: string, encender: boolean) => {
          if (encender) clases.add(c);
          else clases.delete(c);
        },
      },
    },
  };

  const oyentes: ((e: { matches: boolean }) => void)[] = [];
  let prefiereOscuro = opts.sistemaOscuro ?? false;
  (globalThis as { matchMedia?: unknown }).matchMedia = (consulta: string) => {
    assert.equal(consulta, CONSULTA, 'el servicio está consultando otra media query');
    return {
      get matches() {
        return prefiereOscuro;
      },
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        oyentes.push(cb);
      },
    };
  };

  const servicio = new TemaService();
  return {
    servicio,
    almacen,
    oscuroPuesto: () => clases.has(CLASE_OSCURO),
    cambiarSistema: (oscuro: boolean) => {
      prefiereOscuro = oscuro;
      for (const cb of oyentes) cb({ matches: oscuro });
    },
  };
}

test('arranca en auto y sigue al sistema', () => {
  const a = crear({ sistemaOscuro: true });
  assert.equal(a.servicio.tema(), 'auto');
  assert.equal(a.servicio.efectivo(), 'oscuro');
  assert.equal(a.oscuroPuesto(), true, 'la clase tiene que estar puesta desde el arranque');

  const b = crear({ sistemaOscuro: false });
  assert.equal(b.servicio.efectivo(), 'claro');
  assert.equal(b.oscuroPuesto(), false);
});

test('lee la preferencia guardada, y esa manda sobre el sistema', () => {
  const { servicio, oscuroPuesto } = crear({ guardado: 'claro', sistemaOscuro: true });
  assert.equal(servicio.tema(), 'claro');
  assert.equal(servicio.efectivo(), 'claro');
  assert.equal(oscuroPuesto(), false, 'el sistema en oscuro no puede pisar un "claro" explícito');
});

test('un valor basura en localStorage no elige el tema', () => {
  const { servicio } = crear({ guardado: 'azul' });
  assert.equal(servicio.tema(), 'auto');
});

test('🔴 alternar cicla, persiste y repinta', () => {
  const { servicio, almacen, oscuroPuesto } = crear({ sistemaOscuro: false });

  servicio.alternar(); // auto → claro
  assert.equal(servicio.tema(), 'claro');
  assert.equal(almacen.get(CLAVE_TEMA), 'claro', 'sin esto, el tema se pierde al recargar');
  assert.equal(oscuroPuesto(), false);

  servicio.alternar(); // claro → oscuro
  assert.equal(servicio.tema(), 'oscuro');
  assert.equal(almacen.get(CLAVE_TEMA), 'oscuro');
  assert.equal(oscuroPuesto(), true, 'elegir oscuro tiene que poner la clase');

  servicio.alternar(); // oscuro → auto
  assert.equal(servicio.tema(), 'auto');
  assert.equal(almacen.get(CLAVE_TEMA), 'auto');
  assert.equal(oscuroPuesto(), false, 'auto con el sistema en claro vuelve a claro');
});

test('🔴 un cambio de tema del SISTEMA no mueve nada si el tema es explícito', () => {
  const { servicio, cambiarSistema, oscuroPuesto } = crear({ guardado: 'claro' });
  cambiarSistema(true);
  assert.equal(servicio.efectivo(), 'claro', 'el usuario eligió claro: el sistema no decide');
  assert.equal(oscuroPuesto(), false);
});

test('🔴 con el tema en auto, un cambio del sistema SÍ repinta', () => {
  const { servicio, cambiarSistema, oscuroPuesto } = crear({ sistemaOscuro: false });
  assert.equal(oscuroPuesto(), false);
  cambiarSistema(true);
  assert.equal(servicio.efectivo(), 'oscuro');
  assert.equal(oscuroPuesto(), true, 'en auto hay que seguir al sistema, y repintar');
  cambiarSistema(false);
  assert.equal(oscuroPuesto(), false, 'y volver');
});

test('sin localStorage el tema igual funciona, en memoria', () => {
  const { servicio, oscuroPuesto } = crear({ sinAlmacen: true, sistemaOscuro: false });
  assert.equal(servicio.tema(), 'auto', 'un getItem que tira no puede romper el arranque');
  servicio.alternar();
  servicio.alternar();
  assert.equal(servicio.tema(), 'oscuro', 'un setItem que tira no puede romper el ciclo');
  assert.equal(oscuroPuesto(), true);
});

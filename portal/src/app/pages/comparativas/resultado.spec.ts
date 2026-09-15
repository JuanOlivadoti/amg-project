import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { ComparativaResultadoPage } from './resultado';
import { ApiService } from '../../services/api';
import { MembresiaService } from '../../services/membresia';
import { ImpresionService } from '../../shared/services/impresion';
import type { ComparativaSeguros, Miembro } from '../../core/models';

/**
 * Lo que este spec defiende, en orden de importancia:
 *
 * 1. **El gate.** Sin revisar, "Imprimir" y "Copiar mail" están deshabilitados con el aviso de
 *    pendiente; al revisar, se habilitan y el aviso cambia — y el estado se RELEE del servidor
 *    (`obtenerComparativa` tras `revisarComparativa`, no un flag local puesto al clickear).
 * 2. **El informe se pinta como TEXTO.** `informeMd` lo escribió un LLM: mismo criterio de seguridad
 *    que `entregable.spec.ts`.
 * 3. **"Copiar mail" copia dos formatos y sobrevive a un permiso denegado**, molde exacto de
 *    `posts.spec.ts`.
 */

function comparativaDePrueba(overrides: Partial<ComparativaSeguros> = {}): ComparativaSeguros {
  return {
    id: 'cmp1',
    clientId: 'c1',
    creadoPor: 'u1',
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
    informeMd: '# Análisis de comparativas\n\nUn párrafo con la recomendación.',
    mailAsunto: 'Tu comparativa de seguros',
    mailCuerpoMd: 'Hola,\n\nAdjunto tu comparativa.',
    costoUsd: 1.5,
    revisadoEn: null,
    revisadoPor: null,
    createdAt: '2026-09-12T00:00:00.000Z',
    ...overrides,
  };
}

function miembroDePrueba(overrides: Partial<Miembro> = {}): Miembro {
  return {
    id: 'm1',
    tenant_id: 't1',
    user_id: 'u1',
    rol: 'equipo',
    client_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    email: 'ana@amg.test',
    raw_app_meta_data: { name: 'Ana Reviewer' },
    ...overrides,
  };
}

interface Opciones {
  comparativa: ComparativaSeguros;
  /** Lo que devuelve el SEGUNDO `obtenerComparativa` (tras `revisarComparativa`), si difiere. */
  comparativaTrasRevisar?: ComparativaSeguros;
  revisarComparativa?: jasmine.Spy;
  miembros?: Miembro[];
}

function crear(opts: Opciones) {
  let llamadas = 0;
  const obtenerComparativa = jasmine.createSpy('obtenerComparativa').and.callFake(async () => {
    llamadas++;
    if (llamadas === 1) return opts.comparativa;
    return opts.comparativaTrasRevisar ?? opts.comparativa;
  });
  const revisarComparativa =
    opts.revisarComparativa ?? jasmine.createSpy('revisarComparativa').and.resolveTo(undefined);
  const imprimirSpy = jasmine.createSpy('imprimir');

  TestBed.configureTestingModule({
    imports: [ComparativaResultadoPage],
    providers: [
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { paramMap: of(convertToParamMap({ id: 'c1', cid: 'cmp1' })) },
      },
      { provide: ApiService, useValue: { obtenerComparativa, revisarComparativa } },
      { provide: ImpresionService, useValue: { imprimir: imprimirSpy } },
      {
        provide: MembresiaService,
        // `resolver` con su propio doble: esta pantalla vive fuera del shell y la llama en
        // `ngOnInit` (no hereda el `effect` de `app-shell.ts`) — sin este método el double
        // rompería CADA test con "resolver is not a function".
        useValue: {
          miembros: signal<readonly Miembro[]>(opts.miembros ?? []),
          resolver: jasmine.createSpy('resolver').and.resolveTo(undefined),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(ComparativaResultadoPage);
  return { fixture, obtenerComparativa, revisarComparativa, imprimirSpy };
}

async function estabilizar(fixture: ReturnType<typeof crear>['fixture']): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

/** Los tres botones del gate, por su texto — mismo helper que pide el brief de la task. */
function botones(el: HTMLElement) {
  const de = (t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.includes(t));
  return { imprimir: de('Imprimir'), copiar: de('Copiar mail'), revisar: de('Marcar como revisado') };
}

describe('ComparativaResultadoPage', () => {
  it('🔴 SIN revisar, "Imprimir" y "Copiar mail" están DESHABILITADOS', async () => {
    const { fixture } = crear({ comparativa: comparativaDePrueba({ revisadoEn: null, revisadoPor: null }) });
    const el = await estabilizar(fixture);
    expect(botones(el).imprimir!.disabled).toBeTrue();
    expect(botones(el).copiar!.disabled).toBeTrue();
    expect(el.textContent).toContain('pendiente de revisión');
  });

  it('🔴 tras revisar, los dos se habilitan y el aviso dice quién y cuándo', async () => {
    const revisar = jasmine.createSpy('revisarComparativa').and.resolveTo(undefined);
    const { fixture, obtenerComparativa } = crear({
      comparativa: comparativaDePrueba({ revisadoEn: null, revisadoPor: null }),
      comparativaTrasRevisar: comparativaDePrueba({
        revisadoEn: '2026-09-12T10:00:00.000Z',
        revisadoPor: 'u1',
      }),
      revisarComparativa: revisar,
      miembros: [miembroDePrueba({ user_id: 'u1' })],
    });
    const el = await estabilizar(fixture);
    botones(el).revisar!.click();
    const despues = await estabilizar(fixture);

    expect(revisar).toHaveBeenCalledWith('c1', 'cmp1');
    // La garantía central: `revisarComparativa` devuelve `{ok:true}` (ver el handler real), así que
    // el ÚNICO camino para que la pantalla sepa que quedó revisada es volver a pedirla. Un
    // `comparativa.update(c => ({...c, revisadoEn: ...}))` local pasaría las aserciones de abajo
    // igual, pero NO volvería a llamar a `obtenerComparativa` — por eso se cuenta la llamada.
    expect(obtenerComparativa).toHaveBeenCalledTimes(2);
    expect(botones(despues).imprimir!.disabled).toBeFalse();
    expect(botones(despues).copiar!.disabled).toBeFalse();
    expect(despues.textContent).toContain('Revisado por');
    expect(despues.textContent).toContain('Ana Reviewer');
    // El botón "Marcar como revisado" desaparece una vez revisada: no hay nada más que marcar.
    expect(botones(despues).revisar).toBeUndefined();
  });

  it('🔴 el estado del gate se relee del SERVIDOR, no se recuerda en pantalla', async () => {
    // Recargar (una carga nueva de la MISMA comparativa, sin pasar por "Marcar como revisado") tiene
    // que mostrarla ya revisada: es un hecho persistido, no un flag de sesión puesto al clickear. Sin
    // este test, un `revisado = signal(true)` local pasaría los dos de arriba y mentiría tras un F5.
    const { fixture } = crear({
      comparativa: comparativaDePrueba({ revisadoEn: '2026-09-12T10:00:00.000Z', revisadoPor: 'u1' }),
    });
    const el = await estabilizar(fixture);
    expect(botones(el).imprimir!.disabled).toBeFalse();
    expect(botones(el).copiar!.disabled).toBeFalse();
  });

  it('un revisor sin membresía visible muestra su uuid, no "Sin asignar"', async () => {
    const { fixture } = crear({
      comparativa: comparativaDePrueba({ revisadoEn: '2026-09-12T10:00:00.000Z', revisadoPor: 'u-fuera' }),
      miembros: [],
    });
    const el = await estabilizar(fixture);
    expect(el.textContent).toContain('u-fuera');
  });

  it('el informe se dibuja con parsearMarkdown y @for — nunca innerHTML', async () => {
    const { fixture } = crear({
      comparativa: comparativaDePrueba({
        informeMd: '# Título\n\n- uno\n- dos',
        revisadoEn: '2026-09-12T10:00:00.000Z',
        revisadoPor: 'u1',
      }),
    });
    const el = await estabilizar(fixture);
    expect(el.querySelector('h1')!.textContent).toContain('Título');
    expect(el.querySelectorAll('li').length).toBe(2);
    expect(el.innerHTML).not.toContain('# Título'); // si saliera crudo, el Markdown viajaría sin parsear
    expect(el.innerHTML).not.toContain('- uno');
  });

  it('🔴 un informe hostil (<script>, <img onerror>) no mete esas etiquetas en el DOM', async () => {
    const hostil = [
      '# Comparativa <script>alert(1)</script>',
      '',
      'Un párrafo con <img src=x onerror="alert(1)"> incrustado.',
    ].join('\n');
    const { fixture } = crear({
      comparativa: comparativaDePrueba({
        informeMd: hostil,
        revisadoEn: '2026-09-12T10:00:00.000Z',
        revisadoPor: 'u1',
      }),
    });
    const el = await estabilizar(fixture);
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('imprimir() no llama a ImpresionService si el gate sigue cerrado (defensa además del [disabled])', async () => {
    const { fixture, imprimirSpy } = crear({
      comparativa: comparativaDePrueba({ revisadoEn: null, revisadoPor: null }),
    });
    await estabilizar(fixture);
    (fixture.componentInstance as ComparativaResultadoPage).imprimir();
    expect(imprimirSpy).not.toHaveBeenCalled();
  });

  describe('Copiar mail', () => {
    it('🔴 pone HTML enriquecido Y texto plano en el portapapeles — molde exacto de posts.ts', async () => {
      const { fixture } = crear({
        comparativa: comparativaDePrueba({
          mailAsunto: 'Tu comparativa',
          mailCuerpoMd: 'Hola **Juan**',
          revisadoEn: '2026-09-12T10:00:00.000Z',
          revisadoPor: 'u1',
        }),
      });
      const el = await estabilizar(fixture);

      const writeSpy = spyOn(navigator.clipboard, 'write').and.resolveTo(undefined);
      botones(el).copiar!.click();
      await estabilizar(fixture);

      expect(writeSpy).toHaveBeenCalledTimes(1);
      const item = writeSpy.calls.mostRecent().args[0][0] as ClipboardItem;
      expect(item.types).toContain('text/html');
      expect(item.types).toContain('text/plain');

      const html = await (await item.getType('text/html')).text();
      expect(html).toContain('Tu comparativa');
      expect(html).toContain('<strong>Juan</strong>');

      const texto = await (await item.getType('text/plain')).text();
      expect(texto).toContain('Tu comparativa');
      expect(texto).toContain('Hola Juan');
      expect(texto).not.toContain('**');
    });

    it('usa el fallback writeText si ClipboardItem no está disponible', async () => {
      const original = (window as { ClipboardItem?: unknown }).ClipboardItem;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ClipboardItem = undefined;
      try {
        const { fixture } = crear({
          comparativa: comparativaDePrueba({
            mailAsunto: 'Tu comparativa',
            revisadoEn: '2026-09-12T10:00:00.000Z',
            revisadoPor: 'u1',
          }),
        });
        const el = await estabilizar(fixture);
        const writeTextSpy = spyOn(navigator.clipboard, 'writeText').and.resolveTo(undefined);

        botones(el).copiar!.click();
        await estabilizar(fixture);

        expect(writeTextSpy).toHaveBeenCalledTimes(1);
        expect(writeTextSpy.calls.mostRecent().args[0]).toContain('Tu comparativa');
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).ClipboardItem = original;
      }
    });

    it('🔴 sobrevive a que se deniegue el permiso: el catch es silencioso, no rompe la pantalla', async () => {
      const { fixture } = crear({
        comparativa: comparativaDePrueba({ revisadoEn: '2026-09-12T10:00:00.000Z', revisadoPor: 'u1' }),
      });
      const el = await estabilizar(fixture);
      spyOn(navigator.clipboard, 'write').and.rejectWith(new DOMException('Permiso denegado', 'NotAllowedError'));

      expect(() => {
        botones(el).copiar!.click();
      })
        .withContext('el catch de copiarMail() tiene que absorber el rechazo, no dejarlo sin manejar')
        .not.toThrow();
      await estabilizar(fixture);

      expect(el.textContent).not.toContain('Copiado ✓');
    });

    it('el gate también cubre "Copiar mail" en el método, no solo en el [disabled] del botón', async () => {
      const { fixture } = crear({
        comparativa: comparativaDePrueba({ revisadoEn: null, revisadoPor: null }),
      });
      await estabilizar(fixture);
      const writeSpy = spyOn(navigator.clipboard, 'write').and.resolveTo(undefined);
      await (fixture.componentInstance as ComparativaResultadoPage).copiarMail();
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });
});

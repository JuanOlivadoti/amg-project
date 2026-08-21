import { TestBed } from '@angular/core/testing';
import { CarteraTablaComponent } from './cartera-tabla';
import { EVIDENCIA_RESPALDADA } from '../../core/evidence';
import type { PaginaPropuesta } from '../../core/models';

function paginaDePrueba(overrides: Partial<PaginaPropuesta> = {}): PaginaPropuesta {
  return {
    id: 'p1',
    approved: false,
    cluster_id: 'c1',
    tipo: 'servicio',
    page_strategy: null,
    url_slug: '/x',
    keyword_principal: 'pizza a domicilio',
    keywords_secundarias: [],
    // Vocabulario del contrato (inglés), no el viejo del seed — ver `intencion-labels.ts`.
    intencion: 'commercial',
    local: true,
    volumen: 100,
    dificultad: 20,
    evidencia: EVIDENCIA_RESPALDADA,
    opportunity_score: 75,
    score_confidence: 0.8,
    seo: {},
    content_brief: {},
    preguntas_frecuentes: [],
    ...overrides,
  };
}

describe('CarteraTablaComponent', () => {
  function render(paginas: PaginaPropuesta[]) {
    TestBed.configureTestingModule({ imports: [CarteraTablaComponent] });
    const fixture = TestBed.createComponent(CarteraTablaComponent);
    fixture.componentRef.setInput('paginas', paginas);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('sin páginas: muestra el estado vacío', () => {
    const el = render([]);
    expect(el.textContent).toContain('Todavía no hay páginas en la cartera.');
  });

  it('página respaldada: la pastilla dice ✅ Respaldada', () => {
    const el = render([paginaDePrueba({ evidencia: EVIDENCIA_RESPALDADA })]);
    expect(el.textContent).toContain('✅ Respaldada');
    expect(el.querySelector('.bg-respaldo-suave')).not.toBeNull();
  });

  it('página sin validar: la pastilla dice ⚠️ Sin validar', () => {
    const el = render([paginaDePrueba({ evidencia: 'sin_validar' })]);
    expect(el.textContent).toContain('⚠️ Sin validar');
    expect(el.querySelector('.bg-alerta-suave')).not.toBeNull();
  });

  it('renderiza el keyword de cada página', () => {
    const el = render([paginaDePrueba({ keyword_principal: 'sushi delivery' })]);
    expect(el.textContent).toContain('sushi delivery');
  });

  // La columna Intención tiene que mostrar la etiqueta en español, no el vocabulario crudo del
  // contrato: `intencion-labels.test.ts` fija el mapa completo, esto fija que la plantilla lo use.
  it('la columna Intención muestra la etiqueta en español, no el valor crudo del contrato', () => {
    const el = render([paginaDePrueba({ intencion: 'commercial' })]);
    expect(el.textContent).toContain('Comercial');
    expect(el.textContent).not.toContain('commercial');
  });
});

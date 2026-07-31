import { TestBed } from '@angular/core/testing';
import { CarteraTablaComponent } from './cartera-tabla';
import { EVIDENCIA_RESPALDADA } from '../../core/evidence';
import type { PaginaPropuesta } from '../../core/models';

function paginaDePrueba(overrides: Partial<PaginaPropuesta> = {}): PaginaPropuesta {
  return {
    id: 'p1',
    approved: false,
    cluster_id: 'c1',
    tipo: 'comercial',
    page_strategy: null,
    url_slug: '/x',
    keyword_principal: 'pizza a domicilio',
    keywords_secundarias: [],
    intencion: 'comercial',
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
    const el = render([paginaDePrueba({ evidencia: 'sin_datos' })]);
    expect(el.textContent).toContain('⚠️ Sin validar');
    expect(el.querySelector('.bg-alerta-suave')).not.toBeNull();
  });

  it('renderiza el keyword de cada página', () => {
    const el = render([paginaDePrueba({ keyword_principal: 'sushi delivery' })]);
    expect(el.textContent).toContain('sushi delivery');
  });
});

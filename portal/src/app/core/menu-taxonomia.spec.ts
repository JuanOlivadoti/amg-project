import { ALERGENOS, ETIQUETA_ALERGENO, ETIQUETAS_DIETETICAS, ETIQUETA_DIETETICA_LABEL } from './menu-taxonomia';

describe('menu-taxonomia', () => {
  it('ALERGENOS tiene exactamente 14 entradas, todas con etiqueta en ETIQUETA_ALERGENO', () => {
    expect(ALERGENOS.length).toBe(14);
    for (const a of ALERGENOS) {
      expect(ETIQUETA_ALERGENO[a]).toBeTruthy();
    }
  });

  it('ETIQUETAS_DIETETICAS tiene exactamente 7 entradas, todas con etiqueta en ETIQUETA_DIETETICA_LABEL', () => {
    expect(ETIQUETAS_DIETETICAS.length).toBe(7);
    for (const e of ETIQUETAS_DIETETICAS) {
      expect(ETIQUETA_DIETETICA_LABEL[e]).toBeTruthy();
    }
  });
});

import { pageToStory } from "../handoff/adapter.js";
import { validBrief, validPage, validProfile } from "../fixtures.js";
import type { BusinessProfile } from "../types.js";
import { nuevoPresupuestoImagenes } from "./imagenes.js";
import type { CtxPieza } from "./piezas/tipos.js";

/**
 * Contextos de prueba para las piezas. **Solo lo usan los tests** — no lo importa nada de `src` que
 * llegue a producción, y por eso no está en `index.ts`.
 *
 * Vive fuera de un `*.test.ts` porque lo comparten cuatro archivos de test: `aislamiento`, `piezas`,
 * `ensamblado` y `shell`. Duplicarlo en cada uno haría que un cambio del contrato de `CtxPieza`
 * hubiera que arreglarlo cuatro veces, que es la misma clase de problema que este refactor viene a
 * cerrar en el render.
 */

/**
 * Un `CtxPieza` con los huecos rellenos, para escribir un caso diciendo solo lo que le importa.
 *
 * ⚠️ El `presupuestoImagenes` se crea **en cada llamada**, no se comparte entre contextos: es lo que
 * hace que un test que renderiza una pieza veinte veces no se quede sin cupo por culpa del anterior.
 * En producción lo crea `renderDocumento` con el mismo criterio, uno por documento.
 */
export function ctxDe(over: Partial<CtxPieza> = {}): CtxPieza {
  return {
    story: null,
    profile: null,
    activeSlug: "",
    titulo: "",
    bajada: "",
    paginas: [],
    presupuestoImagenes: nuevoPresupuestoImagenes(),
    ...over,
  };
}

/** El perfil "completo": carta, dos locales y logo. Todo lo que alguna pieza del shell necesita. */
export function perfilCompleto(over: Partial<BusinessProfile> = {}): BusinessProfile {
  return validProfile({
    menu: [
      { category: "Pizzas", name: "Margherita", description: "Tomate y mozzarella.", price: "12,50 €" },
      { name: "Postre de la casa" },
    ],
    locations: [
      {
        name: "Centro",
        address: { streetAddress: "Calle Mayor 12", addressLocality: "Madrid", postalCode: "28013" },
        telephone: "+34 911 23 45 67",
        opening_hours: "Mar-Dom 13:00-16:00",
      },
      { name: "Chamberí", address: { streetAddress: "Zurbano 40", addressLocality: "Madrid" } },
    ],
    ...over,
  });
}

/**
 * El contexto en el que **todas** las piezas del catálogo tienen datos que dibujar.
 *
 * Que exista uno solo así es lo que deja escribir el test de "toda pieza envuelve su HTML en su
 * raíz" recorriendo el catálogo: sin él habría que enumerar a mano qué necesita cada pieza, y una
 * pieza nueva se colaría sin que nadie lo notara.
 *
 * ⚠️ **Es una FUNCIÓN y no una constante**, y por el mismo motivo que el presupuesto de imágenes se
 * crea por documento: `CtxPieza` lleva ahora un objeto mutable dentro. Una constante compartida
 * significaría que recorrer el catálogo con ella agota el cupo de las piezas del final — con nueve
 * piezas y dos fotos no se nota, con la galería de 30 de la mitad B sí. Un fixture que reproduce el
 * bug que el código prohíbe es un fixture que un día lo va a esconder.
 */
export function ctxCompleto(): CtxPieza {
  return ctxDe({
    story: pageToStory(validPage(), validBrief()),
    profile: perfilCompleto(),
    activeSlug: "restaurante-italiano-madrid-centro",
    titulo: "Un titular sintetizado",
    bajada: "Una bajada sintetizada",
    paginas: [
      { slug: "pizzeria-chamberi", name: "Pizzería en Chamberí" },
      { slug: "blog/fermentacion-lenta", name: "Qué es la fermentación lenta" },
    ],
  });
}

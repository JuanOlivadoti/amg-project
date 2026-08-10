import type { BusinessProfile } from "web-builder";

/**
 * **El perfil del cliente de demo: «Borcelle Burger».**
 *
 * Vive acá y no dentro de `dev-server.ts` porque lo usan **dos** consumidores: el servidor de
 * desarrollo y el generador del SQL que siembra la demo en producción (`cli/sql-demo.ts`). Dos copias
 * del mismo perfil son dos perfiles el día que alguien ajusta uno — y ese día nadie se entera, porque
 * los dos siguen funcionando.
 *
 * ## Por qué el negocio es FICTICIO, y por qué eso es la mitad del asunto
 *
 * Borcelle Burger no existe. Sus fotos son de stock y sus reseñas están escritas para esta demo. Eso
 * es legítimo **precisamente porque no hay un negocio real al que atribuirle nada**: la misma regla
 * que impide poner estas fotos en la ficha de un restaurante de verdad (`dev-server.ts`) es la que
 * hace que acá no haya problema.
 *
 * Es también la salida al límite de la etapa 3 del bloque K: `testimonios` no tiene contenido por
 * defecto —una reseña inventada es una reseña falsa atribuida a un cliente— y por eso la sección no se
 * puede enseñar con la ficha de un cliente real. Con un negocio inventado sí, y esta es la ficha que
 * lo permite.
 *
 * Las fotos están subidas al space de Storyblok y se sirven desde `a.storyblok.com`, que es el host de
 * la allowlist del renderizador. **Las URL de asset son públicas**: no dependen del token ni del space
 * de quien las lea, así que este perfil funciona bajo cualquier space.
 */

const FOTO = {
  portada: "https://a.storyblok.com/f/293831091573700/2560x1440/3866018887/axe-os-portada.jpg",
  galeria: [
    "https://a.storyblok.com/f/293831091573700/1600x1200/d82ece3683/axe-os-fotos-galeria.jpg",
    "https://a.storyblok.com/f/293831091573700/1600x1200/b6239d5695/axe-os-fotos-galeria-2.jpg",
    "https://a.storyblok.com/f/293831091573700/1600x1200/415661678d/axe-os-fotos-galeria-3.jpg",
    "https://a.storyblok.com/f/293831091573700/1600x1200/056a2a7774/axe-os-fotos-galeria-4.jpg",
    "https://a.storyblok.com/f/293831091573700/1600x1200/1a75e62a1f/axe-os-fotos-galeria-5.jpg",
    "https://a.storyblok.com/f/293831091573700/1600x1200/8eb4949666/axe-os-fotos-galeria-6.jpg",
  ],
  categoriaHamburguesas: "https://a.storyblok.com/f/293831091573700/1200x800/8fbaedf133/axe-og-categories.jpg",
  categoriaEntrantes:
    "https://a.storyblok.com/f/293831091573700/1200x800/194ffe59a5/axe-og-categories-starters.jpg",
  plato: "https://a.storyblok.com/f/293831091573700/800x800/e0f8442ce6/axe-og-menu-item.jpg",
  local: "https://a.storyblok.com/f/293831091573700/1600x1200/46847c4d05/axe-os-locations.jpg",
  logo: "https://a.storyblok.com/f/293831091573700/250x250/ec3d723b80/axe-os-logo-color.png",
} as const;

export const PERFIL_BORCELLE: BusinessProfile = {
  name: "Borcelle Burger",
  telephone: "+34 915 55 44 33",
  address: { streetAddress: "Calle de Fuencarral 88", postalCode: "28004", addressLocality: "Madrid" },
  opening_hours: "Lun-Dom 12:30-16:30, 20:00-00:00",
  brand: {
    plantilla: "base",
    colores: {
      primario: "#8c1c13",
      secundario: "#c8963e",
      titulo: "#1c1917",
      texto: "#44403c",
      fondo: "#fffdf9",
      fondoAlt: "#f5f1ea",
    },
    fuentes: { titulo: "condensada", texto: "humanista", decorativa: "script" },
    logo: FOTO.logo,
  },
  portada: { src: FOTO.portada, alt: "El local de Borcelle Burger" },
  // Seis fotos DISTINTAS, y la tercera **sin `alt` a propósito**: `renderImagen` emite `alt=""` cuando
  // falta, que es lo correcto para una imagen decorativa, y es una rama que conviene ver dibujada.
  fotos: [
    { src: FOTO.galeria[0], alt: "La barra" },
    { src: FOTO.galeria[1], alt: "La sala" },
    { src: FOTO.galeria[2] },
    { src: FOTO.galeria[3], alt: "La terraza" },
    { src: FOTO.galeria[4], alt: "La parrilla" },
    { src: FOTO.galeria[5], alt: "El comedor de arriba" },
  ],
  menu_categorias: [
    { nombre: "Hamburguesas", foto: { src: FOTO.categoriaHamburguesas }, orden: 0 },
    { nombre: "Entrantes", foto: { src: FOTO.categoriaEntrantes }, orden: 1 },
  ],
  menu: [
    {
      category: "Hamburguesas",
      name: "Golden Burger",
      description: "Doble de vacuno, cheddar curado, cebolla caramelizada y pan brioche.",
      precios: [
        { etiqueta: "Sencilla", importe: "12,50 €" },
        { etiqueta: "Doble", importe: "15,90 €" },
      ],
      nota: "Punto al gusto",
      foto: { src: FOTO.plato },
    },
    {
      category: "Entrantes",
      name: "Patatas bravas",
      description: "Salsa brava de la casa.",
      price: "6,50 €",
      foto: { src: FOTO.plato },
    },
  ],
  locations: [
    {
      name: "Fuencarral",
      address: { streetAddress: "Calle de Fuencarral 88", postalCode: "28004", addressLocality: "Madrid" },
      telephone: "+34 915 55 44 33",
      opening_hours: "Lun-Dom 12:30-16:30, 20:00-00:00",
      foto: { src: FOTO.local },
    },
    {
      name: "Chamberí",
      address: { streetAddress: "Calle de Trafalgar 12", postalCode: "28010", addressLocality: "Madrid" },
      telephone: "+34 915 55 44 34",
      opening_hours: "Mar-Dom 13:00-16:30, 20:00-23:30",
      foto: { src: FOTO.local },
    },
  ],
  // Las tres secciones de plantilla (bloque K, etapa 3). Están acá para poder MIRARLAS en el
  // navegador, que en esta área encuentra lo que los tests no ven.
  //
  // ⚠️ Las reseñas son de un negocio FICTICIO —Borcelle Burger no existe— y por eso pueden estar
  // escritas. La misma regla que impide poner sus fotos de stock en la ficha de un restaurante real
  // vale, y más fuerte, para una reseña: `testimonios` NO tiene default en el renderizador
  // justamente para que un cliente real nunca publique una que no le dijo nadie.
  bienvenida:
    "Hamburguesas a la parrilla en el centro de Madrid. Pasa, siéntate donde quieras y pide en la barra.",
  destacados: [
    { titulo: "Carne del día", texto: "Se pica cada mañana en el propio local." },
    { titulo: "Pan de la casa", texto: "Brioche horneado a diario." },
    { titulo: "Dos locales", texto: "Fuencarral y Chamberí, con la misma carta." },
  ],
  testimonios: [
    { texto: "La mejor hamburguesa que he comido en Madrid, y he probado unas cuantas.", autor: "Marta G." },
    { texto: "Sitio pequeño, servicio rápido y la carne en su punto. Volveremos." },
    { texto: "Pedimos las bravas para compartir y se nos fue de las manos. Muy recomendable.", autor: "Álex R." },
  ],};

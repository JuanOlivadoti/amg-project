/**
 * Datos de EJEMPLO para la pantalla `/clientes/:id/ver` (Etapa 5d). Mismo espíritu que
 * `cartera-mock.ts`: TypeScript puro, sin llamada a ninguna API, determinista.
 *
 * **Diferencia con `cartera-mock.ts`**: ese mock está atado por test a lo sembrado de verdad en
 * producción (`db/src/cartera-portal.test.ts`). ESTE no — no hay ningún dato real de ideas,
 * Instagram o Google Reviews en ningún lado de AMG OS todavía. Es contenido ilustrativo genérico,
 * el mismo para cualquier cliente que abra la pantalla, no una copia de algo sembrado. Si en algún
 * momento se construye un backend real para alguno de los tres (decisión pendiente, ver el brief de
 * la Etapa 5d), este archivo se reemplaza entero — no se "completa".
 *
 * Los tipos de acá son deliberadamente más chicos que los del origen (Angular 19 + Firestore):
 * `Idea`/`Post`/`GoogleReview` allá cargan transcripción de audio, checklist de interpretación,
 * ideas complementarias, IDs de Firestore, etc. Acá solo entra lo que la pantalla realmente
 * renderiza.
 */

/** Los cuatro estados que puede tener una idea, igual que el origen. */
export type EstadoIdea = 'nueva' | 'en_revision' | 'aprobada' | 'rechazada';

export interface IdeaMock {
  readonly id: string;
  readonly titulo: string;
  readonly resumen: string;
  readonly estado: EstadoIdea;
  /** ISO 8601. Fija (no `Date.now()`) para que el orden y el contenido sean deterministas. */
  readonly fecha: string;
  /** Cantidad de canales de comunicación a los que apunta la idea (Instagram, blog, email, ...). */
  readonly canales: number;
}

/** Los cuatro estados que puede tener un post, igual que el origen (sin `socialNetwork`: acá el tab ya es Instagram). */
export type EstadoPost = 'borrador' | 'publicado' | 'programado' | 'archivado';

export interface PostInstagramMock {
  readonly id: string;
  /** El mensaje principal del caption — el origen tiene además nota emocional, CTA, etc.; se resume a uno solo. */
  readonly mensaje: string;
  readonly hashtags: readonly string[];
  readonly estado: EstadoPost;
  /** ISO 8601. */
  readonly creadoEn: string;
}

export interface ResenaGoogleMock {
  readonly id: string;
  readonly autor: string;
  /** 1 a 5. */
  readonly calificacion: number;
  readonly texto: string;
  /** ISO 8601. */
  readonly fecha: string;
  /** `null` = todavía sin respuesta del equipo (el origen la llama "pendiente"). */
  readonly respuesta: string | null;
}

/**
 * Cinco ideas de ejemplo, cubriendo los cuatro estados (dos "nueva" para que la grilla no se vea
 * pareja de a una por estado). Orden ya de más nueva a más vieja, como hace el origen con su `sort`.
 */
export function generarIdeasMock(): readonly IdeaMock[] {
  return [
    {
      id: 'idea-mock-1',
      titulo: 'Menú de temporada: platos de invierno',
      resumen: 'Una serie de posteos mostrando los nuevos platos de la carta de invierno, con foco en ingredientes locales.',
      estado: 'nueva',
      fecha: '2026-07-28T09:00:00.000Z',
      canales: 2,
    },
    {
      id: 'idea-mock-2',
      titulo: 'Detrás de escena: la cocina en hora pico',
      resumen: 'Video corto mostrando al equipo de cocina trabajando durante el servicio del viernes noche.',
      estado: 'en_revision',
      fecha: '2026-07-22T09:00:00.000Z',
      canales: 1,
    },
    {
      id: 'idea-mock-3',
      titulo: 'Promo de aniversario del local',
      resumen: 'Campaña de dos semanas con descuento especial para celebrar el aniversario del restaurante.',
      estado: 'aprobada',
      fecha: '2026-07-15T09:00:00.000Z',
      canales: 3,
    },
    {
      id: 'idea-mock-4',
      titulo: 'Reto de maridaje con clientes',
      resumen: 'Invitar a la comunidad a proponer maridajes de cerveza artesanal, elegir el ganador cada mes.',
      estado: 'rechazada',
      fecha: '2026-07-08T09:00:00.000Z',
      canales: 2,
    },
    {
      id: 'idea-mock-5',
      titulo: 'Testimonios de clientes frecuentes',
      resumen: 'Serie de entrevistas cortas a clientes habituales sobre su plato favorito y por qué vuelven.',
      estado: 'nueva',
      fecha: '2026-07-01T09:00:00.000Z',
      canales: 1,
    },
  ];
}

/** Cuatro posts de ejemplo, uno por cada estado posible. */
export function generarPostsInstagramMock(): readonly PostInstagramMock[] {
  return [
    {
      id: 'post-mock-1',
      mensaje: 'Nuestra hamburguesa insignia, ahora con receta renovada 🍔',
      hashtags: ['hamburguesagourmet', 'madrid', 'foodie'],
      estado: 'publicado',
      creadoEn: '2026-07-25T14:30:00.000Z',
    },
    {
      id: 'post-mock-2',
      mensaje: 'Este viernes: música en vivo y cerveza artesanal 🎸',
      hashtags: ['cervezaartesanal', 'planfinde'],
      estado: 'programado',
      creadoEn: '2026-07-24T11:00:00.000Z',
    },
    {
      id: 'post-mock-3',
      mensaje: 'Boceto de la campaña de verano, todavía sin foto final',
      hashtags: ['veranomadrid'],
      estado: 'borrador',
      creadoEn: '2026-07-20T16:45:00.000Z',
    },
    {
      id: 'post-mock-4',
      mensaje: 'Promo de apertura del segundo local (campaña ya cerrada)',
      hashtags: ['nuevoLocal', 'chamberi'],
      estado: 'archivado',
      creadoEn: '2026-05-10T10:00:00.000Z',
    },
  ];
}

/** Tres reseñas de ejemplo — mismo tamaño de muestra que traía el origen en su propio mock. */
export function generarResenasGoogleMock(): readonly ResenaGoogleMock[] {
  return [
    {
      id: 'resena-mock-1',
      autor: 'María González',
      calificacion: 5,
      texto: 'Excelente servicio, muy profesionales y atentos. Totalmente recomendado.',
      fecha: '2026-07-16T00:00:00.000Z',
      respuesta: '¡Muchas gracias por tu comentario, María! Nos alegra mucho que hayas tenido una buena experiencia.',
    },
    {
      id: 'resena-mock-2',
      autor: 'Carlos Rodríguez',
      calificacion: 4,
      texto: 'Muy buen producto, la calidad es excelente. El único detalle es que tardó un poco en llegar.',
      fecha: '2026-07-14T00:00:00.000Z',
      respuesta: 'Gracias por tu feedback, Carlos. Estamos trabajando en mejorar nuestros tiempos de entrega.',
    },
    {
      id: 'resena-mock-3',
      autor: 'Ana Martínez',
      calificacion: 5,
      texto: 'Increíble atención al cliente. Resolvieron todas mis dudas de manera rápida y eficiente.',
      fecha: '2026-07-10T00:00:00.000Z',
      respuesta: null,
    },
  ];
}

/**
 * Promedio de calificación, redondeado a un decimal (mismo criterio que el `averageRating` del
 * origen). `0` con la lista vacía — no hay reseñas de las que promediar, no es un error.
 */
export function promedioCalificacion(resenas: readonly ResenaGoogleMock[]): number {
  if (resenas.length === 0) return 0;
  const suma = resenas.reduce((acc, r) => acc + r.calificacion, 0);
  return Math.round((suma / resenas.length) * 10) / 10;
}

import { Component } from '@angular/core';

/**
 * Tab `/clientes/:id/resenas`. **Placeholder deliberado, no un "próximamente" decorativo.**
 *
 * El respondedor de reseñas de Google es el Bloque F del plan de plataforma y no tiene ni una línea
 * de código ni spec: antes de construirlo hay que decidir qué reseñas, con qué autorización de
 * Google, con qué compuerta humana (¿se publica sola una respuesta generada por IA en el perfil de
 * un cliente?) y qué pasa con el multi-tenancy de las credenciales.
 *
 * Lo que se muestra dice QUÉ FALTA. La alternativa —reciclar las tres reseñas inventadas que tenía
 * la pantalla «Mi Portal», retirada junto con su mock— es peor que un tab vacío: miente con más
 * detalle. Un restaurante que abra su ficha y vea tres reseñas que nadie escribió no descubre que el
 * módulo no existe; descubre que el portal le muestra datos que no son suyos.
 *
 * **El título es un `<h1>` y no un `<h2>`, con la misma clase.** Esta pantalla es una HOJA de la
 * ruta: monta en el `<router-outlet>` de `cliente-ficha.ts`, que es un contenedor y no declara
 * ninguno. Sin `<h1>` acá el documento se queda sin encabezado principal. El tamaño lo manda la
 * clase (`text-sm`), no la etiqueta — el preflight de Tailwind resetea el de los headings—, así que
 * no cambia un píxel. Lo fija `core/arbol-encabezados.test.ts`.
 */
@Component({
  selector: 'app-cliente-resenas',
  template: `
    <div class="bg-superficie rounded-xl border border-borde p-8 text-center">
      <h1 class="text-sm font-semibold text-texto">Reseñas de Google</h1>
      <p class="mt-2 text-sm text-texto-tenue max-w-md mx-auto">
        Todavía no disponible. El módulo de reseñas necesita antes una decisión de diseño: con qué
        autorización de Google se leen, y quién aprueba una respuesta antes de que se publique.
      </p>
    </div>
  `,
})
export class ClienteResenasPage {}

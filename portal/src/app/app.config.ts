import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    /*
     * `paramsInheritanceStrategy: 'always'` NO es cosmético: con el default (`'emptyOnly'`) una ruta
     * hija de path no vacío no ve los parámetros de su padre, así que `/clientes/:id/research` no
     * tendría `:id` en su `paramMap` y el tab no sabría de qué cliente está hablando. El modo de
     * fallo es silencioso —`params.get('id')` devuelve `null`, la pantalla se queda vacía— y por eso
     * lo cubre un test en `app.routes.test.ts`.
     */
    provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'always' })),
  ],
};

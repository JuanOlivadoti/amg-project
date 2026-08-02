---
name: portal-testing
description: Usar al escribir, arreglar o revisar tests del portal de AMG OS (portal/), y al decidir cómo probar algo que se acaba de implementar ahí. Cubre los dos runners y cuándo usa cada uno, el patrón de TestBed con componente anfitrión, la verificación por mutación y los tests que recorren el árbol de archivos.
---

# Tests del portal de AMG OS

El portal tiene **dos runners**, y elegir mal es la diferencia entre un test de 20 ms y uno que
necesita levantar Chrome.

| Archivo | Runner | Comando | Para qué |
|---|---|---|---|
| `*.test.ts` | `node:test` + `tsx` | `npm test` | Lógica pura de `core/`, servicios instanciables con `new`, y tests estructurales |
| `*.spec.ts` | Karma + ChromeHeadless | `npm run test:components` | Lo que necesita el DOM (componentes y plantillas) o el **inyector** de Angular (`services/membresia.spec.ts` usa `TestBed.inject` sin tocar el DOM) |

**La regla: si se puede probar con `node:test`, se prueba con `node:test`.** Eso se consigue sacando
la lógica a `core/` (ver `portal-angular`), que es la misma decisión de arquitectura vista desde el
otro lado. Un componente que necesita Karma para probar su lógica es un componente que tiene lógica
de más.

## Tests de `core/` con node:test

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtrarClientes, filtroVacio } from './clientes-filtro';

test('un filtro vacío no descarta nada', () => {
  assert.deepEqual(filtrarClientes(clientes, filtroVacio()), clientes);
});
```

`node:assert/strict` y nada más. Sin librería de aserciones, sin mocks mágicos: si hace falta un
doble, es un objeto literal.

Los servicios también entran acá cuando se pueden instanciar con `new` —`AuthService`, `TemaService`—
y eso es un motivo concreto para no meterles `effect()`, que exige contexto de inyección.

## Tests de componentes con TestBed

El patrón, tal cual está en `selector-miembro.spec.ts`: un **componente anfitrión** que envuelve al
que se prueba, para ejercitar los `input()`/`output()` como los usa una pantalla real.

```ts
@Component({
  imports: [SelectorMiembroComponent],
  template: `<app-selector-miembro [valor]="valor()" (cambio)="ultimo.set($event)" />`,
})
class Anfitrion {
  readonly valor = signal('');
  readonly ultimo = signal<string | null>(null);
}

function render(miembros: Miembro[], valor = '') {
  TestBed.configureTestingModule({
    imports: [Anfitrion],
    // El doble es un objeto con signals: la interfaz que el componente consume, nada más.
    providers: [{ provide: MembresiaService, useValue: { miembros: signal(miembros) } }],
  });
  const fixture = TestBed.createComponent(Anfitrion);
  fixture.componentInstance.valor.set(valor);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}
```

Se afirma sobre el **DOM renderizado** (`querySelectorAll('option')`, el `.value` del select), no
sobre campos internos de la clase: eso es probar el contrato y no la implementación. Los eventos se
disparan de verdad (`dispatchEvent(new Event('change'))`).

Una factoría de datos (`function miembro(...)`) arriba del `describe` evita repetir objetos completos.

## Los tests estructurales

Los más valiosos del portal no prueban una función: **recorren el árbol de archivos y verifican una
regla en todo lo que exista**, incluido lo que todavía no se escribió.

- `contraste.test.ts` recorre `src/app` buscando hex, `style="color:"`, funciones de color y clases
  de la paleta cruda de Tailwind. Cubre la pantalla que escribas mañana.
- `capacidades.test.ts` abre el archivo SQL que cada capacidad cita y busca el símbolo exacto: si
  alguien renombra una política, la fila que la citaba cae.
- El test del tema compara los nombres de `TOKENS`, los de `:root`, los de `.oscuro` y los de
  `@theme inline`, y exige que cada `--color-X` apunte a `--X`.

> **Las plantillas se descubren, no se listan.** Una lista fija cubre las pantallas de hoy; recorrer
> el directorio es lo que hace que la regla se cumpla sola en las de mañana.

Cuando escribas uno de estos, asegurate de que el recorrido **no pueda encontrar cero archivos**:
`assert.ok(archivos.length >= 4, …)`. Un recorrido que no encuentra nada pasa en verde sin haber
probado nada.

## La convención 🔴

Un test cuyo título arranca con `🔴` es un test que **nació de un bug real y se verificó por
mutación**: se reintrodujo el fallo y se confirmó que cae exactamente ese test.

No es decoración. Marca la diferencia entre un test que documenta y uno que defiende. Ponelo solo
cuando hiciste la mutación de verdad.

```
test('🔴 un valor guardado que no está en la lista se CONSERVA, no se pierde en silencio', …)
```

Y en el cuerpo, un comentario con **por qué pasa de verdad** ("una membresía que se quitó, o un rol
`cliente` que solo se ve a sí mismo"). El título dice qué; el comentario dice por qué importa.

## Rojo primero, y después la mutación

El ciclo del proyecto, sin atajos:

1. **Rojo primero.** El test falla por el motivo correcto. Un test que pasa apenas se escribe no
   demostró nada.
2. El arreglo mínimo.
3. **Verificación por mutación.** Reintroducí el bug y confirmá que cae *exactamente* su test. Si
   cae otro, o no cae ninguno, el test no prueba lo que decís.

Dos reglas que salieron de revisiones y cuestan caro olvidarlas:

- **Un default de producción sin test es una decisión sin dueño.** Si el test elige el parámetro, no
  está fijando el que corre en producción — por eso `contraste.test.ts` afirma
  `assert.equal(AA_TEXTO_NORMAL, 4.5)` además de usarlo en las comparaciones.
- **Probá el contrato, no la implementación.** Un test que reproduce el código línea por línea sigue
  verde cuando el código está mal.

## Lo que ningún test de acá ve

Karma renderiza componentes aislados; `node:test` no abre un navegador. **Ninguno de los dos ve la
app funcionando.** Las carreras asincrónicas del brief, el fogonazo de tema al recargar y el estado
intermedio feo salieron de usar la aplicación, no de leer el código ni de correr la suite.

Después de la suite verde: `npm start`, y en el navegador (MCP chrome-devtools) mirá la consola,
probá los dos temas, recargá con el tema oscuro activo y navegá entre dos registros de la misma ruta
—rápido— para provocar la carrera.

## Errores frecuentes

| Error | Qué pasa |
|---|---|
| Un `.spec.ts` con Karma para probar lógica pura | Tarda cien veces más y prueba lo mismo. Sacá la lógica a `core/` |
| Afirmar sobre campos de la clase del componente en vez del DOM | Es probar la implementación: sigue verde con el render roto |
| Un test estructural que puede recorrer cero archivos | Verde perpetuo. Afirmá un mínimo de archivos encontrados |
| Poner 🔴 sin haber hecho la mutación | La marca deja de significar algo, y es la única señal de que un test defiende |
| Dar por cerrado con la suite verde y sin abrir el navegador | Los dos métodos encuentran cosas distintas. La lista de arriba salió del navegador |
| Un mock que reimplementa el servicio real | El doble es la interfaz que el componente consume, nada más |

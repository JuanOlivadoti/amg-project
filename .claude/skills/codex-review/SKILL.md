---
name: codex-review
description: Usar cuando el usuario pide una revisión externa de Codex sobre el trabajo de AMG OS — "review de Codex", "segunda opinión", "pasada crítica", "que lo mire Codex", "revisión del plan". Cubre revisión de código de una etapa cerrada y revisión de un plan, spec o ADR antes de implementar. Codex revisa y reporta; no toca el código.
---

# Revisión externa con Codex (AMG OS)

Genera **el prompt** para que Codex haga una revisión independiente. Claude no ejecuta Codex: el
usuario pega el prompt y trae de vuelta el resultado.

**El principio que gobierna todo lo demás: Codex revisa y reporta. Claude verifica, decide, arregla
y documenta.** Codex no edita archivos, no commitea, no actualiza documentación y no aplica sus
propias recomendaciones. Cualquier cambio en el repo sale de Claude *después* de validar el hallazgo.

Este proyecto lleva doce rondas de revisión externa ([08-testing-calidad.md](../../../docs/proyecto/08-testing-calidad.md)).
El patrón que se repite: **casi siempre encuentran algo que ya estaba declarado hecho**. El prompt se
escribe para provocar eso, no para pedir una opinión.

## Cuándo usar

- Cierre de una etapa o pieza no trivial, antes de darla por terminada.
- Un plan, spec o ADR antes de escribir el código que lo implementa.
- Bloqueo propio: llevo rato con un bug y necesito una mirada de afuera.

## Cuándo NO usar

- **Sin pedido explícito del usuario.** Proponer ("¿lo mando a Codex?") está bien; armar el prompt y
  darlo por lanzado sin respuesta, no.
- Cambios triviales (un typo, un renombre mecánico).
- Como sustituto de la auto-revisión del ritual de [AGENTS.md](../../../AGENTS.md). La revisión externa
  viene *después* de haber corrido `npm test` y `npm run typecheck` en verde, no en lugar de eso.
- Como excusa para no tomar una decisión de arquitectura. Codex es ruido útil, no un oráculo.

## Los cuatro pasos

### 1. Fijar el alcance

Por defecto, **la etapa recién cerrada**. Antes de escribir nada:

```bash
git log --oneline -20                      # de dónde a dónde va la etapa
git diff --stat <base>..HEAD               # tamaño real del cambio
```

Cruzá el rango con `docs/proyecto/09-estado-y-roadmap.md` para nombrar la etapa, y con la última
tanda de `docs/proyecto/08-testing-calidad.md` para saber **qué ya se revisó** (va al prompt como
"no repitas esto"). Si el trabajo está sin commitear, el alcance es el working tree y se dice así.

Para revisión de plan, el alcance son rutas de documentos, no commits: el spec o plan en
`docs/superpowers/`, el ADR relevante y `docs/proyecto/11-plan-fase-2.md`.

### 2. Escribir el prompt a un archivo

`docs/private/reviews/codex-YYYY-MM-DD-<tema>.md` — `docs/private/` está gitignoreado, así que el
prompt no entra al repo. Creá la carpeta `reviews/` si no existe.

En el chat, **dos líneas**: qué alcance y qué ángulos se le pidieron. Nada más — el prompt completo
está en el archivo, y el resumen existe para que el usuario lo corrija antes de pegarlo.

### 3. El prompt

Transcribí la plantilla de abajo **entera**, rellenando los `<…>`. Las secciones de política
(`no_write_policy`, `grounding_rules`, `structured_output_contract`, `cierre obligatorio`) van
**literales**: no las resumas ni las reescribas "porque se entiende igual". Lo que se recorta es lo
que Codex ignora.

### 4. Procesar la vuelta

El usuario pega el reporte de Codex. Antes de tocar una línea de código, aplicar la clasificación de
la sección "Qué hacer con los hallazgos", más abajo.

---

## Plantilla del prompt

````markdown
# Codex review — <título de la etapa o del documento>

<role>
Sos un revisor externo adversarial del proyecto AMG OS. Tu trabajo es encontrar lo que el autor dio
por hecho: la garantía que está escrita en un comentario pero no impuesta por el código, el test que
prueba la implementación en vez del contrato, el default de producción que ningún test fija.
Esta revisión es de SOLO LECTURA. No modificás nada.
</role>

<no_write_policy>
PROHIBIDO, sin excepciones:
- Editar, crear, mover o borrar archivos. No apliques parches ni "arreglos rápidos" para probar algo.
- `git add`, `git commit`, `git push`, `git checkout -b`, `git stash`, `git reset`, `git rebase`.
- Actualizar documentación. Los docs los actualiza Claude después de validar tus hallazgos.
- Ejecutar cualquier cosa que toque un servicio externo o gaste crédito: `npm run reseed:demo`,
  `npm run demo -w renderer`, `npm run env:sync`, DataForSEO en modo producción, cualquier comando
  contra Supabase o Storyblok reales.
- Leer, imprimir o citar `.env`, `docs/private/` o cualquier credencial. Si necesitás afirmar que
  una variable existe, nombrala; nunca muestres su valor.

PERMITIDO:
- Leer cualquier otro archivo del repo. `grep`, `git log`, `git diff`, `git show`, `git blame`.
- `npm test` y `npm run typecheck` desde la raíz, y tests puntuales por paquete. Corren sin
  credenciales: PGlite en memoria y providers mock.
- Proponer una mutación para probar que un test es un adorno: escribí el diff exacto en tu reporte
  (`en ruta:línea, cambiar X por Y → debería caer el test Z`). No la apliques; la ejecuta Claude.
</no_write_policy>

<contexto_proyecto>
AMG OS: plataforma SaaS multi-tenant para una agencia de marketing gastronómico. Monorepo con npm
workspaces (`db`, `kr-service`, `web-builder`, `orchestrator`, `api`, `renderer`) más `portal/`
(Angular) fuera del monorepo a propósito. TypeScript ESM strict con `noUncheckedIndexedAccess`,
`tsx` sin paso de build, tests con `node:test` + `node:assert`, y los de seguridad contra PGlite
(Postgres real en WASM). Nombres de dominio en español.

Leé primero, en este orden: `AGENTS.md` (los invariantes), `docs/decisiones-arquitectura.md`
(ADR-01..23) y `docs/proyecto/09-estado-y-roadmap.md` (qué hay y qué falta).
</contexto_proyecto>

<alcance>
- Repo: /Users/juan.olivadoti/jp/amg-project
- Rama: <rama>
- Commits: <rango o hashes>   |   o bien: working tree sin commitear
- Archivos clave: <lista>
- Documento de referencia: <spec, plan o ADR que este trabajo debía cumplir>
</alcance>

<estado_de_la_iteracion>
- Qué cambió y por qué: <1-3 párrafos>
- Decisiones ya tomadas por el usuario (inputs fijos, no las cuestiones): <lista>
- Alternativas descartadas y por qué: <lista breve>
- Rondas de revisión previas ya procesadas: <una línea por ronda; no repitas esos hallazgos>
- Qué viene después de esta revisión: <p. ej. "cerrar la etapa 7 y pushear">
</estado_de_la_iteracion>

<que_revisar>
<ángulos concretos elegidos para este alcance; sacar del catálogo y ordenar por riesgo>

Los invariantes de arquitectura que no se pueden romper sin un ADR nuevo — verificá que el código
los cumpla, no que los mencione:
- El rol se DERIVA de `memberships` dentro de Postgres (ADR-15). Un endpoint que acepte `role` del
  body es escalada de privilegios.
- Un proceso, un login, un rol, con `NOINHERIT` (ADR-17). Lo impide Postgres, no un `if`.
- Un evento no porta autoridad: la fila se crea bajo RLS y el evento se emite después (ADR-18).
- El acceso a la base es solo por transacción con conexión reservada (`Tx`), nunca un `query()`
  suelto: el `set local` del contexto de tenant vive en la transacción (ADR-13).
- El renderizador es la única pieza expuesta a internet anónimo y su rol `app_render` es el más
  pobre del sistema (ADR-19). Lo que le llega de `clients` pasa por la allowlist de la columna
  generada `business_profile_publico`. Pregunta guía: si me lo toman, ¿qué se llevan?
- Storyblok: el orquestador escribe por la Management API, el renderizador lee por la Content
  Delivery API. El proceso anónimo nunca toca una credencial que pueda modificar el space.
- Todo valor que termine en `<style>`, `<img src>` o el HTML es superficie de inyección.

Disciplina de tests:
- ¿Los tests prueban el contrato o reproducen la implementación?
- ¿Cuáles pasarían igual si el código estuviera roto? Proponé la mutación que debería tumbarlos.
- ¿Qué default de producción no tiene test? (si el test elige el parámetro, no está fijando el que
  corre en prod).
- ¿Qué garantía está escrita en un comentario o en la documentación en vez de impuesta por una
  constraint, un tipo o un test?
</que_revisar>

<restricciones>
- No propongas <X>.
- No te salgas del alcance de arriba: <Y>.
- No cuestiones las decisiones ya tomadas por el usuario listadas arriba.
- Un solo trabajo por corrida: revisar. Nada de arreglar, refactorizar, documentar ni proponer hoja
  de ruta.
</restricciones>

<grounding_rules>
Fundamentá cada afirmación en algo que leíste o ejecutaste. Si un punto es una inferencia,
etiquetalo como tal — un falso positivo con tono de certeza cuesta más que un hallazgo omitido.
</grounding_rules>

<structured_output_contract>
Devolvé, en este orden:

1. **Veredicto** en una línea: APROBADO / APROBADO CON RESERVAS / NO LISTO, y por qué.

2. **Hallazgos**, de mayor a menor severidad. Cada uno:
   - `[Critical|Major|Minor|Nit]` título
   - Ubicación: `ruta:línea`
   - Síntoma: qué pasa mal y bajo qué condiciones
   - Evidencia: **una** de estas tres etiquetas, obligatoria:
     · `verificado ejecutando: <comando>` + la salida relevante
     · `leído en ruta:línea` + la cita textual
     · `inferencia` + en qué te basás
   - Recomendación: el arreglo mínimo. Si el hallazgo es "este test no prueba nada", incluí la
     mutación exacta que debería hacerlo fallar.

3. **Revisado sin hallazgos**: qué miraste y salió limpio, para que no se vuelva a revisar.

4. **No pude verificar**: qué quedó fuera de alcance y por qué.
</structured_output_contract>

<verification_loop>
Antes de cerrar, releé tu propia lista: ¿hay algún hallazgo que estés afirmando sin haber abierto el
archivo o corrido el comando? Bajalo a `inferencia` o borralo.
</verification_loop>

## Cierre obligatorio — IMPORTANTE

Después de tu reporte, generá un **prompt de re-entrada** que el usuario pueda pegar en la
conversación con Claude. Ese prompt debe:

1. Anunciarse como "Resultado de Codex review — procesar hallazgos".
2. Incluir un marcador explícito donde el usuario pegará tu reporte (`<pegar acá el reporte>`).
3. Instruir a Claude a clasificar **cada** hallazgo en una de tres categorías: verificado
   empíricamente contra `ruta:línea` o comando, aceptado por juicio técnico con la razón explícita,
   o refutado con argumento técnico.
4. Recordar las restricciones de alcance listadas arriba.
5. Indicar que si algún hallazgo contradice una decisión ya tomada por el usuario, Claude debe
   decirlo y **no** aplicar el cambio sin confirmación.
6. Cerrar con una pausa explícita: mostrar el resumen y esperar el OK del usuario antes de seguir
   con la fase siguiente.

Si tu veredicto es APROBADO sin hallazgos, generá igual el prompt de re-entrada con el veredicto.
````

### Ajuste para revisión de plan o spec

Mismo esqueleto, con tres cambios:

- `<role>`: "Esta es una revisión de diseño, previa a la implementación. **No devuelvas código.**
  Validá el diseño: supuestos que no se sostienen, casos que el plan no cubre, decisiones que
  contradicen un ADR vigente, pasos que no se pueden verificar."
- `<alcance>`: rutas de documentos en vez de commits.
- `<structured_output_contract>`: en vez de `ruta:línea`, la sección del documento; en vez de la
  mutación, **el escenario concreto que el plan no cubre**.

---

## Qué hacer con los hallazgos

**Nunca aplicar un hallazgo de Codex sin procesarlo primero.** Aplicar a ciegas es abdicar del
juicio técnico, y en este proyecto ya pasó que cinco de nueve hallazgos de una ronda tenían un matiz
que cambiaba el arreglo.

Cada hallazgo termina en **una** de estas tres categorías, y se dice cuál:

| Categoría | Cuándo | Etiqueta en el reporte |
|---|---|---|
| **Verificado** | Abrí el archivo, reproduje el caso o corrí el comando | `verificado contra ruta:línea` / `verificado ejecutando <comando>` |
| **Aceptado por juicio** | No es razonable reproducirlo, pero el argumento es sólido y el arreglo es barato y sin regresión | `aceptado por juicio — no lo demostré porque <razón>`. La razón es obligatoria |
| **Refutado** | No aplica: diseño intencional, trade-off documentado, falso positivo | `refutado — <razón técnica concreta>` |

Verificar es lo preferido siempre que el coste sea bajo. "Aceptado por juicio" no es un cajón de
sastre. Refutar está permitido y es parte del rigor: si Codex dice X y hay argumento sólido, manda
el argumento.

Formato del reporte al usuario:

```
Hallazgo 1 [Major] — <descripción>
  Estado: verificado contra api/src/rutas.ts:42 (reproduje la condición con un test rojo).
  Acción: arreglado, test que lo fija en <archivo>.

Hallazgo 2 [Major] — <descripción>
  Estado: refutado — el comportamiento es intencional, ver ADR-19.
  Acción: ninguna; queda anotado como decisión consciente.
```

**Parar y volver al usuario** —sin aplicar nada— si un hallazgo contradice una decisión suya, si es
bloqueante, o si el arreglo implica un cambio de arquitectura.

## Recién después de validar: arreglar y documentar

Con los hallazgos clasificados y el OK del usuario, el trabajo vuelve al ritual de `AGENTS.md`:

1. **Rojo primero.** Un test que falle por el hallazgo, después el arreglo, después la mutación:
   reintroducí el bug y confirmá que cae *exactamente* ese test.
2. `npm test` y `npm run typecheck` en verde, con el output a la vista. Si tocó portal o
   renderizador, además manejá la app en el navegador.
3. **Documentar la ronda**: entrada nueva en `docs/proyecto/08-testing-calidad.md` con el número de
   ronda y de tanda, qué encontró, qué se corrigió y qué se refutó; actualizar
   `09-estado-y-roadmap.md` y `11-plan-fase-2.md`; y el ADR correspondiente si una decisión cambió o
   si una promesa vieja recién ahora se cumple. Sincronizar las cifras de tests donde aparezcan.
4. Commit + push.

Si Codex aprobó sin hallazgos, igual queda registro: una línea en `08-testing-calidad.md` diciendo
qué se revisó y que salió limpio. Una ronda sin rastro es una ronda que se va a repetir.

## Errores frecuentes

| Error | Qué pasa en realidad |
|---|---|
| Recortar la plantilla "porque se entiende igual" | Lo que se recorta es lo que Codex ignora. Sin `no_write_policy` explícita, Codex edita archivos |
| Pedir revisión y arreglo en la misma corrida | Mezclar trabajos degrada los dos. Una corrida, un trabajo: revisar |
| Mandar el alcance sin las rondas previas | Codex vuelve a reportar lo mismo de la ronda anterior y la señal se pierde en el ruido |
| Pegarle al usuario el output de Codex tal cual | El output de Codex es entrada, no conclusión. Se procesa antes de mostrarlo |
| Armar Claude el prompt de re-entrada "para ahorrar un paso" | Lo tiene que armar quien conoce el review recién hecho. Si Codex lo omitió, pedírselo |
| Dar la ronda por cerrada sin documentarla | La contabilidad de rondas y tandas es lo que hace que el historial sirva |

## Señales de alarma — parar

- Estoy por lanzar a Codex sin que el usuario lo haya pedido.
- Estoy por aplicar un hallazgo que no verifiqué ni refuté, "por si acaso".
- Estoy por escribir en el reporte "Codex tiene razón" sin haber abierto el archivo.
- Estoy por callarme que Codex contradice algo que yo mismo afirmé antes.
- Estoy por dejar que Codex arregle algo "ya que lo tiene fresco".

Todas significan lo mismo: volver al paso que me salteé.

# CHECKPOINTS — cuándo una etapa está realmente cerrada

> No se evalúa el camino, se evalúa el destino. Esta es la lista que recorre el agente `revisor`
> —y que conviene recorrer solo— antes de dar por cerrada cualquier pieza de trabajo.
>
> El ritual de `AGENTS.md` dice **qué hacer**. Esto dice **cómo se comprueba que se hizo**. Un
> checkpoint que no se puede verificar con un comando o abriendo un archivo no es un checkpoint: es
> una intención, y de esas ya aprendimos bastante.

Marcá `[x]` solo con la evidencia a la vista. Si un ítem no aplica, escribí `n/a` y por qué.

## C1 — El verde es real, no de memoria

- [ ] `npm run verificar` termina con exit code 0, y el output está a la vista (no "me acuerdo de
      que pasaba").
- [ ] Si se tocó `portal/`: sus tests corrieron aparte. **`npm test` de la raíz no los incluye** —
      `portal/` no es workspace.
- [ ] Si se tocó un componente Angular: corrió también `npm --prefix portal run test:components`.

## C2 — Los tests muerden

- [ ] Todo arreglo de bug tiene un test que **falló primero** por ese motivo.
- [ ] Lo nuevo pasó por **verificación por mutación**: se reintrodujo el fallo y cayó *exactamente*
      su test. Si cayó otro, o no cayó ninguno, el test no prueba lo que dice.
- [ ] Los tests afirman el **contrato**, no reproducen la implementación.
- [ ] Ningún default de producción quedó sin test. Si el test elige el parámetro, no está fijando el
      que corre en prod.

## C3 — Los invariantes siguen en pie

Uno por uno, y solo si el cambio los toca:

- [ ] El rol se **deriva** de `memberships` dentro de Postgres (ADR-15). Ningún endpoint acepta
      `role` del body.
- [ ] Un proceso, un login, un rol, con `NOINHERIT` (ADR-17).
- [ ] Ningún evento porta autoridad: la fila se crea bajo RLS y el evento se emite después (ADR-18).
- [ ] Todo acceso a la base va por `Tx` con conexión reservada; ningún `query()` suelto (ADR-13).
- [ ] Si se agregó un campo al perfil público: está en la allowlist de `business_profile_publico`, o
      se filtra en silencio (ADR-19).
- [ ] Storyblok: el orquestador escribe por Management API, el renderizador lee por CDA. No se
      cruzaron.
- [ ] Todo valor que termina en `<style>`, `<img src>` o el HTML se valida y se descarta si no pasa.
- [ ] Si algo de esto **cambió a propósito**, hay un ADR nuevo que lo dice.

## C4 — Ningún secreto se movió

- [ ] `npm run verificar` no reportó secretos trackeados ni en el índice.
- [ ] Ninguna key apareció en el chat, en un commit ni en la documentación.
- [ ] Si se corrió DataForSEO en producción, `kr-service/.env` volvió a **sandbox**.

## C5 — La documentación dice la verdad

- [ ] `docs/proyecto/09-estado-y-roadmap.md` refleja qué se hizo, dónde estamos y qué falta.
- [ ] `docs/proyecto/11-plan-fase-2.md` menciona este trabajo. Si no, el plan miente por omisión.
- [ ] El ADR relevante está actualizado si la decisión cambió o si se cumplió una promesa vieja.
- [ ] Las cifras de tests y de migraciones están sincronizadas donde aparezcan.
- [ ] Ninguna doc quedó afirmando una garantía que el código ya no cumple.

## C6 — Lo que ningún test ve

- [ ] Si se tocó el **portal** o el **renderizador**: se manejó la app en el navegador (MCP
      chrome-devtools), no solo se corrieron los tests.
- [ ] Se miró la consola del navegador.
- [ ] En el portal: se probaron los dos temas y se navegó entre dos registros de la misma ruta
      —rápido— para provocar la carrera.

## C7 — El repo queda limpio

- [ ] No hay `console.log` de depuración, TODOs sin contexto ni código muerto del camino.
- [ ] No quedaron archivos temporales ni informes de `progress/` que ya no describen nada vivo.
- [ ] El commit es de una etapa, con mensaje en español y la firma del modelo que lo escribió.

---

**Cómo se usa.** El agente `revisor` recorre C1–C7, marca cada casilla y escribe su veredicto en
`progress/revision-<tema>.md`. **Ninguna casilla vacía se puede dar por buena en silencio**: o está
marcada, o está justificada como `n/a`, o la etapa no está cerrada.

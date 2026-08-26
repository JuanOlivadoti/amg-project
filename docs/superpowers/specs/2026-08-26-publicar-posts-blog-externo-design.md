# Publicar posts en un blog ya existente (plataforma externa) — diseño

**Sub-proyecto 3 de 3** de la iniciativa "generalizar AMG OS" (ver `progress/current.md`). Diseñado
en serie después de los sub-proyectos 1 (multi-vertical de clientes) y 2 (desacoplar keyword
research de creación de webs) — ambos con spec+plan completos, sin implementar. No se implementa
nada de esto hasta que los tres tengan spec+plan y pasen una revisión conjunta.

## Problema

El sub-proyecto 2 reservó el destino `crear_posts` en `kr_run_decisiones` (destino reconocido en el
modelo de datos, rechazado con `501` por la API — ver
`docs/superpowers/specs/2026-08-26-desacoplar-kr-web-design.md`, decisión #2) precisamente para este
sub-proyecto. Hoy no existe ningún camino para que el research de un cliente termine publicado como
posts en un blog que la agencia no construyó — el cliente ya tiene su web (en WordPress, Wix, o lo
que sea) y quiere que AMG le entregue contenido optimizado por keyword research directo a ESE blog,
sin que la agencia le construya un sitio nuevo.

## Estado actual del código (verificado)

- **`kr_run_decisiones` ya tiene el destino reservado**: `destino_run` incluye `'crear_posts'`
  (spec del sub-proyecto 2), y `POST /runs/:id/approve` lo rechaza con `501 { codigo:
  "NO_IMPLEMENTADO" }` antes de tocar la base. Este sub-proyecto **retira ese rechazo** y completa
  la rama real.
- **`workflowDecision`** (sub-proyecto 2, `orchestrator/src/workflow.ts`) ya tiene el `if
  (decision.destino === "crear_posts")` como stub: cierra la decisión en `error` con un mensaje
  explícito. Este sub-proyecto reemplaza ese stub por la generación real.
- **El precedente exacto a replicar ya existe en el código, para otro dominio**: el borrador de
  respuesta a reseñas de Google (Bloque F, fase 2). Investigado a fondo para este spec:
  - Generación por IA con provider mock/real seleccionado por config (`BorradorProvider`,
    `orchestrator/src/borrador/provider.ts:11-13`), con un prefijo inconfundible en el mock
    (`MockBorradorProvider`, `mock-provider.ts:10`) para que nunca se confunda con contenido real.
  - El borrador vive como **columnas nuevas en la fila del recurso** (`resenas_google.
    borrador_respuesta`, `borrador_generado_en` — migración `0024`), no en una tabla aparte.
  - Edición humana vía `PATCH` con body de **una sola clave por vez**
    (`{"borrador_respuesta": string}`), bajo RLS normal (`app_user`, política `resena_marcar_vista`
    reutilizada).
  - Publicación como **comando compuesto** (ADR-18): `{"publicar": true}` marca
    `respuesta_solicitada_en` bajo RLS primero; solo si la fila cambió se emite el evento
    `resenas/respuesta.solicitada` con únicamente el `id` — el orquestador vuelve a preguntarle a la
    base qué publicar (`resenaParaPublicar`) antes de actuar. El evento no porta autoridad.
    Confirmado publicado solo lo que el proveedor externo **confirma**, nunca lo que "se mandó".
  - Portal: staff edita, rol `cliente` solo lee (`cliente-resenas.ts:137-141`) — nunca un control
    que RLS rechazaría en silencio.
- **`kr_pages`** (la tabla que este sub-proyecto extiende, mismo criterio que `resenas_google`) ya
  tiene `content_brief` (jsonb: la guía de qué debe decir el contenido) y `seo` por página — es el
  insumo que el `PostProvider` nuevo consume para generar el texto final. Hoy ese `content_brief` se
  usa para plantillas del M1 (`web-builder`), no para prosa de blog.
- **`web-builder/src/llm/content.ts`** ya usa OpenAI para generación de contenido en el pipeline —
  mismo proveedor que eligió el borrador de reseñas ("mismo que web-builder", ver su spec) por
  consistencia, no por necesidad técnica.

## La decisión

| # | Decisión | Alternativa descartada |
|---|---|---|
| 1 | La publicación externa es **genérica/pluggable** (`BlogPublisher`), con una plataforma de referencia en el spec pero sin comprometerse a construirla si no hay cliente real confirmado — no hay plataforma decidida con el cliente todavía | Atarse a WordPress específicamente ahora — se puede, pero el usuario no tiene confirmación comercial de cuál plataforma hace falta |
| 2 | Este sub-proyecto **completa el mecanismo `crear_posts`** ya reservado por el sub-proyecto 2 — mismo punto de entrada, misma compuerta de aprobación humana | Un flujo separado, no atado al research — perdería toda la infraestructura de páginas/keywords/aprobación ya construida |
| 3 | El texto del post (título + cuerpo) **se genera con IA** dentro de este sub-proyecto, a partir del `content_brief` + keywords de cada página | Que alguien lo escriba a mano — no resolvería "generar contenido", solo "publicar contenido ya existente" |
| 4 | El borrador generado **se revisa/edita en el portal antes de publicar** — segunda compuerta humana, específica del texto (no alcanza con la aprobación de la página) | Publicar directo al generar — más rápido, pero el primer humano en ver el texto final sería quien lee el blog público |
| 5 | Un `crear_posts` genera **un post por cada página aprobada** del run | El humano elige cuáles páginas se convierten en posts — más control, más UI nueva que este spec no necesita |
| 6 | La publicación, una vez aprobado cada borrador, es **inmediata** (sin cola ni scheduler) | Publicación escalonada en el tiempo (ej. 1 post/día) — práctica real de SEO, pero requiere una pieza de orquestación nueva; queda fuera de alcance, se puede agregar después |

## Arquitectura

**Reusa el molde exacto del borrador de reseñas, aplicado a `kr_pages` en vez de `resenas_google`:**

### 1. Generación — dentro de `workflowDecision`, reemplaza el stub de `crear_posts`

A diferencia del borrador de reseñas (que se genera en un polling automático), acá la generación se
dispara por la aprobación humana del run — mismo punto donde hoy el stub cierra en `error`.
`workflowDecision` (sub-proyecto 2) gana una rama real:

```ts
// orchestrator/src/workflow.ts — reemplaza el stub de crear_posts (sub-proyecto 2, Task 6)
if (decision.destino === "crear_posts") {
  // No hace falta un método nuevo: `getRunPages` (ya existe, db/src/store.ts:1600) devuelve
  // `PaginaPropuesta` con `id`, `approved` y excluye retiradas — el mismo dato que
  // `getPublishablePages` (que usa crear_web) salvo por el `id`. Filtramos `approved` acá porque
  // `registrarDecision` ya garantizó que el run está aprobado antes de llegar a esta rama
  // (Codex, ronda 1, hallazgo "Nit").
  const todas = await deps.store.getRunPages(ctx, decision.run_id);
  const paginas = todas.filter((p) => p.approved);
  if (paginas.length === 0) {
    await deps.store.cerrarDecision(ctx, decisionId, {
      resultado: "error",
      detalleError: "El run no tiene páginas publicables.",
    });
    return { decisionId, runId: decision.run_id, destino: decision.destino, resultado: "error" as const };
  }

  const cliente = await deps.store.getClient(ctx, decision.client_id);
  let generados = 0;
  for (const pagina of paginas) {
    // Falla puntual: si el LLM revienta en UNA página, las demás se generan igual — mismo criterio
    // que pollearResenas con el borrador de reseñas (functions.ts:229-230). Sin reintento automático
    // acá; el reintento por página queda para el plan (ver "Riesgos").
    try {
      const post = await deps.postProvider.generar({
        contentBrief: pagina.content_brief,
        keywordPrincipal: pagina.keyword_principal,
        perfilCliente: cliente?.business_profile ?? null,
      });
      await deps.store.guardarPost(ctx, pagina.id, post); // sanitiza antes de persistir — ver "Modelo de datos"
      generados++;
    } catch (e) {
      log(`[decision ${decisionId}] falló la generación del post para ${pagina.url_slug}: ${(e as Error).message}`);
    }
  }

  // Codex, ronda 1, hallazgo Major: 'completado' incondicional escondía un run con CERO posts
  // generados detrás de un resultado que parece éxito. Ahora el agregado refleja si hubo al menos
  // un éxito. 'completado' acá significa "hay al menos un borrador esperando revisión" — NUNCA
  // "publicados". Distinto de crear_web, donde 'completado' sí significa publicado. Ver "Riesgos".
  // Qué página falló se ve por página (post_generado_en null en las que no se generaron) — no hace
  // falta una columna de estado nueva.
  if (generados === 0) {
    await deps.store.cerrarDecision(ctx, decisionId, {
      resultado: "error",
      detalleError: `Falló la generación de los ${paginas.length} posts del run — ver logs.`,
    });
    return { decisionId, runId: decision.run_id, destino: decision.destino, resultado: "error" as const };
  }
  await deps.store.cerrarDecision(ctx, decisionId, { resultado: "completado" });
  return { decisionId, runId: decision.run_id, destino: decision.destino, resultado: "completado" };
}
```

**`PostProvider`** — misma forma que `BorradorProvider`:

```ts
// orchestrator/src/post-blog/provider.ts
export interface PostBlogGenerado {
  titulo: string;
  // Formato canónico: HTML, sanitizado por allowlist ANTES de llegar acá — ver "Sanitización" en
  // "Modelo de datos". `PostProvider.generar` devuelve el HTML crudo del LLM; quien lo persiste
  // (guardarPost) es responsable de sanitizarlo, no el provider.
  cuerpo: string;
}

export interface PostProvider {
  generar(args: {
    contentBrief: Record<string, unknown>;
    keywordPrincipal: string;
    perfilCliente: Record<string, unknown> | null;
  }): Promise<PostBlogGenerado>;
}
```

Selector mock/real por config, igual que `getBorradorProvider` (`orchestrator/src/borrador/
provider.ts:19-23`): `"openai"` con `OPENAI_API_KEY` presente, mock si no. El mock lleva el mismo
tipo de prefijo inconfundible (`MockBorradorProvider`, `mock-provider.ts:10`) para que un post mock
nunca se confunda con uno real en el portal.

### 2. Publicación externa — comando compuesto, por PÁGINA, no por RUN

A diferencia de `crear_web` (donde la publicación es parte del mismo `workflowDecision`), acá la
publicación de cada post es una acción **separada y posterior**, disparada por el staff desde el
portal — exactamente como "Publicar respuesta" en reseñas. Un `crear_posts` puede generar 5 borradores
y el staff publicarlos de a uno, en momentos distintos (dentro del alcance de "todos de una vez al
aprobar CADA borrador" — decisión #6: no hay cola, pero tampoco hay obligación de publicar los 5
juntos).

**Corrección de ruta (encontrada al escribir el plan de implementación, no en la ronda de Codex):**
`PATCH /clients/:id/pages/:pageId` no existe hoy — la ruta real de edición de páginas es
**`PATCH /pages/:id`** (plana, sin `/clients/:id/`, `api/src/app.ts:348-356`; `editPage` no recibe
`clientId`, RLS ya lo resuelve por la fila). El diseño de abajo se ajusta a esa ruta real, extendida
(no una ruta nueva) — `filtrarCambios` ya acepta múltiples campos juntos en un solo `PATCH` (no
"una sola clave", ese patrón es solo de `resenas`), así que `post_titulo`/`post_cuerpo` entran como
dos campos más de esa misma allowlist, en un handler que dirige por FORMA del body a un método de
store distinto (edición de brief vs. edición de post vs. comando de publicar — nunca mezclados en
el mismo request).

```ts
// api/src/app.ts — PATCH /pages/:id, extendido
// { url_slug?, keyword_principal?, seo?, content_brief?, preguntas_frecuentes? } (uno o más) →
//   editPage, sin cambios (revoca approved, ADR-06 — comportamiento ya existente).
// { post_titulo?, post_cuerpo? } (al menos una) → editarPost (bajo RLS normal, app_user). NO revoca
//   approved — editar el TEXTO del post no es editar el BRIEF que la página aprobó.
//   A diferencia de resenas (una clave estricta), acá las dos viven en el mismo formulario del
//   portal y se editan juntas — Codex, ronda 1, hallazgo Minor: la versión anterior del spec decía
//   "una sola clave" en un lugar y las dos juntas en otro; queda resuelto a favor de "las dos juntas,
//   ninguna otra combinación" (mismo criterio que ya usa editPage con sus cinco campos).
//   editarPost RECHAZA la escritura (retorna false, sin lanzar) si post_solicitado_en is not null
//   and post_publicado_en is null — hay una publicación en curso, no autorizada todavía por lo que
//   se está por escribir. Cierra el hallazgo Critical de Codex (versión no ligada a lo aprobado): la
//   ventana de bloqueo es la vida de un solo step de Inngest, no algo que el staff perciba.
// { publicar_post: true } (única clave) → comando compuesto:
//   1. store.solicitarPublicacionPost(ctx, pageId) marca post_solicitado_en = now() bajo RLS,
//      SOLO si post_titulo/post_cuerpo no son null, la página sigue approved y not retirada, y
//      post_publicado_en is null. Un segundo llamado sobre una fila ya solicitada pero no publicada
//      REINTENTA (pisa el timestamp de nuevo) — mismo criterio que solicitarPublicacion en
//      resenas.ts:145-157. Ya no es "ya solicitado bloquea": ver el hallazgo Critical de Codex sobre
//      el reintento, resuelto en "Idempotencia de la publicación", abajo.
//   2. Solo si la fila cambió, emite el evento "posts/publicacion.solicitada" con SOLO el pageId.
//   3. El orquestador relee la base (postParaPublicar) y publica de verdad con BlogPublisher.
//   4. Solo lo que el publisher CONFIRMA se marca post_publicado_en + post_url_externa.
// Cualquier otra combinación → 400.
```

**Edición y aprobación — por qué el chequeo de `approved`/`retirada` alcanza sin mecanismo nuevo**
(Codex, ronda 1, hallazgo Major "post obsoleto"): `editPage` (`db/src/store.ts:1286-1319`) revoca
`approved` en CUALQUIER edición del brief, y la reconciliación entre corridas marca `retirada`
(`db/src/store.ts:807-821`). Como `solicitarPublicacionPost` exige `approved and not retirada`, una
página cuyo brief cambió después de generar el post queda automáticamente inelegible para publicar
hasta que alguien la vuelva a aprobar — no hace falta invalidar ni regenerar el post por separado.
**Lo que este spec NO resuelve** (fuera de alcance, igual que la regeneración automática): si el post
ya estaba publicado y el brief cambia después, el post publicado queda desactualizado sin aviso —
republicar es una acción manual del staff (volver a pedir "Publicar"), no algo que este sub-proyecto
dispare solo.

**Idempotencia de la publicación** (Codex, ronda 1, hallazgo Critical): responder una reseña de
Google es idempotente por naturaleza — hay un solo slot de respuesta por reseña, así que reintentar
`publicarRespuestaResena` nunca duplica nada. Crear un post con `POST /wp-json/wp/v2/posts` (o el
endpoint equivalente de otra plataforma) NO lo es: cada llamada exitosa crea una fila nueva. Por eso
`BlogPublisher.publicar` recibe un identificador estable (`identificadorExterno`, ver la interfaz más
abajo) que cualquier implementación real tiene que usar para no duplicar — buscar por ese
identificador antes de crear, o usarlo como *idempotency key* si la plataforma lo soporta. La
implementación de referencia de WordPress (ver más abajo) documenta cómo se resuelve para esa
plataforma en particular.

**`BlogPublisher`** — la interfaz genérica (decisión #1):

```ts
// orchestrator/src/post-blog/publisher.ts
export interface CredencialesBlogExterno {
  tipo: "wordpress"; // único valor hoy — el enum crece cuando haya una segunda plataforma real
  url: string;
  credencial: string; // application password de WordPress, u otro secreto según el tipo
}

export interface BlogPublisher {
  publicar(
    post: { titulo: string; cuerpo: string; slug: string },
    // Clave de idempotencia — hoy siempre el `pageId` de kr_pages. Una implementación real DEBE
    // usarla para evitar duplicar en un reintento (ver "Idempotencia de la publicación", arriba):
    // buscar un post existente marcado con este identificador antes de crear uno nuevo.
    identificadorExterno: string,
    credenciales: CredencialesBlogExterno,
  ): Promise<{ url: string; publicado: boolean }>;
}
```

**Implementación de referencia (WordPress)**, documentada acá pero **no necesariamente construida**
en el plan de este sub-proyecto si no hay cliente real confirmado (ver "Fuera de alcance"): REST API
de WordPress (`POST /wp-json/wp/v2/posts`), autenticación por *application password* (usuario +
contraseña de aplicación, no la contraseña de login) — es el mecanismo estándar de WP desde la 5.6,
no requiere OAuth ni un plugin adicional. La idempotencia se resolvería escribiendo
`identificadorExterno` en un *custom field* (`meta`) del post y, antes de crear, consultando
`GET /wp-json/wp/v2/posts?meta_key=amg_page_id&meta_value=<identificadorExterno>` — WordPress expone
búsqueda por meta solo si el plugin/tema lo registra como `meta_query`-able, así que esto queda
marcado como **a confirmar contra un WordPress real** si se llega a construir esta implementación, no
como un hecho verificado en este spec (ver "No pude verificar" del Codex de esta ronda).

## Modelo de datos

**Columnas nuevas en `kr_pages`** (mismo criterio que `resenas_google`: el borrador vive en la fila
del recurso, no en una tabla aparte — la página y su post son el mismo "qué", solo una forma
publicada distinta):

```sql
alter table kr_pages
  add column if not exists post_titulo         text,
  add column if not exists post_cuerpo          text,
  add column if not exists post_generado_en     timestamptz,
  add column if not exists post_solicitado_en   timestamptz,
  add column if not exists post_publicado_en    timestamptz,
  add column if not exists post_url_externa     text;
```

El estado se deriva de la combinación null/not-null de estas columnas, igual que `resenas_google`
(sin enum de estado explícito): sin post → generado (esperando revisión) → editado → solicitado →
publicado.

**Sanitización** (Codex, ronda 1, hallazgo Major — invariante de AGENTS.md: todo valor que termina en
HTML es superficie de inyección): `post_cuerpo` es HTML por dentro. Se sanitiza con un allowlist
(misma disciplina que usa el renderer para `business_profile`, ADR-19: tags y atributos permitidos,
se descarta el resto) en los DOS puntos donde el valor cambia — nunca se persiste HTML sin pasar por
ahí:

- **Al generar** (`guardarPost`, después de `PostProvider.generar`) — lo que el humano revisa ya
  está limpio, no hay que confiar en que el LLM no haya inyectado nada.
- **Al editar** (`editarPost`) — un humano editando a mano puede introducir un `<script>` tan fácil
  como el LLM; RLS decide QUIÉN escribe, la sanitización decide QUÉ queda escrito.

`BlogPublisher.publicar` recibe `post.cuerpo` ya sanitizado — una implementación real puede revalidar
como defensa en profundidad (mismo criterio que ya sigue el renderer: "en prod el dato puede venir de
la base sin pasar por Zod"), pero no es su responsabilidad sanitizar desde cero.

**Columnas nuevas en `clients`** (credenciales del blog externo):

```sql
alter table clients
  add column if not exists blog_externo_tipo        text,  -- 'wordpress', valores futuros
  add column if not exists blog_externo_url          text,
  add column if not exists blog_externo_credencial   text;  -- nunca en el business_profile_publico
```

**Grants — corregido tras la ronda de Codex.** La afirmación original ("el grant de tabla de
0001/0002 cubre las columnas nuevas automáticamente") es **cierta para `kr_pages`** (nunca se
angostó: `app_user`/`app_service` siguen con `grant select, insert, update, delete on ... kr_pages`
completo desde 0001/0002 — los `post_*` de arriba quedan cubiertos sin tocar nada) pero **falsa para
`clients`**: la 0021 le revocó a `app_user` el `select` de tabla sobre `clients` y se lo volvió a
otorgar columna por columna (`db/migrations/0021_resenas_google.sql:112-121`), y la 0022 hizo lo
mismo con `app_service` (`db/migrations/0022_resenas_google_polling.sql:140-141`). Una columna nueva
en `clients` **no la puede leer nadie** hasta que una migración se lo conceda explícitamente.

El plan tiene que agregar, mirror exacto del patrón que ya protege `google_refresh_token`:

- `grant select (blog_externo_tipo, blog_externo_url) on clients to app_user` — dato de negocio, no
  secreto (para que el portal muestre "conectado a wordpress en https://...").
- `grant update (blog_externo_tipo, blog_externo_url, blog_externo_credencial) on clients to
  app_user` — el callback de configuración escribe la credencial (igual que el callback de OAuth de
  Google escribe `google_refresh_token`).
- **`blog_externo_credencial` NUNCA en el `select` de `app_user`** — mismo motivo que
  `google_refresh_token`: si cualquier miembro del staff pudiera leer la credencial en texto plano
  por SQL directo, la protección sería cosmética (Codex, ronda 1, hallazgo Major: la versión anterior
  de este spec decía "mismo nivel de protección que `google_refresh_token`" sin proponer esta
  exclusión — quedaba MENOS protegida, no igual).
- Una función `security definer` nueva, mismo molde que `app.resena_para_publicar` (0025): el evento
  `posts/publicacion.solicitada` solo trae `pageId` — el orquestador no tiene contexto de tenant en
  ese punto, igual que al publicar una reseña. `app.post_para_publicar(page_id uuid)` deriva
  `tenant_id`/`client_id` de la propia fila de `kr_pages` (no de un parámetro separado — mismo
  argumento de seguridad que ya vale para `resena_para_publicar(resena_id)`), y devuelve título,
  cuerpo, slug, tipo/url/credencial del blog en una sola lectura confinada. `app_service` solo puede
  ejecutar la función, no leer `blog_externo_credencial` por SQL directo — el plan define el rol
  `nologin` nuevo (o reutiliza `app_resenas` si el plan concluye que el mismo confinamiento aplica;
  a decidir con el detalle de las políticas).

`app_render` **no debe** ganar acceso a `blog_externo_credencial` — la columna generada
`business_profile_publico` (ADR-19) no la incluye; el plan tiene que confirmar explícitamente que el
`revoke`/allowlist existente sigue excluyéndola, no asumirlo.

## API

- **`GET /pages/:id/post`** — ver el borrador (título, cuerpo, estado derivado de las columnas).
  Staff y cliente (solo lectura), mismo patrón RLS que reseñas. Ruta plana, igual que `PATCH
  /pages/:id` (ver "Arquitectura" — corrección de ruta encontrada al escribir el plan).
- **`PATCH /pages/:id`** (extendida, no una ruta nueva) — dirige por FORMA del body, sin mezclar
  formas en un mismo request:
  - Campos del brief (`url_slug`, `keyword_principal`, `seo`, `content_brief`,
    `preguntas_frecuentes`) → `editPage`, comportamiento ya existente.
  - `{ post_titulo?, post_cuerpo? }` (al menos una presente) → `editarPost`, bajo RLS normal
    (`app_user`, `puede_escribir()`).
  - `{ publicar_post: true }` → comando compuesto (ADR-18), como se describe en "Arquitectura".
  - Mezclar campos de brief con campos de post en el mismo request, o cualquier combinación no
    reconocida → `400`.

## Portal

- Pantalla nueva (o tab dentro de la ficha del cliente, a definir en el plan si se agrega a
  `cliente-research.ts`/`brief.ts` o es una ruta propia) que lista los posts generados de un run con
  destino `crear_posts`: título editable, cuerpo editable (textarea o editor simple), botón
  "Publicar" con los mismos tres estados que reseñas ("Publicar" / "Reintentar publicación" /
  "Publicada — [link]") — el estado "Reintentar publicación" ahora SÍ es consistente con
  `solicitarPublicacionPost` (ver "Arquitectura"): reintentar es válido mientras
  `post_publicado_en is null`, y `BlogPublisher` no duplica porque usa `identificadorExterno`.
  Mientras una solicitud está en curso (`post_solicitado_en` sin confirmar), los campos de edición
  quedan bloqueados en el portal (el `PATCH` de edición los rechaza igual, esto es solo UX).
- Rol `cliente`: mismo contenido, solo lectura — nunca un control que RLS rechazaría en silencio.

## Fuera de alcance

- **La implementación concreta de `BlogPublisher` para una plataforma real** (WordPress u otra) — se
  documenta como referencia en este spec, pero el plan de implementación puede dejarla como una
  interfaz + un mock hasta que haya un cliente real confirmado con una plataforma concreta. Es una
  decisión a tomar explícitamente al escribir el plan, no algo que este spec resuelva.
- Publicación escalonada/programada (decisión #6) — solo publicación inmediata al aprobar.
- Que el humano elija cuáles páginas se convierten en posts (decisión #5) — siempre son todas las
  aprobadas.
- Cualquier segunda plataforma de blog además de la primera que se implemente.
- **Que un mismo run tenga simultáneamente `crear_web` Y `crear_posts`** — con el diseño actual del
  sub-proyecto 2, un run solo tiene un destino "real" a la vez (`crear_web` es terminal; `solo_informe`
  es retomable una sola vez hacia OTRO destino). Publicar el mismo research como web propia y como
  posts en un blog externo simultáneamente no es posible hoy — es un tema para la revisión conjunta
  de los tres sub-proyectos, no algo que este spec resuelva.

## Riesgos

- **`registrarDecision` (sub-proyecto 2) no exigía página aprobada para `crear_posts` — RESUELTO
  (2026-08-26), antes de escribir el plan de este sub-proyecto.** El sub-proyecto 2 había confirmado
  con el usuario que el chequeo "al menos una página aprobada" (ADR-06) aplicaba SOLO a `crear_web`,
  antes de que `crear_posts` existiera de verdad. Codex (ronda 1 sobre este spec, hallazgo Major)
  señaló que dejarlo como flag para la revisión conjunta no era una precondición ejecutable. Se
  resolvió enmendando directamente el plan del sub-proyecto 2 (`docs/superpowers/plans/2026-08-26-desacoplar-kr-web.md`,
  Task 3 y su "Historial de revisión") — la firma de `registrarDecision` ahora acepta `"crear_posts"`
  y el `WHERE` exige página aprobada para ese destino también. Edición de documento de diseño, no de
  código: no adelantó la secuencia de implementación acordada.
- **`kr_run_decisiones.resultado = 'completado'` significa cosas distintas según el destino**:
  para `crear_web` significa "publicado"; para `crear_posts` significa "hay al menos un borrador
  esperando revisión" — nunca "publicado", y ahora (ver "Arquitectura") tampoco significa "todos los
  posts se generaron": si alguna página falló, `resultado='completado'` con menos posts que páginas
  aprobadas es un estado válido, distinguible por página vía `post_generado_en is null`. Cualquier
  código (portal, reportes) que lea `resultado` sin mirar `destino` puede confundir los dos. El plan
  tiene que dejarlo inequívoco en el read model del portal.
- **Fallo puntual de generación por página**: si el LLM falla en una de N páginas, las otras se
  generan igual (mismo criterio que `pollearResenas`); si fallan las N, la decisión cierra en `error`
  en vez de `completado` (ver "Arquitectura"). Sin reintento automático por página — el plan tiene
  que decidir si el portal ofrece un botón de "regenerar" por página sin volver a aprobar el run
  completo, o si alcanza con que el staff vea el hueco y lo escriba a mano (mismo camino de
  recuperación manual que ya usa el borrador de reseñas).
- **`content_brief` fue diseñado para plantillas del M1, no para prompts de LLM directamente** — el
  plan tiene que verificar que la forma de `content_brief` (jsonb) alcanza como insumo de prompt sin
  transformación adicional, o si hace falta un paso de adaptación.

## Verificación

- Test de generación: `PostProvider` mock produce un post con el prefijo inconfundible; el real
  (fixture de respuesta OpenAI) no lo lleva.
- Test de fallo puntual: de 3 páginas, si una falla la generación, las otras 2 sí quedan con post y
  la decisión cierra `completado`; si fallan las 3, cierra `error`.
- Test de sanitización: un `post_cuerpo` con `<script>`/`onerror` no queda persistido tal cual, ni al
  generarlo ni al editarlo — la mutación exacta a probar: guardar un cuerpo con un tag prohibido y
  confirmar que `post_cuerpo` en la base no lo contiene.
- Test de RLS: un rol `cliente` puede leer el post pero no editarlo ni publicarlo (mismo patrón que
  `resena_marcar_vista`).
- Test de bloqueo de edición: con `post_solicitado_en` no nulo y `post_publicado_en` nulo,
  `editarPost` devuelve `false` sin escribir.
- Test del comando compuesto: `publicar_post: true` marca `post_solicitado_en` bajo RLS y SOLO
  entonces emite el evento; si la fila no cambió (ya publicado, sin post generado, no aprobada o
  retirada), no se emite nada.
- Test de reintento: una segunda solicitud sobre una fila ya solicitada pero no publicada SÍ
  re-emite el evento (a diferencia de la versión anterior de este spec, que lo bloqueaba).
- Test de confirmación real: solo se marca `post_publicado_en` lo que `BlogPublisher.publicar`
  confirma con `publicado: true` — nunca lo que "se mandó".
- Test de grants: `app_service` NO puede leer `clients.blog_externo_credencial` por SQL directo bajo
  su rol real (no un mock) — solo vía `app.post_para_publicar`. Mismo tipo de test que ya protege
  `google_refresh_token` contra `app_service`/`app_user`.
- Test de que `blog_externo_credencial` no aparece en `business_profile_publico` (defensa en
  profundidad, ADR-19) — mismo tipo de test que ya protege `google_refresh_token`.
- `npm run verificar` en verde + manejar el flujo completo en el portal (aprobar un run con
  `crear_posts` → ver los borradores generados → editar uno → publicarlo con el mock) antes de cerrar.

## Historial de revisión

### Ronda 1 — Codex, sobre este spec (2026-08-26)

Veredicto de Codex: NECESITA REDISEÑO. 10 hallazgos (3 Critical, 5 Major, 1 Minor, 1 Nit). Verificados
todos independientemente contra el código real antes de aplicar — ninguno refutado, ninguno aplicado
a ciegas. Reporte completo: [`progress/informes/codex-publicar-posts-spec.md`](../../../progress/informes/codex-publicar-posts-spec.md).

| # | Hallazgo | Estado | Qué cambió |
|---|---|---|---|
| 1 | [Critical] versión no ligada a lo aprobado | Verificado (con matiz: el mismo hueco ya existe en el precedente de reseñas, sin resolver) | `editarPost` rechaza escribir mientras hay una publicación en curso sin confirmar |
| 2 | [Critical] reintento imposible-y-duplicador | Verificado — la analogía con reseñas se rompe: responder una reseña es idempotente por naturaleza, crear un post no | Reintento habilitado (mismo criterio que `solicitarPublicacion`); `BlogPublisher.publicar` ahora recibe `identificadorExterno` |
| 3 | [Critical] grants de `clients` no cubren columnas nuevas | Verificado, y el alcance real incluye a `app_user`, no solo `app_service` (0021, no solo 0022) | Sección "Grants" reescrita: grants de columna explícitos + función `security definer` `app.post_para_publicar` |
| 4 | [Major] editar/retirar deja post obsoleto | Verificado | `solicitarPublicacionPost` exige `approved and not retirada`; editar ya revoca `approved` — sin mecanismo nuevo |
| 5 | [Major] `completado` con cero posts generados | Verificado contra el propio código sketch del spec | El agregado ahora cierra `error` si `generados === 0` |
| 6 | [Major] sanitización sin decidir | Verificado — toca el invariante de AGENTS.md sobre superficies de inyección | Formato canónico HTML + sanitización por allowlist al generar y al editar |
| 7 | [Major] dependencia con sub-proyecto 2 no ejecutable | Verificado técnicamente; **decisión de proceso, no de diseño — resuelta con el usuario** | Se promueve a primera tarea del plan de este sub-proyecto (modifica el plan del sub-proyecto 2), en vez de quedar solo como flag |
| 8 | [Major] "mismo nivel que `google_refresh_token`" engañoso | Verificado, y es más serio de lo que decía Codex: el precedente EXCLUYE la columna del select de `app_user` por completo | Resuelto junto con el #3: `blog_externo_credencial` nunca en el `select` de `app_user` |
| 9 | [Minor] contrato PATCH contradictorio | Verificado — contradicción literal entre dos secciones del spec anterior | Unificado: `{ post_titulo?, post_cuerpo? }` (no "una sola clave", las dos viven en el mismo formulario) |
| 10 | [Nit] método nuevo posiblemente innecesario | Aceptado | El sketch de "Arquitectura" usa `getRunPages` (ya existe) en vez de `getPublishablePagesConId` |

Ninguno de los 10 hallazgos contradice las 6 decisiones de producto ya fijadas (publisher genérico,
completar `crear_posts`, IA genera, revisión humana previa, un post por página aprobada, publicación
inmediata) — todos son de mecanismo.

### Correcciones encontradas al escribir el plan de implementación (no son hallazgos de Codex)

- **Ruta real de edición de páginas**: `PATCH /clients/:id/pages/:pageId` (como decía la primera
  versión de "API"/"Arquitectura") no existe — la ruta real es `PATCH /pages/:id` (plana,
  `api/src/app.ts:348-356`). Corregido en ambas secciones; ver la nota explícita en "Arquitectura".
- **Dependencia con el sub-proyecto 2 (hallazgo #7 de la tabla de arriba), resuelta de verdad**: se
  enmendó directamente `docs/superpowers/plans/2026-08-26-desacoplar-kr-web.md` (Task 3 y su
  "Historial de revisión") — `registrarDecision` ya exige página aprobada para `crear_posts`. Ver el
  bullet actualizado en "Riesgos".

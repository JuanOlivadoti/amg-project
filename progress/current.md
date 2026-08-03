# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-03
**En curso:** nada. Cerrada la **reorganización de la documentación**: el corpus quedó separado por la
pregunta que contesta cada carpeta y el grafo de referencias de skill-map quedó en **cero errores**
(venía de 32). El relato está en [`history.md`](history.md).
**Estado:** verificado en verde — 684 tests del monorepo (subió 2: los del agujero de la compuerta de
secretos, ver abajo), typecheck limpio, sin secretos entre los 400 archivos versionados. El portal no
se tocó.

---

## 🔴 Acción humana urgente — rotar las credenciales expuestas

`docs/private.zip` estuvo **commiteado en un repositorio público** desde el 2026-08-01 (commit
`15ae91a`). Ya se sacó del índice y el `.gitignore` quedó blindado, pero **el objeto sigue en el
historial de GitHub** por decisión tomada: purgar no des-expone, lo que devuelve la seguridad es
rotar. Todo lo de abajo hay que considerarlo **comprometido**.

Orden por daño potencial. Después de cada bloque: `npm run env:sync` y redeploy de lo que la use.

| # | Credencial | Por qué primero | Dónde se rota |
| --- | --- | --- | --- |
| 1 | `SUPABASE_JWT_SECRET` | Con esto se **forjan JWT válidos**: se entra a la API como cualquier usuario y con cualquier rol. Deja sin valor a ADR-15, ADR-17 y ADR-18 — no importa que el rol se derive en Postgres si el token se puede firmar | Supabase → Settings → API → JWT Settings. Después, redeploy de `api` |
| 2 | `DATABASE_URL_ADMIN` | Acceso total a la base, **salta RLS** | Supabase → cambiar la contraseña del rol admin |
| 3 | `DATAFORSEO_PASSWORD` (+ `DATAFORSEO_LOGIN`) | **Gasta dinero real** contra el saldo de la cuenta | Panel de DataForSEO |
| 4 | `ANTHROPIC_API_KEY`, `KR_SERVICE__OPENAI_API_KEY`, `WEB_BUILDER__OPENAI_API_KEY`, `OPENAI_API_KEY` | **Gastan dinero real** | Consolas de Anthropic y OpenAI: revocar y crear nuevas |
| 5 | `STORYBLOK_MANAGEMENT_TOKEN` | **Escribe y borra en el space.** El invariante dice que el proceso anónimo nunca toca una credencial que pueda modificar el space; esta estuvo pública | Storyblok → Settings → Access Tokens |
| 6 | `DATABASE_URL_API`, `DATABASE_URL_CACHE` | Acceso directo a datos con los roles `amg_api` y `amg_cache` (más pobres que admin, pero acceso directo) | Supabase → contraseñas de esos roles |
| 7 | `STORYBLOK_PREVIEW_TOKEN` | Lee contenido en borrador | Storyblok → Access Tokens |

**No son secretos y no hace falta rotarlos:** `SUPABASE_JWT_AUD`, `SUPABASE_JWT_ISS`, `CORS_ORIGINS`,
`DATAFORSEO_BASE_URL`, `DATAFORSEO_MODE`, `LLM_PROVIDER`, `PROSE_MODE`, `WEB_PUBLISH_MODE`,
`STORYBLOK_REGION`, `STORYBLOK_SPACE_ID`, `STORYBLOK_PUBLIC_TOKEN` (público por diseño), `DEMO_DOMAIN`
y las rutas `*_PATH`. `SEED_FRANK_USER_ID` y `SEED_JUAN_USER_ID` son identificadores, no credenciales.

---

## Lo que esta sesión dejó abierto

**El agujero del arnés: ✅ tapado.** `npm run verificar` daba verde con el zip de credenciales
trackeado, y la causa no era la que anoté primero: `scripts/secretos.mts` **no** intenta mirar dentro
de los archivos —decide por ruta, a propósito—, sino que su regla de `docs/private/` comparaba el
segundo segmento de **directorio**, y en `docs/private.zip` ese nombre es el del **archivo**. Cerrado
con dos reglas: `docs/private*` por nombre, y cualquier **comprimido versionado** (opaco para un
detector de rutas; hoy no hay ninguno en el repo, así que no cuesta nada). Cada regla tiene su test y
**cada test cae exactamente al quitar su regla** — comprobado con las dos mutaciones. El CLI, con el
caso real por stdin, sale con 1 y nombra el motivo.

**Dos avisos de skill-map que quedan, y son deliberados.** 17 warnings de `extractor-collision` (el
patrón ``[`ruta`](ruta)``, donde gana el enlace y se registra bien: inocuo) y 5 info de
`reference-redundant`, de los cuales 2 **no se pueden silenciar**: el `dismiss` de esa clase no
funciona en skill-map 1.2.1 — la supresión queda activa, el sidecar correcto, y el issue vuelve
después de un scan completo.

**Toda la configuración de skill-map es local a esta máquina.** `.skill-map/` está gitignoreado
entero, así que `respectGitignore`, `ignore` y `referencePaths` **no viajan con el repo**: en otro
clon, el scan vuelve a indexar `progress/informes/` y `docs/private/`. Si esto tiene que valer para
todos, hay que versionar `.skill-map/settings.json`.

**Sin verificar contra producción:** `docs/proyecto/README.md` afirma que hay **10 migraciones
aplicadas en producción**, y en el repo hay **12** (`0011_clientes_crm`, `0012_membresias_perfil`). El
11 dice que `0011` está desplegada. No se puede confirmar sin credenciales, así que la cifra quedó
como estaba.

## Lo que sigue pendiente de antes

**Decisión que no toma un agente:** **regenerar el dataset crudo** cuesta **~$0.31** y ~16 min contra
DataForSEO en producción. Sin él, `VOLUMEN_PERCENTIL_TOPE = 0.9` y `PESO_CONFIANZA_ORDEN = 0.5` quedan
sin calibrar y `TIPOS_MAP_PACK` sin verificar. El destino ya es durable, así que el dataset sobrevive.
**Y si se corre, hay que volver a sandbox** en `kr-service/.env`.

**Pendiente inmediato:** **etapa B** del [plan de agentes](../.claude/PLAN-AGENTES.md) (el agente
`datos`, con `datos-postgres`/`datos-api`/`datos-testing`), que se estrena con KR-2 — y de paso puede
cerrar lo que la etapa A dejó abierto: que el orden del pipeline llegue al portal
(`db/src/store.ts:715,743` + `portal/src/app/core/cartera.ts:37`). Arrancarla en una **sesión nueva**,
para poder invocar a `pipeline` por nombre.

---

## Plantilla (dejar así al cerrar)

```markdown
**Sesión:** YYYY-MM-DD
**En curso:** <qué se está haciendo>
**Estado:** <en progreso | bloqueado | listo para revisión>

**Decisiones de esta sesión:**
- <qué se decidió y por qué>

**Pendiente inmediato:** <lo próximo>
```

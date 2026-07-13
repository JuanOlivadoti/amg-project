# `db` — Esquema, RLS y aislamiento multi-tenant

Base de datos de AMG OS. Implementa **ADR-01** (Supabase/Postgres + RLS) y **ADR-10**
(endurecimiento del esquema).

```bash
npm install
npm test        # 18 tests de RLS contra Postgres 18 REAL
npm run typecheck
```

## Postgres de verdad, sin instalar nada

Los tests corren contra **PGlite** (Postgres 18 compilado a WASM, dentro de Node). Sin Docker, sin
cuenta, sin credenciales — igual que el resto del proyecto.

No es un detalle de comodidad. **ADR-10 exige tests de RLS antes de la Fase 1**, y el aislamiento
entre tenants es *la* garantía que se le vende al cliente: los datos de un restaurante no los ve la
agencia de al lado. Si eso se rompe, no es un bug, es una brecha.

Y tenían que correr contra Postgres real: el aislamiento depende de su semántica exacta
(`FORCE` vs `ENABLE`, `USING` vs `WITH CHECK`, el cast de una variable de sesión vacía). Un mock
reproduciría mis suposiciones en vez de la realidad — y de hecho **dos de esas suposiciones eran
falsas** (ver abajo).

## Los tests muerden (verificado por mutación)

Un test de seguridad que siempre pasa es peor que no tenerlo. Se rompió la política a propósito y
cada agujero fue atrapado por el test correcto:

| Agujero introducido | Test que falló |
|---|---|
| Quitar `force row level security` → **el dueño de la tabla salta las políticas** | `FORCE está activo` |
| Quitar el `nullif` → sin tenant, `''::uuid` **revienta la query** en vez de no devolver nada | `SIN tenant no se ve NADA (falla cerrado)` |
| Rol `cliente` sin filtro por `client_id` → **ve la cartera entera de la agencia** | `el rol 'cliente' solo ve SU cliente` |

### Dos cosas que Postgres hace distinto de lo que uno supone

1. **Una variable de sesión ausente es `''`, no `NULL`** — y `''::uuid` **lanza un error**. Sin el
   `nullif`, una petición sin tenant no devuelve "cero filas": **explota**. Un control de acceso
   tiene que fallar **cerrado y en silencio**.
2. **`ENABLE` no alcanza: hace falta `FORCE`.** Sin él, el *dueño* de la tabla ignora las
   políticas — y en Supabase el owner es justamente quien corre las migraciones. ADR-10 ya lo
   marcaba ("no solo `enable`").

*(Una tercera sospecha resultó infundada: quitar `WITH CHECK` **no** abre un agujero, porque
Postgres reutiliza la expresión de `USING` como check para `INSERT`/`UPDATE`. Se dejó igual por
claridad.)*

## De dónde sale el tenant

Las políticas **no** leen la variable de sesión directamente: pasan por `app.current_tenant_id()`.
Así hay **un solo lugar** donde cambia el origen del tenant. En Supabase se redefine el cuerpo de
esa función para leerlo del JWT (`auth.jwt()`) **sin tocar ni una política**.

```sql
create policy tenant_isolation on kr_runs
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());
```

## Las caches NO llevan `tenant_id` (a propósito)

El volumen de búsqueda de *"pizza napolitana madrid"* es un dato del **mercado**, no de un cliente.
Compartirlo entre tenants es correcto, y es lo que hace que la segunda corrida de una keyword ya
consultada **salga gratis**.

Pero justamente por no tener `tenant_id`, no pueden quedar colgadas de la política de tenant: van
con **RLS deny-all** (RLS habilitado, cero políticas) y **sin ningún `grant`** a `app_user`. Solo
la *service-role* (que salta RLS) las toca. Defensa en profundidad: `grant` **y** RLS.

Aplica a `kr_metrics_cache`, `kr_serp_cache` y `kr_provider_tasks`.

## Tablas

| Tabla | Qué guarda | RLS |
|---|---|---|
| `tenants` | Las agencias. | aislamiento |
| `memberships` | Usuario ↔ tenant + rol (`maestro`/`equipo`/`cliente`). | aislamiento |
| `clients` | Los negocios de la agencia. Un space de Storyblok por cliente (ADR-04/ADR-11). | aislamiento + el rol `cliente` solo ve el suyo |
| `kr_runs` | Un run = un market (ADR-10). Costo en **micros**, `calidad_datos`, config reproducible. | aislamiento |
| `kr_keywords` | **Todas** las keywords enriquecidas, no solo las que llegaron a página: son los datos que se le pagaron a DataForSEO. | aislamiento |
| `kr_pages` | Páginas propuestas + `evidencia` + la compuerta `approved` (ADR-06). | aislamiento |
| `kr_metrics_cache` | Volumen/KD por keyword+mercado, con `expires_at`. | **deny-all** |
| `kr_serp_cache` | SERP por keyword+engine+device+tipo+profundidad. | **deny-all** |
| `kr_provider_tasks` | Idempotencia: `payload_hash` → task ya pagada. | **deny-all** |

## Pendiente

- **Capa de acceso** (`Store`) que use este esquema desde `kr-service` y `web-builder`.
- **Cachear** de verdad contra `kr_metrics_cache` / `kr_serp_cache` (hoy cada corrida vuelve a pagar).
- **Idempotencia** usando `kr_provider_tasks` (hoy un timeout en una operación facturable
  simplemente no se reintenta; con la tabla se podría reintentar **sin volver a pagar**).
- Migraciones versionadas + `supabase migration` cuando exista el proyecto real.

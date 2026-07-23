# Despliegue — Fase 1: el portal de Frank en pre-producción

> **Estado:** 📋 Plan, sin ejecutar · **Última actualización:** 2026-07-22
>
> Este documento es **el plan acordado** para poner el portal en un dominio, funcionando como
> pre-producción, para mostrárselo a Frank. Nace de una conversación de alineación: lo que entra, lo
> que **no**, y quién hace cada paso. Si algo acá no coincide con lo que esperás, es un error del plan
> y se corrige antes de tocar una cuenta.

---

## 1. El objetivo, en una frase

Que **Frank entre a un dominio, se loguee, y vea la plataforma real funcionando** —el research, los
briefs por evidencia, la compuerta de aprobación— con el caso de **Bella Napoli** ya cargado. Un
panel de control vivo, no una maqueta.

## 2. Qué entra y qué NO (para que no haya malentendidos)

| | Fase 1 (esto) | Queda para después |
|---|---|---|
| **El portal** (panel de Frank) | ✅ Desplegado en un dominio | |
| **La `api`** (backend del portal) | ✅ Desplegada (lo necesita el portal) | |
| **La base** (Postgres + login) | ✅ Desplegada (Supabase) | |
| **Contenido** | ✅ Bella Napoli pre-cargado | |
| **Lanzar research EN VIVO** | ❌ No | Fase 2 (orquestador + Inngest) |
| **Las webs de cliente** (renderizador) | ❌ No | Fase 2 (cuando la Fase 1 esté desplegada) |

> **Decisión tomada:** esta es una demo **"read-mostly"** (Nivel 1). Frank *ve* todo; *lanzar* una
> corrida nueva en vivo es Fase 2 — porque eso suma el orquestador, Inngest y DataForSEO en
> producción, y no queremos que una corrida en vivo falle delante del cliente en la primera demo.

## 3. Por qué "subir el portal a Hostinger" no alcanza (el punto clave)

El portal es una **app de Angular = archivos estáticos**. Es la *cara*. Todo lo que hace —login,
listar research, ver briefs, aprobar— vive en el **backend**: la `api` (Node), **Postgres** y
**Supabase** (auth).

- Hostinger (shared) **sí** puede servir los archivos estáticos del portal.
- Hostinger (shared) **no** puede correr la `api` (Node) ni Postgres.

Por eso el portal **solo** en Hostinger se vería lindo pero muerto. El backend va a **PaaS
gestionado**. Hostinger, si querés, queda como **registrador del dominio** y/o host del estático.

## 4. La arquitectura de la demo

```
                    app.tudominio.com                 api.tudominio.com
   navegador  ──▶  PORTAL (Angular estático)  ──▶  API (Node, Hono)  ──▶  Postgres (Supabase)
   (Frank)          Cloudflare Pages / Hostinger      Railway              + Supabase Auth (login)
                                                          │
                                            contenido de Bella Napoli
                                            pre-cargado (acción 06 → seed)
```

## 5. Las piezas y dónde viven

| Pieza | Dónde | Costo | Notas |
|---|---|---|---|
| **portal** (estático) | Cloudflare Pages *(o Hostinger)* | gratis | `ng build` → archivos. Auto-deploy desde GitHub en Pages. |
| **api** (Node) | Railway *(o Render)* | gratis / ~$5 mes | Auto-deploy desde GitHub. `npm run serve -w api`. |
| **Postgres + Auth** | Supabase | gratis | Postgres real: soporta los roles y la RLS. El login ya usa su JWT. |
| **dominio** | el registrador que elijas | ~$10–15/año | `app.` → portal, `api.` → api. |

## 6. Supuestos (corregí lo que no cuadre)

- **Usuarios del portal:** Frank y Juan (roles `maestro`/`equipo`).
- **Contenido:** Bella Napoli (el restaurante de demo que ya está en Storyblok y en las pruebas).
- **Presupuesto:** free tier donde se pueda.
- **Storyblok:** el space ya existe (de las acciones previas); en Fase 1 no se toca.

---

## 7. Los pasos, en orden

Divididos por **quién** los hace. Los de código son míos y se hacen **primero** (así desplegar es
pegar credenciales y hacer click).

### A. Prerequisitos de código — **los preparo yo, antes de tocar ninguna cuenta**

1. **Runner de migraciones contra una base remota.** Hoy las migraciones corren en los tests contra
   PGlite; falta un pequeño CLI que se conecte a la `DATABASE_URL` de Supabase y las aplique en orden
   (crea el esquema, **los roles `amg_api`/`amg_render` y la RLS**).
2. **Script de seed (lo que hace que el portal tenga algo que mostrar).** Carga en la base:
   - los **usuarios** Frank y Juan con sus membresías/roles;
   - un **run completo de Bella Napoli**, derivado del brief de la acción 06, para que el portal
     muestre research, brief y compuerta reales sin necesidad del orquestador.
   *(Al construirlo confirmo la forma exacta de las tablas; el brief ya existe del pipeline.)*
3. **Config de producción del portal.** Hoy apunta a `localhost`; que apunte a la `api` desplegada, y
   las variables de Supabase (URL + anon key) para el login.
4. **CORS de la api.** Sumar el origen del portal a `CORS_ORIGINS` (hoy sin eso sería `*`, que no
   queremos en algo expuesto).
5. **El botón de "lanzar research".** En Nivel 1 no hay orquestador detrás. Hay que **ocultarlo o
   deshabilitarlo con un cartel "próximamente"** — un botón que no hace nada es peor que no tenerlo
   delante de Frank. *(Decisión de UX, ver §10.)*

### B. Cuentas y credenciales — **las hacés vos** (no me pases las keys; van al gestor de secretos)

1. **Comprar el dominio** (Hostinger u otro registrador).
2. **Crear un proyecto en Supabase.** De ahí salen: las *connection strings* (para `amg_api`), el
   **JWT secret**, y la **URL + anon key** del proyecto.
3. **Crear cuenta en Railway** (o Render) y conectarla al repo de GitHub.
4. **Crear cuenta en Cloudflare Pages** (o usar el hosting estático de Hostinger).
5. **Las keys de OpenAI/DataForSEO** ya las tenés — se usan una vez para la corrida de seed (§C.2).

### C. El deploy — **juntos, en este orden**

1. **Base:** aplicar las migraciones contra Supabase (esquema + roles + RLS).
2. **Seed:** cargar los usuarios (Frank/Juan) y el run de Bella Napoli.
3. **API:** desplegar en Railway con sus variables (§8). Verificar que `/health` responda.
4. **Portal:** `ng build` apuntando a la api desplegada → subir a Pages/Hostinger.
5. **Dominio:** apuntar `app.` → portal y `api.` → api. El TLS lo pone el PaaS solo.
6. **Login de Frank:** crear su usuario en Supabase Auth.
7. **Verificar de punta a punta:** Frank entra, ve el research de Bella Napoli, navega la compuerta.

---

## 8. Variables de entorno (checklist, confirmadas contra el código)

**api** (`npm run serve -w api`, falla cerrado si falta algo):

| Variable | Qué es |
|---|---|
| `DATABASE_URL_API` | Conexión del login `amg_api` (→ rol `app_user`). |
| `SUPABASE_JWT_SECRET` | Para verificar la firma del token de login. |
| `CORS_ORIGINS` | El origen del portal (ej. `https://app.tudominio.com`). |
| `SUPABASE_JWT_ISS` / `SUPABASE_JWT_AUD` | *(recomendado)* cierran la puerta a tokens de otro proyecto Supabase. |
| `PORT` | Lo inyecta Railway automáticamente. |

**portal** (build de Angular):

| Variable | Qué es |
|---|---|
| URL de la api | `https://api.tudominio.com`. |
| `SUPABASE_URL` + anon key | Para el login. |

## 9. Seguridad del despliegue (no negociable)

- **Las migraciones crean los roles y la RLS.** Sin correrlas, la seguridad del proyecto (ADR-15/17)
  no existe: es esas políticas, no un `if`.
- **Los secretos van al gestor del host**, nunca al repo ni al chat (misma regla del `.env`).
- **HTTPS en todo** (el TLS lo dan Railway/Pages solos).
- **CORS restringido** al origen del portal, no `*`.
- **JWT con `iss`/`aud` fijados** al proyecto Supabase.

## 10. Costos y cosas a decidir

**Costo estimado:** dominio ~$10–15/año · Supabase/Pages gratis · Railway gratis o ~$5/mes ·
la corrida de seed (acción 06) ~$0.31, una vez. → **~$0–5/mes** para la demo.

**Decisiones abiertas:**
- **Cold start de Railway.** El free tier duerme el servicio; para una demo en vivo con Frank, el
  plan hobby (~$5/mes) evita que la primera carga tarde. *(Recomiendo hobby para la demo.)*
- **El botón "lanzar research"** (§A.5): ¿ocultarlo o dejar un cartel "próximamente"? Recomiendo
  ocultarlo en Fase 1.
- **Hosting del portal:** Cloudflare Pages (gratis, auto-deploy desde GitHub) vs Hostinger (si ya lo
  vas a usar de registrador). Recomiendo Pages; es menos fricción.

## 11. Cómo sabremos que salió bien

- [ ] Frank abre `https://app.tudominio.com` y ve la pantalla de login.
- [ ] Se loguea con su usuario.
- [ ] Ve el research de **Bella Napoli**: clusters, brief por evidencia (✅ respaldadas / ⚠️ sin validar).
- [ ] Navega la **compuerta de aprobación** (aunque en Fase 1 no publique en vivo).
- [ ] Nada tira un error de CORS ni de conexión a la base.

## 12. Qué sigue (Fase 2, cuando esto esté arriba)

- **Research en vivo:** desplegar el **orquestador + Inngest Cloud** → el botón "lanzar" cobra vida.
- **Las webs de cliente:** desplegar el **renderizador + CDN**, con el dominio de cada cliente
  apuntando al servicio (ADR-19). Es el "momento ajá" de la demo, y el paso que convierte esto de
  "les generamos contenido" en "su equipo edita y sirve su web".

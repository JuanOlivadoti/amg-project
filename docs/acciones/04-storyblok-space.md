# Acción 04 — Crear un space de Storyblok

**Tiempo:** ~15 minutos · **Costo:** gratis (plan free) · **Prioridad:** 🟢 cierra la demo

## Por qué

El argumento de venta del CMS que elegimos ([ADR-04](../decisiones-arquitectura.md)) es que
**las creadoras y community managers pueden editar la web sin depender de un desarrollador**, en un
editor visual. Es lo que justifica no usar WordPress.

El código para publicar las páginas y configurar el space **está escrito y verificado**, pero
**nunca se ejecutó contra un Storyblok real** (solo en modo simulado). Sin esta acción, la demo no
muestra la parte más vendible del producto.

---

## Paso 1 — Crear la cuenta y el space

1. Entrá a **https://www.storyblok.com/** y creá una cuenta (plan **free**).
2. Creá un **Space** nuevo. Ponele el nombre del cliente de prueba
   (ej. `AMG - Trattoria Bella Napoli`).
3. Cuando te pregunte por un starter/template, elegí lo más vacío posible — **no necesitamos
   ninguno**, el código crea los componentes por su cuenta.

## Paso 2 — Conseguir el Space ID

Es un número. Lo encontrás de dos formas:

- En **Settings** (⚙️) → **General** del space, aparece como *Space ID*.
- O en la URL cuando estás dentro del space:
  `app.storyblok.com/#/me/spaces/`**`123456`**`/...` ← ese número.

Anotalo.

## Paso 3 — Conseguir el token de la Management API

> ⚠️ **Ojo, este es el paso donde es fácil equivocarse.** Storyblok tiene **dos tipos de token** y
> se parecen:
>
> - ❌ Los **Access Tokens del space** (Settings → Access Tokens): son para **leer** contenido
>   (Content Delivery API). **NO sirven** para lo que necesitamos.
> - ✅ El **Personal Access Token** (Management API): es para **crear y modificar** contenido.
>   **Es el que necesitamos.**

Para conseguirlo:

1. Click en tu **avatar / cuenta** (arriba a la derecha) → **My Account** (o *Account settings*).
2. Buscá la pestaña o sección de **Personal access tokens** (a veces aparece como *Tokens* o
   *Management API token*).
3. Generá un token nuevo y **copialo** (probablemente solo te lo muestre una vez).

> Si no lo encontrás con ese nombre exacto, buscá cualquier opción que mencione **"Management API"**
> o **"Personal access token"**. Si te trabás, mandame una captura de la pantalla de tokens
> (tapando el token) y te digo cuál es.

## Paso 4 — Ponerlos en el `.env`

Abrí **`web-builder/.env`** y agregá (o completá) estas líneas:

```
WEB_PUBLISH_MODE=mock
STORYBLOK_MANAGEMENT_TOKEN=<pegá acá el personal access token>
STORYBLOK_SPACE_ID=<pegá acá el número del space>
STORYBLOK_REGION=eu
```

Notas:
- Dejá `WEB_PUBLISH_MODE=mock` por ahora. **Yo lo cambio cuando vayamos a publicar** — así no se
  publica nada por accidente.
- `STORYBLOK_REGION`: usá `eu` salvo que al crear el space hayas elegido otra región
  (`us`, `ap`, `ca`, `cn`).

> 🔒 El token es un **secreto**: va solo al `.env` (que está gitignoreado). **No me lo pases por
> chat.**

## Paso 5 — Avisame

Escribime: **"Storyblok listo"**.

Yo me encargo de:
1. Correr el **provisioning de componentes** (`npm run setup:storyblok`), que crea en tu space los
   bloques `page`, `hero`, `section`, `faq` y `faq_item`.
2. **Publicar** las páginas generadas desde el research.
3. Guiarte para que las veas y las edites en el **Visual Editor**.

> Recordá que hay una **compuerta de aprobación** (ADR-06): para publicar en vivo, el brief tiene que
> estar aprobado **y** cada página marcada como aprobada. Te acompaño en ese paso — es a propósito
> que no se pueda publicar sin querer.

---

## Cómo saber que salió bien

- [ ] Tenés un space creado.
- [ ] Anotaste el **Space ID** (un número).
- [ ] Conseguiste el **Personal Access Token** (Management API), **no** un token del space.
- [ ] Los tres valores están en `web-builder/.env`.
- [ ] `WEB_PUBLISH_MODE` sigue en `mock` (lo cambio yo).

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| Error 401 al publicar | El token es del tipo equivocado (usaste un Access Token del space en vez del Personal Access Token). |
| Error 404 | El Space ID está mal, o la región no coincide (`STORYBLOK_REGION`). |
| Las páginas se ven "en blanco" en el editor | Falta correr el provisioning de componentes. Eso lo hago yo. |

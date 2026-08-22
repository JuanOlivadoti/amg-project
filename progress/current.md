# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-22
**En curso:** nada. Se cerró un ítem del Bloque H — el enlace de preview del Visual Editor ya no se
emite a mano (`npm run preview:firmar -w renderer`). Antes en la misma sesión: Bloque D (calibración
real contra DataForSEO, `lib/budget.ts` corregido) y el Bloque F fase 2 mergeado a `main` con su
migración (`0024`) desplegada. Detalle completo en
[`history.md`](history.md#2026-08-22--bloque-h-el-enlace-de-preview-del-visual-editor-ya-no-se-emite-a-mano).
**Estado:** `renderer` 162/162, typecheck limpio. Producción al día (24 migraciones aplicadas).

**Decisiones de esta sesión:**
- **G/H no se atacan enteros.** G (CDN, invalidación multi-instancia) es infraestructura sin urgencia
  hoy — corre en una sola instancia, el problema que resolvería no existe todavía. De H, dos ítems
  son decisiones de negocio de Juan (OBS-04, precio de la salida gestionada) y uno depende de esa
  decisión (el clic-para-editar del Visual Editor solo importa si el cliente edita). Se lo dije al
  usuario así, en vez de fingir que había ingeniería lista para hacer, y eligió el único ítem sin
  decisión de negocio de por medio.
- `PREVIEW_SECRET` **no** se sumó al `MAPA.renderer` de `env:sync` — estuve a punto de hacerlo, pero
  `DATABASE_URL_RENDER`/`STORYBLOK_WEBHOOK_SECRET` (las otras credenciales reales del renderizador en
  producción) tampoco están ahí, a propósito: `renderer/.env` es solo para la demo local, las
  credenciales de producción viven solo en Railway. Documentado en `renderer/.env.example`, mismo
  patrón que `DOMINIO_PREVIEW`.

**Pendiente inmediato:**
- **Decisión del usuario, sin resolver:** con qué seguir. De G/H solo queda lo que depende de
  decisiones de negocio (OBS-04, precio de salida gestionada) o de infraestructura sin urgencia (CDN).
- Lo que sigue de Bloque F fase 2, sin empezar: publicar la respuesta de vuelta a Google, alertas por
  WhatsApp/email, acceso real a la Business Profile API (`GOOGLE_REVIEWS_MODO=live`), limpiar la
  conexión cuando el polling detecta un refresh token revocado.

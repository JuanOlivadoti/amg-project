# Guía de alta y uso de DataForSEO (Módulo 2)

Instructivo para dejar DataForSEO listo para el spike de Fase 0.
> Nota: precios y rutas exactas pueden cambiar; confirmá en el dashboard y en docs.dataforseo.com. Datos vigentes a 2026-07.

## 1. Crear la cuenta
1. Entrar a **https://dataforseo.com** → *Sign Up*.
2. Confirmar email y acceder al **dashboard**.
3. En el dashboard, sección **API Access / Dashboard**, ves tu **login** (email) y tu **password de API**. Con esos dos se arma la autenticación (HTTP Basic Auth). No hay OAuth ni developer token: es lo bueno frente a Google Ads.

## 2. Sandbox primero (gratis), luego producción
- **Sandbox** (`https://sandbox.dataforseo.com`): devuelve datos ficticios, **sin costo**. Sirve para cablear la integración y validar el esquema sin gastar.
- **Producción** (`https://api.dataforseo.com`): datos reales, requiere **saldo**. DataForSEO funciona con **depósito prepago** (mínimo histórico ~50 USD; confirmá el actual). No es suscripción mensual fija: pagás por lo que consumís.

**Plan para el spike:** cablear todo contra sandbox → cuando funcione, cargar el mínimo y correr 1-2 research reales para medir el costo por corrida.

## 3. Autenticación
Header en cada request:
```
Authorization: Basic BASE64(login:password)
Content-Type: application/json
```
Donde `BASE64(login:password)` es tu login y password unidos por `:` y codificados en base64.

## 4. Endpoints que usa el Módulo 2

| Paso del pipeline | Endpoint (POST, prefijo `/v3`) |
|---|---|
| Volumen + tendencia | `/keywords_data/google_ads/search_volume/live` |
| Expansión (sugerencias) | `/dataforseo_labs/google/keyword_suggestions/live` |
| Expansión (ideas) | `/dataforseo_labs/google/keyword_ideas/live` |
| Expansión (relacionadas) | `/dataforseo_labs/google/related_keywords/live` |
| Dificultad (KD) en bulk | `/dataforseo_labs/google/bulk_keyword_difficulty/live` |
| Intención de búsqueda | `/dataforseo_labs/google/search_intent/live` |
| SERP (clustering + intención) | `/serp/google/organic/live/advanced` |

- **`live`** = respuesta inmediata (más caro). Para producir en serio conviene la variante **task** (POST + GET en cola, más barata). Para el spike, `live` está bien por simplicidad.
- **España:** `location_code = 2724`, `language_code = "es"`.

## 5. Prueba rápida de credenciales (sandbox)

**Bash (tenés Git Bash en Windows):**
```bash
LOGIN="tu-login"; PASS="tu-password"
AUTH=$(printf "%s:%s" "$LOGIN" "$PASS" | base64)
curl -s -X POST "https://sandbox.dataforseo.com/v3/keywords_data/google_ads/search_volume/live" \
  -H "Authorization: Basic $AUTH" \
  -H "Content-Type: application/json" \
  -d '[{"keywords":["restaurante italiano madrid","mejor pizzeria madrid"],"location_code":2724,"language_code":"es"}]'
```

**PowerShell:**
```powershell
$login="tu-login"; $pass="tu-password"
$auth=[Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$login`:$pass"))
$body='[{"keywords":["restaurante italiano madrid","mejor pizzeria madrid"],"location_code":2724,"language_code":"es"}]'
Invoke-RestMethod -Method Post `
  -Uri "https://sandbox.dataforseo.com/v3/keywords_data/google_ads/search_volume/live" `
  -Headers @{ Authorization = "Basic $auth" } `
  -ContentType "application/json" -Body $body
```

Si devuelve un JSON con `status_code: 20000`, la autenticación funciona. (En sandbox los números son ficticios.)

## 6. Costo — cómo lo controlamos
- Endpoints **task** (cola) en vez de `live` en producción.
- **Cache** con `expires_at` (30 días) para no re-cobrar la misma keyword.
- **SERP solo para cabezas de cluster** (es el endpoint más caro).
- **Presupuesto preflight**: se estima el gasto antes de cada fase y se corta si supera el tope.
- El costo real por research queda registrado (`cost_micros_usd`) → sirve para la propuesta a Frank.

## 7. Qué necesito de vos para el spike
1. **Login + password de API** (los del dashboard). Ideal cargados como variables de entorno, no pegados en el chat.
2. Confirmar que arrancamos contra **sandbox** y pasamos a producción cuando esté cableado.

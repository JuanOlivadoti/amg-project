# Acción 01 — Rotar la API key de OpenAI

**Tiempo:** ~10 minutos · **Costo:** gratis · **Prioridad:** 🔴 alta

## Por qué

Hoy la **misma** API key está en dos archivos: `kr-service/.env` y `web-builder/.env`.
Además estuvo dando vueltas durante todo el spike.

Problemas:
- Una sola filtración compromete **los dos** módulos.
- No podés **revocar uno solo** ni saber **cuál gastó qué**.
- No hay **límite de gasto** por servicio.

> ✅ Dato tranquilizador: **la key nunca se subió a GitHub.** Los `.env` están gitignoreados y se
> verificó el historial. Esto es prevención, no una fuga.

## ⚠️ El orden importa

**Creá las keys nuevas primero, verificá, y recién después revocá la vieja.**
Si revocás primero, te quedás con todo roto mientras configurás.

---

## Paso 1 — Crear dos "Projects" con límite de gasto

Un *project* en OpenAI es un contenedor con su propio presupuesto y sus propias keys. Así podés
ver cuánto gastó cada módulo y ponerle un techo.

1. Entrá a **https://platform.openai.com/**
2. Andá a la sección de **Projects** (suele estar en el menú de configuración de la organización,
   arriba a la izquierda o en *Settings*).
3. Creá **dos** projects:
   - `amg-kr-service`
   - `amg-web-builder`
4. En cada uno, buscá los **límites de gasto** (*Limits* / *Budgets*) y poné un tope mensual bajo
   para empezar. Sugerencia: **5 USD** cada uno. Alcanza de sobra para desarrollo y te protege de
   una sorpresa.

> Si no encontrás la sección de Projects, no es bloqueante: podés crear las dos keys igual (Paso 2)
> y ponerle un límite de gasto general a la cuenta. Lo importante es que sean **dos keys distintas**.

## Paso 2 — Crear una key por módulo

1. Andá a **https://platform.openai.com/api-keys**
2. Click en **Create new secret key**.
3. Ponele nombre `amg-kr-service` y, si te deja elegir project, seleccioná `amg-kr-service`.
4. **Copiá la key ahora** — OpenAI solo te la muestra una vez.
5. Repetí para la segunda: nombre `amg-web-builder`, project `amg-web-builder`.

Ahora tenés dos keys nuevas. Llamémoslas `KEY_KR` y `KEY_WEB`.

## Paso 3 — Ponerlas en los `.env`

Abrí cada archivo y reemplazá la línea `OPENAI_API_KEY=...` por la key nueva que corresponda:

**`kr-service/.env`**
```
OPENAI_API_KEY=<pegá acá KEY_KR>
```

**`web-builder/.env`**
```
OPENAI_API_KEY=<pegá acá KEY_WEB>
```

Guardá los dos archivos.

> 🔒 **Nunca** pegues estas keys en el chat, en un commit, ni en un documento. Van solo al `.env`,
> que está gitignoreado.

## Paso 4 — Verificar que funcionan (ANTES de revocar la vieja)

Abrí una terminal y corré:

```bash
cd kr-service
npm run spike
```
Tiene que terminar con `✅ Brief válido contra el esquema kr.v0.3` y un costo mayor a cero
(ej. `[cost] total $0.0178 ...`). Si el LLM no funcionara, verías `heurística` en vez de `LLM` en
el paso de intención.

```bash
cd ../web-builder
npm run build:web
```
Tiene que decir `[prose] 1/1 página(s) redactada(s) (openai)`.
Si dijera `(mock)`, la key no está siendo leída → revisá el `.env`.

## Paso 5 — Revocar la key vieja

Recién ahora, con todo funcionando:

1. Volvé a **https://platform.openai.com/api-keys**
2. Buscá la key vieja (empieza con `sk-proj-jLAY...`).
3. Click en **Revoke** / eliminar.

Desde ese momento la key vieja no sirve para nada, aunque alguien la tuviera.

## Paso 6 — Avisame

Escribime simplemente: **"key rotada"**.

**No me pases las keys nuevas.** No las necesito: el código las lee del `.env`.

---

## Cómo saber que salió bien

- [ ] Existen dos keys distintas, una por módulo.
- [ ] Cada una tiene un límite de gasto.
- [ ] `npm run spike` (kr-service) termina OK y con costo > 0.
- [ ] `npm run build:web` (web-builder) dice `prose ... (openai)`, no `(mock)`.
- [ ] La key vieja está revocada.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| `[prose] ... (mock)` | El `.env` no tiene la key, o el archivo no se guardó. |
| El spike usa `heurística` en intención | Ídem: la key no llegó a `kr-service/.env`. |
| Error 401 de OpenAI | La key está mal copiada (le falta un pedazo) o ya fue revocada. |
| Error de cuota/límite | El límite de gasto del project es demasiado bajo o la cuenta no tiene saldo. |

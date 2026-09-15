# mcp-server — AMG OS desde Claude Desktop

Servidor MCP local. Le da a Claude Desktop seis herramientas para operar AMG OS en lenguaje natural,
actuando **con el usuario y el rol reales de quien lo corre** — nunca con una credencial más poderosa
que la suya. Diseño completo: [`docs/superpowers/specs/2026-09-05-mcp-claude-desktop-design.md`](../docs/superpowers/specs/2026-09-05-mcp-claude-desktop-design.md).

## 1. Iniciar sesión (una vez, o cuando el refresh token muera)

En una terminal normal — **no** dentro de Claude Desktop:

```bash
AMG_SUPABASE_URL=https://<tu-proyecto>.supabase.co \
AMG_SUPABASE_ANON_KEY=<la anon key> \
npm run mcp:login -w mcp-server
```

Pide email y contraseña (la contraseña **no** se enmascara en pantalla — ver el comentario en
`src/cli/login.ts`) y escribe la sesión en `~/.amg-mcp/session.json`.

## 2. Registrar el servidor en Claude Desktop

Editá `claude_desktop_config.json` (la ubicación depende del sistema operativo; buscarla en la
documentación de Claude Desktop) y agregá:

```json
{
  "mcpServers": {
    "amg-os": {
      "command": "npx",
      "args": ["tsx", "/ruta/absoluta/al/repo/mcp-server/src/index.ts"],
      "env": {
        "AMG_API_URL": "http://localhost:3000",
        "AMG_SUPABASE_URL": "https://<tu-proyecto>.supabase.co",
        "AMG_SUPABASE_ANON_KEY": "<la anon key>"
      }
    }
  }
}
```

`AMG_API_URL` apunta al `dev-server` local (`npm run dev:server -w api`, puerto `3000`) hasta que el
circuito esté probado de punta a punta. Apuntar a producción es cambiar esa única variable, un paso
aparte y consciente.

Reiniciá Claude Desktop después de editar el archivo.

## 3. Las seis tools

| Tool | Qué hace | Escribe |
| --- | --- | --- |
| `amg_listar_clientes` | Clientes del tenant, con id y nombre — paso previo obligatorio | no |
| `amg_ver_cliente` | Ficha de un cliente | no |
| `amg_listar_runs` | Runs de un cliente o de todo el tenant | no |
| `amg_ver_run` | Brief, páginas propuestas y última decisión de un run | no |
| `amg_ver_informe` | El informe de keyword research | no |
| `amg_aprobar_run` | Aprueba un run — dispara trabajo real, y gasto si el destino es `crear_web` | **sí** |

Lo que NO entra en esta v1, a propósito (spec §5.1): reseñas, posts, edición de menú/perfil, members,
ideas, archivar/desarchivar, y estado de publicación (el endpoint no existe todavía). Candidatos
naturales de una v2, una vez que se sepa si el circuito de seis se siente bien en un chat.

## 4. Si algo no anda

Ver la tabla de errores en el spec §7 — cada mensaje que devuelve una tool ya dice qué hacer
(`npm run mcp:login`, revisar que el `dev-server` esté corriendo, etc.).

## 5. Desarrollo

```bash
npm test -w mcp-server
npm run typecheck -w mcp-server
```

No importa `db/` ni `api/` como paquetes — solo habla HTTP y GoTrue directo. Ver §1 y §3.1 del spec
para por qué.

## 6. Qué falta para la v1 completa

El código está terminado y probado (`node:test`, mutación confirmada en las dos barreras de
UUID/enum). Lo único que falta es la prueba manual real — ver el spec §10 — y no la puede hacer una
sesión de Claude Code sola: necesita Claude Desktop instalado, un login real contra un proyecto de
Supabase, y ejercitar las seis tools desde ahí, incluida una aprobación real (`destino:
"solo_informe"`, para no gastar) que llegue a la base.

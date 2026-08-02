#!/usr/bin/env bash
#
# verificar.sh — la verificación del arnés de AMG OS, en un solo comando.
#
# Se corre al EMPEZAR una sesión (¿está sano el entorno?) y antes de dar por cerrada cualquier etapa
# (¿está sano el trabajo?). Devuelve exit code 0 solo si todo pasó: el harness lo puede usar como
# compuerta, y una compuerta que el agente no puede saltarse vale más que una promesa en un comentario.
#
#   npm run verificar              entorno + arnés + higiene + typecheck + tests (y el portal si cambió)
#   npm run verificar -- --rapido  todo menos los tests (segundos, para iterar)
#   npm run verificar -- --con-portal   fuerza los tests del portal aunque no haya cambios
#
# Bash y no tsx a propósito: esto tiene que poder correr ANTES de que exista node_modules, que es
# justo el fallo que más veces arruinó un arranque de sesión ("Cannot find package 'tsx'").

set -u
cd "$(dirname "$0")/.." || exit 1

VERDE='\033[0;32m'; ROJO='\033[0;31m'; AMARILLO='\033[0;33m'; NC='\033[0m'
ok()   { printf "${VERDE}[OK]${NC}    %s\n" "$1"; }
warn() { printf "${AMARILLO}[AVISO]${NC} %s\n" "$1"; }
fail() { printf "${ROJO}[FALLA]${NC} %s\n" "$1"; }

SALIDA=0
RAPIDO=0
CON_PORTAL=0
for arg in "$@"; do
  case "$arg" in
    --rapido) RAPIDO=1 ;;
    --con-portal) CON_PORTAL=1 ;;
    *) warn "opción desconocida: $arg" ;;
  esac
done

echo "── 1. Entorno ────────────────────────────────────────────"

if ! command -v node >/dev/null 2>&1; then
  fail "node no está instalado"; exit 1
fi
NODE_MAYOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAYOR" -lt 20 ]; then
  fail "node $(node --version): el proyecto pide >=20.12.0"; exit 1
fi
ok "node $(node --version)"

if [ ! -d node_modules ]; then
  fail "falta node_modules — corré 'npm install'. Sin esto los tests fallan con \"Cannot find package 'tsx'\", y NO es un bug"
  exit 1
fi
ok "node_modules de la raíz"

if [ -d portal/node_modules ]; then
  ok "node_modules del portal"
else
  warn "portal/ sin node_modules — 'npm --prefix portal install' si vas a tocar el portal"
fi

echo ""
echo "── 2. Archivos del arnés ─────────────────────────────────"

for f in AGENTS.md CLAUDE.md CHECKPOINTS.md \
         docs/proyecto/09-estado-y-roadmap.md \
         docs/proyecto/11-plan-fase-2.md \
         docs/decisiones-arquitectura.md \
         progress/current.md progress/history.md; do
  if [ -f "$f" ]; then ok "$f"; else fail "falta $f"; SALIDA=1; fi
done

AGENTES=$(find .claude/agents -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
SKILLS=$(find .claude/skills -name 'SKILL.md' 2>/dev/null | wc -l | tr -d ' ')
ok "$AGENTES agente(s) y $SKILLS skill(s) en .claude/"

echo ""
echo "── 3. Higiene: nada de secretos en git ───────────────────"

# Trackeado. Un .env versionado es un incidente, no un aviso.
FILTRADOS=$(git ls-files 2>/dev/null | grep -E '(^|/)\.env$|(^|/)\.env\.|^docs/private/' | grep -v '\.env\.example$')
if [ -n "$FILTRADOS" ]; then
  fail "hay secretos TRACKEADOS en git:"; echo "$FILTRADOS" | sed 's/^/          /'; SALIDA=1
else
  ok "ningún .env ni docs/private/ trackeado"
fi

# En el índice, a punto de entrar en el próximo commit.
STAGEADOS=$(git diff --cached --name-only 2>/dev/null | grep -E '(^|/)\.env$|^docs/private/|^node_modules/|(^|/)out/|(^|/)\.cache/' | grep -v '\.env\.example$')
if [ -n "$STAGEADOS" ]; then
  fail "hay archivos prohibidos en el índice:"; echo "$STAGEADOS" | sed 's/^/          /'; SALIDA=1
else
  ok "el índice está limpio"
fi

echo ""
echo "── 4. Typecheck ──────────────────────────────────────────"

if npm run typecheck --silent > /tmp/amg-verificar-typecheck.log 2>&1; then
  ok "typecheck limpio (6 paquetes + scripts/)"
else
  fail "typecheck en rojo — últimas líneas:"; tail -15 /tmp/amg-verificar-typecheck.log | sed 's/^/          /'; SALIDA=1
fi

if [ "$RAPIDO" = "1" ]; then
  echo ""
  warn "modo --rapido: NO se corrieron los tests. El verde de acá NO alcanza para cerrar una etapa."
  echo ""
  [ $SALIDA -eq 0 ] && ok "entorno listo" || fail "hay problemas sin resolver"
  exit $SALIDA
fi

echo ""
echo "── 5. Tests del monorepo ─────────────────────────────────"

if npm test --silent > /tmp/amg-verificar-test.log 2>&1; then
  # Esta es LA cifra de tests del monorepo, medida. Si no coincide con la que declara la
  # documentación, la que está mal es la documentación: sincronizala (09-estado-y-roadmap.md,
  # 08-testing-calidad.md y el README de docs/proyecto/ la repiten).
  ok "$(grep -hE '^# pass' /tmp/amg-verificar-test.log | awk '{s+=$3} END {print s+0}') tests en verde (6 paquetes + scripts/)"
else
  fail "tests en rojo — últimas líneas:"; tail -25 /tmp/amg-verificar-test.log | sed 's/^/          /'; SALIDA=1
fi

echo ""
echo "── 6. Portal ─────────────────────────────────────────────"

# `npm test` de la raíz corre --workspaces, y portal/ NO es workspace: sus tests quedan afuera del
# verde de arriba. Por eso se corren aparte, y solo cuando el portal cambió (o si se piden).
PORTAL_CAMBIO=$(git status --porcelain portal/ 2>/dev/null | head -1)
if [ "$CON_PORTAL" = "1" ] || [ -n "$PORTAL_CAMBIO" ]; then
  if [ ! -d portal/node_modules ]; then
    fail "el portal cambió pero no tiene node_modules — 'npm --prefix portal install'"; SALIDA=1
  elif npm --prefix portal test --silent > /tmp/amg-verificar-portal.log 2>&1; then
    ok "tests del portal en verde (node:test)"
    warn "los *.spec.ts de componentes van aparte: 'npm --prefix portal run test:components' (Karma)"
  else
    fail "tests del portal en rojo — últimas líneas:"; tail -20 /tmp/amg-verificar-portal.log | sed 's/^/          /'; SALIDA=1
  fi
else
  ok "el portal no cambió: sus tests no hacían falta (--con-portal los fuerza)"
fi

echo ""
echo "── Resumen ───────────────────────────────────────────────"
if [ $SALIDA -eq 0 ]; then
  ok "todo verde. Para cerrar la etapa falta lo que ningún script ve: manejar la app en el navegador"
else
  fail "NO está listo. Resolvé lo de arriba antes de dar nada por cerrado"
fi
exit $SALIDA

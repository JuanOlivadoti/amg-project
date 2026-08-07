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
# justo el fallo que más veces arruinó un arranque de sesión ("Cannot find package 'tsx'"). La lógica
# que SÍ necesita tests —qué ruta es un secreto— vive en scripts/secretos.mts y se invoca desde acá,
# después de haber comprobado que node_modules existe.

set -u
cd "$(dirname "$0")/.." || exit 1

VERDE='\033[0;32m'; ROJO='\033[0;31m'; AMARILLO='\033[0;33m'; NC='\033[0m'
ok()   { printf "${VERDE}[OK]${NC}    %s\n" "$1"; }
warn() { printf "${AMARILLO}[AVISO]${NC} %s\n" "$1"; }
fail() { printf "${ROJO}[FALLA]${NC} %s\n" "$1"; }

LOG_TYPECHECK=$(mktemp -t amg-verificar-typecheck)
LOG_TEST=$(mktemp -t amg-verificar-test)
LOG_PORTAL=$(mktemp -t amg-verificar-portal)
LOG_SECRETOS=$(mktemp -t amg-verificar-secretos)
trap 'rm -f "$LOG_TYPECHECK" "$LOG_TEST" "$LOG_PORTAL" "$LOG_SECRETOS"' EXIT

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
if [ "$RAPIDO" = "1" ] && [ "$CON_PORTAL" = "1" ]; then
  warn "--rapido y --con-portal juntos: gana --rapido, no se corre ningún test"
fi

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
         docs/proyecto/15-plan-plataforma.md \
         docs/decisiones-arquitectura.md \
         progress/current.md progress/history.md; do
  if [ -f "$f" ]; then ok "$f"; else fail "falta $f"; SALIDA=1; fi
done

# Con piso: un `find` que no encuentra nada no puede reportar [OK]. Es el mismo motivo por el que
# contraste.test.ts afirma `archivos.length >= 4` antes de recorrer las plantillas.
AGENTES=$(find .claude/agents -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
SKILLS=$(find .claude/skills -name 'SKILL.md' 2>/dev/null | wc -l | tr -d ' ')
if [ "$AGENTES" -lt 1 ] || [ "$SKILLS" -lt 1 ]; then
  fail "$AGENTES agente(s) y $SKILLS skill(s): el arnés de .claude/ no está donde debería"
  SALIDA=1
else
  ok "$AGENTES agente(s) y $SKILLS skill(s) en .claude/"
fi

echo ""
echo "── 3. Higiene: nada de secretos en git ───────────────────"

# "No pude mirar" y "está limpio" NO pueden dar la misma salida verde: esta casilla es la única
# comprobación automática de la regla más dura del proyecto.
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  fail "esto no es un repositorio git: NO pude comprobar si hay secretos versionados"
  SALIDA=1
else
  PROHIBIDAS=$( { git ls-files; git diff --cached --name-only; } 2>/dev/null | sort -u \
                | node --import tsx scripts/secretos.mts 2>"$LOG_SECRETOS" )
  CODIGO=$?
  if [ -n "$PROHIBIDAS" ]; then
    fail "hay rutas prohibidas en git (trackeadas o en el índice):"
    echo "$PROHIBIDAS" | sed 's/^/          /'
    SALIDA=1
  elif [ $CODIGO -ne 0 ]; then
    fail "el detector de secretos no pudo correr (exit $CODIGO):"
    tail -5 "$LOG_SECRETOS" | sed 's/^/          /'
    SALIDA=1
  else
    ok "sin secretos entre los $(git ls-files | wc -l | tr -d ' ') archivos versionados ni en el índice"
  fi
fi

echo ""
echo "── 4. Typecheck ──────────────────────────────────────────"

# El conteo se DERIVA de los workspaces, no se escribe a mano: el "6 paquetes" que estaba acá quedó
# viejo el día que apareció el 7º (`contrato`), y un mensaje que miente sobre cuánto verificó es peor
# que no tenerlo. Mismo motivo que el piso del `find` de la sección 2: si no pude contar, no digo [OK].
N_PAQUETES=$(node -e 'console.log(require("./package.json").workspaces.length)')
if ! [ "$N_PAQUETES" -ge 1 ] 2>/dev/null; then
  fail "no pude contar los workspaces del package.json de la raíz: el conteo de abajo sería una cifra inventada"
  exit 1
fi

if npm run typecheck --silent > "$LOG_TYPECHECK" 2>&1; then
  ok "typecheck limpio ($N_PAQUETES paquetes + scripts/)"
else
  fail "typecheck en rojo — últimas líneas:"; tail -15 "$LOG_TYPECHECK" | sed 's/^/          /'; SALIDA=1
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

# El conteo NO se hace con un grep acá: el patrón que estaba en esta línea (`^# pass`) se rompió el día
# que Node 24 cambió el reporter por defecto de `tap` a `spec` (`ℹ pass 34` en vez de `# pass 34`), y el
# arnés estuvo imprimiendo `[OK] 0 tests en verde` — verde, con la cifra en cero. Ahora la lógica vive
# en scripts/contar-tests.mts, que tiene 9 tests, cubre los dos formatos y **falla si no puede contar**:
# un contador que no cuenta no reporta verde. Mismo motivo que el piso de N_PAQUETES.
contar_tests() { node --import tsx scripts/contar-tests.mts "$1" 2>&1; }

if npm test --silent > "$LOG_TEST" 2>&1; then
  # Esta es LA cifra de tests del monorepo, medida. Si no coincide con la que declara la
  # documentación, la que está mal es la documentación: sincronizala (09-estado-y-roadmap.md,
  # 08-testing-calidad.md y el README de docs/proyecto/ la repiten).
  if CONTEO=$(contar_tests "$LOG_TEST"); then
    ok "$CONTEO tests en verde ($N_PAQUETES paquetes + scripts/)"
  else
    fail "los tests pasaron, pero NO pude contarlos — así que esto no es un verde:"
    echo "$CONTEO" | sed 's/^/          /'
    SALIDA=1
  fi
else
  fail "tests en rojo — últimas líneas:"; tail -25 "$LOG_TEST" | sed 's/^/          /'; SALIDA=1
fi

echo ""
echo "── 6. Portal ─────────────────────────────────────────────"

# `npm test` de la raíz corre --workspaces, y portal/ NO es workspace: sus tests quedan afuera del
# verde de arriba. Se corren aparte cuando el portal cambió — y "cambió" incluye lo ya commiteado y
# todavía sin pushear, porque el momento de recorrer CHECKPOINTS.md es justo DESPUÉS del commit.
PORTAL_SIN_COMMITEAR=$(git status --porcelain -- portal/ 2>/dev/null | head -1)
PORTAL_SIN_PUSHEAR=$(git diff --name-only '@{upstream}..HEAD' -- portal/ 2>/dev/null | head -1)
if [ "$CON_PORTAL" = "1" ] || [ -n "$PORTAL_SIN_COMMITEAR" ] || [ -n "$PORTAL_SIN_PUSHEAR" ]; then
  if [ ! -d portal/node_modules ]; then
    fail "el portal cambió pero no tiene node_modules — 'npm --prefix portal install'"; SALIDA=1
  elif npm --prefix portal test --silent > "$LOG_PORTAL" 2>&1; then
    if CONTEO_PORTAL=$(contar_tests "$LOG_PORTAL"); then
      ok "$CONTEO_PORTAL tests del portal en verde (node:test)"
    else
      fail "los tests del portal pasaron, pero NO pude contarlos — así que esto no es un verde:"
      echo "$CONTEO_PORTAL" | sed 's/^/          /'
      SALIDA=1
    fi
    warn "los *.spec.ts de componentes van aparte: 'npm --prefix portal run test:components' (Karma)"
  else
    fail "tests del portal en rojo — últimas líneas:"; tail -20 "$LOG_PORTAL" | sed 's/^/          /'; SALIDA=1
  fi
else
  ok "el portal no cambió ni en el árbol ni en los commits sin pushear (--con-portal los fuerza igual)"
fi

echo ""
echo "── Resumen ───────────────────────────────────────────────"
if [ $SALIDA -eq 0 ]; then
  ok "todo verde. Para cerrar la etapa falta lo que ningún script ve: manejar la app en el navegador"
else
  fail "NO está listo. Resolvé lo de arriba antes de dar nada por cerrado"
fi
exit $SALIDA

#!/usr/bin/env bash
#
# hook-cierre.sh — lo corre el harness (hook `Stop` de .claude/settings.json) cuando el agente
# termina de responder. NO lo corre el agente, así que no se lo puede saltar: es la única parte del
# ritual que no depende de que alguien se acuerde.
#
# El hook `Stop` se dispara al final de CADA turno, no una vez por sesión. Por eso esto tiene que ser
# barato: la suite completa tarda ~42s (medido) y colgar cada respuesta 42 segundos es inaceptable.
# La regla: si no se tocó código, sale en milisegundos; si se tocó, corre solo el typecheck (~5s) y
# avisa de lo que falta.
#
# Sale con 0 SIEMPRE, incluso en rojo: avisa, no secuestra la sesión. Si preferís que bloquee y me
# obligue a arreglarlo antes de devolverte el control, cambiá el `exit 0` final por `exit 2`.

set -u
cd "$(dirname "$0")/.." || exit 0

# Solo código: la extensión ya deja afuera docs/ y progress/, que son .md.
CAMBIOS=$(git status --porcelain -- '*.ts' '*.mts' '*.tsx' '*.sql' '*.json' '*.css' '*.html' 2>/dev/null)

if [ -z "$CAMBIOS" ]; then
  exit 0   # nada que verificar: turno conversacional o trabajo ya commiteado
fi

# Se cuenta ANTES de truncar nada: un mensaje que dice "20 archivos" cuando son 50 es una cifra que
# el agente después repite.
CANT=$(printf '%s\n' "$CAMBIOS" | grep -c .)

LOG=$(mktemp -t amg-hook-typecheck)
trap 'rm -f "$LOG"' EXIT

if npm run typecheck --silent > "$LOG" 2>&1; then
  echo "[arnés] $CANT archivo(s) de código sin commitear · typecheck OK · falta 'npm run verificar' (~50s) antes de cerrar la etapa"
else
  echo "[arnés] ✗ TYPECHECK EN ROJO con $CANT archivo(s) tocados. No cierres la etapa así:"
  tail -12 "$LOG" | sed 's/^/          /'
fi

exit 0

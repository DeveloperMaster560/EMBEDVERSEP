#!/bin/sh
# Equivalente de start-agent-team.ps1 para macOS/Linux: comprueba Ollama y el
# modelo, arranca el runtime de agentes (127.0.0.1:5175) y la interfaz
# (127.0.0.1:5174) en segundo plano. No descarga modelos ni instala nada.
#   EMBEDVERSE_OLLAMA_MODEL  modelo a usar (por omisión qwen2.5-coder:7b)
set -eu
cd "$(dirname "$0")/.."
# Enlace con el PC Windows (scripts/enlazar-windows.sh): fuera del repositorio.
ENLACE="${XDG_CONFIG_HOME:-$HOME/.config}/embedverse/ollama.env"
if [ -z "${EMBEDVERSE_OLLAMA_URL:-}" ] && [ -f "$ENLACE" ]; then
  EMBEDVERSE_OLLAMA_URL="$(sed -n 's/^EMBEDVERSE_OLLAMA_URL=//p' "$ENLACE")"
  EMBEDVERSE_OLLAMA_REMOTO="$(sed -n 's/^EMBEDVERSE_OLLAMA_REMOTO=//p' "$ENLACE")"
  export EMBEDVERSE_OLLAMA_URL EMBEDVERSE_OLLAMA_REMOTO
fi
OLLAMA_URL="${EMBEDVERSE_OLLAMA_URL:-http://127.0.0.1:11434}"
MODELO="${EMBEDVERSE_OLLAMA_MODEL:-qwen2.5-coder:7b}"
LOGS="${XDG_STATE_HOME:-$HOME/.local/state}/embedverse/logs"
mkdir -p "$LOGS"

responde() { curl -s -o /dev/null --max-time 2 "$1"; }
esperar() { i=0; while [ $i -lt "$2" ]; do responde "$1" && return 0; i=$((i + 1)); sleep 2; done; return 1; }

if [ "$OLLAMA_URL" != "http://127.0.0.1:11434" ]; then
  responde "$OLLAMA_URL/api/tags" || { echo "El Ollama enlazado ($OLLAMA_URL) no responde. Comprueba el PC o vuelve a local: sh scripts/enlazar-windows.sh --local" >&2; exit 1; }
elif ! responde http://127.0.0.1:11434/api/tags; then
  OLLAMA="$(command -v ollama || true)"; [ -z "$OLLAMA" ] && [ -x "$HOME/bin/ollama" ] && OLLAMA="$HOME/bin/ollama"
  [ -z "$OLLAMA" ] && { echo "No se encuentra Ollama. Instálalo y vuelve a ejecutar." >&2; exit 1; }
  nohup "$OLLAMA" serve > "$LOGS/ollama.log" 2>&1 &
  esperar http://127.0.0.1:11434/api/tags 30 || { echo "Ollama no respondió; ver $LOGS/ollama.log" >&2; exit 1; }
fi
if ! curl -s "$OLLAMA_URL/api/tags" | grep -q "\"name\":\"$MODELO\""; then
  echo "Falta el modelo $MODELO. Descárgalo con: ollama pull $MODELO" >&2; exit 1
fi
echo "Ollama listo con $MODELO en $OLLAMA_URL."

if ! responde http://127.0.0.1:5175/health; then
  EMBEDVERSE_OLLAMA_MODEL="$MODELO" nohup npm run agent:runtime > "$LOGS/agent-runtime.log" 2>&1 &
  esperar http://127.0.0.1:5175/health 45 || { echo "El runtime no respondió; ver $LOGS/agent-runtime.log" >&2; exit 1; }
fi
echo "Runtime local listo: http://127.0.0.1:5175"

if ! responde http://127.0.0.1:5174/; then
  nohup npm run agent:ui > "$LOGS/agent-ui.log" 2>&1 &
  esperar http://127.0.0.1:5174/ 45 || { echo "La interfaz no respondió; ver $LOGS/agent-ui.log" >&2; exit 1; }
fi
echo "Interfaz lista: http://127.0.0.1:5174  (logs en $LOGS)"

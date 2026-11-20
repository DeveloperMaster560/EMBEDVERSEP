#!/bin/sh
# Enlaza este Mac con el PC Windows por Tailscale: el equipo de agentes sigue
# corriendo aquí (repositorio, runtime 127.0.0.1:5175, interfaz 5174), pero el
# modelo lo ejecuta el Ollama del PC, que tiene más potencia.
#
#   sh scripts/enlazar-windows.sh <nombre-o-IP-tailscale-del-PC>   enlazar
#   sh scripts/enlazar-windows.sh --estado                         ver dónde corre el modelo
#   sh scripts/enlazar-windows.sh --local                          volver al Ollama del Mac
#
# Requisitos (los hace el usuario, una vez): sesión iniciada en Tailscale en los
# dos equipos con la misma cuenta, y en el PC `scripts\windows\compartir-ollama.ps1`.
# La elección se guarda fuera del repositorio, en ~/.config/embedverse/ollama.env.
# No instala nada ni toca el firewall. Nunca usa 0.0.0.0.
set -eu
cd "$(dirname "$0")/.."
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/embedverse"
ENV="$CONF/ollama.env"
MODELO="${EMBEDVERSE_OLLAMA_MODEL:-qwen2.5-coder:7b}"
TS="$(command -v tailscale || true)"
[ -z "$TS" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] && TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale

reiniciar_runtime() {
  pkill -f "agentTeam/main.js" 2>/dev/null || true
  i=0; while [ $i -lt 20 ] && curl -s -o /dev/null --max-time 1 http://127.0.0.1:5175/health; do i=$((i + 1)); sleep 1; done
  sh scripts/start-agent-team.sh
  echo; curl -s http://127.0.0.1:5175/health; echo
}

case "${1:-}" in
  ""|-h|--help)
    sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  --estado)
    [ -f "$ENV" ] && { echo "Configuración guardada ($ENV):"; cat "$ENV"; } || echo "Sin enlace guardado: modelo local."
    curl -s --max-time 3 http://127.0.0.1:5175/health || echo "El runtime no está corriendo."; echo; exit 0 ;;
  --local)
    rm -f "$ENV"; echo "Enlace eliminado: se usará el Ollama del Mac."; reiniciar_runtime; exit 0 ;;
esac

PC="$1"
[ -z "$TS" ] && { echo "No encuentro Tailscale en este Mac." >&2; exit 1; }
if ! "$TS" status > /dev/null 2>&1; then
  echo "Tailscale no tiene sesión iniciada en el Mac. Ábrelo desde la barra de menús e inicia sesión (o ejecuta: tailscale up)." >&2
  exit 1
fi
# El PC debe aparecer en la red Tailscale y estar en línea.
LINEA="$("$TS" status | grep -i -w -- "$PC" | head -1 || true)"
[ -z "$LINEA" ] && { echo "El PC «$PC» no aparece en 'tailscale status'. Equipos visibles:" >&2; "$TS" status >&2; exit 1; }
echo "$LINEA" | grep -q -i offline && { echo "El PC aparece desconectado en Tailscale: $LINEA" >&2; exit 1; }
IP="$(echo "$LINEA" | awk '{print $1}')"
case "$IP" in 100.*) ;; *) echo "La dirección Tailscale del PC no es 100.x: $IP" >&2; exit 1 ;; esac
URL="http://$IP:11434"

echo "Comprobando Ollama en el PC ($URL)…"
TAGS="$(curl -s --max-time 5 "$URL/api/tags" || true)"
if [ -z "$TAGS" ]; then
  echo "El PC no responde en $URL. En el PC ejecuta: powershell -ExecutionPolicy Bypass -File scripts\\windows\\compartir-ollama.ps1" >&2
  exit 1
fi
echo "$TAGS" | grep -q "\"name\":\"$MODELO\"" || { echo "El PC responde pero no tiene $MODELO. En el PC: ollama pull $MODELO" >&2; exit 1; }

# Prueba real de generación, con tiempo, para saber si de verdad compensa.
T0=$(date +%s)
curl -s --max-time 300 "$URL/api/generate" -d "{\"model\":\"$MODELO\",\"prompt\":\"Responde solo: listo\",\"stream\":false,\"options\":{\"num_predict\":8}}" | grep -q '"response"' \
  || { echo "El PC no completó una generación de prueba." >&2; exit 1; }
echo "Generación de prueba en el PC: $(( $(date +%s) - T0 )) s (incluye cargar el modelo si no estaba en memoria)."

mkdir -p "$CONF"
umask 077
cat > "$ENV" <<EOF2
# Generado por scripts/enlazar-windows.sh el $(date '+%Y-%m-%d %H:%M'). Borrar con --local.
EMBEDVERSE_OLLAMA_URL=$URL
EMBEDVERSE_OLLAMA_REMOTO=tailscale
EOF2
echo "Enlace guardado en $ENV."
reiniciar_runtime

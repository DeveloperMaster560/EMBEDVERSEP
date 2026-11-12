#!/bin/sh
# Arranca la plataforma SHM en macOS o Linux.
#   sh scripts/iniciar.sh          servicios
#   sh scripts/iniciar.sh demo     servicios + estación simulada (firmware real, señal sintética)
set -eu
cd "$(dirname "$0")/.."
PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=python
"$PY" scripts/preparar.py
if [ "${1:-}" = "demo" ]; then
  docker compose --profile demo up -d --build
else
  docker compose up -d --build
fi
docker compose ps
echo
echo "API y documentación:  http://127.0.0.1:8000/api/docs"
echo "Grafana:              http://127.0.0.1:3000   (usuario admin; contraseña GRAFANA_ADMIN_PASSWORD en .env)"
echo "Broker MQTT:          127.0.0.1:1883"

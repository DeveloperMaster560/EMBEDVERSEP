#!/usr/bin/env bash
# Prepara el entorno de Python que necesita el generador de edificios.
#
#   ./tools/setup_generator.sh          # mínimo: lo que usa el Building Studio
#   ./tools/setup_generator.sh --full   # añade IFC, DXF, PDF y STEP
#
# Crea tools/venv. La app lo encuentra sola; si prefieres otro entorno, define
# EMBEDVERSE_PYTHON con la ruta de su intérprete antes de arrancar Vite.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$ROOT/tools/venv"
PY="${PYTHON:-python3}"

# Las dependencias viven en los requirements, no aquí: este script y su
# equivalente de PowerShell deben instalar exactamente lo mismo, y dos listas
# separadas se desincronizan a la primera.
MIN_REQUIREMENTS="$ROOT/tools/requirements-min.txt"
FULL_REQUIREMENTS="$ROOT/tools/requirements-full.txt"

MODE="min"
if [[ "${1:-}" == "--full" ]]; then MODE="full"; fi

echo "==> Intérprete base: $("$PY" --version 2>&1)"

if [[ ! -d "$VENV" ]]; then
  echo "==> Creando entorno en tools/venv"
  "$PY" -m venv "$VENV"
else
  echo "==> Reutilizando tools/venv"
fi

"$VENV/bin/python" -m pip install --quiet --upgrade pip

echo "==> Instalando dependencias de geometría y malla"
"$VENV/bin/python" -m pip install --quiet -r "$MIN_REQUIREMENTS"

if [[ "$MODE" == "full" ]]; then
  echo "==> Instalando dependencias de IFC, DXF, PDF y STEP (descarga grande)"
  "$VENV/bin/python" -m pip install --quiet -r "$FULL_REQUIREMENTS"
fi

echo "==> Comprobando el generador"
"$VENV/bin/python" - <<'PY'
import importlib, sys
faltan = []
for mod in ("numpy", "shapely", "trimesh", "scipy", "networkx"):
    try:
        importlib.import_module(mod)
    except Exception as exc:
        faltan.append(f"{mod}: {exc}")
if faltan:
    print("FALTAN DEPENDENCIAS:")
    for f in faltan:
        print("   -", f)
    sys.exit(1)
import trimesh
print("   trimesh", trimesh.__version__, "listo")
PY

echo
echo "Entorno listo en tools/venv"
echo "Arranca la app con:  npm run dev"
echo "Si usas otro entorno:  EMBEDVERSE_PYTHON=/ruta/al/python npm run dev"

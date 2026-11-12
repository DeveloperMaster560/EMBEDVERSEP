#!/usr/bin/env python3
"""
Prepara la plataforma en este equipo (Windows, macOS o Linux). Solo usa la
biblioteca estándar de Python 3.9 o posterior.

  - crea plataforma/.env con contraseñas aleatorias (si no existe);
  - crea plataforma/secretos/mqtt-usuarios.txt con los usuarios del broker;
  - comprueba que Docker esté instalado y en marcha.

Nunca sobrescribe credenciales existentes. Para regenerarlas, borra .env y
secretos/ a mano, y también los volúmenes (docker compose down -v), porque la
base de datos guarda la contraseña con la que se creó.
"""

from __future__ import annotations

import secrets
import shutil
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
ENV = RAIZ / ".env"
SECRETOS = RAIZ / "secretos"
USUARIOS = SECRETOS / "mqtt-usuarios.txt"

# Estaciones con usuario en el broker. Hoy solo existe la simulada.
ESTACIONES = ["SD-V2-M"]


def clave() -> str:
    return secrets.token_urlsafe(24)


def var_estacion(sid: str) -> str:
    return "MQTT_" + sid.replace("-", "_") + "_PASSWORD"


def preparar_env() -> dict[str, str]:
    if ENV.exists():
        valores = {}
        for linea in ENV.read_text(encoding="utf-8").splitlines():
            if "=" in linea and not linea.lstrip().startswith("#"):
                k, v = linea.split("=", 1)
                valores[k.strip()] = v.strip()
        print(f"· {ENV.name} ya existe: se conserva.")
        return valores
    valores = {
        "DB_PASSWORD": clave(),
        "GRAFANA_DB_PASSWORD": clave(),
        "GRAFANA_ADMIN_PASSWORD": clave(),
        "MQTT_INGESTA_PASSWORD": clave(),
        **{var_estacion(s): clave() for s in ESTACIONES},
        "ALMACEN": "disco",
    }
    texto = ["# Generado por scripts/preparar.py. NO subir al repositorio.", *(f"{k}={v}" for k, v in valores.items())]
    ENV.write_text("\n".join(texto) + "\n", encoding="utf-8")
    try:
        ENV.chmod(0o600)
    except OSError:
        pass
    print(f"✓ Creado {ENV} con contraseñas aleatorias.")
    return valores


def preparar_usuarios(valores: dict[str, str]) -> None:
    SECRETOS.mkdir(exist_ok=True)
    lineas = [f"shm-ingesta:{valores['MQTT_INGESTA_PASSWORD']}"]
    for s in ESTACIONES:
        if var_estacion(s) in valores:
            lineas.append(f"{s}:{valores[var_estacion(s)]}")
    # Se reescribe siempre a partir del .env (fuente única); el broker las cifra al arrancar.
    with open(USUARIOS, "w", encoding="utf-8", newline="\n") as f:  # LF también en Windows
        f.write("\n".join(lineas) + "\n")
    try:
        USUARIOS.chmod(0o600)
    except OSError:
        pass
    print(f"✓ Usuarios del broker: {', '.join(l.split(':')[0] for l in lineas)}.")


def comprobar_docker() -> bool:
    if shutil.which("docker") is None:
        print("✗ Docker no está instalado. Instala Docker Desktop:")
        print("  https://docs.docker.com/desktop/  (Windows: con WSL 2)")
        return False
    r = subprocess.run(["docker", "info", "--format", "{{.ServerVersion}}"], capture_output=True, text=True)
    if r.returncode != 0:
        print("✗ Docker está instalado pero no responde: abre Docker Desktop y espera a que arranque.")
        return False
    c = subprocess.run(["docker", "compose", "version", "--short"], capture_output=True, text=True)
    if c.returncode != 0:
        print("✗ Falta «docker compose» (v2).")
        return False
    print(f"✓ Docker {r.stdout.strip()}, Compose {c.stdout.strip()}.")
    return True


def main() -> int:
    # En Windows, con la salida redirigida, la consola puede no admitir ✓/✗.
    try:
        sys.stdout.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass
    if sys.version_info < (3, 9):
        print("Hace falta Python 3.9 o posterior.")
        return 1
    valores = preparar_env()
    preparar_usuarios(valores)
    return 0 if comprobar_docker() else 2


if __name__ == "__main__":
    raise SystemExit(main())

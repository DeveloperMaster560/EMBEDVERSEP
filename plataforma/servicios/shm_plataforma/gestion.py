"""
Administración desde la línea de órdenes (dentro del contenedor de la API):

  docker compose exec api python -m shm_plataforma.gestion token --rol lectura --nombre "Consulta UTS"
  docker compose exec api python -m shm_plataforma.gestion token --rol estacion --estacion SD-V2-M --nombre SD-V2-M
  docker compose exec api python -m shm_plataforma.gestion revocar --id 3
  docker compose exec api python -m shm_plataforma.gestion credenciales

El token se muestra UNA vez; en la base solo queda su SHA-256.
"""

from __future__ import annotations

import argparse
import getpass
import secrets

from .db import RepositorioPg, conectar, token_hash


def main() -> int:
    ap = argparse.ArgumentParser(prog="gestion")
    sub = ap.add_subparsers(dest="orden", required=True)
    t = sub.add_parser("token", help="crear una credencial de la API")
    t.add_argument("--rol", required=True, choices=["lectura", "operador", "ingeniero", "estacion"])
    t.add_argument("--nombre", required=True)
    t.add_argument("--estacion")
    r = sub.add_parser("revocar", help="desactivar una credencial")
    r.add_argument("--id", type=int, required=True)
    sub.add_parser("credenciales", help="listar credenciales (sin tokens)")
    a = ap.parse_args()

    repo = RepositorioPg(conectar())
    operador = f"cli:{getpass.getuser()}"
    if a.orden == "token":
        if (a.rol == "estacion") != bool(a.estacion):
            ap.error("--estacion es obligatorio con --rol estacion, y solo con él")
        token = secrets.token_urlsafe(32)
        fila = repo.c.execute(
            "INSERT INTO credenciales (nombre, rol, station_id, token_sha256) VALUES (%s,%s,%s,%s) RETURNING id",
            (a.nombre, a.rol, a.estacion, token_hash(token))).fetchone()
        repo.auditar(operador, "crear_credencial", str(fila["id"]), {"rol": a.rol, "nombre": a.nombre})
        print(f"Credencial {fila['id']} ({a.rol}). Guarda este token; no se volverá a mostrar:\n{token}")
    elif a.orden == "revocar":
        repo.c.execute("UPDATE credenciales SET activa = false WHERE id = %s", (a.id,))
        repo.auditar(operador, "revocar_credencial", str(a.id), {})
        print(f"Credencial {a.id} revocada.")
    else:
        for f in repo.c.execute("SELECT id, nombre, rol, station_id, activa, creada FROM credenciales ORDER BY id"):
            print(f"{f['id']:>4}  {f['rol']:<9} {f['nombre']:<30} {f['station_id'] or '':<10} "
                  f"{'activa' if f['activa'] else 'revocada'}  {f['creada']:%Y-%m-%d}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

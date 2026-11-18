"""
Administración desde la línea de órdenes (dentro del contenedor de la API).

  # Proyectos (se cargan solos al arrancar desde proyectos/*/proyecto.json)
  docker compose exec api python -m shm_plataforma.gestion proyectos
  docker compose exec api python -m shm_plataforma.gestion importar /proyectos/novena/proyecto.json

  # Credenciales: cada una ve SOLO su proyecto
  docker compose exec api python -m shm_plataforma.gestion token --rol ingeniero --proyecto novena --nombre "Ing. responsable"
  docker compose exec api python -m shm_plataforma.gestion token --rol lectura   --proyecto novena --nombre "Consulta UTS"
  docker compose exec api python -m shm_plataforma.gestion token --rol estacion  --estacion SD-V2-M --nombre SD-V2-M
  docker compose exec api python -m shm_plataforma.gestion token --rol admin --nombre "Administración CIAI"
  docker compose exec api python -m shm_plataforma.gestion revocar --id 3
  docker compose exec api python -m shm_plataforma.gestion credenciales [--proyecto novena]

El token se muestra UNA vez; en la base solo queda su SHA-256.
"""

from __future__ import annotations

import argparse
import getpass
import secrets
import sys
from pathlib import Path

from .db import RepositorioPg, conectar, token_hash
from .proyecto import ProyectoInvalido, cargar_archivo

ROLES = ["lectura", "operador", "ingeniero", "estacion", "admin"]


def main() -> int:
    ap = argparse.ArgumentParser(prog="gestion")
    sub = ap.add_subparsers(dest="orden", required=True)
    t = sub.add_parser("token", help="crear una credencial de la API")
    t.add_argument("--rol", required=True, choices=ROLES)
    t.add_argument("--nombre", required=True)
    t.add_argument("--proyecto", help="obligatorio para lectura, operador e ingeniero")
    t.add_argument("--estacion", help="obligatorio para el rol estacion")
    r = sub.add_parser("revocar", help="desactivar una credencial")
    r.add_argument("--id", type=int, required=True)
    c = sub.add_parser("credenciales", help="listar credenciales (sin tokens)")
    c.add_argument("--proyecto")
    sub.add_parser("proyectos", help="listar proyectos")
    i = sub.add_parser("importar", help="cargar o actualizar un proyecto.json")
    i.add_argument("archivo", type=Path)
    a = ap.parse_args()

    repo = RepositorioPg(conectar())
    operador = f"cli:{getpass.getuser()}"

    if a.orden == "token":
        proyecto, estacion = a.proyecto, a.estacion
        if a.rol == "admin":
            if proyecto or estacion:
                ap.error("el rol admin abarca todos los proyectos: no lleva --proyecto ni --estacion")
        elif a.rol == "estacion":
            if not estacion:
                ap.error("--estacion es obligatorio con --rol estacion")
            proyecto_est = repo.proyecto_de_estacion(estacion)
            if proyecto_est is None:
                ap.error(f"no existe la estación «{estacion}»")
            if proyecto and proyecto != proyecto_est:
                ap.error(f"la estación «{estacion}» es del proyecto «{proyecto_est}», no de «{proyecto}»")
            proyecto = proyecto_est
        else:
            if estacion:
                ap.error("--estacion solo va con --rol estacion")
            if not proyecto:
                ap.error(f"--proyecto es obligatorio con --rol {a.rol}")
            if not repo.proyectos(proyecto):
                ap.error(f"no existe el proyecto «{proyecto}» (ver: gestion proyectos)")
        token = secrets.token_urlsafe(32)
        fila = repo.c.execute(
            """INSERT INTO credenciales (nombre, rol, station_id, proyecto_id, token_sha256)
               VALUES (%s,%s,%s,%s,%s) RETURNING id""",
            (a.nombre, a.rol, estacion, proyecto, token_hash(token))).fetchone()
        repo.auditar(operador, "crear_credencial", str(fila["id"]), {"rol": a.rol, "nombre": a.nombre}, proyecto)
        alcance = "todos los proyectos" if a.rol == "admin" else f"proyecto «{proyecto}»"
        print(f"Credencial {fila['id']} ({a.rol}, {alcance}). Guarda este token; no se volverá a mostrar:\n{token}")
    elif a.orden == "revocar":
        repo.c.execute("UPDATE credenciales SET activa = false WHERE id = %s", (a.id,))
        repo.auditar(operador, "revocar_credencial", str(a.id), {})
        print(f"Credencial {a.id} revocada.")
    elif a.orden == "credenciales":
        for f in repo.c.execute(
                """SELECT id, nombre, rol, proyecto_id, station_id, activa, creada FROM credenciales
                   WHERE %(p)s::text IS NULL OR proyecto_id = %(p)s ORDER BY id""", {"p": a.proyecto}):
            print(f"{f['id']:>4}  {f['rol']:<9} {f['proyecto_id'] or '(todos)':<20} {f['station_id'] or '':<12} "
                  f"{f['nombre']:<30} {'activa' if f['activa'] else 'revocada'}  {f['creada']:%Y-%m-%d}")
    elif a.orden == "proyectos":
        for p in repo.proyectos(None):
            print(f"{p['proyecto_id']:<20} {p['tipo_estructura']:<9} {p['estaciones_activas']:>3} estaciones  {p['nombre']}")
    else:
        try:
            pr = cargar_archivo(a.archivo)
            res = repo.importar_proyecto(pr)
        except ProyectoInvalido as e:
            print("No se importó:", file=sys.stderr)
            for p in e.problemas:
                print("  -", p, file=sys.stderr)
            return 1
        print(f"Proyecto «{pr.id}» importado: {res['altas']} estaciones activas, "
              f"{res['desactivadas']} desactivadas, {res['sensores']} sensores.")
        if res["altas"]:
            print("Si hay estaciones nuevas, vuelve a ejecutar scripts/iniciar para crear sus usuarios del broker.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

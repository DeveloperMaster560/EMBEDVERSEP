"""
Pone la base al día y carga los proyectos. Lo ejecuta el servicio de un solo
uso `preparar-db` de docker-compose antes de que arranquen la ingesta y la API:

  python -m shm_plataforma.migrar            # migraciones + proyectos de /proyectos
  python -m shm_plataforma.migrar --solo-migraciones

Las migraciones (carpeta `migraciones/`, en orden) se aplican cada una en su
transacción y quedan anotadas en `schema_migraciones`: nunca se repiten. Vale
para bases recién creadas y para las que ya tienen datos.

Los proyectos (`proyectos/*/proyecto.json`) se importan siempre: el archivo es
la fuente de verdad. Una estación que desaparece del archivo se DESACTIVA, no
se borra: sus datos se conservan.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .proyecto import ProyectoInvalido, cargar_carpeta

MIGRACIONES = Path(__file__).with_name("migraciones")


def aplicar_migraciones(conn) -> list[str]:
    conn.execute("""CREATE TABLE IF NOT EXISTS schema_migraciones (
                      nombre text PRIMARY KEY, aplicada timestamptz NOT NULL DEFAULT now())""")
    hechas = {r["nombre"] for r in conn.execute("SELECT nombre FROM schema_migraciones").fetchall()}
    nuevas = []
    for archivo in sorted(MIGRACIONES.glob("*.sql")):
        if archivo.name in hechas:
            continue
        with conn.transaction():
            conn.execute(archivo.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO schema_migraciones (nombre) VALUES (%s)", (archivo.name,))
        nuevas.append(archivo.name)
    return nuevas


def main() -> int:
    ap = argparse.ArgumentParser(prog="migrar")
    ap.add_argument("--solo-migraciones", action="store_true")
    ap.add_argument("--proyectos", default=os.environ.get("PROYECTOS_DIR", "/proyectos"))
    a = ap.parse_args()

    from .db import RepositorioPg, conectar

    repo = RepositorioPg(conectar())
    nuevas = aplicar_migraciones(repo.c)
    print("Migraciones aplicadas: " + (", ".join(nuevas) if nuevas else "ninguna (la base ya estaba al día)."))
    if a.solo_migraciones:
        return 0

    raiz = Path(a.proyectos)
    if not raiz.is_dir():
        print(f"No hay carpeta de proyectos en {raiz}: no se importa nada.")
        return 0
    try:
        proyectos = cargar_carpeta(raiz)
    except ProyectoInvalido as e:
        print("Proyectos NO importados; corrige estos problemas:", file=sys.stderr)
        for p in e.problemas:
            print("  -", p, file=sys.stderr)
        return 1
    for pr in proyectos:
        try:
            r = repo.importar_proyecto(pr)
        except ProyectoInvalido as e:
            print(f"Proyecto «{pr.id}» NO importado:", file=sys.stderr)
            for p in e.problemas:
                print("  -", p, file=sys.stderr)
            return 1
        print(f"Proyecto «{pr.id}»: {r['altas']} estaciones activas, {r['desactivadas']} desactivadas, "
              f"{r['sensores']} sensores.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

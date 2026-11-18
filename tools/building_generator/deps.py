"""
Mensaje claro cuando al intérprete le falta una dependencia del generador.

Sin esto, el Studio solo muestra «No module named 'shapely'», que no dice qué
Python se usó ni cómo arreglarlo. El caso típico es Windows sin `tools\\venv`:
el servidor cae al `python` del sistema, que no tiene las bibliotecas.

Solo usa la biblioteca estándar, para poder importarse aunque falte todo lo demás.
"""

from __future__ import annotations

import sys
from typing import Optional

# Módulo de Python → paquete que hay que instalar con pip.
PAQUETES = {
    "shapely": "shapely",
    "trimesh": "trimesh",
    "numpy": "numpy",
    "scipy": "scipy",
    "networkx": "networkx",
    "mapbox_earcut": "mapbox-earcut",
    "ezdxf": "ezdxf",
    "ifcopenshell": "ifcopenshell",
    "reportlab": "reportlab",
    "cadquery": "cadquery",
}


def mensaje_dependencia(exc: BaseException) -> Optional[str]:
    """Devuelve la explicación si `exc` es una dependencia ausente; si no, None."""
    if not isinstance(exc, ImportError):
        return None
    modulo = (getattr(exc, "name", None) or "").split(".")[0]
    if not modulo:
        return None
    paquete = PAQUETES.get(modulo, modulo)
    if sys.platform == "win32":
        arreglo = (
            "En Windows, desde la carpeta del proyecto: "
            "powershell -ExecutionPolicy Bypass -File tools\\setup_generator.ps1 "
            "y luego reinicia «npm run dev»."
        )
    else:
        arreglo = "Desde la carpeta del proyecto: sh tools/setup_generator.sh y luego reinicia «npm run dev»."
    return (
        f"Falta la biblioteca «{paquete}» en el Python que usa el generador "
        f"({sys.executable}, Python {sys.version.split()[0]}). {arreglo}"
    )
